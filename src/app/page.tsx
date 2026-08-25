import type { Metadata } from 'next'
import { IconDoorzoeken, IconWegen, IconDoorgeven } from '@/components/HomeIcons'
import HomeTrechter from '@/components/HomeTrechter'

export const metadata: Metadata = {
  title: 'Stadsgeest — persbureau voor lokale journalistiek',
  description:
    'Stadsgeest doorzoekt dagelijks honderden openbare bronnen op zoek naar lokaal nieuws dat blijft liggen, en levert de vondsten aan lokale redacties.',
  alternates: { canonical: '/' },
}

const STAPPEN = [
  {
    nr: '01',
    kop: 'Doorzoeken',
    icoon: IconDoorzoeken,
    tekst:
      'Elke dag komen ruim honderd openbare bronnen binnen: raadsstukken, officiële bekendmakingen, vergunningen, subsidieregisters, rechtspraak, aanbestedingen, inspectierapporten, jaarverslagen.',
  },
  {
    nr: '02',
    kop: 'Wegen',
    icoon: IconWegen,
    tekst:
      'Wat binnenkomt wordt geclusterd tot signalen en beoordeeld op nieuwswaarde. Hoeveel onafhankelijke bronnen bevestigen het? Is het eerder gemeld? Verreweg het meeste valt af.',
  },
  {
    nr: '03',
    kop: 'Doorgeven',
    icoon: IconDoorgeven,
    tekst:
      'Wat overblijft komt in een dashboard voor de redactie: het signaal, de brondocumenten, de achtergrond en de vragen die nog open staan. Geen kant-en-klaar artikel — een startpunt.',
  },
]

export default function Home() {
  return (
    <main className="home">
      <div className="home-wrap">
        <header className="home-top">
          <span className="home-merk">
            STADSGEEST<span className="home-merk-accent">033</span>
          </span>
        </header>

        <section className="home-hero">
          <p className="home-eyebrow">Persbureau voor lokale journalistiek</p>
          <h1 className="home-titel">Het nieuws zit in stukken die niemand leest.</h1>
          <p className="home-lead">
            Stadsgeest doorzoekt dagelijks honderden openbare bronnen over Amersfoort, weegt wat er
            tussen zit, en levert de vondsten aan bij een redactie. Geen concurrent van lokale media,
            maar een leverancier — het werk waar op een redactie zelden tijd voor is.
          </p>
        </section>

        <HomeTrechter />

        <section className="home-stappen" aria-label="Hoe het werkt">
          {STAPPEN.map((s) => {
            const Icoon = s.icoon
            return (
              <article key={s.nr} className="home-stap">
                <div className="home-stap-top">
                  <Icoon className="home-stap-icoon" />
                  <span className="home-stap-nr">{s.nr}</span>
                </div>
                <h2 className="home-stap-kop">{s.kop}</h2>
                <p className="home-stap-tekst">{s.tekst}</p>
              </article>
            )
          })}
        </section>

        <section className="home-blok">
          <h2 className="home-blok-kop">Dit is een machine, en dat zeggen we erbij</h2>
          <div className="home-blok-tekst">
            <p>
              Het doorzoeken, clusteren en wegen gebeurt geautomatiseerd, met taalmodellen. Dat is
              waarom het kan: geen mens leest elke dag alle bekendmakingen van een gemeente. Het is
              ook waarom het niet af is.
            </p>
            <p>
              Een signaal uit Stadsgeest is een aanwijzing, geen bevestigd feit. Het systeem legt
              verbanden die niet kloppen, mist context die een verslaggever meteen zou zien, en
              haalt met regelmaat een routinevergunning binnen alsof het nieuws is. Daarom staat bij
              elk signaal waar het vandaan komt en waarom het is doorgelaten, en daarom eindigt de
              keten bij een journalist die beslist of er een verhaal in zit.
            </p>
            <p>
              Wij publiceren zelf niet. Wat hier gevonden wordt, wordt geschreven en gecontroleerd
              door de redactie die het afneemt.
            </p>
          </div>
        </section>

        <section className="home-blok home-blok-contact">
          <h2 className="home-blok-kop">Voor redacties</h2>
          <div className="home-blok-tekst">
            <p>
              Stadsgeest draait op dit moment op Amersfoort en wordt beproefd met één redactie. De
              methode is niet aan die stad gebonden — waar openbare bronnen zijn, werkt hetzelfde
              principe.
            </p>
            <p>
              Werk je bij een lokale of regionale redactie en wil je weten wat dit voor jullie zou
              opleveren? Laat het weten.
            </p>
          </div>
          <a className="home-mail" href="mailto:stadsgeest@proton.me">
            stadsgeest@proton.me
          </a>
        </section>

        <footer className="home-voet">
          <p>Stadsgeest 033 — Amersfoort</p>
        </footer>
      </div>
    </main>
  )
}
