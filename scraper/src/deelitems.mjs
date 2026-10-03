// deelitems.mjs — deelitems van een lang document wegschrijven en bijhouden.
// Toegevoegd 2026-10-03; het waarom staat in deelitems-lib.mjs. De koppeling
// hoofditem → deel staat in raw_item_parts (migrate-raw-item-parts.mjs).
//
// werkDeelitemsBij is idempotent: een deel met dezelfde tekst blijft ongemoeid,
// een deel met andere tekst wordt bijgewerkt en opnieuw gescand, een deel dat
// niet meer nodig is wordt leeggemaakt (niet verwijderd: vermeldingen verwijzen
// naar het item). Geef altijd de volledige, niet-afgekapte tekst mee.
import { contentHash } from './utils.js';
import { deelVelden, isDeelitem, verdeelRest } from './deelitems-lib.mjs';

async function wisScans(db, rawItemId) {
  for (const tabel of ['ner_scans', 'address_scans', 'document_addresses']) {
    try { await db.execute({ sql: `DELETE FROM ${tabel} WHERE raw_item_id = ?`, args: [rawItemId] }); } catch { /* tabel bestaat niet in deze database */ }
  }
}

export async function werkDeelitemsBij(db, ouderId, volledigeTekst) {
  const uit = { aangemaakt: 0, bijgewerkt: 0, ongewijzigd: 0, vervallen: 0 };
  const ouder = (await db.execute({
    sql: 'SELECT id, source_id, external_url, title, scraped_at, published_at FROM raw_items WHERE id = ?', args: [ouderId],
  })).rows[0];
  if (!ouder || !ouder.external_url || isDeelitem(ouder)) return uit;

  const delen = verdeelRest(volledigeTekst);
  const bestaand = new Map((await db.execute({
    sql: 'SELECT part_id, deel FROM raw_item_parts WHERE parent_id = ?', args: [ouderId],
  })).rows.map((r) => [Number(r.deel), Number(r.part_id)]));
  if (!delen.length && !bestaand.size) return uit;

  const totaal = delen.length + 1;
  const nu = new Date().toISOString();
  for (const deel of delen) {
    const v = deelVelden(ouder, deel, totaal);
    const hash = contentHash(`${v.title}${v.external_url}`);
    let partId = bestaand.get(deel.nummer);
    if (!partId) {
      try {
        const r = await db.execute({
          sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary, scraped_at, content_hash,
                  is_processed, is_historical, full_text, fulltext_fetched_at, published_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
          args: [ouder.source_id, v.external_url, v.title, v.content, v.summary, ouder.scraped_at, hash, deel.tekst, nu, ouder.published_at],
        });
        partId = Number(r.lastInsertRowid);
        uit.aangemaakt++;
      } catch (e) {
        // Het item bestaat al zonder koppelrij (afgebroken run): koppel het alsnog.
        if (!String(e.message).includes('UNIQUE constraint failed')) throw e;
        partId = Number((await db.execute({
          sql: 'SELECT id FROM raw_items WHERE source_id = ? AND content_hash = ?', args: [ouder.source_id, hash],
        })).rows[0].id);
      }
      await db.execute({
        sql: 'INSERT OR REPLACE INTO raw_item_parts (part_id, parent_id, deel, van, tot) VALUES (?, ?, ?, ?, ?)',
        args: [partId, ouderId, deel.nummer, deel.van, deel.tot],
      });
      continue;
    }
    const w = await db.execute({
      sql: `UPDATE raw_items SET title = ?, content = ?, summary = ?, content_hash = ?, full_text = ?,
              fulltext_fetched_at = ?, entities_scanned_at = NULL
            WHERE id = ? AND COALESCE(full_text, '') <> ?`,
      args: [v.title, v.content, v.summary, hash, deel.tekst, nu, partId, deel.tekst],
    });
    if (!w.rowsAffected) { uit.ongewijzigd++; continue; }
    await wisScans(db, partId);
    await db.execute({ sql: 'UPDATE raw_item_parts SET van = ?, tot = ? WHERE part_id = ?', args: [deel.van, deel.tot, partId] });
    uit.bijgewerkt++;
  }

  for (const [nummer, partId] of bestaand) {
    if (nummer <= totaal) continue;
    const w = await db.execute({
      sql: `UPDATE raw_items SET full_text = NULL, entities_scanned_at = NULL,
              content = 'Vervallen deel: het document is korter geworden.'
            WHERE id = ? AND full_text IS NOT NULL`,
      args: [partId],
    });
    if (w.rowsAffected) { await wisScans(db, partId); uit.vervallen++; }
  }
  return uit;
}

// Na een lange download of pdf-extractie sluit Turso de wachtende verbinding
// en geeft de eerste query "fetch failed". werkDeelitemsBij is idempotent, dus
// opnieuw proberen is veilig. Gezien op 3 oktober 2026 bij pdf's van 15 MB.
export async function werkDeelitemsBijMetHerkansing(db, ouderId, volledigeTekst, { pogingen = 4, wachtMs = 1500 } = {}) {
  for (let poging = 1; ; poging++) {
    try {
      return await werkDeelitemsBij(db, ouderId, volledigeTekst);
    } catch (e) {
      const melding = `${e.message} ${e.cause?.message || ''}`;
      if (poging >= pogingen || !/fetch failed|socket|ECONNRESET/i.test(melding)) throw e;
      await new Promise((klaar) => setTimeout(klaar, wachtMs * poging));
    }
  }
}

// Dezelfde herkansing voor een losse databaseopdracht. Alleen voor opdrachten
// die veilig twee keer mogen lopen (UPDATE op id, SELECT, idempotente INSERT).
export async function herkansBijVerbrokenVerbinding(opdracht, { pogingen = 3, wachtMs = 1500 } = {}) {
  for (let poging = 1; ; poging++) {
    try {
      return await opdracht();
    } catch (e) {
      const melding = `${e.message} ${e.cause?.message || ''}`;
      if (poging >= pogingen || !/fetch failed|socket|ECONNRESET/i.test(melding)) throw e;
      await new Promise((klaar) => setTimeout(klaar, wachtMs * poging));
    }
  }
}
