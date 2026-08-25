// check-notubiz-browser.mjs — test Notubiz browser-scrape op Jaspers laptop
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
});
const page = await ctx.newPage();

// Vang responses op om networkidle langer actief te houden
page.on('response', async (resp) => { try { await resp.text(); } catch {} });

console.log('Laden: schriftelijke vragen...');
await page.goto('https://amersfoort.notubiz.nl/modules/4/schriftelijke_vragen/view', {
  waitUntil: 'networkidle', timeout: 40000,
}).catch(() => console.log('  goto timeout (normaal)'));

await page.waitForSelector('table.overview_list tbody tr td', { timeout: 15000 })
  .catch(() => console.log('  geen tabel.overview_list gevonden'));

await page.waitForTimeout(500);

const html = await page.content();
console.log('Pagina-lengte:', html.length);

// Tel rijen
const rows = await page.locator('table.overview_list tbody tr').count();
console.log('Tabelrijen (overview_list):', rows);

// Probeer ook andere selectors
const allTables = await page.locator('table').count();
console.log('Tabellen op pagina:', allTables);

const h1 = await page.locator('h1').first().textContent().catch(() => 'geen h1');
console.log('H1:', h1);

// Check body-tekst
const bodyText = await page.locator('body').first().innerText();
console.log('\nBody tekst (eerste 800 tekens):', bodyText.substring(0, 800));

// Screendump van de HTML (rondom de tabel)
const tableIdx = html.indexOf('overview_list');
if (tableIdx > 0) {
  console.log('\n--- HTML rond overview_list ---');
  console.log(html.substring(Math.max(0, tableIdx - 200), tableIdx + 1000));
} else {
  console.log('\nGeen overview_list in HTML gevonden');
  // Zoek naar andere patronen
  for (const term of ['schriftelijke', 'vragen', 'data_overview', 'loading', 'error']) {
    const idx = html.toLowerCase().indexOf(term);
    if (idx > 0) console.log(`  "${term}" gevonden op positie ${idx}`);
  }
}

await browser.close();
