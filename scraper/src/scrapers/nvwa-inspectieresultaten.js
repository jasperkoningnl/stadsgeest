// nvwa-inspectieresultaten.js — openbare inspectieresultaten horeca, ambacht en retail
//
// Vervangt de NVWA-helft van igj-nvwa.js. Die zocht op nvwa.nl met trefwoord
// "amersfoort" en harkte vervolgens elke link van de pagina binnen, waardoor er
// exportcertificaten voor runderen en technische configuratiebestanden in de
// pipeline belandden. Nul van die 142 items ging over Amersfoort.
//
// Deze bron gebruikt openbare-inspectieresultaten.nvwa.nl. Dat is server-rendered
// HTML, dus geen Playwright nodig. We zoeken op postcodeprefix in plaats van op
// de bedrijfsnaam: zoeken op "Amersfoort" levert alleen bedrijven met Amersfoort
// in de naam, en haalt tegelijk zaken binnen die er niet staan (Shell Station
// Amersfoortseweg). De vestigingsplaats op de detailpagina is leidend.
//
// Alleen bedrijven met een tekortkoming worden opgeslagen. Alles opslaan zou ruim
// driehonderd items per run betekenen, waarvan het overgrote deel "Voldoet" — dat
// is registerruis en de intake heeft er niets aan.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BASIS = 'https://www.openbare-inspectieresultaten.nvwa.nl';

const BRON = {
  name: 'NVWA — openbare inspectieresultaten horeca',
  url: `${BASIS}/bedrijfsinspecties/horeca-ambacht-en-retail`,
  sourceType: 'scrape',
  reliability: 'primary',
  category: 'registry',
  scrapeFrequency: 'weekly',
};

// Postcodeprefixen. Amersfoort 3811-3829, Leusden 3831-3835.
const POSTCODES = {
  Amersfoort: [3811, 3812, 3813, 3814, 3815, 3816, 3817, 3818, 3819, 3820, 3821, 3822, 3823, 3824, 3825, 3826, 3827, 3828, 3829],
  Leusden: [3831, 3832, 3833, 3834, 3835],
};

// Oordelen die de moeite van een signaal waard zijn. "Voldoet" en "Geen recente
// gegevens" slaan we over.
const RELEVANT = ['Verbeterpunten vastgesteld', 'Verscherpt toezicht'];

