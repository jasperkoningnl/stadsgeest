// rvs-uitspraken.js — Raad van State, uitspraken met een Amersfoortse of
// Leusdense partij.
//
// Herschreven op 9 augustus 2026. De vorige versie schraapte
// raadvanstate.nl/uitspraken?zoeken_term=amersfoort. Twee dingen deugden niet.
//
//   1. raadvanstate.nl geeft HTTP 403 op elke detailpagina die node ophaalt —
//      getest met een kale fetch, met een browser-user-agent en met een volledige
//      set browserheaders. De zoekpagina komt er wel door, de uitspraken niet.
//      Daardoor sloeg de bron alleen zaaknummer en ECLI op en stond `content` bij
//      alle negen items op nul tekens. Er viel dus niets te wegen.
//   2. Er zat geen filter op de partijen. Van de negen uitspraken gingen er vijf
//      over andere gemeenten: vier over landgoed Tongeren in Epe en één over de
//      basisregistratie in Stichtse Vecht. Die kwamen binnen omdat er een advocaat
//      in Amersfoort optrad, of omdat Amersfoort werd aangehaald als vergelijkbaar
//      geval — in ECLI:NL:RVS:2026:4599 staat het woord Amersfoort precies één keer,
//      in overweging 11, over een naamswijziging in een andere gemeente.
//
// De Raad van State publiceert zijn uitspraken ook op data.rechtspraak.nl, met
// volledige tekst en een inhoudsindicatie, en die ingang blokkeert niets. Dezelfde
// bron dus, maar wel leesbaar.
//
// Het filter kijkt naar de kop van de uitspraak: de inhoudsindicatie plus het
// partijenblok tussen "Uitspraak op het" en "Procesverloop". Daar staan de
// appellant en het bestuursorgaan. Vermeldingen verderop in de overwegingen tellen
// niet mee, en een advocaat of gemachtigde uit Amersfoort maakt een zaak niet
// Amersfoorts.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const ZOEK = 'https://data.rechtspraak.nl/uitspraken/zoeken';
const INHOUD = 'https://data.rechtspraak.nl/uitspraken/content';
const RVS_URI = 'http://standaarden.overheid.nl/owms/terms/Raad_van_State';
const VENSTER_DAGEN = Number(process.env.RVS_VENSTER_DAGEN || 14);

const PLAATSEN = [
  { naam: 'Amersfoort', gemeente: 'Amersfoort' },
  { naam: 'Hoogland', gemeente: 'Amersfoort' },
  { naam: 'Hooglanderveen', gemeente: 'Amersfoort' },
  { naam: 'Vathorst', gemeente: 'Amersfoort' },
  { naam: 'Leusden', gemeente: 'Leusden' },
  { naam: 'Achterveld', gemeente: 'Leusden' },
  { naam: 'Stoutenburg', gemeente: 'Leusden' },
];

// Rollen die een plaatsnaam onbruikbaar maken als aanwijzing. Een advocaat in
// Amersfoort zegt niets over waar de zaak over gaat.
const ROLLEN = /(advocaat|gemachtigde|rechtsbijstand[a-z]*|kantoor(?:houdend)?|werkzaam|verbonden aan)[^.;]{0,40}$/i;

// Landelijke organisaties met hun hoofdkantoor in Amersfoort. Dat die "gevestigd
// in Amersfoort" zijn maakt een zaak over een Fries natuurgebied geen Amersfoortse
// zaak. Gemeten op 9 augustus 2026 was Staatsbosbeheer de enige treffer in 1.200
// uitspraken, en die ging over Tzummarum in de gemeente Waadhoeke.
const LANDELIJKE_ZETELS = /(Staatsbosbeheer|Rijkswaterstaat|RIVM|Nederlandse Spoorwegen|ProRail|Kadaster)[^.;]{0,60}$/i;

