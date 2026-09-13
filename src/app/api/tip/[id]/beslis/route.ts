import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'
import { captureFeedbackContext } from '@/lib/dashboard/feedbackContext'

// 'wachtrij' is de terugzetactie: elke beslissing is omkeerbaar, behalve bij
// een gepubliceerde tip — daar loopt de correctie via de meetknop ("toch niets
// mee gedaan"), zodat de meetstand van de testperiode blijft kloppen.
const TOEGESTAAN = new Set(['goedgekeurd', 'geparkeerd', 'afgekeurd', 'wachtrij'])
const REDEN_BELEID: Record<string, { verdict: string; dimension: string }> = {
  zelf_niet_gevonden: { verdict: 'bruikbaar', dimension: 'redactionele_relevantie' },
  concreet_gemaakt: { verdict: 'bruikbaar', dimension: 'tipkwaliteit' },
  stond_al_op_lijst: { verdict: 'bekend', dimension: 'timing' },
  goede_invalshoek: { verdict: 'bruikbaar', dimension: 'redactionele_relevantie' },
  te_vroeg: { verdict: 'bruikbaar', dimension: 'timing' },
  geen_tijd: { verdict: 'bruikbaar', dimension: 'timing' },
  wacht_op_meer: { verdict: 'te_zwak', dimension: 'tipkwaliteit' },
  onduidelijk: { verdict: 'te_zwak', dimension: 'tipkwaliteit' },
  oud_nieuws: { verdict: 'bekend', dimension: 'timing' },
  al_bekend: { verdict: 'bekend', dimension: 'timing' },
  geen_nieuwswaarde: { verdict: 'niet_relevant', dimension: 'redactionele_relevantie' },
  buiten_gebied: { verdict: 'niet_lokaal', dimension: 'redactionele_relevantie' },
  te_dun: { verdict: 'te_zwak', dimension: 'tipkwaliteit' },
  duplicaat: { verdict: 'duplicaat', dimension: 'tipkwaliteit' },
  verkeerd_geclusterd: { verdict: 'duplicaat', dimension: 'clustervorming' },
  feitelijk_fout: { verdict: 'feitelijk_fout', dimension: 'tipkwaliteit' },
  bron_fout: { verdict: 'feitelijk_fout', dimension: 'bronkwaliteit' },
}
const REQUEST_ID = /^[0-9a-f-]{36}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gebruiker = await huidigeGebruiker(request.headers.get('cookie'))
  if (!gebruiker) {
    return NextResponse.json({ fout: 'Niet ingelogd' }, { status: 401 })
  }
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) return NextResponse.json({ fout: 'Ongeldige tip' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const actie = body?.actie
  if (!TOEGESTAAN.has(actie)) return NextResponse.json({ fout: 'Onbekende actie' }, { status: 400 })

  const requestId = typeof body?.request_id === 'string' && REQUEST_ID.test(body.request_id) ? body.request_id : null
  if (!requestId) return NextResponse.json({ fout: 'Ongeldige aanvraag; ververs de pagina en probeer opnieuw.' }, { status: 400 })

  const redenCode = typeof body.reden_code === 'string' ? body.reden_code.slice(0, 60) : null
  const redenTekst = typeof body.reden_tekst === 'string' ? body.reden_tekst.slice(0, 4000) : null
  if (actie === 'afgekeurd' && (!redenCode || !REDEN_BELEID[redenCode])) {
    return NextResponse.json({ fout: 'Kies waarom de tip niet bruikbaar is.' }, { status: 400 })
  }
  if (redenCode && !REDEN_BELEID[redenCode]) return NextResponse.json({ fout: 'Onbekende reden.' }, { status: 400 })

  const bestaand = await turso.execute({ sql: 'SELECT tip_id FROM tip_feedback WHERE request_id=?', args: [requestId] })
  if (bestaand.rows.length) return NextResponse.json({ ok: true, duplicate: true })

  const huidig = await turso.execute({ sql: 'SELECT status FROM tips WHERE id = ?', args: [id] })
  if (huidig.rows.length === 0) return NextResponse.json({ fout: 'Tip bestaat niet' }, { status: 404 })
  const vorigeStatus = String(huidig.rows[0].status)

  if (actie === vorigeStatus) {
    return NextResponse.json({ fout: 'De tip heeft die status al' }, { status: 400 })
  }
  if (actie === 'wachtrij' && vorigeStatus === 'gepubliceerd') {
    return NextResponse.json(
      { fout: 'Een gepubliceerde tip zet je niet terug; gebruik "toch niets mee gedaan" bij het artikelveld' },
      { status: 400 },
    )
  }

  const feedbackActie = actie === 'wachtrij' ? 'heropend' : actie
  const classified = REDEN_BELEID[redenCode || ''] ?? (actie === 'geparkeerd'
    ? { verdict: 'bruikbaar', dimension: 'timing' }
    : actie === 'goedgekeurd' ? { verdict: 'bruikbaar', dimension: 'redactionele_relevantie' }
      : { verdict: null, dimension: 'correctie' })
  const tx = await turso.transaction('write')
  try {
    await tx.execute({ sql: `UPDATE tips SET status=?,updated_at=datetime('now') WHERE id=?`, args: [actie,id] })
    const inserted = await tx.execute({
      sql: `INSERT INTO tip_feedback(tip_id,gebruiker,actie,reden_code,reden_tekst,request_id,verdict,dimension,feedback_schema_version)
            VALUES (?,?,?,?,?,?,?,?, 'phase5-v1')`,
      args: [id,gebruiker,feedbackActie,redenCode,redenTekst,requestId,classified.verdict,classified.dimension],
    })
    await captureFeedbackContext(tx, Number(inserted.lastInsertRowid), id)
    await tx.execute({
      sql: `INSERT INTO tip_events(tip_id,actor,event_type,status_from,status_to,reason,payload)
            VALUES (?,?,'beslissing',?,?,?,?)`,
      args: [id,gebruiker,vorigeStatus,actie,redenCode ?? redenTekst,JSON.stringify({ request_id: requestId, verdict: classified.verdict, dimension: classified.dimension })],
    })
    await tx.commit()
  } catch (error) {
    await tx.rollback()
    const duplicate = await turso.execute({ sql: 'SELECT tip_id FROM tip_feedback WHERE request_id=?', args: [requestId] })
    if (duplicate.rows.length) return NextResponse.json({ ok: true, duplicate: true })
    throw error
  }

  return NextResponse.json({ ok: true, status: actie })
}
