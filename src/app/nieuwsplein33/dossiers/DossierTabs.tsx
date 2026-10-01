import Link from 'next/link'

// Tabs op een dossierpagina: de feiten en de graaf van partijen.
export default function DossierTabs({ slug, actief }: { slug: string; actief: 'feiten' | 'graaf' }) {
  const basis = `/nieuwsplein33/dossiers/${slug}`
  return (
    <nav className="np-dos-tabs" aria-label="Onderdelen van dit dossier">
      <Link href={basis} className={actief === 'feiten' ? 'np-dos-tab np-dos-tab-actief' : 'np-dos-tab'} aria-current={actief === 'feiten' ? 'page' : undefined}>Feiten</Link>
      <Link href={`${basis}/graaf`} className={actief === 'graaf' ? 'np-dos-tab np-dos-tab-actief' : 'np-dos-tab'} aria-current={actief === 'graaf' ? 'page' : undefined}>Graaf</Link>
    </nav>
  )
}
