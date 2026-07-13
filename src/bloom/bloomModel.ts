// Pure anatomy for the BLOOM — turns a fisheries Stock[] into a BloomSpec[]: one jellyfish per
// fish stock whose body parts ARE the catch record. No React, no three.js, no store — kept pure so
// the data→anatomy mapping is trivially testable and can never drift from the real fields.
//
// This is the SEVER point. The v2 "Thinking Medusa" visual layer (Jellyfish/shaders/geometry/
// atmosphere) consumes a BloomSpec and nothing else. Originally that spec was built from a
// pace-engine RecordView; here it is built from Sea Around Us catch data. The BloomSpec interface
// is preserved verbatim so every downstream visual term works unchanged — only the meaning behind
// each channel is rebound to the ocean.
//
// HONESTY: every anatomical measure maps to a REAL field. A quantity the data doesn't carry gets
// NO body part — named out-of-frame in the legend, never faked.
import type { Stock, Fate } from '@/data/bloom'
import { FATE_COLOR } from '@/data/bloom'

// Seven tentacles = the seven decades 1950s→2010s. (Was: the seven pipeline gates.)
export const STAGE_COUNT = 7

/** Vitality drives the bell's pulse + baseline glow. Mapped 1:1 from the stock's fate so the
 *  visual "mood" language of the original renderer carries over intact:
 *   thriving → sealed  (slow, confident, muscular breath — the hero profile)
 *   declining → flutter (anxious, fast flicker)
 *   collapsed → dim    (stalled, a held breath)
 *   husk → husk        (barely moving, near-dark) */
export type Vitality = 'sealed' | 'flutter' | 'dim' | 'husk'

const VITALITY_OF: Record<Fate, Vitality> = {
  thriving: 'sealed',
  declining: 'flutter',
  collapsed: 'dim',
  husk: 'husk',
}

export interface TentacleSpec {
  /** Decade label, e.g. "1970s". */
  stage: string
  color: string
  /** Severed from the decade the stock collapsed — this decade and every one after render as stubs. */
  severed: boolean
}

export interface ArmSpec {
  head: string
  confidence: number
  advisory: boolean
  color: string
}

// The BloomSpec interface consumed by the visual layer — preserved verbatim from v2. Fields that
// carry no fisheries meaning are set to honest neutral values (see buildBloom).
export interface BloomSpec {
  id: string
  title: string
  tier: string
  bellRadius: number
  /** This-decade survival (0.34..1): the whole creature is scaled by it so the tank visibly thins as
   *  stocks collapse. Applied as a smooth group scale in Jellyfish, not baked into the geometry. */
  decadeScale: number
  /** Death descent 0..1 (0 healthy → 1 husk): Jellyfish drifts the creature DOWN into the dark and
   *  dims it by this, so a collapsing stock slowly sinks and loses life rather than shrinking in place. */
  sink: number
  /** Steady inner glow 0..1. Here: how close the stock is to its historical peak (thriving = 1). */
  glow: number
  vitality: Vitality
  /** Two-tone split — lit industrial vs small-scale fleet. (Was engineering vs experience.) */
  engWeight: number
  expWeight: number
  grade: string | null
  bar: string | null
  bellColor: string
  /** Luminous tank hue for the dark medium — the semantic fate color. */
  tankColor: string
  /** Baseline self-glow 0..1 from vitality — a thriving stock shines, a husk goes near-dark. */
  alive: number
  /** Seven tentacles ← the seven decades, severed from the collapse decade. */
  tentacles: TentacleSpec[]
  /** Oral arms ← reporting integrity. Length ← reported share. */
  arms: ArmSpec[]
  /** Stings ← discard share (dead bycatch), 0..~10 sparks. */
  stings: number
  needsSigner: boolean
  /** Motes — out of frame for fisheries (a stock produces no sub-artifacts). Always empty. */
  motes: { kind: string; count: number }[]
  scars: number
  completed: boolean
  haltStage: string
}

const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s']

// Luminous tank-tuned hue per fate (brightened for the dark water). Reuses the data-layer palette.
const TANK_TINT: Record<Fate, string> = {
  thriving: '#79e0a6',
  declining: '#f0c558',
  collapsed: '#ff7a52',
  husk: '#6b7a86',
}

/** Project a stock's state AS OF a CONTINUOUS decade position (0..6, fractional). The catch `now` is
 *  linearly interpolated between the two bracketing decade buckets so the scrubber/autoplay ages the
 *  bloom SMOOTHLY (no discrete jumps) — a stock's colour, glow, mass, and pulse all move continuously
 *  as the year advances. Peak is taken over the buckets seen so far (inclusive of the current partial
 *  one). Severance stays a DISCRETE decade event (a tentacle snapping is a moment, not a gradient), so
 *  it's computed on the integer decades already elapsed. At decade=6 this equals the committed status. */
