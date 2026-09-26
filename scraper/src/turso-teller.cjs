#!/usr/bin/env node
'use strict';

// Leesteller van Turso voor het hele account, via de Platform-API.
// De aanroep zelf kost geen reads. Zie docs/DATABASE-LEZEN.md.
//
// Gebruik:
//   node scraper/src/turso-teller.cjs              stand van deze maand
//   node scraper/src/turso-teller.cjs --kaal       alleen het getal (voor --sinds)
//   node scraper/src/turso-teller.cjs --sinds <n>  verbruik sinds een eerdere stand
//
// Nodig in scraper/.env: TURSO_PLATFORM_TOKEN en TURSO_ORG.
// Let op: Turso werkt de teller met enige vertraging bij; meet een run dus
// een paar minuten na afloop.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const GRATIS = 500_000_000;

async function api(pad) {
  const token = process.env.TURSO_PLATFORM_TOKEN;
  const org = process.env.TURSO_ORG;
  if (!token || !org) throw new Error('TURSO_PLATFORM_TOKEN of TURSO_ORG ontbreekt in scraper/.env');
  const res = await fetch(`https://api.turso.tech/v1/organizations/${org}${pad}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Turso-API ${res.status} op ${pad || '/'}`);
  return res.json();
}

function mln(n) {
  return `${(n / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mln`;
}

async function stand() {
  const [usage, org, plannen] = await Promise.all([
    api('/usage'),
    api(''),
    api('/plans').catch(() => ({ plans: [] })),
  ]);
  const plan = org.organization?.plan_id ?? 'onbekend';
  const limiet = plannen.plans?.find((p) => p.name === plan)?.quotas?.rowsRead ?? null;
  return { gelezen: usage.organization?.usage?.rows_read ?? 0, plan, limiet };
}

async function main(argv = process.argv.slice(2)) {
  const s = await stand();
  if (argv.includes('--kaal')) { console.log(s.gelezen); return; }
  const i = argv.indexOf('--sinds');
  if (i >= 0) {
    const eerder = Number(argv[i + 1]);
    if (!Number.isFinite(eerder)) throw new Error('--sinds verwacht een getal');
    console.log(`Gelezen sinds de vorige stand: ${mln(s.gelezen - eerder)} (${(s.gelezen - eerder).toLocaleString('nl-NL')} rijen)`);
  }
  console.log(`Deze maand: ${mln(s.gelezen)} van ${mln(GRATIS)} gratis (${Math.round((s.gelezen / GRATIS) * 100)}%)`
    + (s.limiet && s.limiet !== GRATIS ? `; plan ${s.plan}: limiet ${mln(s.limiet)}` : ''));
  console.log(`Stand: ${s.gelezen}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Teller mislukt: ${e.message}`); process.exitCode = 1; });
}

module.exports = { stand };
