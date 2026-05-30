import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Over',
  description: 'Meer over Stadsgeest 033 — AI-ondersteunde journalistiek voor Amersfoort.',
}

export default function OverPage() {
  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'var(--f-d)', fontWeight: 700, fontSize: 'clamp(32px,5vw,44px)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 24 }}>
        Over Stadsgeest 033
      </h1>

      <p style={{ fontFamily: 'var(--f-b)', fontSize: 18, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 32 }}>
        Stadsgeest 033 is een experimenteel lokaal nieuwsplatform voor Amersfoort. Wij gebruiken kunstmatige intelligentie om openbare bronnen — zoals gemeentelijke publicaties, raadsstukken en persberichten — samen te vatten en te duiden voor inwoners van de stad.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 22, marginBottom: 12, marginTop: 40 }}>Hoe het werkt</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        Onze AI-redactie verwerkt dagelijks honderden documenten en signaleert relevante ontwikkelingen op het gebied van politiek, veiligheid, wonen, verkeer en cultuur. Elk artikel bevat een transparantieverklaring die uitlegt op welke bronnen het is gebaseerd.
      </p>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        We streven ernaar feitelijk correct en neutraal te zijn. Toch kunnen AI-systemen fouten maken. Lezers die onjuistheden signaleren, kunnen dat melden via de meldknop onderaan elk artikel.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 22, marginBottom: 12, marginTop: 40 }}>Geen vervanging van journalistiek</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)', marginBottom: 16 }}>
        Stadsgeest 033 is nadrukkelijk geen vervanging van menselijke journalistiek. Het platform is bedoeld als aanvulling: een manier om informatie die al openbaar is toegankelijker te maken voor mensen die niet dagelijks raadsvergaderingen of gemeentelijke nieuwsbrieven volgen.
      </p>

      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 600, fontSize: 22, marginBottom: 12, marginTop: 40 }}>Contact</h2>
      <p style={{ fontFamily: 'var(--f-b)', fontSize: 16, lineHeight: 1.75, color: 'var(--t2)' }}>
        Vragen, opmerkingen of suggesties? Stuur een e-mail naar{' '}
        <a href="mailto:redactie@stadsgeest.nl" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          redactie@stadsgeest.nl
        </a>.
      </p>
    </div>
  )
}
