import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE, magNaar, sessieGebruiker, startpagina } from '@/lib/dashboardAuth'

// De voorpagina is publiek. Het redactiedashboard (/nieuwsplein33) en het
// woondashboard voor de beleidsadviseur (/beleidsadviseur) zitten achter de
// inlog. Wie wel is ingelogd maar dit pad niet mag zien (het beleidsaccount op
// het redactiedashboard, of een redactielid dat niet Jasper is op het
// woondashboard) gaat naar zijn eigen startpagina.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const gebruiker = await sessieGebruiker(request.cookies.get(AUTH_COOKIE)?.value)

  if (gebruiker && magNaar(gebruiker, pathname)) {
    return NextResponse.next()
  }
  if (gebruiker) {
    return NextResponse.redirect(new URL(startpagina(gebruiker), request.url))
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // /login en /api/auth moeten bereikbaar blijven, anders kan niemand inloggen.
  matcher: ['/nieuwsplein33/:path*', '/beleidsadviseur/:path*'],
}
