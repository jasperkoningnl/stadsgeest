const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const {
  archiveSnapshot, changedFields, ensureOrganization, ensureSource, fetchBuffer, isLocalPlace, normalizeText,
  parseDelimited, requireColumns, runVersionedDataset, semanticHash,
} = require('../phase3-core.cjs');

const SOURCE_URL = 'https://www.dnb.nl/openbaar-register/';
const REGISTER_CODES = ['WFTKF', 'WFTBI', 'WFTVE', 'WTTTK', 'WFTEG', 'PWPNF'];
const VERSION = '1.0.0';
const META = {
  name: 'DNB — openbaar register', url: SOURCE_URL, sourceClass: 'AUTHORITATIVE_REGISTER',
  version: VERSION, frequency: 'daily', category: 'registry', lastVerifiedAt: '2026-09-13',
  termsCheckedAt: '2026-09-13', ownerContact: 'info@dnb.nl',
  manifest: { owner: 'De Nederlandsche Bank', license: 'openbaar register', register_codes: REGISTER_CODES, intended_frequency: 'weekdagen 06:30',
    identity: 'deelregister + relatienummer + registratie + activiteit',
    local_filter: 'exacte statutaire of vestigingsplaats; anders harde KVK/LEI-watchlist',
    removal_confirmation_runs: 2 },
};

function parseDnbCsv(text, watchlist = new Set()) {
  const rows = parseDelimited(text, ';');
  requireColumns(rows, ['Deelregister', 'Relatienummer', 'StatutaireNaam', 'StatutairePlaats', 'PlaatsVestiging', 'KvK', 'LEI', 'RegistratieType'], 'DNB-register');
  const relevant = rows.filter(row => isLocalPlace(row.StatutairePlaats) || isLocalPlace(row.PlaatsVestiging) ||
    (row.KvK && watchlist.has(`kvk:${row.KvK.replace(/\s/g, '')}`)) || (row.LEI && watchlist.has(`lei:${row.LEI.replace(/\s/g, '')}`)));
  const grouped = new Map();
  for (const row of relevant) {
    const relation = normalizeText(row.Relatienummer);
    const register = normalizeText(row.Deelregister);
    const key = `dnb:${register.toLowerCase()}:${relation}`;
    if (!grouped.has(key)) grouped.set(key, { sourceKey: key, name: normalizeText(row.StatutaireNaam), aliases: new Set(),
      statutoryPlace: normalizeText(row.StatutairePlaats), place: normalizeText(row.PlaatsVestiging), kvk: normalizeText(row.KvK),
      rsin: normalizeText(row.RSIN), lei: normalizeText(row.LEI), register, relation, registrations: [] });
    const record = grouped.get(key);
    for (const alias of normalizeText(row.Handelsnaam).split(',').map(normalizeText).filter(Boolean)) record.aliases.add(alias);
    record.registrations.push({ type: normalizeText(row.RegistratieType), article: normalizeText(row.Wetsartikel),
      start: normalizeText(row.Begindatum), end: normalizeText(row.Einddatum), activity: normalizeText(row.ActiviteitBranche),
      activityStart: normalizeText(row.BegindatumActiviteit), activityEnd: normalizeText(row.EinddatumActiviteit) });
  }
  return [...grouped.values()].map(record => {
    record.aliases = [...record.aliases].sort();
    record.registrations.sort((a, b) => semanticHash(a).localeCompare(semanticHash(b)));
    record.sourceUrl = SOURCE_URL;
    record.semanticFields = { name: record.name, aliases: record.aliases, statutoryPlace: record.statutoryPlace,
      place: record.place, kvk: record.kvk, rsin: record.rsin, lei: record.lei, register: record.register, registrations: record.registrations };
    return record;
  });
}

async function loadWatchlist(db) {
  const result = await db.execute(`SELECT identifier_type,value FROM entity_identifiers WHERE identifier_type IN ('kvk','lei')`);
  return new Set(result.rows.map(row => `${row.identifier_type}:${String(row.value).replace(/\s/g, '')}`));
}

function eventForChange(changeType, record, previous, entityId) {
  const fields = previous ? changedFields(previous, record, ['name', 'aliases', 'statutoryPlace', 'place', 'registrations']) : [];
  return { type: ({ added: 'DNB_REGISTRATION_ADDED', changed: 'DNB_REGISTRATION_CHANGED', removed: 'DNB_REGISTRATION_REMOVED' })[changeType],
    changeType, entityId, changedFields: fields,
    title: `DNB-registratie ${changeType === 'added' ? 'toegevoegd' : changeType === 'removed' ? 'verdwenen na bevestiging' : 'gewijzigd'}: ${record.name}`,
    summary: `${record.name} (${record.register}, ${record.relation}).${fields.length ? ` Gewijzigd: ${fields.join(', ')}.` : ''}`,
    evidence: [record.name, record.register, record.relation, record.place || record.statutoryPlace],
    uncertainty: changeType === 'removed' ? 'Verdwijning is na twee succesvolle complete downloads bevestigd; controleer rechtsstatus.' : null,
    entityEvidence: 'DNB-register: exacte lokale plaats of harde KVK/LEI-watchlistmatch' };
}

class DnbRegisterAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.registerCodes = config.registerCodes || REGISTER_CODES; this.sourceId = null; }
  async run() {
    this.sourceId = await ensureSource(this.db, META, this.dryRun);
    const watchlist = await loadWatchlist(this.db);
    const parts = []; const allRecords = []; let nationalRows = 0;
    for (const code of this.registerCodes) {
      const url = `https://www.dnb.nl/nl-NL/registerdownload/csv/${code}`;
      const fetched = await fetchBuffer(url, { fetchImpl: this.fetchImpl, label: `DNB ${code}`, accept: 'text/csv', timeoutMs: 120_000 });
      const text = fetched.buffer.toString('utf8'); nationalRows += parseDelimited(text, ';').length;
      allRecords.push(...parseDnbCsv(text, watchlist)); parts.push({ code, url: fetched.url, hash: semanticHash(fetched.buffer.toString('base64')) });
      if (!this.dryRun && this.sourceId > 0) await archiveSnapshot(this.db, this.sourceId, `${META.name}-${code}`, fetched, false);
    }
    const byKey = new Map();
    for (const record of allRecords) byKey.set(record.sourceKey, record);
    const manifestBuffer = Buffer.from(JSON.stringify(parts));
    const fetched = { buffer: manifestBuffer, url: SOURCE_URL, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records: [...byKey.values()], fetched,
      minimumRecords: 1, eventForChange, ensureEntity: (record, sourceId) => ensureOrganization(this.db, record, sourceId, record.relation, this.dryRun) });
    this.sourceId = result.sourceId;
    return { ...result, nationalRows, registers: this.registerCodes.length };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: `${this.registerCodes.length} DNB-deelregisters gecontroleerd` }; }
}

module.exports = { DnbRegisterAdapter, META, REGISTER_CODES, eventForChange, parseDnbCsv };
