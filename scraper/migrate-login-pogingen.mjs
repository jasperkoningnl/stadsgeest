// Tabel voor de rem op inlogpogingen (src/lib/dashboard/inlogLimiet.ts).
// Additief en herhaalbaar. Gebruik vanuit scraper/: node migrate-login-pogingen.mjs
import { createDb } from './src/lib.js';

const db = createDb();
try {
  await db.execute(`CREATE TABLE IF NOT EXISTS login_pogingen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sleutel TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_login_pogingen_sleutel ON login_pogingen(sleutel, created_at)');
  const kolommen = (await db.execute('PRAGMA table_info(login_pogingen)')).rows.map((r) => r.name);
  const indexen = (await db.execute('PRAGMA index_list(login_pogingen)')).rows.map((r) => r.name);
  console.log(`login_pogingen: kolommen ${kolommen.join(', ')}; indexen ${indexen.join(', ')}`);
} finally {
  try { db.close?.(); } catch { /* al dicht */ }
}
