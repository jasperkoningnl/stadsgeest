import { client } from '@/lib/sanity'
import { articlesByPersonQuery, personBySlugQuery } from '@/lib/queries'
import type { Article, Person } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import { relativeTime } from '@/lib/utils'
import Tag from '@/components/Tag'
import { notFound } from 'next/navigation'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const person = await client.fetch<Person | null>(personBySlugQuery, { slug })
  if (!person) return { title: 'Persoon niet gevonden' }
  return {
    title: person.name,
    description: `Artikelen waarin ${person.name} wordt genoemd`,
  }
}

export default async function PersoonPage({ params }: Props) {
  const { slug } = await params
  const [person, articles] = await Promise.all([
    client.fetch<(Person & { articleCount?: number }) | null>(
      personBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    ),
    client.fetch<Article[]>(
      articlesByPersonQuery,
      { personSlug: slug },
      { next: { revalidate: 60 } }
    ),
  ])

  if (!person) notFound()

  return (
    <div className="wrap page-in">
      <div className="nbh-hdr">
        <div className="crumb">
          <Link href="/" className="crumb-link">Stadsgeest 033</Link>
          <span>›</span>
          <span>{person.name}</span>
        </div>
        <h1 className="nbh-title">{person.name}</h1>
        <p className="nbh-sub">
          {[person.role, person.orgName].filter(Boolean).join(' — ')}
        </p>
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
        <div className="empty-state mt8">
          Geen artikelen gevonden voor {person.name}.
        </div>
      )}
    </div>
  )
}
