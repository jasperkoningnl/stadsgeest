'use strict';

// Welke organisaties uit welke bron meedoen aan de koppeling (docs/KOPPELING.md).
// Elke loader geeft ruwe records { bron, bron_ref, naam, kvk, rsin, lei, adres,
// postcode, plaats, extra, rol? }. Alleen lezen.
//
// Bewust niet:
// - personen (eenmanszaken, vof's, maatschappen uit OpenKvK; particulieren in de
//   subsidies; gastouders uit het LRK): namen van burgers horen niet in de graaf;
// - TenderNed-kopers: dat is vrijwel altijd de gemeente zelf.

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const PERSOONLIJK = /^(eenmanszaak|vennootschap onder firma|maatschap|commanditaire vennootschap)/i;

async function rows(db, sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}

async function blob(db, sourceId) {
  const [r] = await rows(db, 'SELECT raw_object FROM source_records WHERE source_id = ? ORDER BY id DESC LIMIT 1', [sourceId]);
  return r ? parse(r.raw_object) || {} : {};
}

// Nieuwste versie per source_key, zonder baseline-markeringen en verwijderde records.
async function delen(db, sourceId) {
  const r = await rows(db, `SELECT sr.source_key, sr.raw_object FROM source_records sr
    WHERE sr.source_id = ? AND sr.source_key NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND sr.id = (SELECT MAX(id) FROM source_records x WHERE x.source_id = sr.source_id AND x.source_key = sr.source_key)
      AND COALESCE(sr.change_type, '') <> 'removed'`, [sourceId]);
  return r.map((x) => ({ key: x.source_key, v: parse(x.raw_object) || {} }));
}

const euro = (b) => (b == null ? '' : `€${Math.round(Number(b)).toLocaleString('nl-NL')}`);

