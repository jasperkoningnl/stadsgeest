import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'

// 'wachtrij' is de terugzetactie: elke beslissing is omkeerbaar, behalve bij
// een gepubliceerde tip — daar loopt de correctie via de meetknop ("toch niets
// mee gedaan"), zodat de meetstand van de testperiode blijft kloppen.
const TOEGESTAAN = new Set(['goedgekeurd', 'geparkeerd', 'afgekeurd', 'wachtrij'])

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

  const redenCode = typeof body.reden_code === 'string' ? body.reden_code.slice(0, 60) : null
  const redenTekst = typeof body.reden_tekst === 'string' ? body.reden_tekst.slice(0, 4000) : null

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

  // Feedback is append-only: er wordt nooit iets overschreven, zodat later terug
  // te zien is hoe het oordeel van de redactie zich heeft ontwikkeld.
  await turso.batch([
    {
      sql: `UPDATE tips SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [actie, id],
    },
    {
      sql: `INSERT INTO tip_feedback (tip_id, gebruiker, actie, reden_code, reden_tekst)
            VALUES (?, ?, ?, ?, ?)`,
      // De CHECK op tip_feedback.actie kent geen 'wachtrij' maar wel
      // 'heropend' — precies wat terugzetten is. De status op de tip zelf
      // wordt wél gewoon 'wachtrij'.
      args: [id, gebruiker, actie === 'wachtrij' ? 'heropend' : actie, redenCode, redenTekst],
    },
    {
      sql: `INSERT INTO tip_events (tip_id, actor, event_type, status_from, status_to, reason)
            VALUES (?, ?, 'beslissing', ?, ?, ?)`,
      args: [id, gebruiker, vorigeStatus, actie, redenCode ?? redenTekst],
    },
  ], 'write')

  return NextResponse.json({ ok: true, status: actie })
}
