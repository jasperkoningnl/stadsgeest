/**
 * Eenmalige backfill: splits alle reeds verwerkte B&W-besluitenlijsten
 * in losse inhoudelijke documenten. Draai: node backfill-omnibus.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const TURSO_URL = process.env.TURSO_URL.replace('libsql://', 'https://');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function query(sql, args = []) {
  const stmt = args.length > 0
    ? { sql, args: args.map(a => ({ type: a === null ? 'null' : typeof a === 'number' ? 'integer' : 'text', value: a === null ? null : String(a) })) }
    : { sql };
  const resp = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  });
  const data = await resp.json();
  const r = data.results[0];
  if (r.type === 'error') throw new Error(r.error.message);
  return r.response.result;
}

const PROCEDUREEL = /besluitenlijst\s+(b\.|hamerstukken)|invitaties|collegebericht/i;

async function main() {
  // Haal alle besluitenlijsten op met een documentensectie
  const items = await query(`
    SELECT r.id, r.source_id, r.external_url, r.scraped_at, r.is_historical
    FROM raw_items r JOIN sources s ON r.source_id = s.id
    WHERE (LOWER(s.name) LIKE '%besluitenlijst%' OR LOWER(r.title) LIKE '%besluitenlijst%')
    AND r.is_processed = 1
    AND r.content LIKE '%=== DOCUMENTEN ===%'
  `);
  const cols = items.cols.map(c => c.name);
  console.log(`${items.rows.length} besluitenlijsten met documentensectie gevonden`);

  let totalSplit = 0, totalProc = 0;

  for (const row of items.rows) {
    const itemId = row[0].value;
    const sourceId = row[1].value;
    const extUrl = row[2].type !== 'null' ? row[2].value : null;
    const scrapedAt = row[3].value;
    const isHist = row[4].type !== 'null' ? Number(row[4].value) : 0;

    // Haal content op in delen (max 50000 tekens)
    let content = '';
    for (let offset = 0; offset < 50001; offset += 10000) {
      const part = await query(`SELECT SUBSTR(content, ${offset + 1}, 10000) as part FROM raw_items WHERE id = ?`, [Number(itemId)]);
      content += (part.rows[0]?.[0]?.value || '');
    }

    const docsSplit = content.split('=== DOCUMENTEN ===');
    if (docsSplit.length < 2 || docsSplit[1].trim().length < 50) continue;

    const docParts = docsSplit[1].split(/\n--- (.+?) ---\n/);
    let gesplitst = 0, procedureel = 0;

    for (let d = 1; d < docParts.length; d += 2) {
      const docTitle = docParts[d].trim();
      const docBody = (docParts[d + 1] || '').trim();
      if (PROCEDUREEL.test(docTitle)) { procedureel++; continue; }
      if (docBody.length < 100) continue;
      const splitTitle = docTitle.replace(/^\d{6}\w?\s*[-–]\s*/, '');

      // Check of dit stuk al bestaat (dedup op titel)
      const exists = await query(
        `SELECT COUNT(*) as n FROM raw_items WHERE title = ? AND source_id = ?`,
        [`[B&W] ${splitTitle}`, Number(sourceId)]
      );
      if (Number(exists.rows[0][0].value) > 0) continue;

      await query(
        `INSERT INTO raw_items (source_id, external_url, title, content, summary, scraped_at, is_processed, is_historical)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [Number(sourceId), extUrl, `[B&W] ${splitTitle}`, docBody.substring(0, 50000),
         `Gesplitst uit besluitenlijst (item #${itemId}): ${splitTitle}`, scrapedAt, isHist]
      );
      gesplitst++;
    }
    if (gesplitst > 0 || procedureel > 0) {
      console.log(`  #${itemId}: ${gesplitst} gesplitst, ${procedureel} procedureel`);
    }
    totalSplit += gesplitst;
    totalProc += procedureel;
  }

  console.log(`\nTotaal: ${totalSplit} inhoudelijke stukken als nieuwe items ingevoegd, ${totalProc} procedurele stukken overgeslagen`);
}

main().catch(e => { console.error('FOUT:', e.message); process.exitCode = 1; });
