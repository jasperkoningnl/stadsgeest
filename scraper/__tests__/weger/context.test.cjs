'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bronTijd, spiegelKandidaten } = require('../../src/weger-context.cjs');

test('bronTijd waarschuwt voor een oud stuk dat opnieuw is opgedoken', () => {
  const tijd = bronTijd([
    { published_at: '2026-09-09', scraped_at: '2026-10-05' },
    { published_at: '2026-10-05', scraped_at: '2026-10-05' },
  ], new Date('2026-10-08T10:00:00Z'));
  assert.equal(tijd.oudste_dagen, 29);
  assert.match(tijd.waarschuwing, /oudste dragende stuk/);
  assert.match(tijd.waarschuwing, /26 dagen uiteen/);
});

test('spiegelcheck vindt ook een thematische treffer zonder gelijke kop', () => {
  const kandidaten = spiegelKandidaten(
    { title: 'Diefstal uit voertuigen stijgt in Soesterkwartier', summary: 'Nieuwe politiecijfers over de wijk' },
    [{ title: 'Politiecijfers voertuigdiefstal', source: { name: 'Politie', role: null } }],
    [{ id: 9, title: 'Bewoners bezorgd over veiligheid en overlast', summary: 'Politie ziet meer diefstal uit auto’s', url: 'https://nieuwsplein33.nl/a', source_name: 'Nieuwsplein33', published_at: '2026-09-20' }],
  );
  assert.equal(kandidaten[0].id, 9);
  assert.ok(kandidaten[0].redenen.includes('thema:veiligheid'));
});
