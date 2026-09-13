import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'
import { captureFeedbackContext } from '@/lib/dashboard/feedbackContext'

const REQUEST_ID = /^[0-9a-f-]{36}$/i

function canonicaliseerArtikelUrl(value: string): string {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Alleen http- of https-adressen.')
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (hostname !== 'nieuwsplein33.nl') throw new Error('Gebruik het adres van het artikel op nieuwsplein33.nl.')
  parsed.protocol = 'https:'
  parsed.hostname = 'nieuwsplein33.nl'
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key)
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString()
}

/**
 * De meetknop. Legt vast of een tip tot een artikel heeft geleid, en of dat
 * artikel er zonder Stadsgeest niet was geweest. Dit is het cijfer waarop de
 * testperiode wordt beoordeeld, dus het wordt op het moment zelf vastgelegd.
 */
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
  if (!body) return NextResponse.json({ fout: 'Geen gegevens ontvangen' }, { status: 400 })

  const requestId = typeof body.request_id === 'string' && REQUEST_ID.test(body.request_id) ? body.request_id : null
  if (!requestId) return NextResponse.json({ fout: 'Ongeldige aanvraag; ververs de pagina en probeer opnieuw.' }, { status: 400 })
  const already = await turso.execute({ sql: 'SELECT tip_id FROM editorial_outcome_events WHERE request_id=?', args: [requestId] })
  if (already.rows.length) return NextResponse.json({ ok: true, duplicate: true })

  const nietGebruikt = body.niet_gebruikt === true
  const zonderStadsgeest = body.zonder_stadsgeest === 'ja' ? 1 : body.zonder_stadsgeest === 'nee' ? 0 : null
  let url: string | null = typeof body.artikel_url === 'string' ? body.artikel_url.trim() || null : null
  let normalizedUrl: string | null = null

  if (!nietGebruikt) {
    if (!url) return NextResponse.json({ fout: 'Vul het adres van het artikel in.' }, { status: 400 })
    if (zonderStadsgeest === null) return NextResponse.json({ fout: 'Geef aan of dit artikel er zonder Stadsgeest ook was geweest.' }, { status: 400 })
    try {
      normalizedUrl = canonicaliseerArtikelUrl(url)
    } catch (error) {
      return NextResponse.json({ fout: error instanceof Error ? error.message : 'Dat is geen geldig webadres.' }, { status: 400 })
    }
  } else {
    url = null
  }

  const nieuweStatus = nietGebruikt ? 'niet_gebruikt' : 'gepubliceerd'

  const huidig = await turso.execute({ sql: 'SELECT status FROM tips WHERE id = ?', args: [id] })
  if (huidig.rows.length === 0) return NextResponse.json({ fout: 'Tip bestaat niet' }, { status: 404 })
  const vorigeStatus = String(huidig.rows[0].status)

  const tx = await turso.transaction('write')
  try {
    let outcomeId: number | null = null
    if (!nietGebruikt && normalizedUrl && url && zonderStadsgeest !== null) {
      const found = await tx.execute({ sql: 'SELECT id,without_stadsgeest FROM editorial_outcomes WHERE normalized_url=?', args: [normalizedUrl] })
      if (found.rows.length && Number(found.rows[0].without_stadsgeest) !== zonderStadsgeest) {
        await tx.rollback()
        return NextResponse.json({ fout: 'Dit artikel is al met een andere uitkomst vastgelegd. Laat Jasper de bestaande meting controleren.' }, { status: 409 })
      }
      if (found.rows.length) outcomeId = Number(found.rows[0].id)
      else {
        const inserted = await tx.execute({
          sql: `INSERT INTO editorial_outcomes(normalized_url,article_url,without_stadsgeest,created_by) VALUES (?,?,?,?)`,
          args: [normalizedUrl,url,zonderStadsgeest,gebruiker],
        })
        outcomeId = Number(inserted.lastInsertRowid)
      }
      await tx.execute({
        sql: `INSERT INTO tip_outcomes(tip_id,outcome_id,active) VALUES (?,?,1)
              ON CONFLICT(tip_id) DO UPDATE SET outcome_id=excluded.outcome_id,active=1,updated_at=datetime('now')`,
        args: [id,outcomeId],
      })
    } else {
      const linked = await tx.execute({ sql: 'SELECT outcome_id FROM tip_outcomes WHERE tip_id=? AND active=1', args: [id] })
      outcomeId = linked.rows.length ? Number(linked.rows[0].outcome_id) : null
      await tx.execute({ sql: `UPDATE tip_outcomes SET active=0,updated_at=datetime('now') WHERE tip_id=?`, args: [id] })
    }

    await tx.execute({
      sql: `UPDATE tips SET artikel_url=?,eigen_vondst=?,status=?,updated_at=datetime('now') WHERE id=?`,
      args: [url,nietGebruikt ? null : zonderStadsgeest,nieuweStatus,id],
    })
    const feedback = await tx.execute({
      sql: `INSERT INTO tip_feedback(tip_id,gebruiker,actie,reden_tekst,request_id,verdict,dimension,feedback_schema_version)
            VALUES (?,?,?,?,? ,?,'artikeluitkomst','phase5-v1')`,
      args: [id,gebruiker,nieuweStatus,url,requestId,nietGebruikt ? null : 'bruikbaar'],
    })
    await captureFeedbackContext(tx, Number(feedback.lastInsertRowid), id)
    await tx.execute({
      sql: `INSERT INTO editorial_outcome_events(outcome_id,tip_id,request_id,actor,event_type,payload)
            VALUES (?,?,?,?,?,?)`,
      args: [outcomeId,id,requestId,gebruiker,nietGebruikt ? 'not_used' : 'published',JSON.stringify({ article_url: url, normalized_url: normalizedUrl, without_stadsgeest: zonderStadsgeest })],
    })
    await tx.execute({
      sql: `INSERT INTO tip_events(tip_id,actor,event_type,status_from,status_to,reason,payload)
            VALUES (?,?,'meetknop',?,?,?,?)`,
      args: [id,gebruiker,vorigeStatus,nieuweStatus,nietGebruikt ? 'geen artikel van gemaakt' : 'artikel gepubliceerd',JSON.stringify({ request_id: requestId, outcome_id: outcomeId, without_stadsgeest: zonderStadsgeest })],
    })
    await tx.commit()
  } catch (error) {
    await tx.rollback()
    const duplicate = await turso.execute({ sql: 'SELECT tip_id FROM editorial_outcome_events WHERE request_id=?', args: [requestId] })
    if (duplicate.rows.length) return NextResponse.json({ ok: true, duplicate: true })
    throw error
  }

  return NextResponse.json({ ok: true, status: nieuweStatus })
}
