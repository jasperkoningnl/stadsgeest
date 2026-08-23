// Bronnenwacht (P4, 2026-08-02).
// MEETPRINCIPE: scrapers liggen bewust vaak stil; gezondheid wordt gemeten in RUNS, nooit in kalendertijd.
// Draait aan het eind van elke run-file. Kijkt per bron naar de laatste gelogde runs in scrape_runs.
// - 'verdacht': laatste 6 runs allemaal 0 items terwijl expected_yield > 0.3, of >=3 fouten in laatste 6
// - 'dood'    : laatste 12 runs allemaal 0 items of fout
// Schrijft health/health_note in sources, rapport naar ../bronnenwacht/, en een
// WAARSCHUWING in STATUS.md als de zojuist afgeronde job < 10 nieuwe items opleverde.
//
// 2026-08-23: reces-bewustheid toegevoegd. Bronnen in category 'government' met
// 'raad' of 'raadsinformatie' in de naam worden in juli–augustus niet als verdacht
// of dood gemarkeerd — de raad vergadert dan niet. Ze krijgen health 'reces' met
// een verklarende note, zodat de bronnenwacht ze niet elke dag rapporteert maar
// ze na het reces (september) weer normaal oppikt.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function ensureColumns() {
  const cols = (await db.execute("PRAGMA table_info(sources)")).rows.map(r => r.name);
  if (!cols.includes('expected_yield')) await db.execute("ALTER TABLE sources ADD COLUMN expected_yield REAL");
  if (!cols.includes('health')) await db.execute("ALTER TABLE sources ADD COLUMN health TEXT DEFAULT 'ok'");
  if (!cols.includes('health_note')) await db.execute("ALTER TABLE sources ADD COLUMN health_note TEXT");
  if (!cols.includes('last_health_check')) await db.execute("ALTER TABLE sources ADD COLUMN last_health_check TEXT");
}

// Raadsreces: de Amersfoortse raad vergadert niet in juli en augustus
// (schoolvakanties). Bronnen die alleen raadsstukken leveren zijn dan
// structureel leeg — dat is geen storing.
function isRaadsbron(source) {
  const naam = (source.name || '').toLowerCase();
  return naam.includes('raad amersfoort') || naam.includes('raadsinformatie');
}

function isReces() {
  const maand = new Date().getMonth(); // 0-indexed: 6=juli, 7=augustus
  return maand === 6 || maand === 7;
}

