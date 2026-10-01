// Korte dossiernamen voor plekken waar ruimte schaars is, zoals de strook
// boven de wachtrij. De volledige naam blijft in de tabel `dossiers` staan.
// Nieuwe dossiers zonder vaste korte naam krijgen een afgeleide: plaatsnaam
// eraf, eerste letter klein.

const KORT: Record<string, string> = {
  'explosies-amersfoort': 'explosies',
  'warmtenet-biomassa': 'warmtenet',
  'droogte-waterbeheer': 'droogte',
  'woningbouw-wonen': 'woningbouw',
  'lokale-politiek': 'politiek',
  'milieu-incidenten-toezicht': 'milieu',
  'horeca-voedselveiligheid-amersfoort': 'horeca',
  'onderwijstoezicht-amersfoort': 'onderwijs',
  'werk-inkomen-amersfoort': 'werk en inkomen',
  'legalisatie-achteraf-amersfoort': 'legalisatie',
  'opdrachten-aanbestedingen-amersfoort': 'aanbestedingen',
  'bomen-en-kapvergunningen-amersfoort': 'bomenkap',
  'discriminatiemeldingen-amersfoort-leusden': 'discriminatie',
  'asielopvang-opvanglocaties': 'asielopvang',
  'gemeentefinancien-leusden': 'financiën Leusden',
  'sro-amersfoort': 'SRO',
  'parkeerbeleid-amersfoort': 'parkeerbeleid',
  'zorginspectie-amersfoort': 'zorgtoezicht',
  'skaeve-huse-amersfoort': 'Skaeve Huse',
  'wind-op-isselt': 'Wind op Isselt',
  'ondermijning-handhaving-amersfoort': 'ondermijning',
  'gemeentefinancien-amersfoort': 'financiën Amersfoort',
}

export function kortDossierNaam(slug: string, naam: string): string {
  const vast = KORT[slug]
  if (vast) return vast
  const zonderPlaats = naam.replace(/\s+(in\s+)?(Amersfoort( en Leusden)?|Leusden)$/i, '').trim() || naam
  // Een afkorting (SRO, RIEC) houdt zijn hoofdletters.
  return /^[A-Z]{2,}\b/.test(zonderPlaats) ? zonderPlaats : zonderPlaats.charAt(0).toLowerCase() + zonderPlaats.slice(1)
}
