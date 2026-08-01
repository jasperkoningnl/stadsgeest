import { NextRequest, NextResponse } from 'next/server'
import { hasTurso, qOne } from '@/lib/turso'
import { isAuthedCookieHeader } from '@/lib/dashboardAuth'
import { getOpenJobForSignal, createJobRequest } from '@/lib/dashboard/queries'

const JOB_TYPE = 'persbericht'
const REQUESTED_BY = 'redactie'

export async function POST(request: NextRequest) {
  // Deze route zit ook achter de proxy-cookiecheck, maar controleert zichzelf
  // expliciet — een schrijvende actie mag niet alleen op de proxy-configuratie leunen.
  if (!isAuthedCookieHeader(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  }

  if (!hasTurso()) {
    return NextResponse.json({ error: 'Geen databaseverbinding' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 })
  }

  const signalId = (body as { signalId?: unknown })?.signalId
  if (typeof signalId !== 'number' || !Number.isInteger(signalId) || signalId <= 0) {
    return NextResponse.json({ error: 'signalId ontbreekt of is ongeldig' }, { status: 400 })
  }

  const signal = await qOne<{ id: number }>(`SELECT id FROM signals WHERE id = ?`, [signalId])
  if (!signal) {
    return NextResponse.json({ error: 'Signaal niet gevonden' }, { status: 404 })
  }

  const existing = await getOpenJobForSignal(signalId, JOB_TYPE)
  if (existing) {
    return NextResponse.json({ job: existing, duplicate: true })
  }

  const job = await createJobRequest(signalId, JOB_TYPE, REQUESTED_BY)
  return NextResponse.json({ job, duplicate: false }, { status: 201 })
}
