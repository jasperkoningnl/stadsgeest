'use strict';

const STOP = new Set('aan als bij dat de den der deze die dit door een en er het in is met naar om op te tot uit van voor was wat wordt zijn amersfoort leusden gemeente gemeenten nieuws'.split(' '));
const THEMAS = {
  veiligheid: ['politie', 'misdrijf', 'diefstal', 'inbraak', 'brand', 'explosie', 'overlast', 'geweld'],
  wonen: ['woning', 'woningen', 'huur', 'bouw', 'project', 'wijk'],
  verkeer: ['verkeer', 'parkeren', 'weg', 'fiets', 'auto', 'station'],
  onderwijs: ['school', 'leerling', 'student', 'onderwijs', 'mbo'],
  bestuur_geld: ['raad', 'college', 'begroting', 'miljoen', 'subsidie', 'besluit'],
};

function datumWaarde(item) {
  return item?.published_at || item?.scraped_at || null;
}

function bronTijd(items, nu = new Date()) {
  const datums = (items || []).map(datumWaarde).filter(Boolean)
    .map((waarde) => new Date(String(waarde).includes('T') ? waarde : String(waarde).replace(' ', 'T') + 'Z'))
    .filter((datum) => !Number.isNaN(datum.getTime())).sort((a, b) => a - b);
  if (!datums.length) return { eerste: null, laatste: null, oudste_dagen: null, waarschuwing: 'Geen bronpublicatiedatum beschikbaar.' };
  const eerste = datums[0];
  const laatste = datums.at(-1);
  const oudsteDagen = Math.max(0, Math.floor((nu.getTime() - eerste.getTime()) / 86400000));
  const spreidingDagen = Math.floor((laatste.getTime() - eerste.getTime()) / 86400000);
  const waarschuwingen = [];
  if (oudsteDagen >= 14) waarschuwingen.push(`oudste dragende stuk is ${oudsteDagen} dagen oud`);
  if (spreidingDagen >= 7) waarschuwingen.push(`brondata liggen ${spreidingDagen} dagen uiteen`);
  return {
    eerste: eerste.toISOString(), laatste: laatste.toISOString(), oudste_dagen: oudsteDagen,
    spreiding_dagen: spreidingDagen, waarschuwing: waarschuwingen.join('; ') || null,
  };
}

function tokens(tekst) {
  return new Set(String(tekst || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{4,}/g)?.map((woord) => woord.replace(/(eren|heid|ingen|ing|en|e|s)$/u, '')).filter((woord) => !STOP.has(woord)) || []);
}

function themas(tekst) {
  const laag = String(tekst || '').toLowerCase();
  return Object.entries(THEMAS).filter(([, woorden]) => woorden.some((woord) => laag.includes(woord))).map(([naam]) => naam);
}

function spiegelKandidaten(signal, items, spiegelItems, { limiet = 5 } = {}) {
  const zoekTekst = [signal?.title, signal?.summary, ...(items || []).filter((item) => item.source?.role !== 'spiegel')
    .flatMap((item) => [item.title, item.summary, item.source?.name])].filter(Boolean).join(' ');
  const zoekTokens = tokens(zoekTekst);
  const zoekThemas = new Set(themas(zoekTekst));
  return (spiegelItems || []).map((item) => {
    const tekst = [item.title, item.summary, item.content].filter(Boolean).join(' ');
    const overlap = [...tokens(tekst)].filter((woord) => zoekTokens.has(woord));
    const gedeeldeThemas = themas(tekst).filter((thema) => zoekThemas.has(thema));
    return { ...item, score: overlap.length * 2 + gedeeldeThemas.length, redenen: [...overlap.slice(0, 5), ...gedeeldeThemas.map((t) => `thema:${t}`)] };
  }).filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || String(b.published_at || b.scraped_at).localeCompare(String(a.published_at || a.scraped_at)))
    .slice(0, limiet).map((item) => ({
      id: Number(item.id), titel: item.title, url: item.url, bron: item.source_name,
      gepubliceerd: datumWaarde(item), score: item.score, redenen: item.redenen,
    }));
}

module.exports = { bronTijd, spiegelKandidaten };
