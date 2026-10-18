import { NextResponse } from 'next/server'
import { huidigeGebruiker } from '@/lib/dashboardAuth'
import { turso } from '@/lib/turso'
import { bewerkWooZaak, WooConflict } from '@/lib/dashboard/wooFactorStore'
import { zelfdeWooHerkomst } from '@/lib/dashboard/wooFactor'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await huidigeGebruiker(request.headers.get('cookie'))
  if (!actor) return NextResponse.json({ fout: 'Log eerst in.' }, { status: 401 })
  if (!zelfdeWooHerkomst(request.headers.get('origin'), request.headers.get('host'))) return NextResponse.json({ fout: 'Ongeldige herkomst.' }, { status: 403 })
  if (!turso) return NextResponse.json({ fout: 'Geen database beschikbaar.' }, { status: 503 })
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(id) || !Number.isSafeInteger(body?.revision) || body.revision < 1 || !['opslaan','goedkeuren','afwijzen'].includes(body?.actie)) {
    return NextResponse.json({ fout: 'Ongeldige bewerking.' }, { status: 400 })
  }
  try {
    return NextResponse.json(await bewerkWooZaak(turso, id, body.revision, actor, body.actie, body.concept))
  } catch (error) {
    if (error instanceof WooConflict) return NextResponse.json({ fout: error.message }, { status: 409 })
    if (error instanceof Error && !('code' in error)) return NextResponse.json({ fout: error.message }, { status: 400 })
    console.error('[woo-factor] Opslaan mislukt', error)
    return NextResponse.json({ fout: 'Opslaan is mislukt. Probeer het opnieuw.' }, { status: 503 })
  }
}
