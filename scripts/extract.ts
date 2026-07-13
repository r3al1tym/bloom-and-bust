// Extraction pass — the ONE place this project touches AWS, and it needs no account.
//
// The AWS Registry of Open Data serves the Sea Around Us global fisheries catch bucket
// publicly over plain HTTPS. We stream the NE Atlantic (NEAFC) catch CSV, aggregate each
// species into a per-decade catch curve, and derive the handful of fields the renderer needs.
// The result is a small JSON committed to the repo, so cloning + `pnpm dev` needs nothing
// from AWS — the cloud is the data SOURCE, never a runtime dependency.
//
// Run: `pnpm extract` (writes public/data/bloom.json). Re-run only to refresh from source.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC =
  'https://fisheries-catch-data.s3.us-west-2.amazonaws.com/global-catch-data/csv/rfmo_12.csv'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'public', 'data', 'bloom.json')

// Seven decades → the seven tentacles. 1950–2018 buckets to 1950s…2010s.
const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'] as const
const decadeIdx = (year: number) => Math.min(6, Math.max(0, Math.floor((year - 1950) / 10)))

// A stock is one species aggregated across the whole region.
interface Agg {
  name: string
  scientific: string
  group: string
  byDecade: number[] // tonnes per decade (landings + discards)
  discards: number // tonnes thrown back dead
  reported: number // tonnes on the official books
  total: number
  industrial: number // tonnes from industrial fleets (vs small-scale)
}

const stocks = new Map<string, Agg>()

// Minimal RFC-4180 line parser (fields are quoted, some contain "&" / spaces but no embedded quotes).
function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

async function main() {
  console.log(`Streaming NEAFC catch from RODA (no credentials)…\n  ${SRC}`)
  const res = await fetch(SRC)
  if (!res.ok || !res.body) throw new Error(`fetch failed: ${res.status}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let header: string[] | null = null
  let rows = 0
  const col: Record<string, number> = {}

  const handle = (line: string) => {
    if (!line) return
    const f = parseLine(line)
    if (!header) {
      header = f
      header.forEach((h, i) => (col[h] = i))
      return
    }
    rows++
    const name = f[col.common_name]
    // Drop unidentified aggregates — they are noise, not a stock the eye can read.
    if (!name || /nei$|not identified|miscellaneous|^finfishes$|^marine fishes/i.test(name)) return
    const catch_ = parseFloat(f[col.catch_sum]) || 0
    if (catch_ <= 0) return
    const year = parseInt(f[col.year], 10)
    if (!Number.isFinite(year)) return

    let a = stocks.get(name)
    if (!a) {
      a = {
        name,
        scientific: f[col.scientific_name] || '',
        group: f[col.commercial_group] || '',
        byDecade: [0, 0, 0, 0, 0, 0, 0],
        discards: 0,
        reported: 0,
        total: 0,
        industrial: 0,
      }
      stocks.set(name, a)
    }
    a.byDecade[decadeIdx(year)] += catch_
    a.total += catch_
    if (f[col.catch_status] === 'Discards') a.discards += catch_
    if (f[col.reporting_status] === 'Reported') a.reported += catch_
    if (f[col.sector_type] === 'Industrial') a.industrial += catch_
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl).replace(/\r$/, ''))
      buf = buf.slice(nl + 1)
    }
  }
  handle(buf.replace(/\r$/, ''))
  console.log(`  scanned ${rows.toLocaleString()} rows → ${stocks.size} identified stocks`)

  // Keep the top stocks by lifetime tonnage — enough to fill a tank, few enough to read.
  const top = [...stocks.values()].sort((a, b) => b.total - a.total).slice(0, 28)

  // Peak decade tonnage across the whole set → normalizes bell size so the biggest bet is biggest.
  const maxTotal = Math.max(...top.map((s) => s.total))

  const out = top.map((s) => {
    const peakIdx = s.byDecade.indexOf(Math.max(...s.byDecade))
    const peak = s.byDecade[peakIdx]
    const last = s.byDecade[6]
    const ratio = peak > 0 ? last / peak : 0

    // Terminal fate vs the stock's own historical peak — the HUE.
    const status: Fate =
      peakIdx === 6 || ratio >= 0.66
        ? 'thriving'
        : ratio >= 0.33
          ? 'declining'
          : ratio >= 0.1
            ? 'collapsed'
            : 'husk'

    // Collapse point: first decade AFTER the peak where catch falls below a third of peak.
    // That decade and every one after it "sever" — the stock's timeline was cut short.
    let severFrom = 7 // none
    for (let i = peakIdx + 1; i < 7; i++) {
      if (s.byDecade[i] < peak * 0.33) {
        severFrom = i
        break
      }
    }

    return {
      id: slug(s.name),
      name: s.name,
      scientific: s.scientific,
      group: s.group,
      status,
      totalTonnes: Math.round(s.total),
      // 0..1 bell size on a log scale (tonnage spans orders of magnitude).
      size: Math.log10(s.total + 1) / Math.log10(maxTotal + 1),
      byDecade: s.byDecade.map((v) => Math.round(v)),
      peakDecade: DECADES[peakIdx],
      peakTonnes: Math.round(peak),
      lastTonnes: Math.round(last),
      pctOfPeak: Math.round(ratio * 100),
      severFrom, // tentacle index (0..6); 7 = intact
      reportedShare: s.total > 0 ? s.reported / s.total : 1, // oral-arm length
      discardShare: s.total > 0 ? s.discards / s.total : 0, // stings
      industrialShare: s.total > 0 ? s.industrial / s.total : 1, // two-tone split
    }
  })

  const payload = {
    source: 'Sea Around Us — Global Fisheries Catch (AWS Registry of Open Data)',
    sourceUrl: 'https://registry.opendata.aws/sau-global-fisheries-catch-data/',
    region: 'NEAFC — Northeast Atlantic',
    span: '1950–2018',
    decades: DECADES,
    generatedFrom: SRC,
    stocks: out,
  }
  await writeFile(OUT, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${out.length} stocks → public/data/bloom.json`)
  console.log('Collapsed/husk stocks:', out.filter((s) => s.status === 'collapsed' || s.status === 'husk').length)
}

type Fate = 'thriving' | 'declining' | 'collapsed' | 'husk'
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
