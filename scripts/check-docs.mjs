import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = [
  'AGENTS.md',
  'STATUS.md',
  'docs/INDEX.md',
  'docs/CURRENT.md',
  'docs/PROJECT-OVERVIEW.md',
  'docs/ARCHITECTURE.md',
  'docs/SOURCES.md',
  'docs/EDITORIAL-PROFILE.md',
  'docs/TESTING.md',
  'docs/RUNBOOKS/operations.md',
  'docs/RUNBOOKS/incident-response.md',
  'docs/RUNBOOKS/deployment.md',
  'docs/PHASES/phase-3.md',
  'operations/WEGER.md',
]

const budgets = new Map([
  ['AGENTS.md', 450],
  ['docs/INDEX.md', 400],
  ['docs/CURRENT.md', 800],
])

const failures = []

for (const relative of required) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) failures.push(`Ontbreekt: ${relative}`)
}

for (const [relative, maximum] of budgets) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) continue
  const count = fs.readFileSync(absolute, 'utf8').trim().split(/\s+/).filter(Boolean).length
  if (count > maximum) failures.push(`${relative} is ${count} woorden; maximum is ${maximum}.`)
}

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'HISTORY') return []
      return markdownFiles(absolute)
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : []
  })
}

const linkFiles = [path.join(root, 'AGENTS.md'), path.join(root, 'STATUS.md'), ...markdownFiles(path.join(root, 'docs'))]
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g
for (const file of linkFiles) {
  if (!fs.existsSync(file)) continue
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(markdownLink)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#', 1)[0]
    if (!target || /^(https?:|mailto:|#)/i.test(target)) continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(root, file)} verwijst naar ontbrekend bestand: ${target}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`Documentatiecontrole mislukt:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Documentatiecontrole geslaagd: ${required.length} kernbestanden en lokale links.`)
