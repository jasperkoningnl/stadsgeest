// financien-lib.mjs — pure hulpfuncties voor scrapers/financien-amersfoort.js.
// Toegevoegd 2026-10-03. Geen netwerk, geen database.
//
// De begroting en het jaarverslag staan niet als pdf op financien.amersfoort.nl
// maar als eigen website (amersfoort.begroting-2027.nl, amersfoort.jaarverslag-
// 2025.nl). De scraper pakte alleen pdf-links en miste ze daardoor. Elke website
// biedt het hele stuk ook als één pdf aan onder /assets/docs/.

const SITE = /^https?:\/\/amersfoort\.(begroting|jaarverslag)-(\d{4})\.nl\/?$/i;
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// "Gepubliceerd op 30 september 2026" of "Vastgesteld op 7 november2023" -> 2026-09-30.
// Alleen een jaartal ("Gepubliceerd in 2021") geeft null.
export function publicatieDatum(tekst) {
  const m = String(tekst || '').match(/(\d{1,2})\s+([a-z]+)\s*(\d{4})/i);
  if (!m) return null;
  const maand = MAANDEN.indexOf(m[2].toLowerCase());
  if (maand < 0) return null;
  return `${m[3]}-${String(maand + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Links naar begrotings- en jaarverslagwebsites, met een leesbare titel.
// `links` is een lijst { href, tekst }. Alleen publicaties uit het lopende of
// vorige jaar: oudere jaargangen zijn archief en zouden bij de eerste run een
// golf oude signalen geven.
export function websitePublicaties(links, nu = new Date()) {
  const uit = [];
  const gezien = new Set();
  for (const { href, tekst } of links) {
    const m = String(href || '').trim().match(SITE);
    if (!m) continue;
    const site = `https://amersfoort.${m[1].toLowerCase()}-${m[2]}.nl`;
    if (gezien.has(site)) continue;
    gezien.add(site);
    const schoon = String(tekst || '').replace(/\s+/g, ' ').trim();
    // Geen woordgrens: de pagina schrijft ook "7 november2023".
    const jaren = [...schoon.matchAll(/(20\d{2})/g)].map((j) => Number(j[1]));
    const publicatiejaar = jaren.length ? jaren[jaren.length - 1] : Number(m[2]);
    if (publicatiejaar < nu.getFullYear() - 1) continue;
    const soort = m[1].toLowerCase() === 'begroting' ? 'Begroting' : 'Jaarverslag';
    uit.push({ site, soort, jaar: m[2], titel: `${soort} gemeente Amersfoort ${schoon}`.slice(0, 200), publicatiedatum: publicatieDatum(schoon) });
  }
  return uit;
}

// De pdf van het hele stuk op de startpagina van zo'n website, of null.
export function volledigePdf(html, site) {
  const m = String(html || '').match(/href=["']([^"']*\/assets\/docs\/[^"']+\.pdf)["']/i);
  if (!m) return null;
  return new URL(m[1], `${site}/`).toString();
}
