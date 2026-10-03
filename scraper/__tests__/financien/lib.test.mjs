import test from 'node:test';
import assert from 'node:assert/strict';
import { publicatieDatum, volledigePdf, websitePublicaties } from '../../src/financien-lib.mjs';

// Linkteksten zoals ze op 3 oktober 2026 op financien.amersfoort.nl stonden.
const links = [
  { href: 'https://amersfoort.jaarverslag-2025.nl', tekst: '2025 Vastgesteld op 8 juli 2026' },
  { href: 'https://amersfoort.jaarverslag-2023.nl', tekst: '2023 Vastgesteld op 18 juni 2024' },
  { href: 'https://amersfoort.begroting-2027.nl', tekst: '2027 - 2030\n   Gepubliceerd op 30 september 2026' },
  { href: 'https://amersfoort.begroting-2027.nl', tekst: 'dubbele link' },
  { href: 'https://amersfoort.begroting-2026.nl', tekst: '2026 - 2029 Vastgesteld op 11 november 2025' },
  { href: 'http://amersfoort.begroting-2019.nl/', tekst: '2019 - 2022 Vastgesteld op 6 november 2018' },
  { href: 'https://amersfoort.begroting-2024.nl', tekst: '2024 - 2027 Vastgesteld op 7 november2023' },
  { href: '/assets/docs/Zomerrapportage 2026.pdf', tekst: '2026 gepubliceerd op 23 september2026' },
];

test('leest een Nederlandse publicatiedatum, ook zonder spatie voor het jaar', () => {
  assert.equal(publicatieDatum('Gepubliceerd op 30 september 2026'), '2026-09-30');
  assert.equal(publicatieDatum('Vastgesteld op 7 november2023'), '2023-11-07');
  assert.equal(publicatieDatum('Gepubliceerd in 2021'), null);
});

test('neemt alleen begrotings- en jaarverslagwebsites uit dit en vorig jaar, elk één keer', () => {
  const uit = websitePublicaties(links, new Date('2026-10-03'));
  assert.deepEqual(uit.map((p) => p.site), [
    'https://amersfoort.jaarverslag-2025.nl',
    'https://amersfoort.begroting-2027.nl',
    'https://amersfoort.begroting-2026.nl',
  ]);
  assert.equal(uit[1].titel, 'Begroting gemeente Amersfoort 2027 - 2030 Gepubliceerd op 30 september 2026');
  assert.equal(uit[1].publicatiedatum, '2026-09-30');
  assert.equal(uit[0].soort, 'Jaarverslag');
});

test('vindt de pdf van het hele stuk op de startpagina van de website', () => {
  const html = '<a href="/p9979/leeswijzer">Leeswijzer</a><a href="/assets/docs/Meerjarenbegroting_2027-2030.pdf">PDF</a>';
  assert.equal(volledigePdf(html, 'https://amersfoort.begroting-2027.nl'), 'https://amersfoort.begroting-2027.nl/assets/docs/Meerjarenbegroting_2027-2030.pdf');
  assert.equal(volledigePdf('<a href="/p1/x">x</a>', 'https://amersfoort.begroting-2027.nl'), null);
});

test('maakt een leesbare titel uit bestandsnaam en linktekst', async () => {
  const { pdfTitel } = await import('../../src/financien-lib.mjs');
  assert.equal(pdfTitel('/assets/docs/Zomerrapportage 2026.pdf', '2026\n      gepubliceerd op 23 september2026'),
    'Zomerrapportage 2026 (2026 gepubliceerd op 23 september 2026)');
  assert.equal(pdfTitel('https://financien.amersfoort.nl/assets/docs/Gemeente Amersfoort Jaarstukken 2016.pdf', '2016Gepubliceerd in 2017'),
    'Gemeente Amersfoort Jaarstukken 2016 (2016 Gepubliceerd in 2017)');
  assert.equal(pdfTitel('/assets/docs/Treasurystatuut_Amersfoort.pdf', ''), 'Treasurystatuut Amersfoort');
  assert.equal(pdfTitel('/assets/docs/Kaderbrief%202027-2030.pdf', 'Kaderbrief 2027-2030'), 'Kaderbrief 2027-2030');
});
