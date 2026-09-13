const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { XMLParser } = require('fast-xml-parser');
const {
  changedFields, ensureOrganization, extractFirstZipEntry, fetchBuffer, isLocalPlace, normalizeText,
  parseDelimited, requireColumns, runVersionedDataset, semanticHash,
} = require('../phase3-core.cjs');

const SOURCE_URL = 'https://www.afm.nl/nl-nl/sector/registers/vergunningenregisters/financiele-dienstverleners';
const CSV_URL = 'https://www.afm.nl/export.aspx?type=04efad81-e254-40fa-8728-94d90447ad4b&format=csv';
const FULL_EXPORT_URL = 'https://www.afm.nl/export.aspx?fdregister=1';
const VERSION = '1.1.0';
const META = {
  name: 'AFM — register financiële dienstverleners', url: SOURCE_URL,
  sourceClass: 'AUTHORITATIVE_REGISTER', version: VERSION, frequency: 'daily', category: 'registry',
  lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13', ownerContact: 'ondernemersloket@afm.nl',
  manifest: { owner: 'Autoriteit Financiële Markten', license: 'openbaar register',
    download: FULL_EXPORT_URL, format: 'ZIP met WfdExternRegister XML 3.0', identity: 'statutaire naam + lokale zetel/vestigingsplaats', local_filter: 'exacte statutaire zetel of vestigingsplaats',
    semantic_fields: ['name', 'aliases', 'place', 'kvk', 'legalForm', 'licenses'], removal_confirmation_runs: 2 },
};

