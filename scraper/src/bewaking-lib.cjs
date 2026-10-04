'use strict';

// Zuivere functies voor de bronnenwacht en het stilte-alarm (2026-10-04).
//
// Aanleiding: bw-besluiten.js en nvwa-inspectieresultaten.js eindigden ruim een
// week lang elke nacht als 'timeout', terwijl de bronnenwacht nul storingen
// meldde. De bronnenwacht kijkt per bron (source_id); een scraper die door de
// runner wordt afgebroken, laat alleen een regel met scraper_file achter en geen
// regel per bron. Die regels beoordeelde niemand.

const FOUT = new Set(['timeout', 'error']);

/**
 * Scrapers waarvan de laatste `reeks` runs via een runner allemaal in een fout of
 * timeout eindigden. `rijen` zijn de runner-regels uit scrape_runs
 * ({ scraper_file, status, started_at }), in willekeurige volgorde.
 */
function falendeScrapers(rijen, reeks = 3) {
  const perBestand = new Map();
  for (const r of rijen || []) {
    if (!r || !r.scraper_file) continue;
    if (!perBestand.has(r.scraper_file)) perBestand.set(r.scraper_file, []);
    perBestand.get(r.scraper_file).push(r);
  }
  const uit = [];
  for (const [scraper, runs] of perBestand) {
    runs.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    if (runs.length < reeks) continue;
    if (!runs.slice(0, reeks).every((r) => FOUT.has(String(r.status)))) continue;
    let aantal = 0;
    while (aantal < runs.length && FOUT.has(String(runs[aantal].status))) aantal++;
    uit.push({
      scraper,
      aantal,
      status: String(runs[0].status),
      sinds: String(runs[aantal - 1].started_at).substring(0, 10),
    });
  }
  return uit.sort((a, b) => b.aantal - a.aantal || a.scraper.localeCompare(b.scraper));
}

/**
 * Tier-1-bronnen die eerder geregeld leverden en nu lang niets brengen. Dit is
 * bewust kalendertijd en daarom alleen een melding ter beoordeling: het verandert
 * de gezondheid van een bron niet (die blijft in runs gemeten).
 *
 * bronnen: [{ id, name, tier, bronrol }]; stats: Map(id -> { laatste, n90 }) met
 * `laatste` de datum van het nieuwste item en `n90` het aantal items in 90 dagen.
 */
function langStilleBronnen(bronnen, stats, nu = new Date(), { dagen = 21, minEerder = 5 } = {}) {
  const grens = new Date(nu.getTime() - dagen * 86400000).toISOString().substring(0, 10);
  const uit = [];
  for (const b of bronnen || []) {
    if (Number(b.tier) !== 1 || b.bronrol === 'spiegel') continue;
    const s = stats.get(Number(b.id));
    if (!s || !s.laatste || Number(s.n90 || 0) < minEerder) continue;
    const laatste = String(s.laatste).substring(0, 10);
    if (laatste >= grens) continue;
    uit.push({ id: Number(b.id), naam: b.name, laatste, n90: Number(s.n90) });
  }
  return uit.sort((a, b) => a.laatste.localeCompare(b.laatste));
}

module.exports = { falendeScrapers, langStilleBronnen };
