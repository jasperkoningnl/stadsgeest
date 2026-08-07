import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE, AUTH_TOKEN } from '@/lib/dashboardAuth'

// Sinds 7 augustus 2026 is de voorpagina publiek en zit alleen het redactionele
// dashboard achter de inlog. Daarvóór beschermde deze proxy de hele site.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (token === AUTH_TOKEN) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Alleen /dashboard en alles eronder. /login en /api/auth moeten juist
  // bereikbaar blijven, anders kan niemand meer inloggen.
  matcher: ['/dashboard/:path*'],
}
