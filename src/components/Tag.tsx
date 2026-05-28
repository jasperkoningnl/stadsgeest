import Link from 'next/link'
import { TAG_COLORS } from '@/lib/utils'

interface Props {
  name: string
  slug?: string
}

export default function Tag({ name, slug }: Props) {
  const c = TAG_COLORS[name] || '#6a6a7a'
  const style = {
    background: c + '22',
    color: c,
    border: `1px solid ${c}44`,
  }

  if (slug) {
    return (
      <Link href={`/tag/${slug}`} className="tag" style={style}>
        {name}
      </Link>
    )
  }

  return (
    <span className="tag" style={style}>
      {name}
    </span>
  )
}
