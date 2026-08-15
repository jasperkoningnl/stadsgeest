import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Inloggen — Stadsgeest',
  robots: { index: false, follow: false },
}

// Zelfde thematiek als het dashboard: opgeslagen keuze wint, anders volgt de
// pagina de systeemvoorkeur. Zie globals.css (.np-vlak) en de dashboardlayout.
const THEMA_SCRIPT = `try{var t=localStorage.getItem('np-thema');if(t==='licht'||t==='donker'){document.documentElement.setAttribute('data-np-thema',t)}}catch(e){}`

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>
}) {
  const params = await searchParams
  const error = params.error === '1'
  // 'config' betekent: de omgevingsvariabelen voor de inlog ontbreken.
  // Dan komt niemand binnen — dat is opzet.
  const nietIngesteld = params.error === 'config'
  const from = params.from || '/nieuwsplein33'

  return (
    <main className="np-vlak np-inlog">
      <script dangerouslySetInnerHTML={{ __html: THEMA_SCRIPT }} />
      <div className="np-inlog-kaart">
        <div className="np-inlog-merk">Stadsgeest<span>*</span></div>
        <h1 className="np-inlog-kop">Redactie Nieuwsplein33</h1>
        <p className="np-inlog-sub">Log in met je gebruikersnaam en wachtwoord.</p>

        {error && (
          <p className="np-inlog-fout">Onjuiste gebruikersnaam of wachtwoord. Probeer het opnieuw.</p>
        )}

        {nietIngesteld && (
          <p className="np-inlog-fout">
            De inlog is nog niet ingesteld op deze omgeving. Zet <code>DASHBOARD_SESSIE_SECRET</code> en
            minimaal één <code>DASHBOARD_WACHTWOORD_HASH_...</code> in de omgevingsvariabelen.
          </p>
        )}

        <form method="POST" action="/api/auth">
          <input type="hidden" name="from" value={from} />
          <label className="np-inlog-veld">
            <span>Gebruikersnaam</span>
            <input
              name="username"
              type="text"
              autoFocus
              autoComplete="username"
              autoCapitalize="off"
              required
            />
          </label>
          <label className="np-inlog-veld">
            <span>Wachtwoord</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="np-inlog-knop">Inloggen</button>
        </form>
      </div>
    </main>
  )
}
