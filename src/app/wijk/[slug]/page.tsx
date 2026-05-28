import { client } from '@/lib/sanity'
import { articlesByLocationQuery, locationBySlugQuery } from '@/lib/queries'
import type { Article, Location } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import { relativeTime } from '@/lib/utils'
import Tag from '@/components/Tag'
import { notFound } from 'next/navigation'

export const revalidate = 60

const OTHER_WIJKEN = [
  'Vathorst',
  'Soesterkwartier',
  'Centrum',
  'Amersfoort-West',
  'Hoogland',
  'Euterpeplein',
]

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const location = await client.fetch<Location | null>(locationBySlugQuery, { slug })
  if (!location) return { title: 'Wijk niet gevonden' }
  return {
    title: `Nieuws uit ${location.name}`,
    description: `Alle artikelen over ${location.name} — chronologisch, op basis van openbare bronnen.`,
  }
}

export default async function WijkPage({ params }: Props) {
  const { slug } = await params
  const [location, articles] = await Promise.all([
    client.fetch<Location | null>(
      locationBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    ),
    client.fetch<Article[]>(
      articlesByLocationQuery,
      { locationSlug: slug },
      { next: { revalidate: 60 } }
    ),
  ])

  if (!location) notFound()

  return (
    <div className="wrap page-in">
      <div className="nbh-hdr">
        <div className="crumb">
          <Link href="/" className="crumb-link">Stadsgeest 033</Link>
          <span>›</span>
          <span className="crumb-link">Wijken</span>
          <span>›</span>
          <span>{location.name}</span>
        </div>
        <h1 className="nbh-title">Nieuws uit {location.name}</h1>
        <p className="nbh-sub">
          Alle artikelen over {location.name} — chronologisch, op basis van openbare bronnen.
        </p>

        {/* Map placeholder */}
        <div className="map-ph">
          <svg
            width="100%"
            height="200"
            viewBox="0 0 700 200"
            preserveAspectRatio="xMidYMid slice"
          >
            <rect width="700" height="200" fill="#1a1c23" />
            {[40, 80, 120, 160].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="700" y2={y} stroke="#252830" strokeWidth="1" />
            ))}
            {[100, 200, 300, 400, 500, 600].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2="200" stroke="#252830" strokeWidth="1" />
            ))}
            <path
              d="M0 160 Q150 130 280 80 Q380 40 500 20 L700 10"
              stroke="#252830"
              strokeWidth="2.5"
              fill="none"
            />
            <polygon
              points="180,30 480,30 520,170 140,170"
              fill="rgba(26,154,170,.1)"
              stroke="rgba(26,154,170,.35)"
              strokeWidth="1.5"
            />
            <text
              x="330"
              y="108"
              textAnchor="middle"
              fill="#1a9aaa"
              fontFamily="monospace"
              fontSize="13"
              opacity="0.8"
            >
              {location.name}
            </text>
            <text
              x="330"
              y="126"
              textAnchor="middle"
              fill="#56544f"
              fontFamily="monospace"
              fontSize="11"
            >
              kaartweergave (placeholder)
            </text>
          </svg>
        </div>
      </div>

      <div className="sec-head mt24">
        <span className="sec-label">
          {articles.length} artikel{articles.length !== 1 ? 'en' : ''}
        </span>
      </div>

      {articles.length > 0 ? (
        <div className="art-list mt8">
          {articles.map((a) => (
            <Link key={a._id} href={`/artikel/${a.slug.current}`} className="art-list-item">
              <div className="art-list-body">
                <div className="art-list-title">{a.title}</div>
                {a.lead && <div className="art-list-lead">{a.lead}</div>}
                <div className="art-list-meta">
                  <span>{relativeTime(a.publishedAt)}</span>
                  {a.tags?.slice(0, 1).map((t) => (
                    <Tag key={t.slug.current} name={t.name} />
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state mt8">Nog geen artikelen gevonden voor deze wijk.</div>
      )}

      {/* Other neighborhoods */}
      <div className="sec-head mt40">
        <span className="sec-label">Andere wijken</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {OTHER_WIJKEN.filter((w) => w.toLowerCase() !== location.name.toLowerCase()).map((w) => (
          <Link
            key={w}
            href={`/wijk/${w.toLowerCase().replace(/\s+/g, '-')}`}
            className="ent-chip"
          >
            {w}
          </Link>
        ))}
      </div>
    </div>
  )
}
