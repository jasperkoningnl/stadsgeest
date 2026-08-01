import { NextRequest, NextResponse } from 'next/server'
import { hasTurso } from '@/lib/turso'
import { isAuthedCookieHeader } from '@/lib/dashboardAuth'
import { getJob, getJobLogs, getPressReleaseForJob } from '@/lib/dashboard/queries'

interface Props {
  params: Promise<{ id: string }>
}

// Lichte pollroute voor de client: de signaaldossierpagina ververst hiermee elke
// 5 seconden zolang een job niet is afgerond (zie taak 2 — geen websockets).
export async function GET(request: NextRequest, { params }: Props) {
  if (!isAuthedCookieHeader(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  }

  if (!hasTurso()) {
    return NextResponse.json({ error: 'Geen databaseverbinding' }, { status: 503 })
  }

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Ongeldig job-id' }, { status: 400 })
  }

  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: 'Job niet gevonden' }, { status: 404 })
  }

  const [logs, pressRelease] = await Promise.all([
    getJobLogs(job.id),
    job.status === 'done' ? getPressReleaseForJob(job) : Promise.resolve(null),
  ])

  return NextResponse.json({ job, logs, pressRelease })
}
