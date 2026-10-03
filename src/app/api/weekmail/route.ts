import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { q } from '@/lib/turso'

const CRON_SECRET = process.env.CRON_SECRET

// Ontvangers staan sinds 3 oktober 2026 in een omgevingsvariabele
// (WEEKMAIL_ONTVANGERS, komma-gescheiden), zodat een nieuw redactielid geen
// code-wijziging vraagt. Zonder variabele valt de mail terug op de twee
// oorspronkelijke adressen en logt een waarschuwing.
const STANDAARD_ONTVANGERS = ['gideon.hofland@nieuwsplein33.nl', 'pien.nieman@nieuwsplein33.nl']

function ontvangers(): string[] {
  const uitEnv = (process.env.WEEKMAIL_ONTVANGERS ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes('@'))
  if (uitEnv.length > 0) return uitEnv
  console.warn('[weekmail] WEEKMAIL_ONTVANGERS ontbreekt; terugval op de standaardadressen')
  return STANDAARD_ONTVANGERS
}

interface WeekTip {
  id: number
  titel: string
  kern: string
  categorie: string | null
  soort: string
  score: number
  status: string
  supertip: number
  created_at: string
  dossier_naam: string | null
}

const SOORT_LABEL: Record<string, string> = {
  nieuwsfeit: 'Nieuwsfeit',
  patroon: 'Patroon',
  verdieping: 'Verdieping',
  dossiersignaal: 'Dossier',
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY ontbreekt' }, { status: 500 })
  }

  // Alleen wat nog bij de redactie ligt: de nieuwe tips van deze week die in de
  // wachtrij staan, plus de supertip van de week (ook als die al is opgepakt).
  // Supertip bovenaan, daarna de sterkste eerst. Een al afgehandelde tip in de
  // mail zetten leidde tot dubbel werk.
  const [tips, wachtrij] = await Promise.all([
    q<WeekTip>(
      `SELECT t.id, t.titel, t.kern, t.categorie, t.soort, t.score, t.status, t.supertip,
              t.created_at, d.naam AS dossier_naam
       FROM tips t
       LEFT JOIN dossiers d ON d.id = t.dossier_id
       WHERE t.created_at > datetime('now', '-7 days')
         AND (t.status = 'wachtrij' OR t.supertip = 1)
       ORDER BY t.supertip DESC, t.score DESC, t.created_at DESC`
    ),
    q<{ n: number; oud: number }>(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS oud
       FROM tips WHERE status = 'wachtrij'`,
    ),
  ])

  if (tips.length === 0) {
    return NextResponse.json({ bericht: 'Geen nieuwe tips deze week — mail overgeslagen.' })
  }

  const stand = { wachtrij: Number(wachtrij[0]?.n ?? 0), oud: Number(wachtrij[0]?.oud ?? 0) }
  const dashboardUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://stadsgeest.nl'
  const html = renderMail(tips, dashboardUrl, stand)
  const plainText = renderPlainText(tips, dashboardUrl, stand)

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: 'Stadsgeest <stadsgeest@stadsgeest.nl>',
    replyTo: 'stadsgeest@proton.me',
    to: ontvangers(),
    bcc: ['stadsgeest@proton.me'],
    subject: `Stadsgeest weekoverzicht — ${tips.length} ${tips.length === 1 ? 'tip' : 'tips'} (${weekLabel()})`,
    html,
    text: plainText,
  })

  if (error) {
    console.error('[weekmail] Resend-fout:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ verzonden: true, aantalTips: tips.length })
}

// --- Helpers ---

function weekLabel(): string {
  const nu = new Date()
  const maandag = new Date(nu)
  maandag.setDate(nu.getDate() - ((nu.getDay() + 6) % 7))
  const zondag = new Date(maandag)
  zondag.setDate(maandag.getDate() - 1)
  const vorige = new Date(zondag)
  vorige.setDate(zondag.getDate() - 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })
  return `${fmt(vorige)} – ${fmt(zondag)}`
}

function soortLabel(tip: WeekTip): string {
  const soort = SOORT_LABEL[tip.soort] ?? tip.soort
  return tip.supertip ? `★ Supertip · ${soort}` : soort
}

// De weger scoort van ongeveer 2 tot 20; een tip wordt pas vanaf 6 gemaakt en
// een supertip zit rond de 20. Tot 3 oktober 2026 stonden hier drempels van
// 80, 60 en 40, waardoor elke score grijs kleurde.
function scoreKleur(score: number): string {
  if (score >= 12) return '#16a34a'
  if (score >= 9) return '#2563eb'
  if (score >= 6) return '#ca8a04'
  return '#6b7280'
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMail(tips: WeekTip[], baseUrl: string, stand: { wachtrij: number; oud: number }): string {
  const rijen = tips
    .map(
      (tip) => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px 8px; vertical-align: top;">
        <span style="display: inline-block; background: ${scoreKleur(tip.score)}; color: white;
          font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 4px;">
          ${tip.score}
        </span>
      </td>
      <td style="padding: 12px 8px; vertical-align: top;">
        <a href="${baseUrl}/nieuwsplein33/tip/${tip.id}"
           style="color: #111827; font-weight: 600; text-decoration: none; font-size: 15px;">
          ${escapeHtml(tip.titel)}
        </a>
        <div style="color: #6b7280; font-size: 13px; margin-top: 4px; line-height: 1.4;">
          ${escapeHtml(tip.kern.length > 200 ? tip.kern.slice(0, 200) + '…' : tip.kern)}
        </div>
        ${tip.dossier_naam ? `<div style="color: #9333ea; font-size: 12px; margin-top: 4px;">📁 ${escapeHtml(tip.dossier_naam)}</div>` : ''}
      </td>
      <td style="padding: 12px 8px; vertical-align: top; white-space: nowrap; font-size: 12px; color: #6b7280;">
        ${tip.categorie || ''}
      </td>
      <td style="padding: 12px 8px; vertical-align: top; white-space: nowrap; font-size: 12px; color: ${tip.supertip ? '#0f766e' : '#6b7280'}; font-weight: ${tip.supertip ? 700 : 400};">
        ${escapeHtml(soortLabel(tip))}
      </td>
    </tr>`
    )
    .join('')

  return `
<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 680px; margin: 0 auto; padding: 24px 16px;">
    <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="background: #111827; color: white; padding: 20px 24px;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Stadsgeest weekoverzicht</h1>
        <p style="margin: 6px 0 0; font-size: 14px; color: #9ca3af;">
          ${weekLabel()} &middot; ${tips.length} nieuwe tip${tips.length === 1 ? '' : 's'} in de wachtrij
        </p>
      </div>
      <div style="padding: 16px 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid #e5e7eb; text-align: left;">
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600; width: 50px;">Score</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Tip</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Categorie</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Soort</th>
            </tr>
          </thead>
          <tbody>${rijen}</tbody>
        </table>
      </div>
      <div style="padding: 12px 24px 0; font-size: 13px; color: #6b7280;">
        In totaal ${stand.wachtrij === 1 ? 'staat 1 tip' : `staan ${stand.wachtrij} tips`} in de wachtrij${stand.oud > 0 ? `, waarvan ${stand.oud} ouder dan een maand` : ''}.
      </div>
      <div style="padding: 16px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
        <a href="${baseUrl}/nieuwsplein33"
           style="display: inline-block; background: #111827; color: white; padding: 10px 24px;
                  border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
          Bekijk het dashboard →
        </a>
      </div>
    </div>
    <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 16px;">
      Dit is een automatisch weekoverzicht van Stadsgeest. Reageer op deze mail
      om het redactieteam te bereiken.
    </p>
  </div>
</body>
</html>`
}

function renderPlainText(tips: WeekTip[], baseUrl: string, stand: { wachtrij: number; oud: number }): string {
  const regels = tips.map(
    (tip, i) =>
      `${i + 1}. [${tip.score}] ${tip.supertip ? 'SUPERTIP: ' : ''}${tip.titel}\n   ${tip.kern.length > 160 ? tip.kern.slice(0, 160) + '…' : tip.kern}\n   ${baseUrl}/nieuwsplein33/tip/${tip.id}`
  )
  return [
    `STADSGEEST WEEKOVERZICHT — ${weekLabel()}`,
    `${tips.length} nieuwe tip${tips.length === 1 ? '' : 's'} in de wachtrij\n`,
    ...regels,
    `\nIn totaal ${stand.wachtrij === 1 ? 'staat 1 tip' : `staan ${stand.wachtrij} tips`} in de wachtrij${stand.oud > 0 ? `, waarvan ${stand.oud} ouder dan een maand` : ''}.`,
    `Bekijk het dashboard: ${baseUrl}/nieuwsplein33`,
  ].join('\n')
}
