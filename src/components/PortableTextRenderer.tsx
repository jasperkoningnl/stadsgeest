import { PortableText, type PortableTextComponents } from '@portabletext/react'

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:']

function sanitizeUrl(href: string | undefined): string {
  if (!href) return '#'
  try {
    const url = new URL(href)
    return SAFE_SCHEMES.includes(url.protocol) ? href : '#'
  } catch {
    // Relative URLs (no protocol) are allowed
    return href.startsWith('/') || href.startsWith('#') ? href : '#'
  }
}

const components: PortableTextComponents = {
  block: {
    h2: ({ children }) => <h2>{children}</h2>,
    blockquote: ({ children }) => (
      <blockquote className="art-quote">
        <p className="art-quote-text">{children}</p>
      </blockquote>
    ),
  },
  marks: {
    sourceRef: ({ value, children }) => (
      <a
        href={sanitizeUrl(value?.source?.url)}
        className="source-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
    link: ({ value, children }) => (
      <a
        href={sanitizeUrl(value?.href)}
        className="source-link"
        target={value?.blank ? '_blank' : undefined}
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
  },
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any[]
}

export default function PortableTextRenderer({ value }: Props) {
  return <PortableText value={value} components={components} />
}
