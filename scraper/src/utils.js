import crypto from 'crypto';

// Genereer een hash van de content voor deduplicatie
export function contentHash(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex').substring(0, 16);
}

// Sla een item op in raw_items, sla over als het al bestaat (dedup op content_hash)
// Publicatiedatum normaliseren naar ISO. Accepteert een Date of een string
// ("2026-08-14", "14-08-2026", RFC 2822 uit RSS). Onleesbare of toekomstige
// datums leveren null op — dan valt de intake terug op scraped_at.
export function naarPublicatieIso(waarde) {
  if (!waarde) return null;
  let d;
  if (waarde instanceof Date) {
    d = waarde;
  } else {
    const s = String(waarde).trim();
    // Nederlandse notatie dd-mm-jjjj eerst, anders leest Date() hem Amerikaans.
    const nl = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    d = nl ? new Date(`${nl[3]}-${nl[2]}-${nl[1]}T00:00:00Z`) : new Date(s);
  }
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 2 * 86400000) return null;
  return d.toISOString();
}

export async function saveRawItem(db, { sourceId, externalUrl, title, content, summary, publishedAt }) {
  const hash = contentHash(`${title}${externalUrl}`);
  const pub = naarPublicatieIso(publishedAt);

  try {
    await db.execute({
      sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary, content_hash, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [sourceId, externalUrl || null, title || null, content || null, summary || null, hash, pub],
    });
    return { saved: true, hash };
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      // Bestaand item: vul de publicatiedatum alsnog in als die er nog niet is.
      // Zo groeit de dekking van published_at vanzelf mee met herhaalde scrapes.
      if (pub) {
        try {
          await db.execute({
            sql: `UPDATE raw_items SET published_at = ? WHERE content_hash = ? AND published_at IS NULL`,
            args: [pub, hash],
          });
        } catch { /* backfill is een extraatje, geen reden om de run te breken */ }
      }
      return { saved: false, hash, reason: 'duplicate' };
    }
    throw err;
  }
}

// Haal het source_id op voor een bron, of maak de bron aan als die niet bestaat
export async function getOrCreateSource(db, { name, url, sourceType, reliability, category, scrapeFrequency }) {
  const existing = await db.execute({
    sql: 'SELECT id FROM sources WHERE url = ?',
    args: [url],
  });

  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE sources SET last_scraped_at = datetime('now') WHERE id = ?",
      args: [existing.rows[0].id],
    });
    return existing.rows[0].id;
  }

  const result = await db.execute({
    sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency, last_scraped_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [name, url, sourceType, reliability, category, scrapeFrequency],
  });

  return Number(result.lastInsertRowid);
}

// Log resultaat van een scrape-run (Laag B: schrijft ook naar scrape_runs)
// job_name komt uit SCRAPE_JOB_NAME (door de aanroepende runner gezet); bij een
// handmatige/losse run van een scraper-bestand is die env var niet gezet.
export async function logResult(db, sourceId, sourceName, saved, skipped, errors, itemsFound) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${sourceName}: ${saved} nieuw, ${skipped} overgeslagen, ${errors} fouten`);

  const found = itemsFound ?? (saved + skipped);
  const status = found === 0 ? 'empty' : 'ok';

  try {
    await db.execute({
      sql: `INSERT INTO scrape_runs (job_name, source_id, source_name, items_found, items_new, items_duplicate, items_error, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [process.env.SCRAPE_JOB_NAME || null, sourceId ?? null, sourceName, found, saved, skipped, errors, status],
    });
  } catch (e) {
    console.error(`Kon scrape_runs niet bijwerken voor ${sourceName}:`, e.message);
  }
}
