#!/usr/bin/env node
'use strict';

// Handmatige onderzoeksproef: uitsluitend een bestaande lokale kopie lezen.
// Geen .env, netwerk, intake, productiewrites of redactionele puntenscore.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');

function maanden(einde, aantal = 3) {
  if (!/^\d{4}MM(0[1-9]|1[0-2])$/.test(einde)) throw new Error('Ongeldige eindmaand.');
  const jaar = Number(einde.slice(0, 4)), maand = Number(einde.slice(6));
  return Array.from({ length: aantal }, (_, i) => {
    const d = new Date(Date.UTC(jaar, maand - aantal + i, 1));
    return `${d.getUTCFullYear()}MM${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function telPeriode(records, perioden) {
  const gekozen = perioden.map(p => records.filter(r => r.obj.Perioden === p));
  if (gekozen.some(rs => rs.length !== 1)) return { geldig: false, reden: 'Ontbrekende of dubbele maanden' };
  const rijen = gekozen.flat();
  if (rijen.some(r => typeof r.obj.GeregistreerdeMisdrijven_1 !== 'number' || !Number.isFinite(r.obj.GeregistreerdeMisdrijven_1) || r.obj.GeregistreerdeMisdrijven_1 < 0)) {
    return { geldig: false, reden: 'Lege, afgeschermde of ongeldige telling' };
  }
  const kaartjaren = [...new Set(rijen.map(r => r.obj.mapYear))];
  if (kaartjaren.length !== 1 || !Number.isInteger(kaartjaren[0])) return { geldig: false, reden: 'Ontbrekend of verschillend kaartjaar' };
  return { geldig: true, totaal: rijen.reduce((s, r) => s + r.obj.GeregistreerdeMisdrijven_1, 0), kaartjaar: kaartjaren[0], record_ids: rijen.map(r => r.id), maanden: perioden };
}

function vergelijkReeks(records, einde) {
  const huidig = telPeriode(records, maanden(einde));
  const vorig = telPeriode(records, maanden(`${Number(einde.slice(0, 4)) - 1}${einde.slice(4)}`));
  if (!huidig.geldig || !vorig.geldig) return { geldig: false, reden: huidig.reden || vorig.reden };
  if (huidig.kaartjaar !== vorig.kaartjaar) return { geldig: false, reden: 'Kaartjaar verandert tussen perioden' };
  return { geldig: true, huidig, vorig, verschil: huidig.totaal - vorig.totaal, procent: vorig.totaal ? 100 * (huidig.totaal / vorig.totaal - 1) : null };
}

function vergelijkRest(deel, geheel) {
  if (!deel.geldig || !geheel.geldig) return { geldig: false, reden: 'Geen volledige deel- en gemeentereeks' };
  if (deel.huidig.kaartjaar !== geheel.huidig.kaartjaar || ['huidig', 'vorig'].some(k => JSON.stringify(deel[k].maanden) !== JSON.stringify(geheel[k].maanden))) {
    return { geldig: false, reden: 'Verschillende perioden of kaartjaren' };
  }
  const vorig = geheel.vorig.totaal - deel.vorig.totaal;
  const huidig = geheel.huidig.totaal - deel.huidig.totaal;
  if (vorig < 0 || huidig < 0) return { geldig: false, reden: 'Deel is groter dan gemeente' };
  return { geldig: true, vorig, huidig, verschil: huidig - vorig, procent: vorig ? 100 * (huidig / vorig - 1) : null,
    afleiding: 'Gemeentetotaal minus dit gebied; geen onafhankelijke bron of bewijs van verplaatsing.' };
}

function historischeVragen(records, areas, einde) {
  const reeksen = new Map();
  for (const r of records) {
    const o = r.obj;
    if (!o.WijkenEnBuurten || !o.SoortMisdrijf || !o.Perioden) continue;
    const key = `${o.WijkenEnBuurten.trim()}|${o.SoortMisdrijf.trim()}`;
    if (!reeksen.has(key)) reeksen.set(key, []);
    reeksen.get(key).push(r);
  }
  const kaarten = new Map(areas.map(a => [`${a.area_code}|${a.map_year}`, a]));
  const vragen = [], afgewezen = [];
  for (const [key, rs] of reeksen) {
    const [gebied, delict] = key.split('|');
    if (!/^(GM0307|GM0327|WK0307\d{2}|WK0327\d{2})$/.test(gebied)) continue;
    const lokaal = vergelijkReeks(rs, einde);
    if (!lokaal.geldig) { afgewezen.push({ gebied, delict, reden: lokaal.reden }); continue; }
    const kaart = kaarten.get(`${gebied}|${lokaal.huidig.kaartjaar}`);
    if (!kaart) { afgewezen.push({ gebied, delict, reden: 'Geen gebiedsidentiteit voor kaartjaar' }); continue; }
    // Dit zijn begrenzingen voor de leeslijst, geen significantietoets of tipscore.
    if (lokaal.vorig.totaal < 20 || Math.abs(lokaal.verschil) < 20 || Math.abs(lokaal.procent) < 20) continue;
    const gemeente = kaart.municipality_code;
    const landelijk = vergelijkReeks(reeksen.get(`NL00|${delict}`) || [], einde);
    const gemeenteReeks = vergelijkReeks(reeksen.get(`${gemeente}|${delict}`) || [], einde);
    vragen.push({ sleutel: key, gebied, gebiedsnaam: kaart.area_name, delict, gemeente,
      vergelijking: lokaal, gemeentevergelijking: gemeenteReeks, landelijke_vergelijking: landelijk,
      rest_van_gemeente: gebied.startsWith('WK') ? vergelijkRest(lokaal, gemeenteReeks) : null,
      afwijking_van_gemeente: gemeenteReeks.geldig ? lokaal.procent - gemeenteReeks.procent : null,
      bron_url: kaart.source_url, status: 'te_lezen',
      waarschuwingen: ['Geregistreerde misdrijven; geen bewezen oorzaak of verplaatsing.',
        'Verkennende selectie uit meerdere reeksen; geen uitspraak over statistische significantie.',
        ...(['1.3.1', '2.5.2', '3.9.1'].includes(delict) ? ['Controleer registratiewijziging of concentratie rond één locatie.'] : [])] });
  }
  vragen.sort((a, b) => Math.abs(b.afwijking_van_gemeente ?? 0) - Math.abs(a.afwijking_van_gemeente ?? 0) || Math.abs(b.vergelijking.verschil) - Math.abs(a.vergelijking.verschil) || a.sleutel.localeCompare(b.sleutel));
  return { einde, getoetste_reeksen: reeksen.size, leeslijst: vragen.slice(0, 12), overige_geldige_treffers: Math.max(0, vragen.length - 12), afgewezen };
}

function tekstHash(body) {
  // De bekende vergaderkoppen zijn transportmetadata. De rest van het stuk blijft intact.
  let text = String(body || '');
  const kopEinde = text.indexOf('\n\n');
  if (kopEinde >= 0 && kopEinde < 1100 && /^(?:Provincie Utrecht|Gemeente |Raad |Amersfoort\s*[—–-])/.test(text)) text = text.slice(kopEinde + 2);
  return crypto.createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

function vindPassages(body, termen) {
  const lower = body.toLocaleLowerCase('nl-NL');
  const gevonden = [];
  for (const term of termen) {
    const needle = term.toLocaleLowerCase('nl-NL');
    let start = 0, aantal = 0;
    while (aantal < 3) {
      const pos = lower.indexOf(needle, start);
      if (pos < 0) break;
      const van = Math.max(0, pos - 250), tot = Math.min(body.length, pos + 1000);
      if (!gevonden.some(x => Math.abs(x.van - van) < 500)) gevonden.push({ van, tot, tekst: body.slice(van, tot) });
      start = pos + needle.length;
      aantal++;
    }
  }
  return gevonden.sort((a, b) => a.van - b.van).slice(0, 6);
}

function dossierVragen(documents, topics) {
  if (!Array.isArray(topics) || topics.length > 6) throw new Error('Geef maximaal zes afgebakende zoekvragen.');
  return topics.map(topic => {
    if (!topic.id || !topic.vraag || !Array.isArray(topic.termen) || !topic.termen.length || topic.termen.some(t => typeof t !== 'string' || t.trim().length < 4)) throw new Error('Ongeldige zoekvraag of te algemene zoekterm.');
    const groepen = new Map();
    for (const doc of documents) {
      const context = `${doc.title}\n${doc.body}`.toLocaleLowerCase('nl-NL');
      if (!topic.termen.some(t => context.includes(t.toLocaleLowerCase('nl-NL')))) continue;
      if (doc.bronrol === 'spiegel' || doc.source_category === 'local_news' || doc.reliability === 'signal' || ![1, 2].includes(Number(doc.tier)) || doc.body.length < 500) continue;
      const hash = tekstHash(doc.body);
      if (groepen.has(hash)) { groepen.get(hash).ook_beschikbaar_als.push({ key: doc.key, url: doc.url }); continue; }
      groepen.set(hash, { key: doc.key, raw_item_id: doc.raw_item_id, titel: doc.title, bron: doc.source_name,
        bron_url: doc.url, opgegeven_publicatiedatum: doc.published_at, gevonden_op: doc.scraped_at,
        tekens: doc.body.length, inhoud_hash: hash, ook_beschikbaar_als: [],
        datumcontrole: 'Oorspronkelijke stukdatum en betekenis handmatig controleren; ophaaldatum is geen actualiteit.',
        passages: vindPassages(doc.body, topic.termen),
        waarschuwingen: doc.body.length >= 200000 ? ['Groot document: controleer delen en volledigheid.'] : [] });
    }
    // Een ouder stuk wordt niet weggesorteerd: de vergelijking is het uitgangspunt.
    const stukken = [...groepen.values()].sort((a, b) => a.key.localeCompare(b.key, 'nl', { numeric: true }));
    return { id: topic.id, vraag: topic.vraag, status: 'te_lezen', unieke_teksten: stukken.length,
      stukken, instructie: 'Controleer identiteit, oorspronkelijke datums, de tegenverklaring en bestaande berichtgeving. Treffers vormen nog geen bewezen tijdlijn.' };
  });
}

async function main(argv = process.argv.slice(2)) {
  const optie = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
  const kopie = optie('--kopie'), uit = optie('--uit'), datum = optie('--datum'), topicsFile = optie('--vragen');
  if (!kopie || !uit || !datum || !topicsFile) throw new Error('Gebruik --kopie <bestaande lokale db> --datum JJJJ-MM-DD --vragen <json> --uit <json>.');
  if (/^[a-z]+:\/\//i.test(kopie) || !fs.existsSync(kopie) || !fs.statSync(kopie).isFile()) throw new Error('Alleen een bestaand lokaal databasebestand is toegestaan.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || new Date(`${datum}T00:00:00Z`).toISOString().slice(0, 10) !== datum) throw new Error('Ongeldige datum.');
  if ([kopie, topicsFile].some(p => path.resolve(p) === path.resolve(uit))) throw new Error('Uitvoer mag de invoer niet overschrijven.');
  const topics = JSON.parse(fs.readFileSync(topicsFile, 'utf8'));
  const db = createClient({ url: pathToFileURL(path.resolve(kopie)).href.replace(/^file:\/\//, 'file:') });
  const plans = {};
  async function q(name, sql, args = []) {
    plans[name] = (await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args })).rows.map(r => ({ ...r }));
    return (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
  }
  try {
    await db.execute('PRAGMA query_only=ON');
    const meta = await q('kopie', 'SELECT * FROM _kopie_meta');
    if (!meta[0]?.gemaakt_op || datum < meta[0].gemaakt_op.slice(0, 10)) throw new Error('Deze kopie kan geen historische beschikbaarheid vóór de kopiedatum bewijzen.');
    // Eén bronbegrensde sweep op de lokale kopie, geen query per reeks of onderwerp.
    const records = await q('politie', `SELECT id,source_key,raw_object,fetched_at FROM source_records WHERE source_id=149 ORDER BY fetched_at,id`);
    const latest = new Map();
    for (const r of records) if (r.fetched_at.slice(0, 10) <= datum) latest.set(r.source_key, { id: r.id, obj: JSON.parse(r.raw_object) });
    const areas = await q('gebieden', 'SELECT * FROM area_versions WHERE source_id=149');
    const docs = await q('documenten', `SELECT r.id,r.source_id,s.name source_name,s.bronrol,s.tier,s.category source_category,s.reliability,r.title,r.external_url url,r.published_at,r.scraped_at,coalesce(nullif(r.full_text,''),r.content,'') body FROM raw_items r JOIN sources s ON s.id=r.source_id WHERE r.scraped_at<?`, [`${datum}T23:59:59.999Z`]);
    const parts = await q('delen', 'SELECT * FROM raw_item_parts ORDER BY parent_id,deel');
    const partIds = new Set(parts.map(p => Number(p.part_id)));
    const byId = new Map(docs.map(d => [Number(d.id), d]));
    for (const p of parts) {
      const parent = byId.get(Number(p.parent_id)), part = byId.get(Number(p.part_id));
      if (parent && part && !parent.body.includes(part.body)) parent.body += `\n\n${part.body}`;
    }
    const attachments = await q('bijlagen', `SELECT a.id,a.raw_item_id,a.titel title,a.url,a.tekst body,a.status FROM raw_item_attachments a WHERE a.status='ok'`);
    const documents = docs.filter(d => !partIds.has(Number(d.id))).map(d => ({ ...d, key: `item:${d.id}`, raw_item_id: d.id }));
    for (const a of attachments) {
      const parent = byId.get(Number(a.raw_item_id));
      if (parent && a.body) documents.push({ ...parent, ...a, key: `attachment:${a.id}` });
    }
    const perioden = [...latest.values()].map(r => r.obj.Perioden).filter(p => /^\d{4}MM\d{2}$/.test(p) && p.replace('MM', '-') < datum.slice(0, 7)).sort();
    if (!perioden.length) throw new Error('Geen complete kalendermaand in de lokale politiebron.');
    const result = { schema_version: 1, onderzoeksdatum: datum, invoer: { kopie: path.basename(kopie), metadata: meta },
      status: 'Onderzoeksvoorbereiding; geen tips, publicatiebesluit of statistische significantietoets.',
      historie: historischeVragen([...latest.values()], areas, perioden.at(-1)),
      dossiers: dossierVragen(documents, topics),
      eerdere_tips: await q('eerdere_tips', 'SELECT id,titel,kern,status,created_at FROM tips ORDER BY id DESC LIMIT 100'),
      redactieoordelen: await q('redactieoordelen', 'SELECT f.tip_id,t.titel,f.actie,f.reden_code,f.reden_tekst FROM tip_feedback f JOIN tips t ON t.id=f.tip_id ORDER BY f.created_at DESC LIMIT 20'),
      queryplannen: plans };
    fs.mkdirSync(path.dirname(path.resolve(uit)), { recursive: true });
    fs.writeFileSync(uit, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ uitvoer: uit, historische_leesvragen: result.historie.leeslijst.length,
      dossiers: result.dossiers.map(d => ({ id: d.id, unieke_teksten: d.unieke_teksten })), productie_writes: 0 }));
    return result;
  } finally { db.close(); }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { maanden, telPeriode, vergelijkReeks, vergelijkRest, historischeVragen, tekstHash, vindPassages, dossierVragen, main };
