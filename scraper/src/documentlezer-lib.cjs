'use strict';

// Gedeelde functies voor de documentlezer: grote stukken volledig laten lezen
// en per stuk een uittreksel met letterlijke citaten maken.
// Alles hier leest uitsluitend de lokale kopie van lokale-kopie.cjs; er is
// bewust geen route naar Turso. Zie operations/DOCUMENTLEZER.md.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Zelfde grens als MAX_CONTENT_CHARS in weger-workset.cjs.
const WEGER_TEKENS = 4000;
// Een leeseenheid is hoogstens zo lang; langere teksten worden geknipt.
const MAX_EENHEID = 200000;
// Regels in de leesversie worden op witruimte afgebroken, zodat een leestool
// die lange regels afkapt niets kwijtraakt. De controle vergelijkt zonder
// onderscheid in witruimte, dus dit verandert de uitkomst niet.
const MAX_REGEL = 1000;
// B&W-besluitenlijsten staan in de database als tier 2, maar zijn een
// officiële bron en horen bij de documentenstroom.
const EXTRA_BRONNEN = [131];

const SOORTEN = ['bedrag', 'partij', 'toezegging', 'risico', 'termijn', 'afwijking'];
const BEWIJSSTATUSSEN = ['direct', 'samengesteld', 'extractie_onzeker'];
const MAX_FEITEN = 12;
const STANDAARD_FEITEN = 8;
const CITAAT_MIN = 40;
const CITAAT_MAX = 300;

const STANDAARD_KOPIE = path.join(__dirname, '..', 'tmp', 'kopie', 'stadsgeest.db');
const STANDAARD_MAP = path.join(__dirname, '..', 'tmp', 'documentlezer');

function vindKopie(expliciet) {
  return path.resolve(expliciet || process.env.STADSGEEST_KOPIE || STANDAARD_KOPIE);
}

function openKopie(expliciet) {
  const pad = vindKopie(expliciet);
  if (!fs.existsSync(pad)) throw new Error(`geen lokale kopie op ${pad}; maak die met node scraper/src/lokale-kopie.cjs`);
  // Pas hier laden: de pure functies hieronder werken ook zonder databaseclient.
  const { createClient } = require('@libsql/client');
  return createClient({ url: `file:${pad.replace(/\\/g, '/')}` });
}

async function kopieDatum(db) {
  const r = await db.execute('SELECT gemaakt_op FROM _kopie_meta').catch(() => null);
  return r?.rows[0]?.gemaakt_op || null;
}

// Vergelijkingsvorm voor citaten. Alleen witruimte wordt gelijkgetrokken en
// onzichtbare tekens (zacht afbreekstreepje, nulbreedte-spatie) vallen weg.
// Hoofdletters, leestekens, aanhalingstekens en cijfers blijven zoals ze zijn.
function normaliseer(tekst) {
  return String(tekst ?? '').replace(/[­​﻿]/g, '').replace(/[\s ]+/g, ' ').trim();
}

function sha(tekst) {
  return crypto.createHash('sha256').update(tekst, 'utf8').digest('hex').slice(0, 16);
}

