// Herstel na een afgebroken intake: hergebruik vastgelegde besluiten en herhaal
// alleen leesvragen bij een verbroken verbinding. Een onzekere write nooit retryen.
const NETWERKFOUTEN = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);

export function foutCode(error) {
  return error?.cause?.code || error?.code || (error?.cause ? foutCode(error.cause) : error?.name) || 'onbekend';
}

export async function leesMetHerkansing(db, stmt, {
  wacht = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  meld = (tekst) => console.warn(tekst),
} = {}) {
  const sql = typeof stmt === 'string' ? stmt : stmt.sql;
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
    throw new Error('Leesherkansing accepteert uitsluitend leesvragen');
  }
  for (let poging = 1; ; poging++) {
    try { return await db.execute(stmt); }
    catch (error) {
      if (poging >= 3 || !NETWERKFOUTEN.has(foutCode(error))) throw error;
      meld(`Intake-leesverbinding onderbroken (${foutCode(error)}); herkansing ${poging}/2`);
      await wacht(poging * 500);
    }
  }
}

export function herstelBesluit(itemId, besluiten, koppelingen) {
  const links = koppelingen.filter((r) => Number(r.raw_item_id) === Number(itemId));
  const eerdere = besluiten.filter((r) => Number(r.raw_item_id) === Number(itemId))
    .sort((a, b) => Number(a.id) - Number(b.id));
  // Een link kan al zijn opgeslagen terwijl de besluitbuffer nog niet is geflusht.
  // Bestaande koppelingen nooit nogmaals tellen of last_seen_at opnieuw verversen.
  if (links.length) {
    const passend = eerdere.find((r) => links.some((l) => Number(l.signal_id) === Number(r.signal_id)));
    return {
      decision: passend?.decision || 'matched',
      signal_id: passend?.signal_id || links[0].signal_id,
      reason: `hervat na afgebroken intake; bestaande koppeling behouden: ${passend?.reason || 'bronitem was al gekoppeld'}`,
    };
  }
  const gefilterd = eerdere.find((r) => r.decision === 'filtered');
  return gefilterd ? { decision: 'filtered', signal_id: null,
    reason: `hervat na afgebroken intake: ${gefilterd.reason}` } : null;
}

export function maakBatcher(db, flushSize = 50) {
  let buffer = [];
  let fout = null;
  const flush = async () => {
    if (fout) throw fout; // Een mogelijk uitgevoerde write niet opnieuw versturen.
    if (!buffer.length) return;
    const chunk = buffer.slice();
    try { await db.batch(chunk, 'write'); }
    catch (error) { fout = error; throw error; }
    buffer.splice(0, chunk.length);
  };
  return {
    async push(stmt) { buffer.push(stmt); if (buffer.length >= flushSize) await flush(); },
    flush,
  };
}
