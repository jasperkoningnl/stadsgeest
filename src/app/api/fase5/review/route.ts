import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'

const REQUEST_ID = /^[0-9a-f-]{36}$/i

export async function POST(request: Request) {
  const gebruiker = await huidigeGebruiker(request.headers.get('cookie'))
  if (gebruiker !== 'jasper') return NextResponse.json({ fout: 'Geen toegang' }, { status: 403 })
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })
  const body = await request.json().catch(() => null)
  const maand = typeof body?.maand === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(body.maand) ? body.maand : null
  const requestId = typeof body?.request_id === 'string' && REQUEST_ID.test(body.request_id) ? body.request_id : null
  if (!maand || !requestId) return NextResponse.json({ fout: 'Ongeldige maandreview' }, { status: 400 })
  if (![body.false_positives,body.gemiste_entiteiten,body.brongezondheid].every(value => value === true)) {
    return NextResponse.json({ fout: 'Controleer eerst alle drie de reviewonderdelen.' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null
  const existing = await turso.execute({ sql: 'SELECT id FROM phase5_review_events WHERE request_id=?', args: [requestId] })
  if (existing.rows.length) return NextResponse.json({ ok: true, duplicate: true })
  const tx = await turso.transaction('write')
  try {
    const cycle = await tx.execute({ sql: 'SELECT status FROM phase5_review_cycles WHERE review_month=?', args: [maand] })
    if (!cycle.rows.length) { await tx.rollback(); return NextResponse.json({ fout: 'Deze reviewcyclus bestaat niet.' }, { status: 404 }) }
    if (String(cycle.rows[0].status) !== 'open') { await tx.rollback(); return NextResponse.json({ ok: true, alreadyReviewed: true }) }
    const payload = JSON.stringify({ false_positives: true, gemiste_entiteiten: true, brongezondheid: true, notes })
    await tx.execute({ sql: `INSERT INTO phase5_review_events(review_month,request_id,actor,action,payload) VALUES (?,?,?,'reviewed',?)`, args: [maand,requestId,gebruiker,payload] })
    await tx.execute({ sql: `UPDATE phase5_review_cycles SET status='reviewed',notes=?,decided_by=?,decided_at=datetime('now'),updated_at=datetime('now') WHERE review_month=?`, args: [notes,gebruiker,maand] })
    await tx.commit()
  } catch (error) {
    await tx.rollback()
    const duplicate = await turso.execute({ sql: 'SELECT id FROM phase5_review_events WHERE request_id=?', args: [requestId] })
    if (duplicate.rows.length) return NextResponse.json({ ok: true, duplicate: true })
    throw error
  }
  return NextResponse.json({ ok: true })
}
