'use client'
import { useState } from 'react'

export default function ShareButtons({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: silent fail
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
      <button
        onClick={copyLink}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: '1px solid var(--border)',
          color: copied ? 'var(--accent)' : 'var(--t3)',
          borderColor: copied ? 'var(--accent)' : 'var(--border)',
          padding: '6px 12px', borderRadius: 9999,
          fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'all .15s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="4" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M4 4V2.5A1 1 0 0 1 5 1.5h5.5A1 1 0 0 1 11.5 2.5V8A1 1 0 0 1 10.5 9H9" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        {copied ? 'Gekopieerd!' : 'Kopieer link'}
      </button>

      <a
        href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: '1px solid var(--border)',
          color: 'var(--t3)', padding: '6px 12px', borderRadius: 9999,
          fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500,
          textDecoration: 'none', transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--t2)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1.5" y="3" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M1.5 4.5 L6.5 7.5 L11.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        E-mail
      </a>

      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: '1px solid var(--border)',
          color: 'var(--t3)', padding: '6px 12px', borderRadius: 9999,
          fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500,
          textDecoration: 'none', transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--t2)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M1 1.5 L5.5 7 L1 11.5H2.5L6.2 8 L9.5 11.5H12L7.3 5.7 L11.5 1.5H10L6.6 4.5 L3.5 1.5Z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round"/>
        </svg>
        Delen
      </a>
    </div>
  )
}
