// P9-opschoning 2026-08-02: 12 vervuilde signalen (woordoverlap-matchingbug).
// Discarded signalen: alle items loskoppelen. Published: alleen inhoudelijk passende items behouden.
// Losgekoppelde items die nergens meer aan hangen: is_processed=0 (keuze Jasper: opnieuw door intake).
// Alles gelogd naar opschoning-2026-08-02.md (terugdraaibaar).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// per published signaal: regex die een item moet matchen (titel+summary) om te blijven
const KEEP = {
  207: /bijlholt/i,
  97: /zakkenroll|diefstal.*zak|pickpocket/i,
  209: /turpijnplaats|steekincident|schothorst.*steek|steek.*schothorst/i,
  80: /starterslening/i,
  210: /soesterkwartier.*(parkeer|parkeren)|betaald parkeren.*soesterkwartier|parkeer.*soesterkwartier/i,
};
const STRIP_ALL = [98, 31, 35, 33, 197, 41, 32]; // discarded: alles los

(async () => {
  const log = [`# Opschoning P9 — 2026-08-02\n`];
  let totLos = 0;
  const all = [...STRIP_ALL, ...Object.keys(KEEP).map(Number)];
  for (const id of all) {
    const sig = (await db.execute({ sql: "SELECT id,title,status FROM signals WHERE id=?", args: [id] })).rows[0];
    if (!sig) { log.push(`\n## #${id}: bestaat niet`); continue; }
    const items = (await db.execute({ sql: "SELECT r.id, r.title, COALESCE(r.summary,'') s FROM raw_items r JOIN signal_items si ON si.raw_item_id=r.id WHERE si.signal_id=?", args: [id] })).rows;
    const keepRe = KEEP[id];
    const remove = items.filter(it => !keepRe || !(keepRe.test(it.title || '') || keepRe.test(it.s)));
    const keep = items.length - remove.length;
    log.push(`\n## #${id} [${sig.status}] "${String(sig.title).substring(0, 70)}" — ${items.length} items, ${keep} behouden, ${remove.length} losgekoppeld`);
    for (const it of remove) log.push(`- los: item ${it.id} :: ${String(it.title).substring(0, 90)}`);
    if (remove.length) {
      const ids = remove.map(r => r.id);
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        await db.execute({ sql: `DELETE FROM signal_items WHERE signal_id=${id} AND raw_item_id IN (${chunk.map(() => '?').join(',')})`, args: chunk });
        // items zonder resterende signaalkoppeling: opnieuw vrijgeven voor intake
        await db.execute({ sql: `UPDATE raw_items SET is_processed=0 WHERE id IN (${chunk.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM signal_items si WHERE si.raw_item_id = raw_items.id)`, args: chunk });
      }
      totLos += remove.length;
    }
    await db.execute({ sql: "UPDATE signals SET confirmations = MAX(1,(SELECT COUNT(*) FROM signal_items WHERE signal_id=?)) WHERE id=?", args: [id, id] });
    await db.execute({ sql: "INSERT INTO signal_events (signal_id, actor, event_type, reason) VALUES (?, 'opschoning', 'cleanup', ?)", args: [id, `P9-opschoning: ${remove.length} vals gekoppelde items losgekoppeld (matchingbug), ${keep} behouden. Zie opschoning-2026-08-02.md.`] });
  }
  const vrij = (await db.execute("SELECT COUNT(*) n FROM raw_items WHERE is_processed=0")).rows[0].n;
  log.push(`\n---\nTotaal losgekoppeld: ${totLos}. Items nu op is_processed=0 (klaar voor herintake): ${vrij}.`);
  fs.writeFileSync(path.join(__dirname, '..', 'opschoning-2026-08-02.md'), log.join('\n') + '\n', 'utf8');
  console.log(`Klaar. ${totLos} items losgekoppeld over ${all.length} signalen. ${vrij} items vrijgegeven voor herintake. Log: opschoning-2026-08-02.md`);
})().catch(e => { console.error(e); process.exit(1); });