function ontdoeVanTags(xml) {
  return xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// De kop van de uitspraak: inhoudsindicatie plus het partijenblok. Daar staat wie
// er tegenover elkaar staan.
function koptekst(xml, volledig) {
  const inh = xml.match(/<inhoudsindicatie>([\s\S]*?)<\/inhoudsindicatie>/);
  const indicatie = inh ? ontdoeVanTags(inh[1]) : '';

  let partijen = '';
  const start = volledig.search(/Uitspraak op het|Uitspraak in het geding|Uitspraak van de/i);
  if (start > -1) {
    const rest = volledig.slice(start);
    const eind = rest.search(/Procesverloop|Overwegingen/i);
    partijen = eind > -1 ? rest.slice(0, eind) : rest.slice(0, 2000);
  }
  return { indicatie, partijen, kop: `${indicatie}\n${partijen}` };
}

// Raakt deze uitspraak Amersfoort of Leusden als partij? Geeft null of de plaats.
function bepaalPlaats(kop) {
  for (const p of PLAATSEN) {
    const re = new RegExp(`\\b${p.naam}\\b`, 'gi');
    let m;
    while ((m = re.exec(kop)) !== null) {
      const ervoor = kop.slice(Math.max(0, m.index - 60), m.index);
      if (ROLLEN.test(ervoor)) continue; // advocaat/gemachtigde: telt niet
      if (LANDELIJKE_ZETELS.test(ervoor)) continue; // hoofdkantoor, geen lokale zaak
      return p;
    }
  }
  return null;
}

// Let op: de q-parameter wordt genegeerd zodra creator is meegegeven. Filteren op
// "Amersfoort" kan dus niet aan de kant van rechtspraak.nl; we halen alle
// RvS-uitspraken van het venster op en filteren zelf.
//
// Het venster loopt bewust een week achter. De nieuwste uitspraken staan er wel als
// metadata maar nog zonder tekst — gemeten: van de tien nieuwste hadden er negen
// 149 tekens. De tekst komt een paar dagen later. Zonder die vertraging haal je
// lege records op die je daarna nooit meer terugziet.
async function haalEclis() {
  const tot = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const van = new Date(Date.now() - (7 + VENSTER_DAGEN) * 86400000).toISOString().slice(0, 10);
  const eclis = new Set();
  for (let from = 0; from < 1000; from += 100) {
    const url = `${ZOEK}?creator=${encodeURIComponent(RVS_URI)}&date=${van}&date=${tot}`
      + `&from=${from}&max=100&sort=desc`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
    const xml = await r.text();
    const gevonden = [...xml.matchAll(/<id>(ECLI[^<]+)<\/id>/g)].map((m) => m[1]);
    const nieuw = gevonden.filter((e) => !eclis.has(e));
    gevonden.forEach((e) => eclis.add(e));
    if (nieuw.length === 0) break;
  }
  console.log(`[RVS] venster ${van} t/m ${tot}: ${eclis.size} uitspraken`);
  return [...eclis];
}

async function haalUitspraak(ecli) {
  const r = await fetch(`${INHOUD}?id=${encodeURIComponent(ecli)}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return null;
  return r.text();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Raad van State — Amersfoort',
    url: `${ZOEK}?creator=Raad_van_State`,
    sourceType: 'api',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'weekly',
  });

  let opgeslagen = 0;
  let overgeslagen = 0;
  let fouten = 0;
  let bekeken = 0;

  let eclis;
  try {
    eclis = await haalEclis();
  } catch (e) {
    console.error(`[RVS] ${e.message}`);
    await logResult(db, sourceId, 'Raad van State — Amersfoort', 0, 0, 1, 0);
    return;
  }

  for (const ecli of eclis) {
    try {
      const xml = await haalUitspraak(ecli);
      await new Promise((r) => setTimeout(r, 150));
      if (!xml) { fouten++; continue; }

      const volledig = ontdoeVanTags(xml);
      // Uitspraken zonder tekst zijn nog niet compleet; die komen later terug.
      if (volledig.length < 1000) { overgeslagen++; continue; }
      bekeken++;
      const { indicatie, kop } = koptekst(xml, volledig);
      const plaats = bepaalPlaats(kop);
      if (!plaats) { overgeslagen++; continue; }

      const datum = (xml.match(/<dcterms:date[^>]*>([^<]+)</) || [])[1] || '';
      const zaak = (xml.match(/<psi:zaaknummer[^>]*>([^<]+)</) || [])[1]
        || (xml.match(/<dcterms:identifier[^>]*>([^<]+)</) || [])[1] || '';

      const titel = `Raad van State ${datum ? datum + ' ' : ''}— ${(indicatie || volledig).substring(0, 200)}`;
      const inhoud = [
        indicatie ? `Inhoudsindicatie: ${indicatie}` : null,
        `Herkend als ${plaats.gemeente} op grond van de plaatsnaam "${plaats.naam}" in de inhoudsindicatie of het partijenblok.`,
        `ECLI: ${ecli}${zaak ? ` | zaak ${zaak}` : ''}`,
        '',
        volledig.substring(0, 8000),
      ].filter(Boolean).join('\n');

      const r = await saveRawItem(db, {
        sourceId,
        externalUrl: `https://uitspraken.rechtspraak.nl/details?id=${encodeURIComponent(ecli)}`,
        title: titel.substring(0, 290),
        content: inhoud,
        summary: (indicatie || volledig).substring(0, 500),
      });
      if (r.saved) opgeslagen++; else overgeslagen++;
    } catch (e) {
      fouten++;
      console.error(`[RVS] fout bij ${ecli}: ${e.message}`);
    }
  }

  console.log(`[RVS] ${bekeken} uitspraken gelezen, ${opgeslagen} met een Amersfoortse of Leusdense partij`);
  await logResult(db, sourceId, 'Raad van State — Amersfoort', opgeslagen, overgeslagen, fouten, bekeken);
}

scrape().catch((e) => { console.error('rvs-uitspraken:', e.message); process.exit(1); });
