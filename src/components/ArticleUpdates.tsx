'use client'

import { useState } from 'react'
import PortableTextRenderer from './PortableTextRenderer'
import type { ArticleUpdate } from '@/types'

interface Props {
  updates: ArticleUpdate[]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default function ArticleUpdates({ updates }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (!updates || updates.length === 0) return null

  const sorted = [...updates].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  const latest = sorted[0]
  const rest = sorted.slice(1)

  return (
    <div style={{
      margin: '0 0 32px',
      borderLeft: '3px solid var(--accent)',
      background: 'var(--bg-raised)',
      borderRadius: '0 var(--r-md) var(--r-md) 0',
      padding: '14px 18px',
    }}>
      <div style={{
        fontFamily: 'var(--f-m)',
        fontSize: 11,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
        marginBottom: 8,
      }}>
        Bijgewerkt op {formatDate(latest.date)}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--t1)' }}>
        <PortableTextRenderer value={latest.text} />
      </div>

      {rest.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setExpanded((e: boolean) => !e)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--f-d)',
              fontSize: 13,
              color: 'var(--t2)',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
            >
              <path d="M5 7L1 3h8z" />
            </svg>
            {expanded ? 'Verberg eerdere updates' : `Bekijk alle updates (${updates.length})`}
          </button>

          {expanded && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {rest.map((u, i) => (
                <div key={i} style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <div style={{
                    fontFamily: 'var(--f-m)',
                    fontSize: 11,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--t2)',
                    marginBottom: 6,
                  }}>
                    {formatDate(u.date)}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--t1)' }}>
                    <PortableTextRenderer value={u.text} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