async function main() {
  await ensureColumns();
  const jobName = process.env.SCRAPE_JOB_NAME || null;

  // expected_yield herberekenen voor bronnen met >=10 gelogde runs
  await db.execute(`
    UPDATE sources SET expected_yield = (
      SELECT AVG(CASE WHEN sr.items_found > 0 THEN 1.0 ELSE 0.0 END)
      FROM scrape_runs sr WHERE sr.source_id = sources.id
    )
    WHERE id IN (SELECT source_id FROM scrape_runs GROUP BY source_id HAVING COUNT(*) >= 10)
  `);

  const sources = (await db.execute("SELECT id, name, url, category, expected_yield, health FROM sources WHERE COALESCE(health,'ok') != 'uitgeschakeld'")).rows;
  const regels = [];
  let nVerdacht = 0, nDood = 0, nReces = 0;

  for (const s of sources) {
    const runs = (await db.execute({ sql: "SELECT items_found, status FROM scrape_runs WHERE source_id = ? ORDER BY id DESC LIMIT 12", args: [s.id] })).rows;
    if (runs.length < 6) continue; // te weinig actieve runs om iets te zeggen — géén kalenderoordeel
    const l6 = runs.slice(0, 6);
    const yieldVerwacht = s.expected_yield == null ? 0.5 : s.expected_yield;
    const leeg6 = l6.every(r => (r.items_found || 0) === 0);
    const fout6 = l6.filter(r => r.status === 'error' || r.status === 'timeout').length;
    const leeg12 = runs.length >= 12 && runs.every(r => (r.items_found || 0) === 0 || r.status === 'error');

    let health = 'ok', note = null;

    // Reces-check: raadsbronnen in juli/augustus krijgen 'reces' in plaats van
    // 'verdacht' of 'dood', mits het probleem leegte is (niet fouten).
    if ((leeg12 || (leeg6 && yieldVerwacht > 0.3)) && isRaadsbron(s) && isReces() && fout6 === 0) {
      health = 'reces';
      note = 'Raad op zomerreces — leeg is verwacht gedrag. Wordt na augustus opnieuw beoordeeld.';
      nReces++;
    } else if (leeg12) {
      health = 'dood';
      note = `0 items of fout in laatste ${runs.length} runs`;
    } else if (leeg6 && yieldVerwacht > 0.3) {
      health = 'verdacht';
      note = `0 items in laatste 6 runs, historisch levert deze bron in ${Math.round(yieldVerwacht * 100)}% van de runs`;
    } else if (fout6 >= 3) {
      health = 'verdacht';
      note = `${fout6} van laatste 6 runs faalden`;
    }

    // classificatie via fetch voor verdachte/dode bronnen
    if ((health === 'verdacht' || health === 'dood') && s.url) {
      try {
        const resp = await fetch(s.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (StadsgeestBronnenwacht)' } });
        note += resp.ok ? `; URL bereikbaar (HTTP ${resp.status}) — feed leeg of structuur gewijzigd` : `; URL geeft HTTP ${resp.status}`;
      } catch (e) { note += `; URL niet bereikbaar (${e.name})`; }
    }

    if (health !== (s.health || 'ok') || health !== 'ok') {
      await db.execute({ sql: "UPDATE sources SET health = ?, health_note = ?, last_health_check = datetime('now') WHERE id = ?", args: [health, note, s.id] });
    } else {
      await db.execute({ sql: "UPDATE sources SET last_health_check = datetime('now') WHERE id = ?", args: [s.id] });
    }
    if (health === 'verdacht') { nVerdacht++; regels.push(`- VERDACHT: ${s.name} — ${note}`); }
    if (health === 'dood') { nDood++; regels.push(`- DOOD: ${s.name} — ${note}`); }
    if (health === 'reces') { regels.push(`- RECES: ${s.name} — ${note}`); }
  }

  // rapport
  const dir = path.join(__dirname, '..', '..', 'bronnenwacht');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const datum = new Date().toISOString().substring(0, 10);
  const kop = `# Bronnenwacht ${datum}${jobName ? ` (na job ${jobName})` : ''}\n\nGemeten in runs (niet kalendertijd). ${nVerdacht} verdacht, ${nDood} dood${nReces ? `, ${nReces} reces` : ''}.\n\n`;
  fs.writeFileSync(path.join(dir, `rapport-${datum}.md`), kop + (regels.length ? regels.join('\n') : 'Geen afwijkingen.') + '\n', 'utf8');
  console.log(`Bronnenwacht: ${sources.length} bronnen gecheckt, ${nVerdacht} verdacht, ${nDood} dood${nReces ? `, ${nReces} reces` : ''}. Rapport: bronnenwacht/rapport-${datum}.md`);

  // heartbeat: leverde deze job < 10 nieuwe items, waarschuw in STATUS.md
  if (jobName) {
    const tot = (await db.execute({ sql: "SELECT COALESCE(SUM(items_new),0) n FROM scrape_runs WHERE job_name = ? AND created_at > datetime('now','-2 hours')", args: [jobName] })).rows[0].n;
    if (Number(tot) < 10) {
      const statusPad = path.join(__dirname, '..', '..', 'STATUS.md');
      try {
        fs.appendFileSync(statusPad, `\n**WAARSCHUWING bronnenwacht ${new Date().toISOString()}:** job ${jobName} leverde slechts ${tot} nieuwe items. Check bronnenwacht/rapport-${datum}.md.\n`, 'utf8');
      } catch (e) { console.error('Kon STATUS.md niet bijwerken:', e.message); }
      console.log(`WAARSCHUWING: job ${jobName} leverde slechts ${tot} nieuwe items.`);
    }
  }
}
main().catch(e => { console.error('Bronnenwacht-fout:', e.message); process.exit(0); }); // nooit de run laten falen
