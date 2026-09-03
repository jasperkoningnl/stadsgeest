import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { q } from '@/lib/turso'

const CRON_SECRET = process.env.CRON_SECRET

interface WeekTip {
  id: number
  titel: string
  kern: string
  categorie: string | null
  score: number
  status: string
  created_at: string
  dossier_naam: string | null
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

  const tips = await q<WeekTip>(
    `SELECT t.id, t.titel, t.kern, t.categorie, t.score, t.status,
            t.created_at, d.naam AS dossier_naam
     FROM tips t
     LEFT JOIN dossiers d ON d.id = t.dossier_id
     WHERE t.created_at > datetime('now', '-7 days')
     ORDER BY t.score DESC, t.created_at DESC`
  )

  if (tips.length === 0) {
    return NextResponse.json({ bericht: 'Geen nieuwe tips deze week — mail overgeslagen.' })
  }

  const dashboardUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://stadsgeest.nl'
  const html = renderMail(tips, dashboardUrl)
  const plainText = renderPlainText(tips, dashboardUrl)

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: 'Stadsgeest <stadsgeest@stadsgeest.nl>',
    replyTo: 'stadsgeest@proton.me',
    to: [
      'gideon.hofland@nieuwsplein33.nl',
      'pien.nieman@nieuwsplein33.nl',
    ],
    subject: `Stadsgeest weekoverzicht — ${tips.length} tips (${weekLabel()})`,
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

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    wachtrij: '🟡 Wachtrij',
    goedgekeurd: '🟢 Goedgekeurd',
    in_behandeling: '🔵 In behandeling',
    gepubliceerd: '✅ Gepubliceerd',
    niet_gebruikt: '⚪ Niet gebruikt',
    geparkeerd: '📦 Geparkeerd',
    afgekeurd: '🔴 Afgekeurd',
  }
  return labels[status] || status
}

function scoreKleur(score: number): string {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#2563eb'
  if (score >= 40) return '#ca8a04'
  return '#6b7280'
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMail(tips: WeekTip[], baseUrl: string): string {
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
      <td style="padding: 12px 8px; vertical-align: top; white-space: nowrap; font-size: 12px; color: #6b7280;">
        ${statusLabel(tip.status)}
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
          ${weekLabel()} &middot; ${tips.length} nieuwe tip${tips.length === 1 ? '' : 's'}
        </p>
      </div>
      <div style="padding: 16px 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid #e5e7eb; text-align: left;">
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600; width: 50px;">Score</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Tip</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Categorie</th>
              <th style="padding: 8px; font-size: 12px; color: #6b7280; font-weight: 600;">Status</th>
            </tr>
          </thead>
          <tbody>${rijen}</tbody>
        </table>
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

function renderPlainText(tips: WeekTip[], baseUrl: string): string {
  const regels = tips.map(
    (tip, i) =>
      `${i + 1}. [${tip.score}] ${tip.titel}\n   ${tip.kern.length > 160 ? tip.kern.slice(0, 160) + '…' : tip.kern}\n   ${baseUrl}/nieuwsplein33/tip/${tip.id}`
  )
  return [
    `STADSGEEST WEEKOVERZICHT — ${weekLabel()}`,
    `${tips.length} nieuwe tip${tips.length === 1 ? '' : 's'}\n`,
    ...regels,
    `\nBekijk het dashboard: ${baseUrl}/nieuwsplein33`,
  ].join('\n')
}
