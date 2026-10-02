// Beleidskader wonen Amersfoort: de doelen uit openbare beleidsstukken waar het
// dashboard de CBS-realisatie tegen afzet. Dit is bewust een klein, met de hand
// bijgehouden bestand: beleidsdoelen veranderen per raadsbesluit, niet per
// scrape. Elke regel noemt bron en datum, zodat de beleidsadviseur kan zien
// waar een getal vandaan komt en het kan laten corrigeren.
//
// Gecontroleerd op 2 oktober 2026 (zie docs/HANDOFFS/2026-10.md).

export interface Beleidsdoel {
  id: string
  /** Korte naam van het doel. */
  naam: string
  /** Het doel in één zin, met het getal. */
  doel: string
  /** Numeriek doel per jaar, als dat er is. */
  perJaar?: number
  /** Aandeel in procenten van de nieuwbouw, als dat er is. */
  aandeelPct?: number
  bron: string
  bronUrl: string
  datum: string
  status: 'vastgesteld' | 'in voorbereiding'
}

export const BELEIDSDOELEN: Beleidsdoel[] = [
  {
    id: 'deltaplan-aantal',
    naam: 'Deltaplan Wonen: 1.000 woningen per jaar',
    doel: 'Tot 2030 komen er jaarlijks 1.000 woningen bij, zodat iedere Amersfoorter in 2030 passend en betaalbaar woont.',
    perJaar: 1000,
    bron: 'Deltaplan Wonen (Visie en Aanpak Woonopgave Amersfoort), gemeenteraad',
    bronUrl: 'https://www.amersfoort.nl/sites/default/files/2022-07/Deltaplan%20Woonopgave%20Amersfoort.pdf',
    datum: '2019-05',
    status: 'vastgesteld',
  },
  {
    id: 'deltaplan-sociaal',
    naam: 'Deltaplan Wonen: 35% sociale huur',
    doel: 'Van de nieuwbouw is 35% sociale huur (350 van 1.000 per jaar) en 20% middensegment.',
    perJaar: 350,
    aandeelPct: 35,
    bron: 'Deltaplan Wonen, gemeenteraad',
    bronUrl: 'https://www.amersfoort.nl/sites/default/files/2022-07/Deltaplan%20Woonopgave%20Amersfoort.pdf',
    datum: '2019-05',
    status: 'vastgesteld',
  },
  {
    id: 'woondeal-regio',
    naam: 'Woondeal Regio Amersfoort: 27.000 woningen',
    doel: 'De negen regiogemeenten bouwen 27.000 woningen in 2022 tot en met 2030; vanaf 2025 is twee derde betaalbaar (7.425 sociale huur en 1.485 middenhuur door corporaties, 9.000 middenhuur en betaalbare koop door marktpartijen).',
    bron: 'Woondeal Regio Amersfoort, Rijk, provincie Utrecht, regiogemeenten en corporaties',
    bronUrl: 'https://www.regioamersfoort.nl/themas/wonen/provinciaal-programma-wonen-en-werken/woondeal/',
    datum: '2023-03',
    status: 'vastgesteld',
  },
  {
    id: 'omgevingsprogramma',
    naam: 'Omgevingsprogramma Volkshuisvesting (in voorbereiding)',
    doel: 'Het college bereidt nieuw woonbeleid voor waarin de harde 35%-norm wordt losgelaten: 250 sociale huurwoningen netto per jaar, met ruimte voor verkoop van 100 corporatiewoningen per jaar.',
    perJaar: 250,
    bron: 'Berichtgeving De Stad Amersfoort over het concept-omgevingsprogramma',
    bronUrl: 'https://www.destadamersfoort.nl/lokaal/wonen/1159055/nieuw-woonbeleid-in-voorbereiding-minder-sociale-huurwoningen',
    datum: '2025-04',
    status: 'in voorbereiding',
  },
]

/** Prijsgrenzen uit de Woondeal (prijspeil 2022/2023), voor de uitleg bij huurklassen. */
export const WOONDEAL_GRENZEN = {
  socialeHuur: 808,
  middenhuur: 1026,
  betaalbareKoop: 355000,
}

export const WONINGBOUWDOEL_PER_JAAR = 1000
export const SOCIALE_HUUR_DOEL_PER_JAAR = 350
