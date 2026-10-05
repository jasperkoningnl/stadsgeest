// Snelle Notubiz-test — draai vanuit scraper/
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
console.log('Browser gestart, pagina laden...');
try {
  await page.goto('https://amersfoort.notubiz.nl/modules/4/schriftelijke_vragen/view', { timeout: 30000 });
  console.log('Pagina geladen, wachten op tabel...');
  await page.waitForSelector('table.overview_list tbody tr', { timeout: 15000 }).catch(() => console.log('Geen overview_list'));
  const rows = await page.locator('table.overview_list tbody tr').count().catch(() => 0);
  console.log('Rijen:', rows);
  if (rows === 0) {
    // Check wat er wel is
    const title = await page.title();
    console.log('Title:', title);
    const tables = await page.locator('table').count();
    console.log('Tabellen:', tables);
    const bodyLen = (await page.locator('body').innerText()).length;
    console.log('Body tekst lengte:', bodyLen);
  }
} catch(e) { console.log('Fout:', e.message.substring(0,200)); }
await browser.close();
console.log('Klaar');
