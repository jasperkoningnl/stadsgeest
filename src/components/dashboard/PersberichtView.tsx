'use client'

import { useState } from 'react'
import {
  safeParseJsonArray,
  buildPressReleaseClipboardText,
  BETROUWBAARHEID_META,
  type PressReleaseFact,
  type PressReleaseSource,
} from '@/lib/dashboard/format'
import type { PressReleaseRow } from '@/lib/dashboard/queries'

interface Props {
  pressRelease: PressReleaseRow
}

export default function PersberichtView({ pressRelease: pr }: Props) {
  const [copied, setCopied] = useState(false)

  const facts = safeParseJsonArray<PressReleaseFact>(pr.facts)
  const questions = safeParseJsonArray<string>(pr.open_questions)
  const sources = safeParseJsonArray<PressReleaseSource>(pr.sources)
  const isTip = pr.type === 'tip'
  const betrouwbaarheid = pr.betrouwbaarheid ? BETROUWBAARHEID_META[pr.betrouwbaarheid] : null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPressReleaseClipboardText(pr))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Klembordtoegang kan door de browser geweigerd worden — dan blijft de knop gewoon klikbaar.
    }
  }

  return (
    <div className="dash-pr">
      {isTip && (
        <div className="dash-tip-banner">
          <span>Tip voor de redactie — halfharde vondst, geen persbureaubericht</span>
          {betrouwbaarheid && (
            <span className="dash-pill" style={{ background: `${betrouwbaarheid.color}22`, color: betrouwbaarheid.color }}>
              Betrouwbaarheid: {betrouwbaarheid.label}
            </span>
          )}
        </div>
      )}

      <button className="btn btn-primary dash-pr-copy" onClick={handleCopy} type="button">
        {copied ? 'Gekopieerd' : isTip ? 'Kopieer tip als platte tekst' : 'Kopieer als platte tekst'}
      </button>

      {pr.headline && <h3 className="dash-pr-headline">{pr.headline}</h3>}
      {pr.lead && <p className="dash-pr-lead">{pr.lead}</p>}
      {pr.body && (
        <div className="dash-pr-body">
          {pr.body.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
        </div>
      )}

      <div className="dash-pr-section">
        <div className="dash-pr-section-title">Feiten en bronnen</div>
        {facts ? (
          facts.length === 0 ? (
            <p className="dash-pr-empty">Geen feiten vastgelegd.</p>
          ) : (
            <ul className="dash-pr-facts">
              {facts.map((f, i) => (
                <li key={i}>
                  <span>{f.feit}</span>
                  {f.bron_naam && (
                    f.bron_url ? (
                      <a href={f.bron_url} target="_blank" rel="noopener noreferrer" className="dash-pr-fact-source">{f.bron_naam}</a>
                    ) : (
                      <span className="dash-pr-fact-source">{f.bron_naam}</span>
                    )
                  )}
                </li>
              ))}
            </ul>
          )
        ) : pr.facts ? (
          <pre className="dash-pr-raw">{pr.facts}</pre>
        ) : (
          <p className="dash-pr-empty">Geen feiten vastgelegd.</p>
        )}
      </div>

      <div className="dash-pr-section dash-pr-questions">
        <div className="dash-pr-section-title">Open vragen voor de redactie</div>
        {questions ? (
          questions.length === 0 ? (
            <p className="dash-pr-empty">Geen open vragen.</p>
          ) : (
            <ul>
              {questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          )
        ) : pr.open_questions ? (
          <pre className="dash-pr-raw">{pr.open_questions}</pre>
        ) : (
          <p className="dash-pr-empty">Geen open vragen.</p>
        )}
      </div>

      <div className="dash-pr-section">
        <div className="dash-pr-section-title">Bronnen</div>
        {sources ? (
          sources.length === 0 ? (
            <p className="dash-pr-empty">Geen bronnen vastgelegd.</p>
          ) : (
            <ul className="dash-pr-sources">
              {sources.map((s, i) => (
                <li key={i}>
                  {s.tier ? <span className="dash-tier-pill">T{s.tier}</span> : null}
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.naam}</a> : <span>{s.naam}</span>}
                </li>
              ))}
            </ul>
          )
        ) : pr.sources ? (
          <pre className="dash-pr-raw">{pr.sources}</pre>
        ) : (
          <p className="dash-pr-empty">Geen bronnen vastgelegd.</p>
        )}
      </div>
    </div>
  )
}
