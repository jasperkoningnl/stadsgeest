import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = [
  'AGENTS.md',
  'STATUS.md',
  'docs/INDEX.md',
  'docs/CURRENT.md',
  'docs/STAND.md',
  'docs/HANDOFFS/OPEN.md',
  'docs/PROJECT-OVERVIEW.md',
  'docs/ARCHITECTURE.md',
  'docs/SOURCES.md',
  'docs/EDITORIAL-PROFILE.md',
  'docs/EDITORIAL-LEARNING.md',
  'docs/TESTING.md',
  'docs/RUNBOOKS/operations.md',
  'docs/RUNBOOKS/incident-response.md',
  'docs/RUNBOOKS/deployment.md',
  'docs/PHASES/phase-3.md',
  'docs/PHASES/phase-4.md',
  'docs/PHASES/phase-5.md',
  'operations/WEGER.md',
]

const budgets = new Map([
  ['AGENTS.md', 450],
  ['docs/INDEX.md', 400],
  ['docs/CURRENT.md', 800],
  ['docs/HANDOFFS/OPEN.md', 700],
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

// Overdrachten staan per ISO-week; open punten in OPEN.md. Geen maandbestanden meer.
const handoffDir = path.join(root, 'docs', 'HANDOFFS')
if (fs.existsSync(handoffDir)) {
  for (const name of fs.readdirSync(handoffDir)) {
    if (name !== 'OPEN.md' && !/^\d{4}-W\d{2}\.md$/.test(name)) {
      failures.push(`docs/HANDOFFS/${name}: verwacht OPEN.md of JJJJ-Www.md (ISO-week).`)
    }
  }
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

// Het woondashboard voor de beleidsadviseur wonen (/beleidsadviseur) mag nergens
// op het redactiedashboard /nieuwsplein33 genoemd worden, ook niet in het
// logboek dat daar getoond wordt. Zie docs/DECISIONS.md (2026-10-02).
const verbodenWoorden = [/woondashboard/i, /beleidsadviseur/i]
const bewaaktePaden = ['LOGBOEK.md', 'src/app/nieuwsplein33']

function tekstBestanden(target) {
  if (!fs.existsSync(target)) return []
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(target, entry.name)
    if (entry.isDirectory()) return tekstBestanden(absolute)
    return /\.(md|mdx|ts|tsx|js|jsx|json|css)$/.test(entry.name) ? [absolute] : []
  })
}

for (const relative of bewaaktePaden) {
  for (const file of tekstBestanden(path.join(root, relative))) {
    const regels = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    regels.forEach((regel, index) => {
      for (const woord of verbodenWoorden) {
        if (woord.test(regel)) {
          failures.push(
            `${path.relative(root, file)}:${index + 1} noemt het woondashboard (${woord.source}); dat mag niet op /nieuwsplein33.`,
          )
        }
      }
    })
  }
}

if (failures.length > 0) {
  console.error(`Documentatiecontrole mislukt:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Documentatiecontrole geslaagd: ${required.length} kernbestanden, lokale links en geen woondashboardverwijzing op /nieuwsplein33.`)
