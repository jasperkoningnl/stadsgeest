interface CitaatProps {
  quote: string
  attribution?: string
}

export default function Citaat({ quote, attribution }: CitaatProps) {
  return (
    <blockquote className="art-citaat">
      <p className="art-citaat-text">&ldquo;{quote}&rdquo;</p>
      {attribution && (
        <cite className="art-citaat-attr">— {attribution}</cite>
      )}
    </blockquote>
  )
}