function asArray(value) { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }
function parseAfmXml(xml) {
  if (!/<WfdExternRegister\b/i.test(xml)) throw new Error('AFM volledig register: WfdExternRegister ontbreekt');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const grouped = new Map(); let nationalRows = 0;
  for (const match of xml.matchAll(/<Instelling\b[\s\S]*?<\/Instelling>/gi)) {
    nationalRows++;
    const block = match[0];
    if (!/<StatutaireZetel>\s*(?:Amersfoort|Leusden)\s*<\/StatutaireZetel>|<VestigingsAdres>[\s\S]*?<Plaats>\s*(?:Amersfoort|Leusden)\s*<\/Plaats>/i.test(block)) continue;
    const institution = parser.parse(block).Instelling; const company = institution?.Bedrijfsgegevens || {};
    const name = normalizeText(company.StatutaireNaam); const seat = normalizeText(company.StatutaireZetel);
    const addressPlace = normalizeText(company.VestigingsAdres?.Plaats); const place = isLocalPlace(addressPlace) ? addressPlace : seat;
    const aliases = asArray(company.Handelsnamen?.Handelsnaam).map(item => normalizeText(item?.Naam)).filter(Boolean).sort();
    const licenses = asArray(institution.Vergunningen?.Vergunning).map(license => ({
      number: normalizeText(license?.Vergunningnummer), start: normalizeText(license?.StartDatum), end: normalizeText(license?.EindDatum),
      products: asArray(license?.PDCs?.Product).map(product => ({ name: normalizeText(product?.Omschrijving),
        services: asArray(product?.Dienst).map(service => ({ name: normalizeText(service?.Omschrijving), start: normalizeText(service?.StartDatum), end: normalizeText(service?.EindDatum) }))
          .sort((a, b) => `${a.name}|${a.start}`.localeCompare(`${b.name}|${b.start}`)) })).sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.number.localeCompare(b.number));
    const sourceKey = `afm-fd:${semanticHash({ name: name.toLowerCase(), place: place.toLowerCase() }).slice(0, 24)}`;
    const record = { sourceKey, institutionId: normalizeText(institution?.InstellingID), name, aliases, place,
      kvk: normalizeText(company.KVKNummer).replace(/\s/g, ''), legalForm: normalizeText(company.Rechtsvorm), licenses, sourceUrl: SOURCE_URL };
    record.semanticFields = { name, aliases, place, kvk: record.kvk, legalForm: record.legalForm, licenses };
    if (!grouped.has(sourceKey)) grouped.set(sourceKey, record);
    else {
      const current = grouped.get(sourceKey); current.aliases = [...new Set([...current.aliases, ...aliases])].sort();
      current.licenses = [...current.licenses, ...licenses].sort((a, b) => a.number.localeCompare(b.number));
      current.semanticFields.aliases = current.aliases; current.semanticFields.licenses = current.licenses;
    }
  }
  return { records: [...grouped.values()], nationalRows };
}

function parseAfmCsv(text) {
  const rows = parseDelimited(text, ';');
  requireColumns(rows, ['Statutaire naam', 'Handelsnaam', 'Vestigingsplaats'], 'AFM FD-register');
  const grouped = new Map();
  for (const row of rows.filter(row => isLocalPlace(row['Vestigingsplaats']))) {
    const name = normalizeText(row['Statutaire naam']);
    const aliases = normalizeText(row['Handelsnaam']).split(',').map(normalizeText).filter(Boolean);
    const place = normalizeText(row['Vestigingsplaats']);
    const sourceKey = `afm-fd:${semanticHash({ name: name.toLowerCase(), place: place.toLowerCase() }).slice(0, 24)}`;
    if (!grouped.has(sourceKey)) grouped.set(sourceKey, { sourceKey, name, aliases: new Set(), place, sourceUrl: SOURCE_URL });
    for (const alias of aliases) grouped.get(sourceKey).aliases.add(alias);
  }
  return [...grouped.values()].map(record => {
    record.aliases = [...record.aliases].sort();
    record.semanticFields = { name: record.name, aliases: record.aliases, place: record.place };
    return record;
  });
}

function eventForChange(changeType, record, previous, entityId) {
  if (previous && previous.licenses === undefined) return null;
  const fields = previous ? changedFields(previous, record, ['name', 'aliases', 'place', 'kvk', 'legalForm', 'licenses']) : [];
  const types = { added: 'AFM_REGISTRATION_ADDED', changed: 'AFM_REGISTRATION_CHANGED', removed: 'AFM_REGISTRATION_REMOVED' };
  return {
    type: types[changeType], changeType, entityId,
    title: `AFM-registratie ${changeType === 'added' ? 'toegevoegd' : changeType === 'removed' ? 'verdwenen na bevestiging' : 'gewijzigd'}: ${record.name}`,
    summary: `${record.name} (${record.place}) in het AFM-register financiële dienstverleners; ${record.licenses.length} vergunning(en).${fields.length ? ` Gewijzigd: ${fields.join(', ')}.` : ''}`,
    changedFields: fields, evidence: [record.name, record.place, record.kvk, ...record.licenses.slice(0, 3).map(item => item.number)],
    uncertainty: changeType === 'removed' ? 'Verdwijning is na twee volledige succesvolle exports bevestigd; controleer rechtsstatus op de detailpagina.' : null,
    entityId, entityEvidence: 'AFM-register: exacte statutaire naam en lokale vestigingsplaats',
  };
}

class AfmRegisterAdapter {
  constructor(config = {}) {
    this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null;
  }
  async run() {
    const fetched = await fetchBuffer(FULL_EXPORT_URL, { fetchImpl: this.fetchImpl, label: 'AFM volledig FD-register', accept: 'application/zip', timeoutMs: 180_000 });
    const entry = extractFirstZipEntry(fetched.buffer);
    if (!/\.xml$/i.test(entry.name)) throw new Error(`AFM volledig register: verwacht XML, kreeg ${entry.name}`);
    const { records, nationalRows } = parseAfmXml(entry.data.toString('utf8'));
    if (nationalRows < 10_000) throw new Error(`AFM FD-register verdacht klein: ${nationalRows} rijen`);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records, fetched,
      minimumRecords: 20, eventForChange,
      ensureEntity: (record, sourceId) => ensureOrganization(this.db, record, sourceId, record.sourceKey, this.dryRun) });
    this.sourceId = result.sourceId;
    return { ...result, nationalRows };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: this.sourceId ? 'AFM-export valide en lokaal gefilterd' : 'Geen geldige AFM-run' }; }
}

module.exports = { AfmRegisterAdapter, CSV_URL, FULL_EXPORT_URL, META, SOURCE_URL, eventForChange, parseAfmCsv, parseAfmXml };
