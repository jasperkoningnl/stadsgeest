import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'next-sanity'

const writeClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '60u1z6xa',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-28',
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
})

export async function POST(req: NextRequest) {
  if (!process.env.SANITY_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Write token not configured' }, { status: 503 })
  }

  try {
    const { articleId, message, sessionHash } = await req.json()

    if (!articleId || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await writeClient.create({
      _type: 'report',
      article: { _type: 'reference', _ref: articleId },
      message: message.trim(),
      sessionHash: sessionHash || null,
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
