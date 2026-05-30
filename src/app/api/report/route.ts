import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'next-sanity'

const writeClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '60u1z6xa',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-28',
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
})

const MAX_MESSAGE_LENGTH = 2000
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour per IP

const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) return false

  entry.count++
  return true
}

export async function POST(req: NextRequest) {
  if (!process.env.SANITY_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Write token not configured' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Te veel meldingen. Probeer het later opnieuw.' }, { status: 429 })
  }

  try {
    const { articleId, message } = await req.json()

    if (!articleId || typeof articleId !== 'string' || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: 'Melding is te lang' }, { status: 400 })
    }

    await writeClient.create({
      _type: 'report',
      article: { _type: 'reference', _ref: articleId },
      message: message.trim(),
      createdAt: new Date().toISOString(),
    })

    await writeClient
      .patch(articleId)
      .setIfMissing({ reportCount: 0 })
      .inc({ reportCount: 1 })
      .commit()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Report API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
