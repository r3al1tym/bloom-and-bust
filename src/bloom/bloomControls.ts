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
  bloomThreshold: 0.9,
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

// Plain store (no actions) — leva pushes whole-object updates via setState; readers subscribe to the
// slices they need, and per-frame loops use getState() to avoid re-rendering React on every tick.
export const useBloomControls = create<BloomControlsState>(() => ({
  ...BLOOM_DEFAULTS,
  freeze: false,
  camStart: null,
  camEnd: null,
  replayNonce: 0,
}))
