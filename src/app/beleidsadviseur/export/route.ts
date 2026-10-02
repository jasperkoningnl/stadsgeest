import { NextResponse } from 'next/server'
import { hasTurso } from '@/lib/turso'
import { getVergunningenLijst, SOORT_LABEL, THEMAS } from '@/lib/dashboard/wonenQueries'
import { leesFilter, pasFilterToe } from '@/lib/dashboard/vergunningenFilter'
import { getWijken } from '@/lib/dashboard/cbsWonen'

// CSV-export voor het woondashboard. De proxy laat alleen het beleidsaccount
// en Jasper op /beleidsadviseur/*, dus ook hier. De data komt uit dezelfde
// caches als de pagina's; een export kost geen extra databasereads.
export const dynamic = 'force-dynamic'

function csv(rijen: (string | number | null | undefined)[][]): string {
  const cel = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Puntkomma en BOM: zo opent Excel in Nederlandse instellingen het bestand direct goed.
  return '﻿' + rijen.map((r) => r.map(cel).join(';')).join('\r\n')
}

function antwoord(naam: string, inhoud: string): NextResponse {
  return new NextResponse(inhoud, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${naam}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const set = url.searchParams.get('set') ?? 'vergunningen'
  const params = Object.fromEntries(url.searchParams.entries())

  if (set === 'wijken') {
    try {
      const w = await getWijken()
      return antwoord('wijken-amersfoort', csv([
        ['wijkcode', 'wijk', `inwoners ${w.bevolkingsjaar}`, '65 tot 80 jaar', '80 jaar of ouder', 'huishoudens', 'eenpersoonshuishoudens', `woningen ${w.woningjaar}`, 'nieuwbouw', 'WOZ x1000', 'meergezins %', 'koop %', 'huur %', 'corporatie %', 'bouwjaar laatste 10 jaar %', 'laagste 40% inkomen %', `Wmo-clienten ${w.wmoJaar}`, 'Wmo per 1000'],
        ...w.wijken.map((x) => [x.code, x.naam, x.inwoners, x.j65tot80, x.j80plus, x.huishoudens, x.eenpersoons, x.woningen, x.nieuwbouw, x.wozDuizend, x.meergezinsPct, x.koopPct, x.huurPct, x.corporatiePct, x.bouwjaarRecentPct, x.laagInkomenPct, x.wmoClienten, x.wmoPer1000]),
      ]))
    } catch (e) {
      console.error('[beleidsadviseur] export wijken:', e)
      return new NextResponse('CBS-cijfers tijdelijk niet beschikbaar', { status: 503 })
    }
  }

  if (!hasTurso()) return new NextResponse('Geen database', { status: 503 })
  try {
    const lijst = await getVergunningenLijst()
    if (set === 'lopend') {
      return antwoord('lopende-aanvragen', csv([
        ['datum aanvraag', 'dagen open', 'dagen tot einde beslistermijn', 'adres', 'wijk', 'woningen in kop', 'thema\'s', 'kop', 'url'],
        ...lijst.lopend.map((a) => [a.datum, a.dagenOpen, a.dagenTotTermijn, a.adres, a.wijk, a.woningen, a.themas.join(', '), a.titel, a.url]),
      ]))
    }
    const f = leesFilter(params)
    const items = pasFilterToe(lijst.items, f)
    const themaLabel = new Map<string, string>(THEMAS.map((t) => [t.id, t.label]))
    return antwoord('omgevingsvergunningen', csv([
      ['datum', 'soort besluit', 'adres', 'wijk', 'woningen in kop', 'thema\'s', 'zorg', 'kop', 'url'],
      ...items.map((it) => [it.datum, SOORT_LABEL[it.soort], it.adres, it.wijk, it.woningen, it.themas.map((t) => themaLabel.get(t) ?? t).join(', '), it.zorg ? 'ja' : '', it.titel, it.url]),
    ]))
  } catch (e) {
    console.error('[beleidsadviseur] export:', e)
    return new NextResponse('Export tijdelijk niet beschikbaar', { status: 503 })
  }
}
