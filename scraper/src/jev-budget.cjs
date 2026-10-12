'use strict';
const fs = require('node:fs'), path = require('node:path');
const { budgetUsed, canReserve, PRICE } = require('./jev-experiment-lib.cjs');
const BASE = path.join(__dirname, '..', 'tmp', 'jev-experiment');
const LEDGERS = ['ledger.json','followup/ledger.json','large/ledger.json'];
function allEntries(base = BASE) {
  return LEDGERS.flatMap(name => {
    const file = path.join(base,name);
    // Een niet-afgeronde lokale write kan een verstuurd verzoek bevatten.
    const pending = file + '.writing';
    if (!fs.existsSync(file) && !fs.existsSync(pending)) return [];
    const value = JSON.parse(fs.readFileSync(fs.existsSync(pending) ? pending : file,'utf8'));
    if (!Array.isArray(value.entries) || value.entries.some(e => !['not_sent','ok','reserved','unresolved'].includes(e.status)
      || (e.status === 'ok' && (!Number.isInteger(e.result?.input_tokens) || e.result.input_tokens <= 0
        || e.result.input_tokens > 64000 || !Number.isFinite(e.result.cost_usd)
        || Math.abs(e.result.cost_usd-e.result.input_tokens*PRICE)>1e-12)))) throw Error('Budgetledger ongeldig.');
    return value.entries;
  });
}
function total(base = BASE) { return budgetUsed(allEntries(base)); }
function mayReserve(budget = 5, base = BASE) {
  if (!Number.isFinite(budget) || budget <= 0 || budget > 5) throw Error('Maximaal toegestaan proefbudget is 5 USD.');
  return canReserve(allEntries(base),budget);
}
module.exports = { BASE, LEDGERS, allEntries, total, mayReserve };
