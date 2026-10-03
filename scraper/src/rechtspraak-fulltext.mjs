// rechtspraak-fulltext.mjs — tekst van een uitspraak via data.rechtspraak.nl.
// Toegevoegd 2026-10-03. Geen database; fetch is injecteerbaar voor de tests.
//
// Waarom: twee groepen uitspraken bleven zonder tekst.
// 1. Oudere items hebben een URL naar uitspraken.rechtspraak.nl/details. Dat is
//    een JavaScript-pagina zonder tekst; de uitspraak zelf staat als XML op
//    data.rechtspraak.nl/uitspraken/content?id=<ECLI>.
// 2. De Rechtspraak registreert een ECLI vaak dagen of weken voordat de tekst
//    erbij komt. Het XML bevat dan alleen metadata. fetch-fulltext.js probeert
//    zulke items daarom later opnieuw.

const MIN_TEXT = 200;
const UA_STANDAARD = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';
const ECLI = /^ECLI:[A-Z]{2}:[A-Z0-9]+:\d{4}:[A-Z0-9.]+$/i;

// ECLI uit een rechtspraak.nl-URL (details, inziendocument, deeplink of de
// open-data-URL zelf). Andere hosts geven null.
export function rechtspraakEcli(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (host !== 'rechtspraak.nl' && !host.endsWith('.rechtspraak.nl')) return null;
    const id = (url.searchParams.get('id') || '').trim();
    return ECLI.test(id) ? id.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function rechtspraakContentUrl(ecli) {
  return `https://data.rechtspraak.nl/uitspraken/content?id=${encodeURIComponent(ecli)}`;
}

function platteTekst(xml) {
  return String(xml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function element(xml, naam) {
  const m = String(xml || '').match(new RegExp(`<${naam}[\\s>][\\s\\S]*?</${naam}>`));
  return m ? platteTekst(m[0]) : '';
}

// Inhoudsindicatie plus de uitspraak (of conclusie) uit het open-data-XML.
// De RDF-metadata telt niet mee: een ECLI zonder gepubliceerde tekst geeft ''.
export function uitspraakTekst(xml) {
  const lichaam = element(xml, 'uitspraak') || element(xml, 'conclusie');
  if (!lichaam) return '';
  const indicatie = element(xml, 'inhoudsindicatie');
  return indicatie && !lichaam.startsWith(indicatie) ? `${indicatie} ${lichaam}` : lichaam;
}

// Resultaat: { text, reason }. `alleen metadata` betekent dat de ECLI bestaat
// maar de tekst (nog) niet is gepubliceerd; dat kan later alsnog gebeuren.
export async function haalRechtspraakTekst(url, { fetchFn = fetch, ua = UA_STANDAARD, minText = MIN_TEXT } = {}) {
  const ecli = rechtspraakEcli(url);
  if (!ecli) return { text: null, reason: 'geen ECLI in de URL' };
  let r;
  try {
    r = await fetchFn(rechtspraakContentUrl(ecli), {
      headers: { 'User-Agent': ua, Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { text: null, reason: `fout: ${e.message}` };
  }
  if (!r.ok) return { text: null, reason: `http_${r.status}` };
  const text = uitspraakTekst(await r.text());
  return text.length >= minText ? { text, reason: null } : { text: null, reason: 'alleen metadata (tekst nog niet gepubliceerd)' };
}