// Fail-closed controle voor gegevens die nooit in een redactioneel uittreksel
// horen. Namen blijven primair een instructieregel: zonder betrouwbare rol- en
// entiteitscontext kan een reguliere expressie bestuurders niet van burgers
// onderscheiden. Contactgegevens en identificatienummers kunnen wel hard
// worden tegengehouden.
function privacyTreffers(tekst) {
  const regels = [
    ['e-mailadres', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ['telefoonnummer', /(?:\+31|0031|0)\s*[-(]?\s*\d(?:[\s().-]*\d){7,9}\b/],
    ['BSN', /\b\d{9}\b/],
    ['naam van mogelijke particulier', /\b(?:bewoner|indiener|bezwaarmaker|woo-verzoeker|cliënt|klant)\s+[A-ZÀ-Ý][\p{L}'-]+(?:\s+(?:van|de|der|den|ten|ter))*\s+[A-ZÀ-Ý][\p{L}'-]+/u],
  ];
  return regels.filter(([, patroon]) => patroon.test(String(tekst || ''))).map(([naam]) => naam);
}

// De eigenlijke documenttekst: de langste van full_text en content. Bij
// B&W-stukken (bron 131) is full_text kort en staat het stuk in content.
function leestekstVanItem(rij) {
  const ft = String(rij.full_text ?? '');
  const c = String(rij.content ?? '');
  return ft.length >= c.length ? ft : c;
}

// Wat de weger van een item ziet: de langste beschikbare documenttekst. Dit
// voorkomt dat paginatekst of een korte samenvatting het eigenlijke stuk
// verdringt, zoals eerder bij B&W-bron 131 gebeurde.
function wegerTekst(rij) {
  const teksten = [rij.full_text, rij.content, rij.summary].map((v) => String(v || ''));
  return teksten.sort((a, b) => b.length - a.length)[0].slice(0, WEGER_TEKENS);
}

// Knipt een tekst in stukken van hoogstens `max` tekens, bij voorkeur op een
// regeleinde. Geeft [{ van, tot }] met tot exclusief; de stukken sluiten aan.
function knip(tekst, max = MAX_EENHEID) {
  if (tekst.length <= max) return [{ van: 0, tot: tekst.length }];
  const aantal = Math.ceil(tekst.length / max);
  const doel = Math.ceil(tekst.length / aantal);
  const delen = [];
  let van = 0;
  for (let i = 1; i <= aantal; i++) {
    let tot = i === aantal ? tekst.length : Math.min(van + doel, tekst.length);
    if (i < aantal) {
      const regel = tekst.lastIndexOf('\n', tot);
      const spatie = tekst.lastIndexOf(' ', tot);
      if (regel > tot - 5000 && regel > van) tot = regel + 1;
      else if (spatie > tot - 500 && spatie > van) tot = spatie + 1;
    }
    delen.push({ van, tot });
    van = tot;
  }
  return delen;
}

function leesversie(tekst) {
  const uit = [];
  for (let regel of String(tekst).split('\n')) {
    while (regel.length > MAX_REGEL) {
      const grens = regel.lastIndexOf(' ', MAX_REGEL);
      if (grens < MAX_REGEL / 2) break; // geen witruimte: regel laten staan
      uit.push(regel.slice(0, grens));
      regel = regel.slice(grens + 1);
    }
    uit.push(regel);
  }
  return uit.join('\n');
}

const ITEM_SQL = `SELECT r.id, r.source_id, r.title, r.external_url, r.summary, r.content, r.full_text,
    r.scraped_at, r.published_at, s.name AS bron, s.tier,
    p.parent_id, p.deel, p.van AS deel_van
  FROM raw_items r JOIN sources s ON s.id = r.source_id
  LEFT JOIN raw_item_parts p ON p.part_id = r.id
  WHERE r.id = ?`;

// Sleutels: item-<raw_item_id> of bijlage-<attachment_id>, met -d<N> als de
// tekst langer is dan MAX_EENHEID en dus in knipdelen gelezen wordt.
function ontleedSleutel(sleutel) {
  const m = /^(item|bijlage)-(\d+)(?:-d(\d+))?$/.exec(String(sleutel).trim());
  if (!m) throw new Error(`ongeldige sleutel: ${sleutel}`);
  return { soort: m[1], id: Number(m[2]), knipdeel: m[3] ? Number(m[3]) : null };
}

async function laadDocument(db, soort, id) {
  if (soort === 'item') {
    const rij = (await db.execute({ sql: ITEM_SQL, args: [id] })).rows[0];
    if (!rij) throw new Error(`raw_item ${id} niet gevonden`);
    // Van een deelitem krijgt de weger niets te zien; hij ziet het hoofditem.
    const hoofdId = Number(rij.parent_id || rij.id);
    const hoofd = rij.parent_id ? (await db.execute({ sql: ITEM_SQL, args: [hoofdId] })).rows[0] : rij;
    const deelitems = Number((await db.execute({
      sql: 'SELECT count(*) AS n FROM raw_item_parts WHERE parent_id = ?', args: [hoofdId],
    })).rows[0].n);
    const ft = String(rij.full_text ?? '');
    const c = String(rij.content ?? '');
    return {
      soort, id, raw_item_id: id, hoofditem_id: hoofdId, bijlage_id: null,
      bron_id: Number(rij.source_id), bron: rij.bron, tier: Number(rij.tier),
      titel: rij.title, url: rij.external_url, datum: rij.published_at || rij.scraped_at,
      deelitem: rij.parent_id ? { deel: Number(rij.deel), van_delen: deelitems + 1, van: Number(rij.deel_van) } : null,
      heeft_deelitems: rij.parent_id ? 0 : deelitems,
      tekst: leestekstVanItem(rij), tekstveld: ft.length >= c.length ? 'full_text' : 'content',
      weger: wegerTekst(hoofd),
    };
  }
  const rij = (await db.execute({
    sql: `SELECT a.id, a.raw_item_id, a.titel, a.url, a.tekst, a.paginas, a.tekstbron, a.opgehaald_at,
            r.title AS item_titel, r.source_id, r.summary, r.content, r.full_text, s.name AS bron, s.tier
          FROM raw_item_attachments a JOIN raw_items r ON r.id = a.raw_item_id
          JOIN sources s ON s.id = r.source_id WHERE a.id = ?`,
    args: [id],
  })).rows[0];
  if (!rij) throw new Error(`bijlage ${id} niet gevonden`);
  return {
    soort, id, raw_item_id: Number(rij.raw_item_id), hoofditem_id: Number(rij.raw_item_id), bijlage_id: id,
    bron_id: Number(rij.source_id), bron: rij.bron, tier: Number(rij.tier),
    titel: `${rij.item_titel} — bijlage: ${rij.titel}`, url: rij.url, datum: rij.opgehaald_at,
    paginas: rij.paginas, tekstbron: rij.tekstbron, deelitem: null, heeft_deelitems: 0,
    tekst: String(rij.tekst ?? ''), tekstveld: 'raw_item_attachments.tekst', weger: wegerTekst(rij),
  };
}

// Geeft de leeseenheid bij een sleutel: de tekst die één lezer in één keer leest.
async function laadEenheid(db, sleutel, max = MAX_EENHEID) {
  const { soort, id, knipdeel } = ontleedSleutel(sleutel);
  const doc = await laadDocument(db, soort, id);
  const stukken = knip(doc.tekst, max);
  if (stukken.length > 1 && !knipdeel) throw new Error(`${sleutel} is ${doc.tekst.length} tekens: gebruik ${sleutel}-d1 t/m -d${stukken.length}`);
  if (knipdeel && (knipdeel < 1 || knipdeel > stukken.length)) throw new Error(`${sleutel}: knipdeel bestaat niet (${stukken.length} delen)`);
  const stuk = stukken[(knipdeel || 1) - 1];
  const tekst = doc.tekst.slice(stuk.van, stuk.tot);
  return {
    ...doc,
    sleutel: stukken.length > 1 ? `${soort}-${id}-d${knipdeel}` : `${soort}-${id}`,
    tekst, document_tekens: doc.tekst.length, tekens: tekst.length,
    knip: stukken.length > 1 ? { deel: knipdeel, van_delen: stukken.length, van: stuk.van, tot: stuk.tot } : null,
    // Plaats van deze tekst in het hele document, voor de vergelijking met de weger.
    begin_in_document: (doc.deelitem ? doc.deelitem.van : 0) + stuk.van,
    sha: sha(tekst),
  };
}

// Alle sleutels van één document, in leesvolgorde.
async function sleutelsVan(db, soort, id, max = MAX_EENHEID) {
  const doc = await laadDocument(db, soort, id);
  const n = knip(doc.tekst, max).length;
  return n === 1 ? [`${soort}-${id}`] : Array.from({ length: n }, (_, i) => `${soort}-${id}-d${i + 1}`);
}

module.exports = {
  WEGER_TEKENS, MAX_EENHEID, MAX_REGEL, EXTRA_BRONNEN, SOORTEN, BEWIJSSTATUSSEN, MAX_FEITEN, STANDAARD_FEITEN, CITAAT_MIN, CITAAT_MAX,
  STANDAARD_KOPIE, STANDAARD_MAP,
  vindKopie, openKopie, kopieDatum, normaliseer, sha, privacyTreffers, leestekstVanItem, wegerTekst,
  knip, leesversie, ontleedSleutel, laadDocument, laadEenheid, sleutelsVan,
};
