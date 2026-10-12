import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'

// De voorpagina is publiek. Het redactiedashboard (/nieuwsplein33) zit achter de inlog.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const gebruiker = await sessieGebruiker(request.cookies.get(AUTH_COOKIE)?.value)

  if (gebruiker) {
    return NextResponse.next()
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // /login en /api/auth moeten bereikbaar blijven, anders kan niemand inloggen.
  matcher: ['/nieuwsplein33/:path*'],
}
