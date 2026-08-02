// P1-migratie 2026-08-02: entiteit-gedreven extractie
// 1) entities: CHECK uitbreiden + person_id/organization_id kolommen (tabel-rebuild)
// 2) person_aliases + org_aliases
// 3) entity_mentions
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const has = async (t) => (await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE name=?", args: [t] })).rows.length > 0;

  if (!(await has('entities_new'))) {
    const cols = (await db.execute("PRAGMA table_info(entities)")).rows.map(r => r.name);
    if (!cols.includes('person_id')) {
      console.log('Rebuild entities-tabel...');
      await db.execute(`CREATE TABLE entities_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
        entity_type TEXT NOT NULL CHECK(entity_type IN ('person','organization','location','address','amount','legal_ref','kvk_number','project')),
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        context TEXT,
        person_id INTEGER REFERENCES persons(id),
        organization_id INTEGER REFERENCES organizations(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      await db.execute("INSERT INTO entities_new (id,raw_item_id,entity_type,name,normalized_name,context,created_at) SELECT id,raw_item_id,entity_type,name,normalized_name,context,created_at FROM entities");
      await db.execute("ALTER TABLE entities RENAME TO entities_old_20260802");
      await db.execute("ALTER TABLE entities_new RENAME TO entities");
      console.log('entities herbouwd.');
    } else {
      console.log('entities al gemigreerd, overslaan.');
    }
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS person_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES persons(id),
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    match_mode TEXT NOT NULL DEFAULT 'ci' CHECK(match_mode IN ('ci','cs')),
    UNIQUE(person_id, normalized_alias)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS org_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    UNIQUE(organization_id, normalized_alias)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS entity_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    context_snippet TEXT,
    matched_via TEXT NOT NULL DEFAULT 'alias',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_id, raw_item_id)
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities(normalized_name)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_entities_item ON entities(raw_item_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_mentions_item ON entity_mentions(raw_item_id)");
  console.log('Tabellen person_aliases, org_aliases, entity_mentions + indexen aanwezig.');

  // Aliassen genereren
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const persons = (await db.execute("SELECT id,name FROM persons")).rows;
  const roles = (await db.execute("SELECT person_id, lower(title) t FROM roles WHERE is_current=1")).rows;
  const roleMap = {};
  for (const r of roles) {
    let f = null;
    if (r.t.includes('burgemeester')) f = 'burgemeester';
    else if (r.t.includes('wethouder')) f = 'wethouder';
    else if (r.t.includes('raadslid')) f = 'raadslid';
    else if (r.t.includes('dijkgraaf')) f = 'dijkgraaf';
    if (f) (roleMap[r.person_id] = roleMap[r.person_id] || new Set()).add(f);
  }
  // achternaam = laatste woord-reeks incl. tussenvoegsels
  const surname = (name) => {
    const parts = name.trim().split(/\s+/);
    const tv = ['van','de','der','den','ter','te','ten','het','op','in','aan','bij','tot','v.d.','vd'];
    let i = parts.length - 1;
    while (i > 1 && tv.includes(parts[i - 1].toLowerCase())) i--;
    if (i <= 0) return null;
    return parts.slice(i > 1 && tv.includes(parts[1].toLowerCase()) ? 1 : i).join(' ');
  };
  const surCount = {};
  const surOf = {};
  for (const p of persons) {
    const s = surname(p.name);
    surOf[p.id] = s;
    if (s) surCount[norm(s)] = (surCount[norm(s)] || 0) + 1;
  }
  let pa = 0;
  for (const p of persons) {
    const aliases = [];
    aliases.push([p.name, 'ci']);
    const s = surOf[p.id];
    if (s) {
      const kaal = s.replace(/^((van|de|der|den|ter|te|ten|het|op|in|aan|bij|tot)\s+)+/i, '');
      // achternaam alleen als cs-alias (hoofdlettergevoelig), uniek onder personen en >=5 tekens
      if (surCount[norm(s)] === 1 && kaal.length >= 5) aliases.push([s, 'cs']);
      // voorletter + achternaam
      const first = p.name.trim().split(/\s+/)[0];
      if (first && first.length > 1) aliases.push([first[0] + '. ' + s, 'ci']);
      // functie + achternaam
      for (const f of (roleMap[p.id] || [])) aliases.push([f + ' ' + s, 'ci']);
    }
    for (const [a, m] of aliases) {
      await db.execute({ sql: "INSERT OR IGNORE INTO person_aliases (person_id, alias, normalized_alias, match_mode) VALUES (?,?,?,?)", args: [p.id, a, norm(a), m] });
      pa++;
    }
  }
  const orgs = (await db.execute("SELECT id,name FROM organizations")).rows;
  const extra = {
    'de alliantie': ['alliantie'],
    'meander medisch centrum': ['meander mc', 'meander'],
    'waterschap vallei en veluwe': ['vallei en veluwe'],
    'ggd regio utrecht': ['ggd'],
    'politie midden-nederland': ['politie midden nederland'],
    'gemeente amersfoort': ['college van b en w', 'college van burgemeester en wethouders'],
  };
  let oa = 0;
  for (const o of orgs) {
    const set = new Set([o.name]);
    const stripped = o.name.replace(/^(stichting|gemeente|vereniging)\s+/i, '');
    if (norm(stripped) !== norm(o.name) && stripped.length >= 5) set.add(stripped);
    for (const e of (extra[norm(o.name)] || [])) set.add(e);
    for (const a of set) {
      await db.execute({ sql: "INSERT OR IGNORE INTO org_aliases (organization_id, alias, normalized_alias) VALUES (?,?,?)", args: [o.id, a, norm(a)] });
      oa++;
    }
  }
  console.log(`Aliassen: ~${pa} persoon-, ~${oa} organisatie-aliassen weggeschreven.`);
  const cnt = await db.execute("SELECT (SELECT COUNT(*) FROM person_aliases) pa,(SELECT COUNT(*) FROM org_aliases) oa");
  console.log('Totalen:', JSON.stringify(cnt.rows));
}
main().catch(e => { console.error(e); process.exit(1); });
