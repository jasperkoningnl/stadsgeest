import db from './src/db.js';

// Alle B&W items met contentlengte
const items = await db.execute(`
  SELECT title, LENGTH(content) as chars, published_at,
         content
  FROM raw_items
  WHERE source_id = (SELECT id FROM sources WHERE url = 'https://amersfoort.raadsinformatie.nl/modules/12/Besluitenlijsten/view')
  ORDER BY published_at ASC
`);

let metDocs = 0, zonderDocs = 0;
let totaalChars = 0;

for (const r of items.rows) {
  const heeftDocs = r.content && r.content.includes('=== DOCUMENTEN ===');
  const docCount = heeftDocs ? (r.content.match(/--- .+ ---/g) || []).length : 0;
  const isAgenda = r.title.includes('Agenda');

  if (isAgenda) {
    console.log(`AGENDA   | ${r.published_at?.substring(0,10)} | ${(r.chars||0).toLocaleString().padStart(8)} tekens | ${docCount} docs | ${r.title.substring(0,80)}`);
  } else {
    console.log(`BESLUIT  | ${r.published_at?.substring(0,10)} | ${(r.chars||0).toLocaleString().padStart(8)} tekens | ${docCount} docs | ${r.title.substring(0,80)}`);
    if (docCount > 0) metDocs++;
    else zonderDocs++;
  }
  totaalChars += (r.chars || 0);
}

console.log(`\n--- SAMENVATTING ---`);
console.log(`Totaal items: ${items.rows.length}`);
console.log(`Totaal tekens: ${totaalChars.toLocaleString()}`);
console.log(`Besluitenlijsten met PDF-docs: ${metDocs}`);
console.log(`Besluitenlijsten zonder PDF-docs: ${zonderDocs}`);

process.exit(0);
