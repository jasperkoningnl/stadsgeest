// destadsbron-lib.mjs — pure hulpfuncties voor De Stadsbron (destadsbron.nl).
// Geen netwerk en geen database, zodat ze los te testen zijn. Gebruikt door
// scrapers/destadsbron.js.
//
// De site draait op het CMS Hypha en heeft geen RSS. De voorpagina en
// /nl/tijdlijn tonen artikelen als <li class="pagelist-item"> met titel,
// auteur, datum ("24 september 2026" plus "om 21:52u") en een samenvatting.
// Links zijn relatief ten opzichte van <base href="https://destadsbron.nl/">.
import * as cheerio from 'cheerio';

export const BASIS = 'https://destadsbron.nl/';

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** Verschuiving van Europe/Amsterdam ten opzichte van UTC in minuten, op een gegeven moment. */
function amsterdamOffsetMinuten(utcMs) {
  const delen = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', timeZoneName: 'longOffset' }).formatToParts(new Date(utcMs));
  const naam = (delen.find((d) => d.type === 'timeZoneName') || {}).value || 'GMT';
  const m = naam.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/**
 * "24 september 2026" en "om 21:52u" (Nederlandse tijd) naar ISO in UTC.
 * Zonder herkenbare datum: null. Zonder tijd: middag, zodat de kalenderdag
 * in elke tijdzone klopt.
 */
export function nlDatumIso(datumTekst, tijdTekst = '') {
  const d = String(datumTekst || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!d) return null;
  const maand = MAANDEN.indexOf(d[2]);
  if (maand < 0) return null;
  const t = String(tijdTekst || '').match(/(\d{1,2})[:.](\d{2})/);
  const uur = t ? Number(t[1]) : 12;
  const minuut = t ? Number(t[2]) : 0;
  const alsUtc = Date.UTC(Number(d[3]), maand, Number(d[1]), uur, minuut);
  const ms = alsUtc - amsterdamOffsetMinuten(alsUtc) * 60000;
  const iso = new Date(ms).toISOString();
  return Number.isNaN(ms) ? null : iso;
}

/** Artikelen uit een lijstpagina, in de volgorde van de pagina. */
export function parseLijst(html, basis = BASIS) {
  const $ = cheerio.load(html);
  const uit = [];
  $('li.pagelist-item').each((_, li) => {
    const el = $(li);
    const a = el.find('a[href]').first();
    const href = (a.attr('href') || '').trim();
    const titel = el.find('h2.title, h3.title, .title').first().text().replace(/\s+/g, ' ').trim();
    if (!href || !titel) return;
    const url = new URL(href, basis).toString();
    const auteur = el.find('.author').first().text().replace(/^door\s+/i, '').replace(/\s+/g, ' ').trim() || null;
    const datum = nlDatumIso(el.find('.published_at .date').first().text(), el.find('.published_at .time').first().text());
    const alineas = el.find('.excerpt_body p').map((__, p) => $(p).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
    const samenvatting = (alineas.length ? alineas : [el.find('.excerpt').text().replace(/\s+/g, ' ').trim()]).filter(Boolean).join('\n\n');
    uit.push({ url, titel, auteur, datum, samenvatting });
  });
  return uit;
}
