import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beschrijfOordeel,
  haalInstellingen,
  parseDatum,
  scrape,
  selecteerRapporten,
} from '../src/scrapers/onderwijsinspectie.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'onderwijsinspectie');
const fixture = name => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

function response(payload, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async text() { return JSON.stringify(payload); },
  };
}

function school(id, town, extra = {}) {
  return {
    id,
    pseudocode: `TEST|0${id}`,
    naam: `School ${town}`,
    town,
    street: 'Schoolstraat',
    houseNo: id,
    postalcode: '0000 AA',
    sectoromschrijving: 'Basisonderwijs',
    vervallen: false,
    bevoegdGezag: { naam: `Bestuur ${town}` },
    ...extra,
  };
}

describe('Onderwijsinspectie — selectie en schema', () => {
  it('filtert zoekresultaten exact op Amersfoort en Leusden en dedupliceert ids', async () => {
    const fetchImpl = async url => {
      const parsed = new URL(url);
      const plaats = parsed.searchParams.get('search');
      return response({
        content: [
          school(plaats === 'Amersfoort' ? 1 : 2, plaats),
          school(plaats === 'Amersfoort' ? 1 : 2, plaats),
          school(99, 'Utrecht'),
        ],
        last: true,
      });
    };
    const result = await haalInstellingen(fetchImpl, 0);
    assert.deepEqual(result.perPlaats, { Amersfoort: 1, Leusden: 1 });
    assert.deepEqual(result.instellingen.map(item => item.id), [1, 2]);
  });

  it('houdt het inhoudelijke rapport en onderdrukt een dubbele oudersamenvatting', () => {
    const reports = fixture('magneet-rapporten.json');
    const selected = selecteerRapporten([...reports, reports[0]]);
    assert.deepEqual(selected.map(item => item.rapportnummer), [133913]);
  });

  it('neemt het geldende oordeel, indicatoren en de officiële duiding over', () => {
    const oordeel = fixture('magneet-oordeel.json');
    const text = beschrijfOordeel(oordeel.oordeel, {
      OP0: { indicatoromschrijving: 'Basisvaardigheden', indicatorscoreomschrijving: 'Onvoldoende' },
    });
    assert.match(text, /Geldend oordeel: Zeer zwak/);
    assert.match(text, /Basisvaardigheden: Onvoldoende/);
    assert.match(text, /vervolgtoezicht/);
    assert.equal(parseDatum('05-02-2026').toISOString(), '2026-02-05T00:00:00.000Z');
    assert.equal(parseDatum('2026-02-05'), null);
  });
});

describe('Onderwijsinspectie — dry-run', () => {
  it('doorloopt beide plaatsen zonder databasewrites', async () => {
    const fetchImpl = async url => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/zoek/elementen') {
        const plaats = parsed.searchParams.get('search');
        return response({ content: [school(plaats === 'Amersfoort' ? 1 : 2, plaats)], last: true });
      }
      if (parsed.pathname.startsWith('/api/ws/vigerend-oordeel/')) {
        const id = Number(parsed.pathname.split('/').at(-1));
        return response({
          oordeel: { effectieveWaardeomschrijving: 'Voldoende', dimensieomschrijving: 'Kwaliteit onderwijs' },
          indicatoren: {},
          onderzoekenVoorRapporten: [100 + id],
        });
      }
      if (parsed.pathname.startsWith('/api/detail/rapporten-bij-onderzoeken/')) {
        const onderzoek = Number(parsed.pathname.split('/').at(-1));
        return response([{
          rapportnummer: 1000 + onderzoek,
          publicatienaam: 'Kwaliteitsonderzoek',
          vaststellingsdatum: '12-09-2026',
        }]);
      }
      return response({}, false);
    };
    const result = await scrape({ fetchImpl, dryRun: true, pauseMs: 0 });
    assert.deepEqual(result.institutions, { Amersfoort: 1, Leusden: 1 });
    assert.deepEqual(
      { found: result.found, saved: result.saved, skipped: result.skipped, errors: result.errors },
      { found: 2, saved: 0, skipped: 2, errors: 0 },
    );
  });

  it('gebruikt de rapport-URL als stabiele sleutel bij een identieke herhaalrun', async () => {
    const rawItems = [];
    let sourceExists = false;
    const database = {
      async execute(statement) {
        const sql = typeof statement === 'string' ? statement : statement.sql;
        const args = typeof statement === 'string' ? [] : statement.args;
        if (sql.includes('SELECT id FROM sources')) {
          return { rows: sourceExists ? [{ id: 1 }] : [] };
        }
        if (sql.includes('INSERT INTO sources')) {
          sourceExists = true;
          return { rows: [], lastInsertRowid: 1 };
        }
        if (sql.includes('SELECT id FROM raw_items')) {
          return { rows: rawItems.filter(item => item.sourceId === args[0] && item.externalUrl === args[1]) };
        }
        if (sql.includes('INSERT INTO raw_items')) {
          rawItems.push({ id: rawItems.length + 1, sourceId: args[0], externalUrl: args[1] });
          return { rows: [], lastInsertRowid: rawItems.length };
        }
        return { rows: [] };
      },
    };
    const fetchImpl = async url => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/zoek/elementen') {
        const plaats = parsed.searchParams.get('search');
        return response({ content: [school(plaats === 'Amersfoort' ? 1 : 2, plaats)], last: true });
      }
      if (parsed.pathname.startsWith('/api/ws/vigerend-oordeel/')) {
        const id = Number(parsed.pathname.split('/').at(-1));
        return response({ oordeel: {}, indicatoren: {}, onderzoekenVoorRapporten: [100 + id] });
      }
      const onderzoek = Number(parsed.pathname.split('/').at(-1));
      return response([{ rapportnummer: 1000 + onderzoek, publicatienaam: 'Kwaliteitsonderzoek', vaststellingsdatum: '12-09-2026' }]);
    };

    const eerste = await scrape({ database, fetchImpl, pauseMs: 0 });
    const herhaling = await scrape({ database, fetchImpl, pauseMs: 0 });
    assert.deepEqual({ saved: eerste.saved, skipped: eerste.skipped }, { saved: 2, skipped: 0 });
    assert.deepEqual({ saved: herhaling.saved, skipped: herhaling.skipped }, { saved: 0, skipped: 2 });
    assert.equal(rawItems.length, 2);
  });
});
