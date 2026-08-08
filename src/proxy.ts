import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE, sessieGeldig } from '@/lib/dashboardAuth'

// De voorpagina is publiek; alleen het redactiedashboard zit achter de inlog.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (await sessieGeldig(request.cookies.get(AUTH_COOKIE)?.value)) {
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
