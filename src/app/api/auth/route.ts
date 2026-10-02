import { NextResponse } from 'next/server'
import { AUTH_COOKIE, isGeconfigureerd, maakSessie, magNaar, startpagina, wachtwoordKlopt } from '@/lib/dashboardAuth'

export async function POST(request: Request) {
  const formData = await request.formData()
  const gebruikersnaam = (formData.get('username') as string) ?? ''
  const wachtwoord = (formData.get('password') as string) ?? ''
  const from = (formData.get('from') as string) || ''

  const terugNaarLogin = (code: string) => {
    const url = new URL('/login', request.url)
    url.searchParams.set('error', code)
    if (from) url.searchParams.set('from', from)
    return NextResponse.redirect(url, { status: 303 })
  }

  if (!isGeconfigureerd()) return terugNaarLogin('config')

  const geldigeGebruiker = await wachtwoordKlopt(gebruikersnaam, wachtwoord)
  if (!geldigeGebruiker) return terugNaarLogin('1')

  const sessie = await maakSessie(geldigeGebruiker)
  if (!sessie) return terugNaarLogin('config')

  // Alleen paden binnen deze site toestaan, anders is dit een open redirect.
  // En alleen paden die deze gebruiker mag zien: het beleidsaccount dat via
  // /login?from=/nieuwsplein33 binnenkomt, gaat naar zijn eigen dashboard.
  const binnenSite = from.startsWith('/') && !from.startsWith('//')
  const pad = binnenSite && magNaar(geldigeGebruiker, from.split('?')[0]) ? from : startpagina(geldigeGebruiker)
  const response = NextResponse.redirect(new URL(pad, request.url), { status: 303 })

  response.cookies.set(AUTH_COOKIE, sessie.waarde, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessie.maxAge,
    path: '/',
  })

  return response
}