const LOADERS = {
  async subsidie(db) {
    return (await rows(db, 'SELECT id, jaar, ontvanger, omschrijving, bedrag FROM subsidies WHERE COALESCE(is_particulier,0) = 0'))
      .map((r) => ({ bron: 'subsidie', bron_ref: `subsidies#${r.id}`, naam: r.ontvanger,
        extra: `${r.jaar} ${euro(r.bedrag)} ${r.omschrijving || ''}` }));
  },
  async anbi(db) {
    return Object.entries(await blob(db, 158)).map(([k, v]) => ({ bron: 'anbi', bron_ref: `anbi#${k}`, naam: v.naam, rsin: v.rsin,
      plaats: v.vestigingsplaats, extra: v.website || '' }));
  },
  async gleif(db) {
    return Object.entries(await blob(db, 159)).map(([k, v]) => ({ bron: 'gleif', bron_ref: `gleif#${k}`, naam: v.legalName, lei: v.lei || k,
      kvk: v.registeredAs, adres: v.legalAddressLines, postcode: v.legalPostalCode, plaats: v.legalCity, extra: v.status || '' }));
  },
  async lrk(db) {
    return Object.entries(await blob(db, 139)).filter(([, v]) => v && v.type !== 'VGO').map(([k, v]) => ({
      bron: 'lrk', bron_ref: `lrk#${k}`, naam: v.houder, kvk: v.kvk, adres: v.adres, postcode: v.postcode,
      extra: `${v.type} ${v.naam} ${v.plaatsen || '?'} plaatsen` }));
  },
  async asbest(db) {
    return (await delen(db, 138)).map(({ key, v }) => ({ bron: 'asbest', bron_ref: `asbest#${key}`, naam: v.bedrijf,
      plaats: v.plaatsOvertreder, extra: `asbestovertreding ${String(v.locatieText || '').replace(/\s+/g, ' ')}` }));
  },
  async rvo(db) {
    return (await delen(db, 146)).map(({ key, v }) => ({ bron: 'rvo', bron_ref: `rvo#${key}`, naam: v.applicant || v.name, kvk: v.kvk,
      extra: `${v.year || ''} ${euro(v.budget)} ${v.title || ''}` }));
  },
  async afm(db) {
    return (await delen(db, 145)).map(({ key, v }) => ({ bron: 'afm', bron_ref: `afm#${key}`, naam: v.name, kvk: v.kvk, plaats: v.place }));
  },
  async dnb(db) {
    return (await delen(db, 147)).map(({ key, v }) => ({ bron: 'dnb', bron_ref: `dnb#${key}`, naam: v.name, kvk: v.kvk, rsin: v.rsin, lei: v.lei,
      plaats: v.place, extra: v.register || '' }));
  },
  async onderwijsinspectie(db) {
    return (await delen(db, 144)).map(({ key, v }) => ({ bron: 'onderwijsinspectie', bron_ref: `oi#${key}`, naam: v.name,
      adres: `${v.street || ''} ${v.houseNumber || ''}`, postcode: v.postalCode, plaats: v.place,
      rol: /onvoldoende|zwak/i.test(v.judgment || '') ? 'toezicht' : 'register', extra: `oordeel: ${v.judgment || 'geen'}` }));
  },
  async governance(db) {
    return (await delen(db, 156)).map(({ key, v }) => ({ bron: 'governance', bron_ref: `gov#${key}`, naam: v.organization,
      extra: `${v.person || ''} — ${v.role || ''}` }));
  },
  async seveso(db) {
    return (await delen(db, 155)).map(({ key, v }) => ({ bron: 'seveso', bron_ref: `seveso#${key}`, naam: (v.data || {}).naam,
      plaats: (v.data || {}).gemeente, extra: `Seveso-inspectie ${(v.data || {}).inspectiedatum || ''}` }));
  },
  async zorg(db) {
    const seen = new Map();
    for (const { v } of await delen(db, 150)) {
      const d = v.data || {};
      const naam = d.naam_name;
      if (!naam) continue;
      const kvk = d.kvknummer_externalorganizationid;
      const ref = `zorg#${kvk || naam}`;
      if (!seen.has(ref)) seen.set(ref, { bron: 'zorg', bron_ref: ref, naam, kvk,
        adres: `${d.straat_streetname || ''} ${d.huisnummer_housenumber || ''}`, postcode: d.postcode_postalcode, plaats: d.plaats_town });
    }
    return [...seen.values()];
  },
  async nvwa(db) {
    const out = [];
    for (const r of await rows(db, 'SELECT id, title, content FROM raw_items WHERE source_id = 126')) {
      const m = String(r.title || '').match(/^(.+?), ([^—]+?) — (.+?) \(inspectie/);
      if (!m) continue;
      const a = String(r.content || '').split('Oordeel')[0].match(/(\d{4}\s?[A-Z]{2})/);
      const adres = String(r.content || '').split('Oordeel')[0].replace(m[1], '').trim();
      out.push({ bron: 'nvwa', bron_ref: `raw#${r.id}`, naam: m[1], plaats: m[2], postcode: a ? a[1] : null, adres,
        rol: /voldoet niet/i.test(m[3]) ? 'toezicht' : 'register', extra: `NVWA: ${m[3]}` });
    }
    return out;
  },
  async arbeidsinspectie(db) {
    const out = [];
    for (const r of await rows(db, 'SELECT id, content FROM raw_items WHERE source_id = 133')) {
      const d = parse(r.content);
      if (!d || !d.bedrijfsnaam) continue;
      const overtreding = d.heeftOvertreding === true
        || (Array.isArray(d.overtredingen) && d.overtredingen.some((o) => /^overtreding/i.test(o.resultaat || '')));
      const wat = (Array.isArray(d.overtredingen) ? d.overtredingen : []).map((o) => `${o.omschrijving}: ${o.resultaat}`).join('; ');
      out.push({ bron: 'arbeidsinspectie', bron_ref: `raw#${r.id}`, naam: d.bedrijfsnaam, plaats: d.bedrijfPlaats,
        rol: overtreding ? 'toezicht' : 'register', extra: `${String(d.inspectiedatum || '').slice(0, 10)} ${wat}`.slice(0, 280) });
    }
    return out;
  },
  // Centraal Insolventieregister (bron 48): alleen rechtspersonen, zie scrapers/insolventies.js.
  async insolventie(db) {
    const out = [];
    for (const r of await rows(db, 'SELECT id, title, content, published_at FROM raw_items WHERE source_id = 48')) {
      const naam = (String(r.title || '').match(/^Insolventie: (.+?) \(/) || [])[1];
      if (!naam || naam === 'onbekende rechtspersoon') continue;
      const kvk = (String(r.content || '').match(/KvK-nummer: (\d{8})/) || [])[1];
      const adres = (String(r.content || '').match(/Vestigingsadres: (.+?)\.?$/m) || [])[1] || '';
      const soort = (String(r.title || '').split(' — ').slice(1).join(' — ')) || 'insolventie';
      out.push({ bron: 'insolventie', bron_ref: `raw#${r.id}`, naam, kvk, adres, postcode: (adres.match(/\d{4}\s?[A-Z]{2}/) || [])[0],
        extra: `${String(r.published_at || '').slice(0, 10)} ${soort}` });
    }
    return out;
  },
  // TenderNed: alleen winnaars. Eén record per winnaar per publicatie; voegSamen maakt er één per naam van.
  async tender_winnaar(db) {
    return (await rows(db, `SELECT id, publicatie_id, publicatie_datum, aanbesteding_naam, opdrachtgever_naam, naam,
        registratienummer, adres, postcode, plaats, waarde_eur FROM tender_parties WHERE is_winnaar = 1`))
      .map((r) => ({ bron: 'tender_winnaar', bron_ref: `tender#${r.publicatie_id}`, naam: r.naam, kvk: r.registratienummer,
        adres: r.adres, postcode: r.postcode, plaats: r.plaats,
        extra: `${String(r.publicatie_datum || '').slice(0, 10)} ${r.opdrachtgever_naam || ''}: ${r.aanbesteding_naam || ''} ${euro(r.waarde_eur)}` }));
  },
  async openkvk(db) {
    return (await delen(db, 161)).map(({ key, v }) => v).filter((v) => v.kvk && !PERSOONLIJK.test(v.legalForm || ''))
      .map((v) => ({ bron: 'openkvk', bron_ref: v.sourceKey, naam: v.name, kvk: v.kvk,
        adres: `${(v.address || {}).street || ''} ${(v.address || {}).number || ''}`, postcode: (v.address || {}).postcode,
        plaats: (v.address || {}).place, extra: `${v.legalForm || ''}${v.active === false ? ', niet actief' : ''}` }));
  },
  async kg(db) {
    return (await rows(db, `SELECT e.id, e.canonical_name,
        (SELECT value FROM entity_identifiers i WHERE i.entity_id = e.id AND lower(i.identifier_type) = 'kvk' LIMIT 1) AS kvk
        FROM kg_entities e WHERE e.entity_type = 'organization' AND e.merged_into_id IS NULL`))
      .map((r) => ({ bron: 'kg', bron_ref: `kg#${r.id}`, naam: r.canonical_name, kvk: r.kvk }));
  },
};

module.exports = { LOADERS, PERSOONLIJK };
