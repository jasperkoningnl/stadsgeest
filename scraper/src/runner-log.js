// runner-log.js — vangnetlaag (Laag A) voor scrape_runs.
// Wordt aangeroepen door de runners (run-all.js, run-browser.js, run-weekly.js) na
// elke uitgevoerde scraper-file, ongeacht of die zelf iets naar scrape_runs schreef.
// source_id blijft leeg: dat vult de scraper zelf in via lib.js/utils.js (Laag B).

export async function recordScrapeRun(db, { jobName, scraperFile, sourceName, startedAt, finishedAt, status, errorMessage }) {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await db.execute({
    sql: `INSERT INTO scrape_runs (job_name, scraper_file, source_name, started_at, finished_at, duration_ms, status, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      jobName,
      scraperFile ?? null,
      sourceName ?? null,
      startedAt.toISOString(),
      finishedAt.toISOString(),
      durationMs,
      status,
      errorMessage ? errorMessage.substring(0, 500) : null,
    ],
  });
}
