import db from './src/db.js';

// Totale omvang raw_items
const totaal = await db.execute(`
  SELECT COUNT(*) as items,
         SUM(LENGTH(content)) as content_chars,
         SUM(LENGTH(title)) as title_chars,
         SUM(LENGTH(summary)) as summary_chars
  FROM raw_items
`);
const t = totaal.rows[0];
const totalMB = ((t.content_chars || 0) + (t.title_chars || 0) + (t.summary_chars || 0)) / 1024 / 1024;
console.log(`TOTAAL: ${t.items} items, ~${totalMB.toFixed(1)} MB tekst`);

// Top 10 bronnen op content-grootte
const bronnen = await db.execute(`
  SELECT s.name, COUNT(*) as items,
         SUM(LENGTH(ri.content)) as chars,
         ROUND(SUM(LENGTH(ri.content)) / 1024.0 / 1024.0, 2) as mb
  FROM raw_items ri JOIN sources s ON ri.source_id = s.id
  GROUP BY s.id ORDER BY chars DESC LIMIT 15
`);
console.log('\nTop 15 bronnen op contentgrootte:');
for (const r of bronnen.rows) {
  console.log(`  ${String(r.mb).padStart(7)} MB | ${String(r.items).padStart(5)} items | ${r.name}`);
}

// B&W specifiek: hoeveel docs zitten er in de content?
const bw = await db.execute(`
  SELECT title, LENGTH(content) as chars,
         CASE WHEN content LIKE '%=== DOCUMENTEN ===%' THEN 'ja' ELSE 'nee' END as heeft_docs
  FROM raw_items
  WHERE source_id = (SELECT id FROM sources WHERE url = 'https://amersfoort.raadsinformatie.nl/modules/12/Besluitenlijsten/view')
  AND title LIKE '%Besluitenlijst%'
  ORDER BY chars DESC
`);
console.log(`\nB&W besluitenlijsten: ${bw.rows.length} items`);
let at50k = 0;
for (const r of bw.rows) {
  if (r.chars >= 49999) at50k++;
}
console.log(`  Waarvan op 50.000-limiet: ${at50k}`);

process.exit(0);
