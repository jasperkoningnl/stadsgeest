import { NextResponse } from 'next/server'
import { AUTH_COOKIE, isGeconfigureerd, maakSessie, wachtwoordKlopt } from '@/lib/dashboardAuth'

export async function POST(request: Request) {
  const formData = await request.formData()
  const gebruikersnaam = (formData.get('username') as string) ?? ''
  const wachtwoord = (formData.get('password') as string) ?? ''
  const from = (formData.get('from') as string) || '/nieuwsplein33'

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
  const bestemming = new URL(from.startsWith('/') && !from.startsWith('//') ? from : '/nieuwsplein33', request.url)
  const response = NextResponse.redirect(bestemming, { status: 303 })

  response.cookies.set(AUTH_COOKIE, sessie.waarde, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessie.maxAge,
    path: '/',
  })

  return response
}
