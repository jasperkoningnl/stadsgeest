import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacybeleid — Stadsgeest 033',
  description: 'Privacybeleid van Stadsgeest 033.',
}

export default function PrivacyPage() {
  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'var(--f-d)', fontWeight: 700, fontSize: 'clamp(32px,5vw,44px)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 8 }}>
        Privacybeleid
      </h1>
      <p style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)', letterSpacing: '0.05em', marginBottom: 40 }}>
        LAATSTE UPDATE: MEI 2026
      </p>

      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 32 }}>
        Stadsgeest 033 respecteert uw privacy. Dit beleid beschrijft welke gegevens we verzamelen, waarom, en hoe we ermee omgaan.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 20, marginBottom: 12, marginTop: 40 }}>Welke gegevens verzamelen we?</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        Stadsgeest 033 verzamelt geen persoonlijke gegevens van bezoekers. Er is geen registratie, geen login en geen tracking via advertentienetwerken. We slaan geen cookies op buiten technisch noodzakelijke sessie-instellingen (zoals uw kleurthema-voorkeur, die lokaal in uw browser wordt bewaard).
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 20, marginBottom: 12, marginTop: 40 }}>Meldingen</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        Als u een fout meldt via de meldknop onderaan een artikel, wordt de inhoud van uw melding opgeslagen in onze redactionele database. We vragen geen naam of e-mailadres. Meldingen worden uitsluitend gebruikt voor redactionele doeleinden.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 20, marginBottom: 12, marginTop: 40 }}>Externe diensten</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        De website maakt gebruik van Sanity (contentbeheer) en Vercel (hosting). Beide diensten worden in overeenstemming met de AVG ingezet. Afbeeldingen worden geserveerd via het Sanity CDN.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 20, marginBottom: 12, marginTop: 40 }}>Contact</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)' }}>
        Vragen over dit privacybeleid? Stuur een e-mail naar{' '}
        <a href="mailto:privacy@stadsgeest.nl" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          privacy@stadsgeest.nl
        </a>.
      </p>
    </div>
  )
}
