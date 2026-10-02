import Link from 'next/link'

// Tabs op een dossierpagina: de feiten, de tips die eruit voortkwamen en de
// graaf van partijen. Deelbaar via de URL, net als de filters.
export default function DossierTabs({ slug, actief, tips }: { slug: string; actief: 'feiten' | 'tips' | 'graaf'; tips?: number }) {
  const basis = `/nieuwsplein33/dossiers/${slug}`
  const tab = (id: 'feiten' | 'tips' | 'graaf', href: string, label: React.ReactNode) => (
    <Link href={href} className={actief === id ? 'np-dos-tab np-dos-tab-actief' : 'np-dos-tab'} aria-current={actief === id ? 'page' : undefined}>
      {label}
    </Link>
  )
  return (
    <nav className="np-dos-tabs" aria-label="Onderdelen van dit dossier">
      {tab('feiten', basis, 'Feiten')}
      {tab('tips', `${basis}/tips`, <>Tips{tips !== undefined && tips > 0 && <span className="np-tab-tel">{tips}</span>}</>)}
      {tab('graaf', `${basis}/graaf`, 'Graaf')}
    </nav>
  )
}