export function stockAsOf(
  s: Stock,
  decade: number,
): { fate: Fate; severFrom: number; pctOfPeak: number; glow: number } {
  const n = s.byDecade.length - 1
  const d = Math.max(0, Math.min(n, decade))
  const lo = Math.floor(d)
  const hi = Math.min(n, lo + 1)
  const frac = d - lo
  const now = s.byDecade[lo] + (s.byDecade[hi] - s.byDecade[lo]) * frac // interpolated catch
  // peak over everything seen up to (and including the fraction of) the current position
  let peak = 1
  for (let i = 0; i <= lo; i++) peak = Math.max(peak, s.byDecade[i])
  peak = Math.max(peak, now)
  const ratio = now / peak
  const atPeakNow = now >= peak - 1 // effectively still at/above its running peak
  const fate: Fate =
    atPeakNow || ratio >= 0.66
      ? 'thriving'
      : ratio >= 0.33
        ? 'declining'
        : ratio >= 0.1
          ? 'collapsed'
          : 'husk'
  // collapse point: first WHOLE decade elapsed after the peak that fell below a third of it. Discrete
  // on integer decades so the tentacle severs cleanly on a decade boundary, not mid-interpolation.
  const peakIdx = s.byDecade.slice(0, lo + 1).indexOf(Math.max(...s.byDecade.slice(0, lo + 1), 1))
  let severFrom = 7
  for (let i = peakIdx + 1; i <= lo; i++) {
    if (s.byDecade[i] < peak * 0.33) {
      severFrom = i
      break
    }
  }
  return { fate, severFrom, pctOfPeak: Math.round(ratio * 100), glow: Math.min(1, ratio) }
}

/** Build the BloomSpec[] for the whole tank as of a given decade (default: final, 2010s). */
export function buildBloom(stocks: Stock[], decade = 6): BloomSpec[] {
  return stocks.map((s) => {
    const { fate, severFrom, glow } = stockAsOf(s, decade)
    const hue = FATE_COLOR[fate]
    const tankColor = TANK_TINT[fate]

    // TEMPORAL MASS — the bell shrinks as the stock collapses. Cross-stock scale still reads (a big
    // stock is a big creature via s.size, log lifetime tonnage), but each bell is then scaled by how
    // much of its OWN peak survives at THIS decade (glow = now/peak). So scrubbing forward genuinely
    // EMPTIES the tank — a husk shrivels to ~a third of its peak footprint instead of hanging on as a
    // big recoloured dome. Floored at 0.34 so a collapsed stock still reads as a (small, dim) creature
    // rather than vanishing (vanishing would erase the datum). This is the change that makes the
    // collapse feel like loss, not a palette swap.
    const decadeScale = 0.34 + 0.66 * glow

    const tentacles: TentacleSpec[] = DECADES.map((d, i) => ({
      stage: d,
      color: hue,
      severed: i >= severFrom,
    }))

    // Oral arms ← reporting integrity: four arms, length scaled by how much catch reached the books.
    // (The original's advisory/gating head distinction has no fisheries analogue → all solid.)
    const arms: ArmSpec[] = Array.from({ length: 4 }, (_, i) => ({
      head: `report-${i}`,
      confidence: s.reportedShare,
      advisory: false,
      color: hue,
    }))

    // SINK — a dying stock doesn't just shrink, it slowly loses buoyancy and drifts DOWN into the
    // dark. 0 while healthy, rising toward 1 as it collapses (shaped so a mild decline barely sinks
    // but a husk sinks deep). Applied as a downward Y offset + extra dimming in Jellyfish, so the
    // graveyard literally settles into the depths over the arc. Continuous in glow → smooth descent.
    const sink = Math.pow(1 - glow, 1.7)

    // continuous vitality baseline (was the discrete ALIVE_OF[fate] step): a stock's self-glow fades
    // smoothly with its survival rather than snapping at the fate thresholds. 0.12 floor keeps a husk
    // faintly present; scales to ~0.9 at full peak.
    const alive = 0.12 + 0.78 * glow

    return {
      id: s.id,
      title: s.name,
      tier: s.group,
      bellRadius: 0.5 + s.size * 0.9, // log-tonnage lifetime mass → readable bell radius (geometry base)
      decadeScale, // this-decade survival multiplier — applied as a SMOOTH group scale (not geometry)
      sink, // 0..1 death descent — Jellyfish offsets Y downward + dims by this
      glow,
      vitality: VITALITY_OF[fate],
      engWeight: s.industrialShare, // two-tone: industrial vs small-scale fleet
      expWeight: 1 - s.industrialShare,
      grade: null,
      bar: null,
      bellColor: hue,
      tankColor,
      alive,
      tentacles,
      arms,
      stings: Math.round(s.discardShare * 10), // dead bycatch sparks
      needsSigner: false,
      motes: [], // out of frame — a fish stock produces no sub-artifacts
      scars: 0,
      completed: fate === 'thriving',
      haltStage: severFrom < 7 ? DECADES[severFrom] : DECADES[6],
    }
  })
}

/** The CONTINUOUS visual targets for a stock at a fractional decade position — everything the per-frame
 *  animation loop needs to age a creature smoothly, WITHOUT rebuilding a BloomSpec or re-rendering React.
 *  Jellyfish calls this each frame with the store's live decadeF and eases its uniforms toward the
 *  result, so colour/glow/mass/sink flow like water. Pure; no allocation beyond the small return. */
export interface StockVisuals {
  glow: number
  alive: number
  decadeScale: number
  sink: number
  /** fate hue + tank tint for THIS position (still bucketed to the 4 fates — the legend names four). */
  fate: Fate
  tankColor: string
}
export function visualsAsOf(s: Stock, decadeF: number): StockVisuals {
  const { fate, glow } = stockAsOf(s, decadeF)
  return {
    glow,
    alive: 0.12 + 0.78 * glow,
    decadeScale: 0.34 + 0.66 * glow,
    sink: Math.pow(1 - glow, 1.7),
    fate,
    tankColor: TANK_TINT[fate],
  }
}

/** Deterministic drift seed per creature so the bloom looks alive but is stable across reloads. */
export function driftSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h % 1000) / 1000
}
