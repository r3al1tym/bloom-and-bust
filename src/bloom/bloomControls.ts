// Live-tuning store for the Bloom renderer. A single source of truth the leva panel writes to and
// every layer reads from — postprocessing props (React render), shader uniforms (per-frame), and the
// camera-drift/water-speed loops (per-frame). Deep children read without prop drilling (per prefs).
//
// DEFAULTS must exactly match the values currently baked into the shaders/props so mounting the panel
// is a visual no-op — the panel starts where the scene already is. Multiplier knobs (glow/halo/drift)
// default to 1.0 = "leave as authored".
import { create } from 'zustand'

// A camera pose as OrbitControls spherical coords around the (fixed, origin) target. Pan is disabled
// so the target never moves — az/pol/rad fully describe a framing. Used to author the opening move.
export interface CamPose {
  az: number // azimuthal angle (rad) — orbit around Y
  pol: number // polar angle (rad) — SMALLER = higher / more top-down
  rad: number // distance from target
}

export interface BloomControlsState {
  // postprocessing
  bloomIntensity: number
  bloomThreshold: number
  bloomRadius: number
  grain: number
  vignette: number
  // scene
  waterSpeed: number // multiplier on the water shader clock
  fogDensity: number // exponential-squared fog density (glues depth)
  // per-jellyfish
  glowBoost: number // multiplier on bell interior + lantern emissive
  haloBoost: number // multiplier on the per-jelly halo opacity
  // camera
  driftSpeed: number // multiplier on the orbit frequencies
  driftAmount: number // multiplier on the orbit amplitudes
  // THE STORY CLOCK (NOT a visual default / reset target). Time is driven through the store so it can
  // flow CONTINUOUSLY at 60fps without re-rendering React every frame: App's rAF sweep (or the scrubber
  // drag) writes it, and the per-frame useFrame loops in Jellyfish/Atmosphere read it via getState().
  //   decadeF       — continuous decade position 0..6 (0 = 1950, 6 = 2018); Jellyfish interpolates each
  //                   stock's glow/mass/sink/colour along it, so the bloom ages like water, not in jumps.
  //   decadeProgress — decadeF/6 (0..1); god-rays, fog, and the warm plankton layer read it so the
  //                   LIGHT itself goes out as the fishery dies — "light as a clock".
  decadeF: number
  decadeProgress: number
  // AGGREGATE BLOOM LEVEL — the honest mean collapse across the 28 stocks at the live decadeF (mean of
  // 1 - visualsAsOf(stock, decadeF).glow, the exact per-creature `collapse` averaged). 0 in 1950,
  // ~0.62 in 2018 (the 2 survivors never fully fall). Written ONCE per frame by BloomRenderer's decade
  // effect, never per-creature. Read by story techniques via getState() in useFrame — NEVER a
  // subscription (a useBloomControls(s => s.bloomLevel) re-renders the whole scene every frame).
  bloomLevel: number
  // SCRIPTED TIPPING-POINT BEAT (technique #4) — the ONE documented exception to the scene's otherwise
  // pure f(clock, decadeF) reversibility. Driven from App.tsx's rAF loop (which owns the playhead): as
  // autoplay crosses BEAT_INFLECTION_DECADEF going FORWARD, an ~8s beat plays (fade→black→ignite→settle)
  // and RAMPS decadeF 2.6→6.0 through ignite+settle so the beat IS the climax that lands the 2018
  // end-state. beatActive gates the visual overrides; beatPhase names the sub-beat; beatT is 0..1 across
  // the whole beat. One-shot per forward crossing; re-arms on rewind/reset. Read via getState() only.
  beatActive: boolean
  beatT: number
  beatPhase: 'idle' | 'fade' | 'black' | 'ignite' | 'settle'
  // camera framing (NOT part of the visual defaults / reset — set live via the Framing panel):
  freeze: boolean // pause the auto-orbit so you can hand-compose a shot to capture
  camStart: CamPose | null // authored opening pose; null = derived arc-in default
  camEnd: CamPose | null // authored hero (settled) pose; null = derived default
  replayNonce: number // bump to restart the establishing move (preview the authored opening)
}

// The VISUAL defaults — exactly the look the share opens on. leva binds to these and `reset all`
// snaps back to them. Framing state (freeze/camStart/camEnd/replayNonce) is deliberately excluded:
// it's authoring scaffolding, not part of the baked look.
// NOTE: retuned from the origin project's single-hero defaults. That scene had ONE bright medusa in
// darkness; this bloom has ~28 lit stocks at once, so additive glow + halos stacked past the Bloom
// threshold and clipped the whole frame to white. Fix: much lower intensity/glow/halo and a higher
// luminance threshold so only the brightest bell CORES bloom — the drift stays legible as many
// distinct creatures, not one white cloud.
export const BLOOM_DEFAULTS = {
  bloomIntensity: 1.15,
  // 0.9→0.87: let the now-HDR neural fan feather (mipmapBlur gives the 1px canals apparent width).
  // Held above 0.86 as a white-clip guard — the brain gain (1.7) + clearer gel dome already push more
  // energy through, and the threshold was raised to 0.9 originally because 28 lit stocks clipped white.
  bloomThreshold: 0.87,
  bloomRadius: 0.85,
  grain: 0.45,
  vignette: 0.8,
  waterSpeed: 0.9,
  fogDensity: 0.11,
  glowBoost: 0.6,
  haloBoost: 0.5,
  driftSpeed: 1.0,
  driftAmount: 1.0,
} satisfies Partial<BloomControlsState>

