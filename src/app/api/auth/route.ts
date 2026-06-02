import { NextResponse } from 'next/server'
import { createHash } from 'crypto'

const AUTH_COOKIE = 'sg_auth'
const PASSWORD_HASH = 'f28d5b97fc847044a60e7d675cf6dfd83e329c4b52224825ce9d1142b62f6252'
const ONE_YEAR = 365 * 24 * 60 * 60

export async function POST(request: Request) {
  const formData = await request.formData()
  const password = (formData.get('password') as string) ?? ''
  const from = (formData.get('from') as string) || '/'

  const hash = createHash('sha256').update(password).digest('hex')

  if (hash !== PASSWORD_HASH) {
    const url = new URL('/login', request.url)
    url.searchParams.set('error', '1')
    if (from !== '/') url.searchParams.set('from', from)
    return NextResponse.redirect(url, { status: 303 })
  }

  const destination = new URL(from.startsWith('/') ? from : '/', request.url)
  const response = NextResponse.redirect(destination, { status: 303 })

  response.cookies.set(AUTH_COOKIE, PASSWORD_HASH, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ONE_YEAR,
    path: '/',
  })

  return response
}
