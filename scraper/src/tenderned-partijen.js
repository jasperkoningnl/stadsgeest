// tenderned-partijen.js — partijen (koper, inschrijvers, winnaars) uit de
// eForms-publicatie-PDF van TenderNed. Toegevoegd 2026-09-23.
//
// De publicatie-API geeft geen winnaar; de PDF wel, in hoofdstuk "8. Organisaties"
// met per organisatie naam, registratienummer (meestal KvK), adres en rollen.
// Dit module bevat geen databaseverbinding: de aanroeper geeft `db` mee.

let pdfjsCache = null;
async function getPdfjs() {
  if (!pdfjsCache) pdfjsCache = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsCache;
}

// PDF → regels. Tekstdelen op dezelfde hoogte vormen één regel; delen worden
// gescheiden door ' | ' zodat label en waarde uit elkaar te houden zijn.
export async function pdfNaarRegels(buffer, maxPaginas = 40) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true,
  }).promise;
  const regels = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++) {
    const inhoud = await (await doc.getPage(p)).getTextContent();
    const rijen = new Map();
    for (const it of inhoud.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rijen.has(y)) rijen.set(y, []);
      rijen.get(y).push([it.transform[4], it.str.normalize('NFKC').trim()]);
    }
    [...rijen.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, delen]) => regels.push(delen.sort((a, b) => a[0] - b[0]).map(d => d[1]).join(' | ')));
  }
  await doc.destroy();
  return regels;
}

const VELDEN = {
  'Officiële naam': 'naam',
  'Registratienummer': 'registratienummer',
  'Postadres': 'adres',
  'Stad': 'plaats',
  'Postcode': 'postcode',
};

// Waarde van de eerste winnende inschrijving in hoofdstuk 6 (eForms: "Waarde van de
// aanbesteding" of "Waarde van de raamovereenkomst"). Symbolische bedragen komen voor.
export function winnaarsWaarde(ruweRegels) {
  const regels = ruweRegels.map(plat);
  const start = regels.findIndex(r => /^6\.1\.2\s*Informatie over winnaars/.test(r));
  if (start < 0) return null;
  for (let i = start; i < Math.min(regels.length, start + 60); i++) {
    const m = regels[i].match(/([\d][\d .,]*)\s*Euro/);
    if (m && /Waarde van de|aanbesteding:|raamovereenkomst:/.test(regels.slice(Math.max(start, i - 1), i + 2).join(' '))) {
      const n = Number(m[1].replace(/[ .]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// Regel zonder scheidingstekens; pdfjs knipt labels soms in losse stukjes ("Stad | : | Amersfoort").
const plat = r => r.replace(/\s*\|\s*/g, ' ').replace(/\s+:/g, ':').replace(/\s+/g, ' ').trim();

// Hoofdstuk 8 → lijst van organisaties.
export function parsePartijen(ruweRegels) {
  const regels = ruweRegels.map(plat);
  const start = regels.findIndex(r => /^8\.\s*Organisaties/.test(r));
  if (start < 0) return [];
  let eind = regels.findIndex((r, i) => i > start && /^(9|10|11)\. /.test(r));
  if (eind < 0) eind = regels.length;
  // Paginavoet ('TN-123456 - 18 apr 2024 Pagina 3 van 4', 'Publicatie') overslaan.
  const blok = regels.slice(start + 1, eind).filter(r => !/^TN-\d+ - .*Pagina \d+ van \d+$/.test(r) && r !== 'Publicatie');

  const partijen = [];
  let huidig = null, inRollen = false, inAndereContact = false;
  for (const regel of blok) {
    const orgKop = regel.match(/^8\.1\s*(ORG-\d+)/);
    if (orgKop) {
      huidig = { org_ref: orgKop[1], rollen: [] };
      partijen.push(huidig);
      inRollen = false; inAndereContact = false;
      continue;
    }
    if (!huidig) continue;
    if (/^Rollen van deze organisatie:/.test(regel)) { inRollen = true; continue; }
    if (/^Andere contactpunten:/.test(regel)) { inAndereContact = true; continue; }
    if (inRollen) { huidig.rollen.push(regel); continue; }
    if (inAndereContact) continue;
    const m = regel.match(/^(Officiële naam|Registratienummer|Postadres|Stad|Postcode):\s*(.+)$/);
    const veld = m && VELDEN[m[1]];
    if (veld && huidig[veld] === undefined) huidig[veld] = m[2].trim();
  }
  return partijen.map(p => {
    const rollen = p.rollen.join(' ; ');
    return {
      org_ref: p.org_ref,
      naam: p.naam || null,
      registratienummer: p.registratienummer || null,
      adres: p.adres || null,
      postcode: p.postcode ? p.postcode.replace(/\s+/g, '').toUpperCase() : null,
      plaats: p.plaats || null,
      rollen,
      is_winnaar: /Winnaar/i.test(rollen) ? 1 : 0,
      is_koper: /\bKoper\b/.test(rollen) ? 1 : 0,
    };
  }).filter(p => p.naam);
}

export async function zorgVoorTabel(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS tender_parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicatie_id TEXT NOT NULL,
    kenmerk TEXT,
    publicatie_datum TEXT,
    publicatie_type TEXT,
    aanbesteding_naam TEXT,
    opdrachtgever_naam TEXT,
    org_ref TEXT NOT NULL,
    naam TEXT NOT NULL,
    registratienummer TEXT,
    adres TEXT,
    postcode TEXT,
    plaats TEXT,
    rollen TEXT,
    is_winnaar INTEGER NOT NULL DEFAULT 0,
    is_koper INTEGER NOT NULL DEFAULT 0,
    waarde_eur REAL,
    bron_url TEXT,
    opgehaald_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(publicatie_id, org_ref)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tp_naam ON tender_parties(naam)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tp_reg ON tender_parties(registratienummer)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tp_winnaar ON tender_parties(is_winnaar)');
}

// Idempotent: dezelfde publicatie en organisatie overschrijft de vorige rij.
export async function slaPartijenOp(db, meta, partijen, waarde) {
  if (!partijen.length) return 0;
  await db.batch(partijen.map(p => ({
    sql: `INSERT INTO tender_parties (publicatie_id, kenmerk, publicatie_datum, publicatie_type, aanbesteding_naam,
            opdrachtgever_naam, org_ref, naam, registratienummer, adres, postcode, plaats, rollen, is_winnaar, is_koper,
            waarde_eur, bron_url)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(publicatie_id, org_ref) DO UPDATE SET naam=excluded.naam, registratienummer=excluded.registratienummer,
            adres=excluded.adres, postcode=excluded.postcode, plaats=excluded.plaats, rollen=excluded.rollen,
            is_winnaar=excluded.is_winnaar, is_koper=excluded.is_koper, waarde_eur=excluded.waarde_eur,
            opgehaald_at=datetime('now')`,
    args: [String(meta.publicatieId), meta.kenmerk != null ? String(meta.kenmerk) : null, meta.publicatieDatum || null,
      meta.type || null, meta.aanbestedingNaam || null, meta.opdrachtgeverNaam || null, p.org_ref, p.naam,
      p.registratienummer, p.adres, p.postcode, p.plaats, p.rollen, p.is_winnaar, p.is_koper,
      p.is_winnaar ? waarde : null, meta.url || null],
  })), 'write');
  return partijen.length;
}
