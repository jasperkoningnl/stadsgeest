import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { formatDate } from '@/lib/dashboard/format'
import { getVergunningenOverzicht, getVergunningenLijst, getDpiOverzicht, getRaadOverzicht, getWoonDossier, SOORT_LABEL } from '@/lib/dashboard/wonenQueries'
import { getWoningvoorraad, getEigendom, getBouwvergunningen } from '@/lib/dashboard/cbsWonen'
import { BELEIDSDOELEN, WONINGBOUWDOEL_PER_JAAR, SOCIALE_HUUR_DOEL_PER_JAAR } from '@/lib/dashboard/woonBeleid'
import GeenDatabase from '../nieuwsplein33/GeenDatabase'
import { Aandacht, Extern, Kaart, Kolommen, Meter, Onbeschikbaar, Tegel, maandLabel, maandNaam, nl, pct, plusmin, vang, type Status } from './Onderdelen'

export const dynamic = 'force-dynamic'

const DAG = 86400000
function sinds(dagen: number): string {
  return new Date(Date.now() - dagen * DAG).toISOString().slice(0, 10)
}

export default async function OverzichtPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const [vergunningen, lijst, dpi, raad, dossier, voorraad, eigendom, bouwvergunningen] = await Promise.all([
    vang(getVergunningenOverzicht(), 'vergunningen'),
    vang(getVergunningenLijst(), 'vergunningenlijst'),
    vang(getDpiOverzicht(), 'dpi'),
    vang(getRaadOverzicht(), 'raad'),
    vang(getWoonDossier(), 'dossier'),
    vang(getWoningvoorraad(), 'cbs voorraad'),
    vang(getEigendom(), 'cbs eigendom'),
    vang(getBouwvergunningen(), 'cbs bouwvergunningen'),
  ])

  // ── Aandachtspunten: wat er de komende weken op het bureau ligt ──────────
  const punten: { status: Status; statusTekst?: string; titel: React.ReactNode; waarom?: React.ReactNode; datum?: string; sorteer: string }[] = []

  if (lijst.ok) {
    const verlopen = lijst.data.lopend.filter((a) => a.dagenTotTermijn < 0 && (a.woningen !== null || a.themas.includes('woningtoevoeging') || a.themas.includes('nieuwbouw')))
    for (const a of verlopen.slice(0, 5)) {
      punten.push({
        status: 'ernst', statusTekst: 'termijn',
        titel: <Extern href={a.url}>{a.titel}</Extern>,
        waarom: `Aanvraag van ${formatDate(a.datum)}, ${a.dagenOpen} dagen open: de beslistermijn van acht weken is ${-a.dagenTotTermijn} dagen verstreken zonder gepubliceerd besluit of verlenging op dit adres.`,
        sorteer: a.datum,
      })
    }
    const grens60 = sinds(60)
    for (const p of lijst.data.projecten.filter((p) => p.datum >= grens60).slice(0, 5)) {
      punten.push({
        status: 'info', statusTekst: `${p.woningen} woningen`,
        titel: <Extern href={p.url}>{p.titel}</Extern>,
        waarom: `${SOORT_LABEL[p.soort]}${p.wijk ? ` · ${p.wijk}` : ''}; een project van vijf of meer woningen in de bekendmakingen.`,
        datum: formatDate(p.datum), sorteer: p.datum,
      })
    }
    const grens30 = sinds(30)
    // Geweigerde kapvergunningen horen bij groenbeleid, niet bij wonen.
    for (const w of lijst.data.items.filter((it) => it.soort === 'geweigerd' && it.datum >= grens30 && !it.themas.includes('kap')).slice(0, 4)) {
      punten.push({ status: 'let', statusTekst: 'geweigerd', titel: <Extern href={w.url}>{w.titel}</Extern>, waarom: 'Geweigerde omgevingsvergunning in de afgelopen 30 dagen; bezwaartermijn loopt zes weken na bekendmaking.', datum: formatDate(w.datum), sorteer: w.datum })
    }
  }
  if (raad.ok) {
    const grens45 = sinds(45)
    for (const s of raad.data.stukken.filter((s) => s.datum >= grens45)) {
      const bron = s.bron.replace('Raad Amersfoort — ', '')
      if (/Schriftelijke vragen/i.test(bron)) {
        punten.push({ status: 'info', statusTekst: 'raadsvraag', titel: <Extern href={s.url}>{s.titel}</Extern>, waarom: 'Schriftelijke vragen over wonen; het college beantwoordt ze binnen de termijn uit het reglement van orde.', datum: formatDate(s.datum), sorteer: s.datum })
      } else if (/Moties|Amendementen/i.test(bron)) {
        punten.push({ status: 'let', statusTekst: bron.toLowerCase().replace(/s$/, ''), titel: <Extern href={s.url}>{s.titel}</Extern>, waarom: `${bron} over wonen in de raad.`, datum: formatDate(s.datum), sorteer: s.datum })
      }
    }
    const grens60 = sinds(60)
    for (const r of raad.data.regels.filter((r) => r.datum >= grens60).slice(0, 3)) {
      punten.push({ status: 'info', statusTekst: 'regeling', titel: <Extern href={r.url}>{r.titel}</Extern>, waarom: 'Nieuwe of gewijzigde verordening, beleidsregel of besluit over wonen in het Gemeenteblad.', datum: formatDate(r.datum), sorteer: r.datum })
    }
  }
  if (dpi.ok) {
    for (const v of dpi.data.verschuivingen.filter((v) => v.huidige < v.vorige && /totaal/i.test(v.metric)).slice(0, 3)) {
      punten.push({
        status: 'let', statusTekst: 'bijgesteld',
        titel: <><strong>{v.naam}</strong> stelt de prognose voor {v.doeljaar} naar beneden bij: {nl(v.vorige)} → {nl(v.huidige)} zelfstandige woningen ({plusmin(v.huidige - v.vorige)}).</>,
        waarom: `Verschil tussen de dPi ${dpi.data.dpiJaar - 1} en dPi ${dpi.data.dpiJaar} voor hetzelfde doeljaar; zie het tabblad Corporaties.`,
        sorteer: '0000',
      })
    }
  }
  if (voorraad.ok && voorraad.data.ditJaar.totMaand > 0) {
    const d = voorraad.data.ditJaar
    const naarRato = Math.round((WONINGBOUWDOEL_PER_JAAR * d.totMaand) / 12)
    const opKoers = d.saldo >= naarRato
    punten.push({
      status: opKoers ? 'goed' : 'let', statusTekst: opKoers ? 'op koers' : 'achter',
      titel: <>Woningvoorraad groeide in {d.jaar} tot en met {maandNaam(d.totMaand)} met <strong>{nl(d.saldo)}</strong> woningen ({nl(d.nieuwbouw)} nieuwbouw, {nl(d.toevoegingen)} toevoegingen); naar rato van 1.000 per jaar hoorde dat {nl(naarRato)} te zijn.</>,
      waarom: `Vorig jaar in dezelfde maanden: ${plusmin(voorraad.data.vorigJaarTotMaand.saldo)}. CBS-cijfers over de laatste maanden kunnen nog worden bijgesteld.`,
      sorteer: '9999',
    })
  }
  punten.sort((a, b) => (a.status === 'ernst' ? -1 : b.status === 'ernst' ? 1 : b.sorteer.localeCompare(a.sorteer)))

  // ── Doelen tegen realisatie ─────────────────────────────────────────────
  const laatsteVolJaar = voorraad.ok ? voorraad.data.perJaar[voorraad.data.perJaar.length - 1] : null
  const corporatieGroei = eigendom.ok && eigendom.data.length >= 2
    ? { jaar: eigendom.data[eigendom.data.length - 1].jaar, groei: eigendom.data[eigendom.data.length - 1].corporatie - eigendom.data[eigendom.data.length - 2].corporatie }
    : null
  const huurAandeel = bouwvergunningen.ok
    ? (() => { const vol = bouwvergunningen.data.perJaar.filter((j) => j.volledig); const j = vol[vol.length - 1]; return j && j.totaal > 0 ? { jaar: j.jaar, pct: (j.huur / j.totaal) * 100, totaal: j.totaal } : null })()
    : null

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Wat vraagt aandacht</h2>
          <p>
            Lopende termijnen, nieuwe raadsstukken, grotere bouwplannen en bijgestelde corporatieplannen uit openbare bronnen,
            afgezet tegen de CBS-cijfers en de woningbouwdoelen. Alles is herleidbaar naar de bron; de tabbladen geven de details.
          </p>
        </div>
      </div>

      <div className="bd-tegels">
        {voorraad.ok && (() => {
          const v = voorraad.data
          const laatste = v.maanden[v.maanden.length - 1]
          return (
            <>
              <Tegel getal={laatste?.eind ?? 0} label="woningen in Amersfoort" toelichting={`CBS, stand eind ${maandLabel(v.laatsteMaand)}`} delta={v.ditJaar.saldo} deltaLabel={`saldo sinds 1 januari ${v.ditJaar.jaar}`} />
              <Tegel getal={v.ditJaar.nieuwbouw} label={`nieuwbouw gereed in ${v.ditJaar.jaar}`} toelichting={`t/m ${maandNaam(v.ditJaar.totMaand)}; vorig jaar zelfde periode ${nl(v.vorigJaarTotMaand.nieuwbouw)}`} delta={v.ditJaar.nieuwbouw - v.vorigJaarTotMaand.nieuwbouw} deltaLabel="verschil met dezelfde maanden vorig jaar" />
              <Tegel getal={v.ditJaar.gestart} label={`bouw gestart in ${v.ditJaar.jaar}`} toelichting={`t/m ${maandNaam(v.ditJaar.totMaand)}; vorig jaar zelfde periode ${nl(v.vorigJaarTotMaand.gestart)}`} delta={v.ditJaar.gestart - v.vorigJaarTotMaand.gestart} deltaLabel="verschil met dezelfde maanden vorig jaar" />
            </>
          )
        })()}
        {vergunningen.ok && (
          <>
            <Tegel getal={vergunningen.data.laatste30.aanvraag} label="aanvragen ontvangen" toelichting="omgevingsvergunningen, afgelopen 30 dagen" />
            <Tegel getal={vergunningen.data.laatste30.verleend} label="vergunningen verleend" toelichting="afgelopen 30 dagen" />
          </>
        )}
        {lijst.ok && (
          <Tegel getal={lijst.data.lopend.filter((a) => a.dagenTotTermijn < 0).length} label="aanvragen over de termijn" toelichting="ontvangen aanvragen zonder gepubliceerd besluit na acht weken (indicatief)" />
        )}
        {eigendom.ok && eigendom.data.length > 0 && (
          <Tegel getal={eigendom.data[eigendom.data.length - 1].corporatie} label="corporatiewoningen" toelichting={`CBS, 1 januari ${eigendom.data[eigendom.data.length - 1].jaar}`} delta={corporatieGroei?.groei ?? null} deltaLabel="verschil met een jaar eerder" />
        )}
      </div>

      <div className="bd-raster">
        <Kaart titel="Aandachtspunten" breed={8} sub="afgeleid uit de bronnen, gesorteerd op urgentie en datum" kinderen={
          <>
            {!lijst.ok && !raad.ok ? <Onbeschikbaar u={lijst.ok ? raad as { geblokkeerd: boolean } : lijst} /> : <Aandacht punten={punten.slice(0, 18)} />}
          </>
        } voet="Termijnen zijn afgeleid van de publicatiedatum en de wettelijke beslistermijn van acht weken (Omgevingswet, reguliere procedure). Een verlenging of besluit dat nog niet is gepubliceerd, of een aanvraag zonder herkenbaar adres, kan ontbreken." />

        <Kaart titel="Doelen en realisatie" breed={4} sub="beleid tegen CBS" kinderen={
          <div>
            {laatsteVolJaar && (
              <div className="bd-doel">
                <div className="bd-doel-naam">Woningen erbij in {laatsteVolJaar.jaar}<span>Deltaplan: 1.000 per jaar tot 2030</span></div>
                <Meter waarde={laatsteVolJaar.saldo} doel={WONINGBOUWDOEL_PER_JAAR} label={`Saldo voorraad ${laatsteVolJaar.jaar}: ${nl(laatsteVolJaar.nieuwbouw)} nieuwbouw, ${nl(laatsteVolJaar.toevoegingen)} toevoegingen, ${nl(laatsteVolJaar.sloop + laatsteVolJaar.onttrekkingen)} sloop en onttrekkingen`} />
              </div>
            )}
            {voorraad.ok && voorraad.data.ditJaar.totMaand > 0 && (
              <div className="bd-doel">
                <div className="bd-doel-naam">Woningen erbij in {voorraad.data.ditJaar.jaar} t/m {maandNaam(voorraad.data.ditJaar.totMaand)}<span>naar rato van 1.000 per jaar</span></div>
                <Meter waarde={voorraad.data.ditJaar.saldo} doel={Math.round((WONINGBOUWDOEL_PER_JAAR * voorraad.data.ditJaar.totMaand) / 12)} />
              </div>
            )}
            {corporatieGroei && (
              <div className="bd-doel">
                <div className="bd-doel-naam">Corporatiebezit erbij, {corporatieGroei.jaar - 1}–{corporatieGroei.jaar}<span>Deltaplan: 350 sociale huur per jaar; netto bezit is een benadering</span></div>
                <Meter waarde={Math.max(0, corporatieGroei.groei)} doel={SOCIALE_HUUR_DOEL_PER_JAAR} label={`Netto verandering corporatiebezit: ${plusmin(corporatieGroei.groei)}`} />
              </div>
            )}
            {huurAandeel && (
              <div className="bd-doel">
                <div className="bd-doel-naam">Huur in vergunde nieuwbouw {huurAandeel.jaar}<span>Woondeal: twee derde betaalbaar vanaf 2025</span></div>
                <Meter waarde={Math.round(huurAandeel.pct)} doel={67} formatteer={(v) => pct(v)} label={`${nl(huurAandeel.totaal)} vergunde nieuwbouwwoningen in ${huurAandeel.jaar}; huur omvat ook vrije sector`} />
              </div>
            )}
            <p className="bd-kaart-voet">
              Doelen uit {BELEIDSDOELEN.filter((d) => d.status === 'vastgesteld').length} vastgestelde stukken; bronnen op het tabblad <Link href="/beleidsadviseur/raad">Raad en beleid</Link>.
              Het CBS telt geen sociale huur apart; corporatiebezit en huur-koop in vergunningen zijn de dichtstbijzijnde benadering.
            </p>
          </div>
        } />

        <Kaart titel="Omgevingsvergunningen per maand" breed={6} sub="Gemeenteblad Amersfoort" kinderen={
          vergunningen.ok ? (
            <Kolommen
              labels={vergunningen.data.perMaand.map((m) => maandLabel(m.maand))}
              reeksen={[
                { label: 'aanvraag ontvangen', klasse: 's1', waarden: vergunningen.data.perMaand.map((m) => m.aanvraag) },
                { label: 'verleend', klasse: 's2', waarden: vergunningen.data.perMaand.map((m) => m.verleend) },
                { label: 'overige besluiten', klasse: 'rest', waarden: vergunningen.data.perMaand.map((m) => m.overig) },
              ]}
            />
          ) : <Onbeschikbaar u={vergunningen} />
        } voet={<>Alle omgevingsvergunningen, ook niet-woonbouw. De laatste maand is nog niet vol. Details en filters: <Link href="/beleidsadviseur/vergunningen">Vergunningen</Link>.</>} />

        <Kaart titel="Nieuwbouw gereed per maand" breed={6} sub="CBS, laatste 24 maanden" kinderen={
          voorraad.ok ? (
            <Kolommen
              labels={voorraad.data.maanden.map((m) => maandLabel(m.maand))}
              reeksen={[
                { label: 'nieuwbouw gereed', klasse: 's1', waarden: voorraad.data.maanden.map((m) => m.nieuwbouw) },
                { label: 'overige toevoegingen', klasse: 's3', waarden: voorraad.data.maanden.map((m) => m.toevoegingen) },
              ]}
            />
          ) : <Onbeschikbaar u={voorraad} />
        } voet={<>Toevoegingen zijn splitsingen, transformaties en andere niet-nieuwbouw. Jaarreeks, sloop en bouwvergunningen: <Link href="/beleidsadviseur/woningmarkt">Woningmarkt</Link>.</>} />

        <Kaart titel="Laatste feiten in het woondossier" breed={12} sub="officieel of bevestigd" kinderen={
          dossier.ok ? (
            <ul className="bd-lijst">
              {dossier.data.feiten.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <span className="bd-datum">{f.datum ? formatDate(f.datum) : 'zonder datum'}</span>
                  <span className="bd-inhoud">
                    <strong>{f.titel}</strong>
                    {f.details && <span className="bd-details">{f.details}</span>}
                    <span className="bd-meta">
                      {f.locatie && <span>{f.locatie}</span>}
                      <span>{f.fact_type}</span>
                      {f.dossier_slug !== 'woningbouw-wonen' && <span>dossier {f.dossier}</span>}
                      {f.primaire_bron_url && <a href={f.primaire_bron_url} target="_blank" rel="noopener noreferrer">bron</a>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <Onbeschikbaar u={dossier} />
        } voet={<>Het volledige dossier met aanpalende dossiers staat onder <Link href="/beleidsadviseur/raad">Raad en beleid</Link>.</>} />
      </div>
    </main>
  )
}
