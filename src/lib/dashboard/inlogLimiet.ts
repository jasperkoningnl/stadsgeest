// Rem op inlogpogingen (2026-10-04). Mislukte pogingen staan in de tabel
// login_pogingen (scraper/migrate-login-pogingen.mjs). Het adres van de bezoeker
// wordt niet bewaard, alleen een gezouten hash ervan.
//
// Bij een databasefout laat de rem de poging door: de inlog zelf heeft geen
// database nodig, en een Turso-storing mag niemand buitensluiten.
import { turso } from '@/lib/turso'
import { sha256Hex } from '@/lib/dashboardAuth'
import { GRENZEN, VENSTER_MINUTEN, magProberen, sleutels, type Soort } from './inlogRegels'

async function sleutelsVoor(gebruikersnaam: string, request: Request): Promise<Record<Soort, string>> {
  const adres = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'onbekend'
  const zout = process.env.DASHBOARD_SESSIE_SECRET ?? ''
  return sleutels(gebruikersnaam, (await sha256Hex(`${zout}:${adres}`)).slice(0, 32))
}

export async function teVeelPogingen(gebruikersnaam: string, request: Request): Promise<boolean> {
  if (!turso) return false
  try {
    const s = await sleutelsVoor(gebruikersnaam, request)
    const res = await turso.execute({
      sql: `SELECT sleutel, count(*) AS n FROM login_pogingen
            WHERE sleutel IN (?, ?, ?) AND created_at >= datetime('now', ?)
            GROUP BY sleutel`,
      args: [s.combinatie, s.adres, s.gebruiker, `-${VENSTER_MINUTEN} minutes`],
    })
    const perSleutel = new Map(res.rows.map((r) => [String(r.sleutel), Number(r.n)]))
    const telling: Partial<Record<Soort, number>> = {}
    for (const soort of Object.keys(GRENZEN) as Soort[]) telling[soort] = perSleutel.get(s[soort]) ?? 0
    return !magProberen(telling)
  } catch (e) {
    console.error('[inlog] rem niet te controleren, poging doorgelaten:', e)
    return false
  }
}

export async function noteerMisluktePoging(gebruikersnaam: string, request: Request): Promise<void> {
  if (!turso) return
  try {
    const s = await sleutelsVoor(gebruikersnaam, request)
    await turso.execute({
      sql: 'INSERT INTO login_pogingen (sleutel) VALUES (?), (?), (?)',
      args: [s.combinatie, s.adres, s.gebruiker],
    })
  } catch (e) {
    console.error('[inlog] mislukte poging niet vastgelegd:', e)
  }
}
