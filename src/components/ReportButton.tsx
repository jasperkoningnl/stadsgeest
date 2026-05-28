'use client'

import { useState } from 'react'

interface Props {
  articleId: string
}

export default function ReportButton({ articleId }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleClose = () => {
    setIsOpen(false)
    setTimeout(() => { setText(''); setSent(false) }, 300)
  }

  const handleSend = async () => {
    if (!text.trim()) return
    setLoading(true)
    try {
      await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          message: text,
          sessionHash: Math.random().toString(36).substring(2),
        }),
      })
    } catch {
      // proceed to success state even on network error
    } finally {
      setLoading(false)
      setSent(true)
      setTimeout(handleClose, 1800)
    }
  }

  return (
    <>
      <button className="report-btn" onClick={() => setIsOpen(true)}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M6.5 1 L12 11 L1 11 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M6.5 5v3M6.5 9.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Klopt er iets niet?
      </button>

      {isOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <div className="modal-box">
            {sent ? (
              <>
                <div className="modal-title">Bedankt voor uw melding</div>
                <div className="modal-sub">
                  Uw opmerking is ontvangen. We nemen dit mee bij de beoordeling van dit artikel.
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">Klopt er iets niet?</div>
                <div className="modal-sub">
                  Laat ons weten wat er onjuist of onvolledig is. We streven ernaar elk artikel zo
                  accuraat mogelijk te houden.
                </div>
                <textarea
                  className="modal-ta"
                  placeholder="Beschrijf het probleem..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
                <div className="modal-foot">
                  <button className="btn btn-ghost" onClick={handleClose}>
                    Annuleren
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={!text.trim() || loading}
                  >
                    {loading ? 'Versturen...' : 'Versturen'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
