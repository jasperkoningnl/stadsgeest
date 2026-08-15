import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'

// Algemene feedback over het dashboard zelf. Feedback óver een tip loopt via
// /api/tip/[id]/beslis en komt in tip_feedback — die twee blijven gescheiden,
// zodat het meetmateriaal van de testperiode één betekenis houdt.
//
// De soorten zijn kort en dekkend genoeg om zonder typen te kunnen kiezen; ze
// worden geteld, dus ze moeten over maanden nog hetzelfde betekenen.
const SOORTEN = new Set(['onduidelijk', 'ontbreekt', 'werkt_niet', 'werkt_goed', 'anders'])

export async function POST(request: Request) {
  const gebruiker = await huidigeGebruiker(request.headers.get('cookie'))
  if (!gebruiker) return NextResponse.json({ fout: 'Niet ingelogd' }, { status: 401 })
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })

  const body = await request.json().catch(() => null)

  const tekst = typeof body?.tekst === 'string' ? body.tekst.trim().slice(0, 4000) : ''
  if (!tekst) return NextResponse.json({ fout: 'Er is niets ingevuld' }, { status: 400 })

  const soort = typeof body?.soort === 'string' && SOORTEN.has(body.soort) ? body.soort : null
  const pagina = typeof body?.pagina === 'string' ? body.pagina.slice(0, 200) : null
  const aanleiding = body?.aanleiding === 'balk' ? 'balk' : 'logboek'

  await turso.execute({
    sql: `INSERT INTO dashboard_feedback (gebruiker, soort, tekst, pagina, aanleiding)
          VALUES (?, ?, ?, ?, ?)`,
    args: [gebruiker, soort, tekst, pagina, aanleiding],
  })

  return NextResponse.json({ ok: true })
}
