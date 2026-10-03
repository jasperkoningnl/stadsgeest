// deelitems-lib.mjs — lange documenten in delen knippen. Toegevoegd 2026-10-03.
// Pure functies: geen netwerk, geen database.
//
// Waarom: raw_items.full_text is begrensd op 200.000 tekens (ongeveer 70
// pagina's). Bij een Woo-besluit met honderd bijlagen, de begroting of het
// jaarverslag viel alles daarna buiten de entiteiten- en adresscan en buiten
// de verkenner. Op 3 oktober 2026 was dat ruim de helft van alle tekst uit
// Woo-bijlagen. Besluit met Jasper: het hoofditem houdt de eerste 200.000
// tekens; de rest komt in deelitems, elk een eigen raw_item met een eigen URL
// (<url>#deel=N), zoals de gesplitste B&W-stukken (#stuk=). Deelitems zijn
// historisch en verwerkt: ze voeden de scans maar maken geen signalen.

export const DEEL_KENMERK = '#deel=';
export const HOOFDITEM_TEKENS = 200000;
export const MAX_DEEL_TEKENS = 180000;
export const MIN_REST_TEKENS = 2000; // een staartje van een halve pagina is geen item waard

export function isDeelitem(item) {
  return String(item?.external_url || '').includes(DEEL_KENMERK);
}

export function deelUrl(url, nummer) {
  return `${String(url || '').split(DEEL_KENMERK)[0]}${DEEL_KENMERK}${nummer}`;
}

// De tekst voorbij het hoofditem, geknipt in delen van hoogstens `max` tekens.
// Knipt bij voorkeur op een bijlagegrens, anders op een regel, anders op een
// spatie; nooit eerder dan op 60% van het deel. Deel 1 is het hoofditem zelf,
// de nummering hier begint dus bij 2.
export function verdeelRest(volledig, { eerste = HOOFDITEM_TEKENS, max = MAX_DEEL_TEKENS, minRest = MIN_REST_TEKENS } = {}) {
  const tekst = String(volledig || '');
  if (tekst.length - eerste < minRest) return [];
  const delen = [];
  let pos = eerste;
  while (pos < tekst.length) {
    let einde = Math.min(pos + max, tekst.length);
    if (einde < tekst.length) {
      const venster = tekst.slice(pos, einde);
      const minimaal = Math.floor(max * 0.6);
      let knip = venster.lastIndexOf('\n\n=== Bijlage:');
      if (knip < minimaal) knip = venster.lastIndexOf('\n');
      if (knip < minimaal) knip = venster.lastIndexOf(' ');
      if (knip >= minimaal) einde = pos + knip;
    }
    const stuk = tekst.slice(pos, einde).trim();
    if (stuk) delen.push({ nummer: delen.length + 2, van: pos, tot: einde, tekst: stuk });
    pos = einde;
  }
  return delen;
}

// Velden van het raw_item voor één deel. `ouder` is het hoofditem.
export function deelVelden(ouder, deel, totaal) {
  const titel = `${String(ouder.title || 'Document').slice(0, 440)} (deel ${deel.nummer} van ${totaal})`;
  return {
    external_url: deelUrl(ouder.external_url, deel.nummer),
    title: titel,
    content: `Vervolg van een lang document dat in delen is gesplitst: deel ${deel.nummer} van ${totaal}, tekens ${deel.van} tot ${deel.tot}. Het hoofditem is raw_item ${ouder.id}.`,
    summary: `Deel ${deel.nummer} van ${totaal} van raw_item ${ouder.id}`,
  };
}
