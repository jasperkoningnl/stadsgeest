// insolventies-lib.js — parsering van CIR-publicaties zonder databaseafhankelijkheid,
// zodat de filterregels los te testen zijn. Gebruikt door scrapers/insolventies.js.

export const LOKAAL = /\b(Amersfoort|Leusden|Achterveld|Stoutenburg|Hoogland|Hooglanderveen)\b|\b38(1\d|2\d|3[0-3]) ?[A-Z]{2}\b/i;

// Vestigings- en correspondentieadressen uit de publicatietekst.
export function adressen(tekst) {
  // Vestigingsadressen eerst; een correspondentieadres (vaak een postbus) alleen als terugval.
  const alle = [...tekst.matchAll(/(vest|corr)\.adr\.\s*([^,]+?)(?=,|\s+KvK|\s+hodn|\.\s|$)/gi)];
  return [...alle.filter(m => m[1] === 'vest'), ...alle.filter(m => m[1] !== 'vest')].map(m => m[2].trim());
}

// Beoordeelt één publicatie. Geeft null als die buiten scope valt.
export function beoordeel(cluster, soort, tekst) {
  if (/schuldsanering/i.test(cluster) || /schuldsanering/i.test(soort || '')) return null;
  if (/\bgeb\.\s/.test(tekst) || /woonadr\./i.test(tekst)) return null;
  const adr = adressen(tekst);
  const vestiging = adr.find(a => LOKAAL.test(a));
  if (!vestiging) return null;
  const kenmerk = (tekst.match(/\(([FS]\.\d{2}\/\d{2}\/\d+)\)/) || [])[1] || null;
  const naam = (tekst.match(/inzake \([^)]*\),?\s*(.+?),\s*(?:corr|vest)\.adr\./i) || [])[1] || null;
  const kvk = (tekst.match(/KvK:\s*(\d{8})/) || [])[1] || null;
  const curator = (tekst.match(/Cur:\s*([^,]+)/) || [])[1] || null;
  return { kenmerk, naam: naam ? naam.trim() : null, kvk, vestiging, curator };
}

