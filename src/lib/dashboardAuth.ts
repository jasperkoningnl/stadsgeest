// Toegang tot het redactiedashboard.
//
// Vóór 7 augustus 2026 stond hier een hardcoded AUTH_TOKEN die tegelijk de
// SHA-256 van het wachtwoord én de geldige cookiewaarde was, in een publieke
// repo. Dat is weg: het geheim staat uitsluitend in omgevingsvariabelen, en de
// cookie bevat geen geheim maar een ondertekende sessie met vervaldatum.
//
// Sinds 9 augustus 2026: één gedeeld wachtwoord vervangen door drie losse
// accounts (Jasper, Pien, Gideon, Benthe, Kees) voor de testperiode. Elk account heeft een
// eigen wachtwoord en een eigen hash-omgevingsvariabele; de sessielaag
// daaronder (HMAC, vervaldatum) is ongewijzigd t.o.v. de vorige versie.
//
// Benodigde omgevingsvariabelen (Vercel én .env.local, nooit in de repo):
//   DASHBOARD_SESSIE_SECRET          — willekeurige string, minimaal 32 tekens
//   DASHBOARD_WACHTWOORD_HASH_JASPER — SHA-256 (hex) van Jaspers wachtwoord
//   DASHBOARD_WACHTWOORD_HASH_PIEN   — SHA-256 (hex) van Piens wachtwoord
//   DASHBOARD_WACHTWOORD_HASH_GIDEON — SHA-256 (hex) van Gideons wachtwoord
//   DASHBOARD_WACHTWOORD_HASH_BENTHE — SHA-256 (hex) van Benthes wachtwoord
//   DASHBOARD_WACHTWOORD_HASH_KEES   — SHA-256 (hex) van Kees' wachtwoord
//
// Ontbreekt DASHBOARD_SESSIE_SECRET of hebben alle drie gebruikers geen hash,
// dan komt niemand binnen. Dat is opzet: liever dicht dan per ongeluk open.
//
// Dit is nog steeds een tussenstap. Zodra dat handiger is komt hier een magic
// link per persoon overheen; de sessielaag hieronder blijft dan ongewijzigd,
// alleen de manier waarop iemand zijn identiteit bewijst verandert.

export const AUTH_COOKIE = 'sg_sessie'

const SESSIE_DUUR_SECONDEN = 30 * 24 * 60 * 60 // 30 dagen

type Gebruiker = { gebruikersnaam: string; envVar: string }

const GEBRUIKERS: Gebruiker[] = [
  { gebruikersnaam: 'jasper', envVar: 'DASHBOARD_WACHTWOORD_HASH_JASPER' },
  { gebruikersnaam: 'pien', envVar: 'DASHBOARD_WACHTWOORD_HASH_PIEN' },
  { gebruikersnaam: 'gideon', envVar: 'DASHBOARD_WACHTWOORD_HASH_GIDEON' },
  { gebruikersnaam: 'benthe', envVar: 'DASHBOARD_WACHTWOORD_HASH_BENTHE' },
  { gebruikersnaam: 'kees', envVar: 'DASHBOARD_WACHTWOORD_HASH_KEES' },
]

const encoder = new TextEncoder()

/** Web Crypto in plaats van node:crypto, zodat dit ook in de Edge-proxy werkt. */
async function hmac(bericht: string, sleutel: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sleutel),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bericht))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(tekst: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(tekst))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Vergelijking met constante looptijd — voorkomt dat de responstijd het antwoord verraadt. */
function gelijk(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let verschil = 0
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return verschil === 0
}

export function isGeconfigureerd(): boolean {
  if (!process.env.DASHBOARD_SESSIE_SECRET) return false
  return GEBRUIKERS.some((g) => Boolean(process.env[g.envVar]))
}

/**
 * Controleert gebruikersnaam + wachtwoord tegen de hash uit de omgeving.
 * Geeft de genormaliseerde gebruikersnaam terug bij succes, anders null.
 */
export async function wachtwoordKlopt(
  gebruikersnaamInvoer: string,
  wachtwoord: string,
): Promise<string | null> {
  const gebruikersnaam = gebruikersnaamInvoer.trim().toLowerCase()
  const gebruiker = GEBRUIKERS.find((g) => g.gebruikersnaam === gebruikersnaam)
  if (!gebruiker) return null

  const verwacht = process.env[gebruiker.envVar]
  if (!verwacht) return null

  const klopt = gelijk(await sha256Hex(wachtwoord), verwacht.trim().toLowerCase())
  return klopt ? gebruikersnaam : null
}

/** Maakt een sessiewaarde `gebruikersnaam.vervalMoment.handtekening`. */
export async function maakSessie(
  gebruikersnaam: string,
): Promise<{ waarde: string; maxAge: number } | null> {
  const secret = process.env.DASHBOARD_SESSIE_SECRET
  if (!secret) return null
  const verval = Math.floor(Date.now() / 1000) + SESSIE_DUUR_SECONDEN
  const payload = `${gebruikersnaam}.${verval}`
  const handtekening = await hmac(payload, secret)
  return { waarde: `${payload}.${handtekening}`, maxAge: SESSIE_DUUR_SECONDEN }
}

/** Geeft de gebruikersnaam terug bij een geldige, niet-verlopen sessie, anders null. */
export async function sessieGebruiker(waarde: string | null | undefined): Promise<string | null> {
  const secret = process.env.DASHBOARD_SESSIE_SECRET
  if (!secret || !waarde) return null

  const delen = waarde.split('.')
  if (delen.length !== 3) return null
  const [gebruikersnaam, vervalDeel, handtekening] = delen

  const verval = Number(vervalDeel)
  if (!gebruikersnaam || !Number.isFinite(verval) || verval < Math.floor(Date.now() / 1000)) return null

  const verwacht = await hmac(`${gebruikersnaam}.${vervalDeel}`, secret)
  return gelijk(verwacht, handtekening) ? gebruikersnaam : null
}

export async function sessieGeldig(waarde: string | null | undefined): Promise<boolean> {
  return (await sessieGebruiker(waarde)) !== null
}

/**
 * Voor API-routes die zichzelf moeten controleren, los van de proxy. Een
 * schrijvende route mag nooit alleen op de proxy vertrouwen: een verkeerd
 * ingestelde matcher zou de route dan ongemerkt openzetten.
 *
 * Geeft de gebruikersnaam terug (voor attributie bij schrijvende routes),
 * of null als de cookie ontbreekt of ongeldig is.
 */
export async function huidigeGebruiker(cookieHeader: string | null | undefined): Promise<string | null> {
  if (!cookieHeader) return null
  for (const deel of cookieHeader.split(';')) {
    const [naam, ...rest] = deel.trim().split('=')
    if (naam === AUTH_COOKIE) return sessieGebruiker(rest.join('='))
  }
  return null
}

export async function isAuthedCookieHeader(cookieHeader: string | null | undefined): Promise<boolean> {
  return (await huidigeGebruiker(cookieHeader)) !== null
}
