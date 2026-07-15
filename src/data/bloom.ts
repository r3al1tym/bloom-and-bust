// The data contract — a Stock is one named taxon aggregated across the NE Atlantic, 1950–2018.
// Produced by scripts/extract.ts from the Sea Around Us catch data on the AWS Registry of Open
// Data, then committed to public/data/bloom.json. The renderer OWNS no data and derives nothing
// about the pipeline — every visible part of a medusa maps to one field below.

export type Fate = 'thriving' | 'declining' | 'collapsed' | 'husk'

export interface Stock {
  id: string
  name: string
  scientific: string
  group: string
  status: Fate
  totalTonnes: number
  /** 0..1 bell size (log lifetime catch tonnage). */
  size: number
  /** Catch per decade, 1950s…2010s (seven buckets → seven tentacles). */
  byDecade: number[]
  peakDecade: string
  peakTonnes: number
  lastTonnes: number
  /** Last decade's catch as a % of the taxon's own observed peak. */
  pctOfPeak: number
  /** Tentacle index (0..6) from which the timeline severs; 7 = intact. */
  severFrom: number
  /** Share of catch on the official books (0..1) — oral-arm length. */
  reportedShare: number
  /** Share discarded dead (0..1) — the stings. */
  discardShare: number
  /** Share from industrial fleets vs small-scale (0..1) — the two-tone split. */
  industrialShare: number
}

export interface BloomData {
  source: string
  sourceUrl: string
  region: string
  span: string
  decades: string[]
  generatedFrom: string
  stocks: Stock[]
}

// Luminous tank hues for each fate — brightened so they read against deep water.
// Green thriving / gold declining / hot-coral collapsed / cold slate husk.
export const FATE_COLOR: Record<Fate, string> = {
  thriving: '#79e0a6',
  declining: '#f0c558',
  collapsed: '#ff7a52',
  husk: '#6b7a86',
}

export const FATE_LABEL: Record<Fate, string> = {
  thriving: 'near peak — catch is at least two-thirds of its observed peak',
  declining: 'below peak — catch is one-third to two-thirds of peak',
  collapsed: 'far below peak — catch is one-tenth to one-third of peak',
  husk: 'minimal catch — less than one-tenth of peak',
}

// Pulse behaviour by fate — the bell's "mood".
export const PULSE: Record<Fate, { rate: number; depth: number; alive: number }> = {
  thriving: { rate: 0.9, depth: 0.06, alive: 0.85 }, // slow, confident breathing
  declining: { rate: 2.4, depth: 0.13, alive: 0.6 }, // anxious flutter
  collapsed: { rate: 0.45, depth: 0.03, alive: 0.4 }, // barely moving
  husk: { rate: 0.15, depth: 0.015, alive: 0.12 }, // almost still
}

export async function loadBloom(): Promise<BloomData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/bloom.json`)
  if (!res.ok) throw new Error(`could not load bloom.json: ${res.status}`)
  return res.json()
}

// Deterministic per-creature drift seed so the bloom looks alive but is stable across reloads.
export function driftSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h % 1000) / 1000
}
