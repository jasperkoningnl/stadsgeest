#!/usr/bin/env node
'use strict';

// Wekelijkse keten na de eenmalige initialisatie:
// 1. haal uitsluitend nieuwe en recent gewijzigde documenten op;
// 2. doorzoek de lokale FTS-index;
// 3. zet hoogstens tien nieuwe historische items gericht terug voor de intake.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function step(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} stopte met resultaatcode ${result.status}.`);
}

function main() {
  step('archive-sync.cjs');
  step('archive-research.cjs', ['--promote', '--max', '20', '--max-promoties', '10']);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`Wekelijks archiefonderzoek mislukt: ${error.message}`); process.exitCode = 1; }
}

module.exports = { main, step };