function ontsnap(tekst) {
  return (tekst || '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&hellip;/g, '...')
    .trim();
}

function naarTekstregels(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((r) => ontsnap(r))
    .filter((r) => r !== '');
}

async function haal(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Stadsgeest/1.0 (persbureau Amersfoort)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} op ${url}`);
  return res.text();
}

// Zoek op postcodeprefix en geef de slugs van de gevonden bedrijven terug.
async function zoekSlugs(prefix) {
  const slugs = new Set();
  for (let pagina = 0; pagina < 10; pagina++) {
    const url = `${BASIS}/zoekresultaten?keys=${prefix}&page=${pagina}`;
    const html = await haal(url);
    const treffers = [...html.matchAll(/href="(\/bedrijfsinspecties\/[^"?#]+\/[^"?#]+)"/g)].map((m) => m[1]);
    const nieuw = treffers.filter((s) => !slugs.has(s));
    for (const s of treffers) slugs.add(s);
    // Geen nieuwe treffers op deze pagina betekent dat we voorbij het einde zijn.
    if (nieuw.length === 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return [...slugs];
}

// Lees een detailpagina uit. Levert null als de pagina niet te lezen is.
function leesDetail(html, pad) {
  const regels = naarTekstregels(html);

  // Het adresblok staat direct na het laatste kruimelpad-item: naam, straat,
  // postcode, plaats, oordeel.
  const iPlaats = regels.findIndex((r) => /^(Amersfoort|Leusden)$/.test(r));
  if (iPlaats < 3) return null;

  const plaats = regels[iPlaats];
  const postcode = regels[iPlaats - 1];
  const straat = regels[iPlaats - 2];
  const naam = regels[iPlaats - 3];
  if (!/^\d{4}\s?[A-Z]{2}$/.test(postcode)) return null;

  const oordeel = regels[iPlaats + 1] || '';

  // Per inspectieonderwerp: onderwerp, oordeel, grondslag, datum.
  const onderwerpen = [];
  const namen = ['Juiste omgang met voedsel', 'Allergeneninformatie', 'Hygiëne', 'Plaagdierbeheersing'];
  for (const onderwerp of namen) {
    const i = regels.indexOf(onderwerp, iPlaats);
    if (i === -1) continue;
    const oordeelOnderwerp = regels[i + 1] || '';
    const datum = (regels.slice(i + 1, i + 5).find((r) => /^\d{2}-\d{2}-\d{4}$/.test(r))) || '';
    if (!/^Voldoet/.test(oordeelOnderwerp)) continue;
    onderwerpen.push({ onderwerp, oordeel: oordeelOnderwerp, datum });
  }

  const datums = onderwerpen.map((o) => o.datum).filter(Boolean).sort();
  const laatsteInspectie = datums.length ? datums[datums.length - 1] : '';

  return {
    naam,
    straat,
    postcode,
    plaats,
    oordeel,
    onderwerpen,
    laatsteInspectie,
    url: BASIS + pad,
  };
}

function isRelevant(detail) {
  if (RELEVANT.includes(detail.oordeel)) return true;
  return detail.onderwerpen.some((o) => o.oordeel === 'Voldoet niet');
}

function maakItem(detail) {
  const tekortkomingen = detail.onderwerpen.filter((o) => o.oordeel === 'Voldoet niet');
  const titel = `${detail.naam}, ${detail.plaats} — ${detail.oordeel}`
    + (detail.laatsteInspectie ? ` (inspectie ${detail.laatsteInspectie})` : '');

  const regels = [
    `${detail.naam}`,
    `${detail.straat}, ${detail.postcode} ${detail.plaats}`,
    `Oordeel NVWA: ${detail.oordeel}`,
    detail.laatsteInspectie ? `Laatste inspectie: ${detail.laatsteInspectie}` : null,
    '',
    'Per inspectieonderwerp:',
    ...detail.onderwerpen.map((o) => `- ${o.onderwerp}: ${o.oordeel}${o.datum ? ` (${o.datum})` : ''}`),
    '',
    tekortkomingen.length
      ? `Tekortkomingen: ${tekortkomingen.map((o) => o.onderwerp).join(', ')}.`
      : 'Geen onderwerp met het oordeel "Voldoet niet"; het oordeel over het bedrijf als geheel is wel afwijkend.',
    '',
    'Openbaar gemaakt op grond van artikel 44 Gezondheidswet. De NVWA publiceert',
    'inspectieresultaten twee weken na de inspectie.',
  ].filter((r) => r !== null);

  return {
    titel,
    inhoud: regels.join('\n'),
    samenvatting: `${detail.oordeel} bij ${detail.naam} aan de ${detail.straat} in ${detail.plaats}`
      + (tekortkomingen.length ? `. Tekortkoming: ${tekortkomingen.map((o) => o.onderwerp).join(', ')}.` : '.'),
  };
}

export async function scrape({ proef = false } = {}) {
  const sourceId = proef ? null : await getOrCreateSource(db, BRON);

  let bekeken = 0;
  let opgeslagen = 0;
  let overgeslagen = 0;
  let fouten = 0;
  const relevante = [];

  // Met SG_POSTCODES=3812,3813 draai je een klein stukje, handig bij het proeven.
  const beperking = (process.env.SG_POSTCODES || '').split(',').map((s) => Number(s.trim())).filter(Boolean);

  for (const [gemeente, prefixen] of Object.entries(POSTCODES)) {
    for (const prefix of prefixen) {
      if (beperking.length && !beperking.includes(prefix)) continue;
      let slugs;
      try {
        slugs = await zoekSlugs(prefix);
      } catch (err) {
        fouten++;
        console.error(`  [${prefix}] zoeken mislukt: ${err.message}`);
        continue;
      }

      for (const pad of slugs) {
        try {
          const html = await haal(BASIS + pad);
          const detail = leesDetail(html, pad);
          bekeken++;
          if (!detail) continue;
          if (detail.plaats !== gemeente) continue;
          if (!isRelevant(detail)) continue;

          relevante.push(detail);
          if (proef) continue;

          const item = maakItem(detail);
          const r = await saveRawItem(db, {
            sourceId,
            externalUrl: detail.url,
            title: item.titel,
            content: item.inhoud,
            summary: item.samenvatting,
          });
          if (r.saved) opgeslagen++;
          else overgeslagen++;
        } catch (err) {
          fouten++;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  if (proef) {
    console.log(`PROEF: ${bekeken} detailpagina's bekeken, ${relevante.length} relevant, ${fouten} fouten`);
    for (const d of relevante) {
      console.log(`  ${d.plaats} | ${d.oordeel} | ${d.naam} | ${d.straat} | ${d.laatsteInspectie} | `
        + d.onderwerpen.map((o) => `${o.onderwerp}=${o.oordeel}`).join(', '));
    }
    return;
  }

  await logResult(db, sourceId, BRON.name, opgeslagen, overgeslagen, fouten, relevante.length);
}

// Direct aangeroepen? Dan draaien. Met --proef schrijft hij niets weg.
if (process.argv[1] && process.argv[1].endsWith('nvwa-inspectieresultaten.js')) {
  scrape({ proef: process.argv.includes('--proef') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
