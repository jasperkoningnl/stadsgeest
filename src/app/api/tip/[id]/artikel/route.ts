import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { isAuthedCookieHeader } from '@/lib/dashboardAuth'

const GEBRUIKER_ONBEKEND = 'gedeelde-inlog'

/**
 * De meetknop. Legt vast of een tip tot een artikel heeft geleid, en of dat
 * artikel er zonder Stadsgeest niet was geweest. Dit is het cijfer waarop de
 * testperiode wordt beoordeeld, dus het wordt op het moment zelf vastgelegd.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedCookieHeader(request.headers.get('cookie')))) {
    return NextResponse.json({ fout: 'Niet ingelogd' }, { status: 401 })
  }
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) return NextResponse.json({ fout: 'Ongeldige tip' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ fout: 'Geen gegevens ontvangen' }, { status: 400 })

  const nietGebruikt = body.niet_gebruikt === true
  const eigenVondst = body.eigen_vondst === true ? 1 : 0
  let url: string | null = typeof body.artikel_url === 'string' ? body.artikel_url.trim() || null : null

  if (!nietGebruikt) {
    if (!url) return NextResponse.json({ fout: 'Vul het adres van het artikel in.' }, { status: 400 })
    let ontleed: URL
    try {
      ontleed = new URL(url)
    } catch {
      return NextResponse.json({ fout: 'Dat is geen geldig webadres.' }, { status: 400 })
    }
    if (ontleed.protocol !== 'https:' && ontleed.protocol !== 'http:') {
      return NextResponse.json({ fout: 'Alleen http- of https-adressen.' }, { status: 400 })
    }
    url = ontleed.toString()
  } else {
    url = null
  }

  const nieuweStatus = nietGebruikt ? 'niet_gebruikt' : 'gepubliceerd'

  const huidig = await turso.execute({ sql: 'SELECT status FROM tips WHERE id = ?', args: [id] })
  if (huidig.rows.length === 0) return NextResponse.json({ fout: 'Tip bestaat niet' }, { status: 404 })
  const vorigeStatus = String(huidig.rows[0].status)

  await turso.batch([
    {
      sql: `UPDATE tips SET artikel_url = ?, eigen_vondst = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [url, nietGebruikt ? null : eigenVondst, nieuweStatus, id],
    },
    {
      sql: `INSERT INTO tip_feedback (tip_id, gebruiker, actie, reden_tekst) VALUES (?, ?, ?, ?)`,
      args: [id, GEBRUIKER_ONBEKEND, nieuweStatus, url],
    },
    {
      sql: `INSERT INTO tip_events (tip_id, actor, event_type, status_from, status_to, reason, payload)
            VALUES (?, ?, 'meetknop', ?, ?, ?, ?)`,
      args: [
        id, GEBRUIKER_ONBEKEND, vorigeStatus, nieuweStatus,
        nietGebruikt ? 'geen artikel van gemaakt' : 'artikel gepubliceerd',
        JSON.stringify({ artikel_url: url, eigen_vondst: nietGebruikt ? null : eigenVondst }),
      ],
    },
  ], 'write')

  return NextResponse.json({ ok: true, status: nieuweStatus })
}