// The live OrbitControls pose, written every frame from inside the Canvas (CameraPoseProbe) so the
// leva panel — which lives OUTSIDE the Canvas — can read the current framing to capture start/end
// poses without a React re-render. Plain mutable object on purpose (per-frame writes, no subscribers).
export const liveCamPose: CamPose = { az: 0, pol: 0, rad: 11 }

// ── SHARED STORY-CLOCK CONSTANTS (imported by the storytelling techniques) ──────────────────────────
// The aggregate bloomLevel never reaches 1 (mackerel + Norway lobster never fully collapse); divide by
// this observed 2018 endpoint for a clean 0..1 drive: min(1, bloomLevel / BLOOM_LEVEL_FULL).
export const BLOOM_LEVEL_FULL = 0.62
// The tipping-point beat (technique #4) fires as autoplay crosses this decadeF going FORWARD — ~1980,
// the sharpest single-decade aggregate collapse (running-mean glow 0.922→0.719, the largest 7-decade drop).
export const BEAT_INFLECTION_DECADEF = 2.6
export const BEAT_ARM_BELOW = 2.0 // re-arms once decadeF rewinds below this (hysteresis vs re-firing)
// Beat sub-phase durations (seconds): fade→black→ignite→settle. decadeF ramps 2.6→6.0 across ignite+settle.
export const BEAT_FADE_S = 1.4
export const BEAT_BLACK_S = 1.1
export const BEAT_IGNITE_S = 2.8
export const BEAT_SETTLE_S = 2.7 // total ≈ 8.0s
export const BEAT_TOTAL_S = BEAT_FADE_S + BEAT_BLACK_S + BEAT_IGNITE_S + BEAT_SETTLE_S

// WORLD-DARKENING SHAPE — the single curve #1 (and the beat's steady-state hand-back) key off, so the
// god-rays, exposure, fills, and backdrop all fade together. Slightly late-biased (pow 1.15) so the
// 1950s-70s stay lit and the dark bites post-1990 as the sea empties. worldDarkness(0)===0 (the
// 1950-frame guarantee), worldDarkness(1)===1.
export const worldDarkness = (p: number): number => {
  const c = p < 0 ? 0 : p > 1 ? 1 : p
  return Math.pow(c, 1.15)
}

// #4 THE BEAT'S VISUAL ENVELOPE — maps the store's beat state to two scalars the renderer + Jellyfish
// read so the lights-out-then-ignite reads as ONE scripted event on top of the steady-state look:
//   dark   0..1 — extra darkness laid over worldDarkness: ramps up through 'fade', holds ~full in
//                 'black' (the sea's breath held), snaps back off through 'ignite', 0 in 'settle'/'idle'.
//   ignite 0..1 — a brief brightness/bloom LIFT right as the light returns (the black→ignite hinge),
//                 decaying across 'ignite' so the return reads as an ignition, not a fade-up.
export interface BeatEnvelope { dark: number; ignite: number }
export const beatEnvelope = (phase: BloomControlsState['beatPhase'], t: number): BeatEnvelope => {
  // t is 0..1 across the WHOLE beat; recover per-phase progress from the duration constants.
  const total = BEAT_TOTAL_S
  const s = t * total // elapsed seconds
  const tFade = BEAT_FADE_S
  const tBlack = BEAT_FADE_S + BEAT_BLACK_S
  const tIgnite = tBlack + BEAT_IGNITE_S
  switch (phase) {
    case 'fade': {
      const k = tFade > 0 ? s / tFade : 1 // 0→1 darkening
      return { dark: k * k, ignite: 0 } // ease-in to black
    }
    case 'black':
      return { dark: 1, ignite: 0 } // held dark
    case 'ignite': {
      const k = Math.min(1, (s - tBlack) / Math.max(0.0001, BEAT_IGNITE_S)) // 0→1 across ignite
      return { dark: 1 - k, ignite: (1 - k) * (1 - k) } // dark releases; a decaying flash of light
    }
    case 'settle': {
      const k = Math.min(1, (s - tIgnite) / Math.max(0.0001, BEAT_SETTLE_S))
      return { dark: 0, ignite: 0.15 * (1 - k) } // a last ember of the flash easing out
    }
    default:
      return { dark: 0, ignite: 0 }
  }
}

// Plain store (no actions) — leva pushes whole-object updates via setState; readers subscribe to the
// slices they need, and per-frame loops use getState() to avoid re-rendering React on every tick.
export const useBloomControls = create<BloomControlsState>(() => ({
  ...BLOOM_DEFAULTS,
  decadeF: 0,
  decadeProgress: 0,
  bloomLevel: 0,
  beatActive: false,
  beatT: 0,
  beatPhase: 'idle',
  freeze: false,
  camStart: null,
  camEnd: null,
  replayNonce: 0,
}))
