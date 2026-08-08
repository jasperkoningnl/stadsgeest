// Toegang tot het redactiedashboard.
//
// Vóór 7 augustus 2026 stond hier een hardcoded AUTH_TOKEN die tegelijk de
// SHA-256 van het wachtwoord én de geldige cookiewaarde was, in een publieke
// repo. Wie de repo las kon die string als cookie zetten en was binnen. Dat is
// hiermee weg: het geheim staat nu uitsluitend in omgevingsvariabelen, en de
// cookie bevat geen geheim maar een ondertekende sessie met vervaldatum.
//
// Benodigde omgevingsvariabelen (Vercel én .env.local, nooit in de repo):
//   DASHBOARD_WACHTWOORD_HASH  — SHA-256 (hex) van het wachtwoord
//   DASHBOARD_SESSIE_SECRET    — willekeurige string, minimaal 32 tekens
//
// Ontbreekt een van beide, dan komt niemand binnen. Dat is opzet: liever dicht
// dan per ongeluk open.
//
// Dit is de tussenstap. Zodra de redactie toegang krijgt komt hier een magic
// link per persoon overheen; de sessielaag hieronder blijft dan ongewijzigd,
// alleen de manier waarop iemand zijn identiteit bewijst verandert.

export const AUTH_COOKIE = 'sg_sessie'

const SESSIE_DUUR_SECONDEN = 30 * 24 * 60 * 60 // 30 dagen

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
  return Boolean(process.env.DASHBOARD_WACHTWOORD_HASH && process.env.DASHBOARD_SESSIE_SECRET)
}

/** Controleert het ingevoerde wachtwoord tegen de hash uit de omgeving. */
export async function wachtwoordKlopt(wachtwoord: string): Promise<boolean> {
  const verwacht = process.env.DASHBOARD_WACHTWOORD_HASH
  if (!verwacht) return false
  return gelijk(await sha256Hex(wachtwoord), verwacht.trim().toLowerCase())
}

/** Maakt een sessiewaarde `vervalMoment.handtekening`. Bevat zelf geen geheim. */
export async function maakSessie(): Promise<{ waarde: string; maxAge: number } | null> {
  const secret = process.env.DASHBOARD_SESSIE_SECRET
  if (!secret) return null
  const verval = Math.floor(Date.now() / 1000) + SESSIE_DUUR_SECONDEN
  const handtekening = await hmac(String(verval), secret)
  return { waarde: `${verval}.${handtekening}`, maxAge: SESSIE_DUUR_SECONDEN }
}

export async function sessieGeldig(waarde: string | null | undefined): Promise<boolean> {
  const secret = process.env.DASHBOARD_SESSIE_SECRET
  if (!secret || !waarde) return false

  const scheiding = waarde.indexOf('.')
  if (scheiding < 1) return false

  const vervalDeel = waarde.slice(0, scheiding)
  const handtekening = waarde.slice(scheiding + 1)

  const verval = Number(vervalDeel)
  if (!Number.isFinite(verval) || verval < Math.floor(Date.now() / 1000)) return false

  return gelijk(handtekening, await hmac(vervalDeel, secret))
}

/**
 * Voor API-routes die zichzelf moeten controleren, los van de proxy. Een
 * schrijvende route mag nooit alleen op de proxy vertrouwen: een verkeerd
 * ingestelde matcher zou de route dan ongemerkt openzetten.
 */
export async function isAuthedCookieHeader(cookieHeader: string | null | undefined): Promise<boolean> {
  if (!cookieHeader) return false
  for (const deel of cookieHeader.split(';')) {
    const [naam, ...rest] = deel.trim().split('=')
    if (naam === AUTH_COOKIE) return sessieGeldig(rest.join('='))
  }
  return false
}
