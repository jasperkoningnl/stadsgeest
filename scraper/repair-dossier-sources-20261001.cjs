const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const OFFICIELE = 'https://zoek.officielebekendmakingen.nl/';

const repairs = new Map([
  [2, {
    primary: 'https://api.notubiz.nl/document/17106657/2',
    secondary: ['https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort_20250317092603/_doc/7921606'],
  }],
  [3, {
    primary: 'https://api.notubiz.nl/document/17106657/2',
    secondary: ['https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort_20250317092603/_doc/7921606'],
  }],
  [68, { primary: 'https://www.de-alliantie.nl/over-de-alliantie/meer-weten/nieuws-inspiratie/nieuws/hoogste-punt-bereikt-van-plot26/', secondary: [] }],
  [71, {
    primary: 'https://112-nu.nl/melding/17690462/hoogland/de-koop/brandweer-met-spoed.html',
    secondary: [
      'https://112-nu.nl/melding/17694731/amersfoort/mozartweg/brandweer-met-spoed.html',
      'https://112-nu.nl/melding/17703907/amersfoort/leusderweg/brandweer-met-spoed.html',
      'https://112-nu.nl/melding/17703901/amersfoort/leusderweg/brandweer-met-spoed.html',
      'https://112-nu.nl/melding/17711768/amersfoort/kreupelstraat/brandweer-met-spoed.html',
    ],
  }],
  [72, {
    primary: `${OFFICIELE}gmb-2026-369720.html`,
    secondary: [`${OFFICIELE}gmb-2026-369734.html`, `${OFFICIELE}gmb-2026-369716.html`],
  }],
  [150, { secondary: [`${OFFICIELE}wsb-2026-18079.html`] }],
  [161, { primary: `${OFFICIELE}gmb-2026-384244.html`, secondary: [] }],
  [162, { primary: `${OFFICIELE}gmb-2026-376931.html`, secondary: [] }],
  [163, { primary: `${OFFICIELE}gmb-2026-355558.html`, secondary: [] }],
  [164, { primary: `${OFFICIELE}gmb-2026-308932.html`, secondary: [] }],
  [165, { primary: `${OFFICIELE}gmb-2026-308942.html`, secondary: [] }],
  [166, {
    primary: `${OFFICIELE}gmb-2026-384244.html`,
    secondary: [
      `${OFFICIELE}gmb-2026-376931.html`,
      `${OFFICIELE}gmb-2026-355558.html`,
      `${OFFICIELE}gmb-2026-308932.html`,
      `${OFFICIELE}gmb-2026-308942.html`,
      `${OFFICIELE}gmb-2026-384992.html`,
      `${OFFICIELE}gmb-2026-384949.html`,
    ],
  }],
  [205, { secondary: ['https://amersfoort.raadsinformatie.nl/document/17198704/2/Zomerrapportage+2026++-+18062026'] }],
  [207, { secondary: ['https://www.destadamersfoort.nl/lokaal/politiek/1301182/inwoners-denken-mee-over-uitwerking-coalitieakkoord'] }],
  [217, {
    secondary: [
      `${OFFICIELE}gmb-2026-394063.html`,
      `${OFFICIELE}gmb-2026-393458.html`,
      `${OFFICIELE}gmb-2026-393442.html`,
      `${OFFICIELE}gmb-2026-394034.html`,
      `${OFFICIELE}gmb-2026-393428.html`,
    ],
  }],
  [218, { secondary: ['https://www.amersfoort.nl/samenvatting-collegebesluiten-15-juli-2025'] }],
  [219, { secondary: ['https://amersfoort.nieuws.nl/nieuws/extra-maatregel-tegen-droogte-verbod-op-grondwater-oppompen-bij-kwetsbare-beeklopen-met-waardevolle-natuur'] }],
  [220, { secondary: ['https://amersfoort.nieuws.nl/nieuws/tijdelijk-onttrekkingsverbod-grondwater-natte-landnatuur'] }],
  [263, {
    secondary: [
      'https://www.amersfoort.nl/burgemeester-lucas-bolsius-kondigt-pensioen-aan-1-juli-2027',
      'https://www.nieuwsplein33.nl/nieuws/4086642/lucas-bolsius-neemt-1-juli-volgend-jaar-afscheid-als-burgemeester',
      'https://www.destadamersfoort.nl/lokaal/achtergrond/1306937/van-grandioze-vent-tot-teleurstelling-amersfoorters-over-vert',
    ],
  }],
  [277, { secondary: [] }],
  [278, { secondary: [] }],
]);

function desired(row, repair) {
  return {
    primary: repair.primary ?? row.primaire_bron_url ?? null,
    secondary: JSON.stringify(repair.secondary),
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Turso-configuratie ontbreekt.');

  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const ids = [...repairs.keys()];
    const result = await db.execute({
      sql: `SELECT id,titel,primaire_bron_url,secundaire_bronnen FROM dossier_facts WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      args: ids,
    });
    if (result.rows.length !== ids.length) throw new Error(`Verwacht ${ids.length} feiten, gevonden ${result.rows.length}.`);

    const changes = result.rows.flatMap((row) => {
      const next = desired(row, repairs.get(Number(row.id)));
      if (row.primaire_bron_url === next.primary && row.secundaire_bronnen === next.secondary) return [];
      return [{ id: Number(row.id), title: row.titel, primary: next.primary, secondary: JSON.parse(next.secondary) }];
    });

    if (apply && changes.length > 0) {
      await db.batch(changes.map((change) => ({
        sql: 'UPDATE dossier_facts SET primaire_bron_url=?, secundaire_bronnen=? WHERE id=?',
        args: [change.primary, JSON.stringify(change.secondary), change.id],
      })), 'write');
    }

    const remaining = apply ? (await db.execute(`SELECT id FROM dossier_facts
      WHERE primaire_bron_url IS NULL OR trim(primaire_bron_url)='' OR json_valid(secundaire_bronnen)=0`)).rows : [];
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', changes, remainingInvalidIds: remaining.map((row) => Number(row.id)) }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { repairs };
