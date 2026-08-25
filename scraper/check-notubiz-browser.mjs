// check-notubiz-browser.mjs — test Notubiz browser-scrape
// Draai vanuit scraper/: node check-notubiz-browser.mjs
import { withBrowser } from './src/browser.js';

const result = await withBrowser(async (page) => {
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

  // Alle tabellen
  const allTables = await page.locator('table').count();
  console.log('Tabellen op pagina:', allTables);

  const h1 = await page.locator('h1').first().textContent().catch(() => 'geen h1');
  console.log('H1:', h1);

  // Body-tekst
  const bodyText = await page.locator('body').first().innerText();
  console.log('\nBody tekst (eerste 1000 tekens):');
  console.log(bodyText.substring(0, 1000));

  // HTML rondom overview_list
  const tableIdx = html.indexOf('overview_list');
  if (tableIdx > 0) {
    console.log('\n--- HTML rond overview_list ---');
    console.log(html.substring(Math.max(0, tableIdx - 100), tableIdx + 800));
  } else {
    console.log('\nGeen overview_list in HTML gevonden');
    // Zoek andere patronen
    for (const term of ['schriftelijke', 'vragen', 'data_overview', 'loading', 'error', 'module_overview']) {
      const idx = html.toLowerCase().indexOf(term);
      if (idx > 0) console.log(`  "${term}" gevonden op positie ${idx}: ...${html.substring(idx, idx+100)}...`);
    }
  }

  // Items ophalen zoals de scraper het doet
  const items = await page.$$eval('table.overview_list tbody tr', (trs) => {
    return trs.map(tr => {
      const docLink = tr.querySelector('a[href*="/document/"]');
      const viewLink = tr.querySelector('a[href*="/modules/"]');
      const link = docLink || viewLink;
      return {
        href: link?.href || 'geen link',
        text: tr.textContent?.replace(/\s+/g, ' ').trim().substring(0, 150) || '',
      };
    });
  });
  console.log('\n--- Gevonden items ---');
  for (const item of items.slice(0, 10)) {
    console.log(`  ${item.href} | ${item.text}`);
  }

  return items.length;
}, { timeout: 90000 });

console.log(`\nTotaal items gevonden: ${result}`);
