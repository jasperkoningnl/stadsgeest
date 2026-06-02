import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Inloggen — Stadsgeest 033',
  robots: { index: false, follow: false },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>
}) {
  const params = await searchParams
  const error = params.error === '1'
  const from = params.from || '/'

  return (
    <main style={{
      minHeight: 'calc(100vh - var(--hh))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
      }}>
        <h1 style={{
          fontFamily: 'var(--f-d)',
          fontWeight: 800,
          fontSize: '22px',
          letterSpacing: '-0.01em',
          marginBottom: '8px',
        }}>
          Toegang vereist
        </h1>
        <p style={{
          fontFamily: 'var(--f-b)',
          fontSize: '15px',
          color: 'var(--t2)',
          marginBottom: '28px',
          lineHeight: 1.6,
        }}>
          Voer het wachtwoord in om verder te gaan.
        </p>

        {error && (
          <p style={{
            background: 'rgba(255,180,171,0.10)',
            border: '1px solid var(--error)',
            color: 'var(--error)',
            borderRadius: 'var(--r-lg)',
            padding: '10px 14px',
            fontSize: '14px',
            marginBottom: '20px',
            fontFamily: 'var(--f-d)',
          }}>
            Onjuist wachtwoord. Probeer het opnieuw.
          </p>
        )}

        <form method="POST" action="/api/auth">
          <input type="hidden" name="from" value={from} />
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontFamily: 'var(--f-m)',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--t3)',
                marginBottom: '8px',
              }}
            >
              Wachtwoord
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                color: 'var(--t1)',
                fontFamily: 'var(--f-d)',
                fontSize: '15px',
                padding: '10px 14px',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px' }}
          >
            Inloggen
          </button>
        </form>
      </div>
    </main>
  )
}
