'use client'
import { useRouter } from 'next/navigation'

export default function BackButton() {
  const router = useRouter()

  const handleClick = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/nieuws')
    }
  }

  return (
    <button
      onClick={handleClick}
      className="back-btn"
      aria-label="Terug naar vorige pagina"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--t3)',
        padding: '0 0 16px', transition: 'color .15s',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M9 2 L4 7 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Terug
    </button>
  )
}
