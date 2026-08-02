import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { AUTH_COOKIE, AUTH_TOKEN } from '@/lib/dashboardAuth'

const ONE_YEAR = 365 * 24 * 60 * 60

export async function POST(request: Request) {
  const formData = await request.formData()
  const password = (formData.get('password') as string) ?? ''
  const from = (formData.get('from') as string) || '/'

  const hash = createHash('sha256').update(password).digest('hex')

  if (hash !== AUTH_TOKEN) {
    const url = new URL('/login', request.url)
    url.searchParams.set('error', '1')
    if (from !== '/') url.searchParams.set('from', from)
    return NextResponse.redirect(url, { status: 303 })
  }

  const destination = new URL(from.startsWith('/') ? from : '/', request.url)
  const response = NextResponse.redirect(destination, { status: 303 })

  response.cookies.set(AUTH_COOKIE, AUTH_TOKEN, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ONE_YEAR,
    path: '/',
  })

  return response
}
