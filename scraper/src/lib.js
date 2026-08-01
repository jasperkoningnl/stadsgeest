// Shared utilities for Stadsgeest scrapers
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv() {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

export function createDb() {
  const env = loadEnv();
  return createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
}

export async function ensureSource(db, { name, url, source_type, reliability, category, scrape_frequency, tier }) {
  // Zoek op naam of URL (voorkomt UNIQUE constraint-fout als URL al bestaat)
  const existing = await db.execute({
    sql: 'SELECT id FROM sources WHERE name = ? OR url = ?',
    args: [name, url ?? ''],
  });
  if (existing.rows.length > 0) {
    await db.execute({ sql: "UPDATE sources SET last_scraped_at = datetime('now'), tier = ? WHERE id = ?", args: [tier ?? 2, existing.rows[0].id] });
    return existing.rows[0].id;
  }
  const r = await db.execute({
    sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency, tier, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
    args: [name, url, source_type ?? 'scrape', reliability ?? 'secondary', category ?? 'government', scrape_frequency ?? 'weekly', tier ?? 2],
  });
  return r.lastInsertRowid;
}

export async function insertItem(db, { source_id, title, content, summary, external_url, scraped_at, is_historical = 0 }) {
  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM raw_items WHERE external_url = ? OR (title = ? AND source_id = ?)',
      args: [external_url ?? '', title, source_id],
    });
    if (existing.rows.length > 0) return false; // skip duplicate

    await db.execute({
      sql: `INSERT INTO raw_items (source_id, title, content, summary, external_url, scraped_at, is_processed, is_historical)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      args: [source_id, title?.substring(0, 500) ?? '', content?.substring(0, 10000) ?? '', summary?.substring(0, 1000) ?? '', external_url ?? '', scraped_at ?? new Date().toISOString(), is_historical],
    });
    return true;
  } catch (e) {
    return null; // error
  }
}

// Laag B: schrijft het resultaat van één scraper (bron) naar scrape_runs.
// job_name komt uit SCRAPE_JOB_NAME (door de aanroepende runner gezet); bij een
// handmatige/losse run van een scraper-bestand is die env var niet gezet.
export async function log(db, sourceId, name, stats, itemsFound) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${name}: ${stats.new} nieuw, ${stats.skipped} overgeslagen, ${stats.errors} fouten`);

  const found = itemsFound ?? (stats.new + stats.skipped);
  const status = found === 0 ? 'empty' : 'ok';

  try {
    await db.execute({
      sql: `INSERT INTO scrape_runs (job_name, source_id, source_name, items_found, items_new, items_duplicate, items_error, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [process.env.SCRAPE_JOB_NAME || null, sourceId ?? null, name, found, stats.new, stats.skipped, stats.errors, status],
    });
  } catch (e) {
    console.error(`Kon scrape_runs niet bijwerken voor ${name}:`, e.message);
  }
}
