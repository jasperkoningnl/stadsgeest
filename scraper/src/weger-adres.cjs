#!/usr/bin/env node
'use strict';

// Alleen-lezend: adres -> PDOK/BAG (nummeraanduiding, buurtcode) plus
// rijksmonumenten binnen 10 m uit source_records (bron 154).
// Gebruik: node scraper/src/weger-adres.cjs "Nieuweweg 4 Amersfoort" ["..."]
// Nabijheid is een aanwijzing, geen bewijs: bevestig een monument altijd in het
// monumentenregister (het adres van het monument moet exact overeenkomen).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const MONUMENTBRON = 154;
const MAX_METER = 10;

function afstandMeter(a, b) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function puntUitWkt(wkt) {
  const m = String(wkt || '').match(/POINT\(([\d.]+) ([\d.]+)\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function laadMonumenten(db) {
  const r = await db.execute({ sql: 'SELECT raw_object FROM source_records WHERE source_id = ?', args: [MONUMENTBRON] });
  const lijst = [];
  for (const row of r.rows) {
    try {
      const o = JSON.parse(row.raw_object);
      if (o?.data?.geometry?.coordinates) {
        lijst.push({ nr: o.data.monumentnummer, url: o.data.citation, c: o.data.geometry.coordinates });
      }
    } catch { /* onleesbaar record overslaan */ }
  }
  return lijst;
}

async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help') {
    console.log('Gebruik: node scraper/src/weger-adres.cjs "Straat 12 Amersfoort" ["..."]');
    return;
  }
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const monumenten = await laadMonumenten(db);
    for (const zoek of argv) {
      const url = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=1&fq=type:adres&q=' + encodeURIComponent(zoek);
      const doc = (await (await fetch(url)).json())?.response?.docs?.[0];
      const punt = puntUitWkt(doc?.centroide_ll);
      if (!doc || !punt) {
        console.log(JSON.stringify({ zoek, gevonden: false }));
        continue;
      }
      const bij = monumenten
        .map((m) => ({ nr: m.nr, url: m.url, meter: Math.round(afstandMeter(punt, m.c)) }))
        .filter((m) => m.meter <= MAX_METER)
        .sort((a, b) => a.meter - b.meter);
      console.log(JSON.stringify({
        zoek,
        adres: doc.weergavenaam,
        buurt: doc.buurtnaam,
        buurtcode: doc.buurtcode,
        wijk: doc.wijknaam,
        nummeraanduiding_id: doc.nummeraanduiding_id,
        adresseerbaarobject_id: doc.adresseerbaarobject_id,
        monumenten_binnen_10m: bij,
      }));
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Adrescontrole mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { afstandMeter, puntUitWkt };
