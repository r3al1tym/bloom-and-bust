// The tank as a character: god-ray shafts, drifting marine snow, and a teal depth-haze. All
// additive at low alpha and always subordinate to the data — bloom is a strict semantic amplifier,
// so atmosphere can tint and soften the far creatures but never drowns the read.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeMarineSnow } from './bloomGeometry'
import { dotTexture } from './dotTexture'
import { useBloomControls } from './bloomControls'

// Two layers of suspended particulate for real depth-of-field payoff: a fine near layer (small,
// many, faster) and a coarse far layer (big, few, slow) that the DoF pass blurs into glowing bokeh
// orbs — the "motes catching the light in deep water" read.
function MarineSnow({
  count,
  size,
  color,
  opacity,
  driftY,
  spin,
  span,
  seed = 7,
  lowBias = false,
  fadeWithDecade = false,
}: {
  count: number
  size: number
  color: string
  opacity: number
  driftY: number
  spin: number
  span: number
  seed?: number
  lowBias?: boolean
  /** the warm living-water layer thins as the fishery dies (opacity × (1 − 0.5·decadeProgress)). */
  fadeWithDecade?: boolean
}) {
  const { positions, sizes } = useMemo(() => makeMarineSnow(count, seed, lowBias), [count, seed, lowBias])
  const ref = useRef<THREE.Points>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    // Decade-driven opacity. Kept as a standalone if (not fused with any grow-with-decade branch) so a
    // future rising-detritus layer can slot in as an else-if without clobbering this fade.
    if (fadeWithDecade && mat.current) {
      const p = useBloomControls.getState().decadeProgress
      // Warm living-water thins EARLY — shared warmth clock, lingering just past the god-ray warmth:
      // smoothstep(p, 0, 0.5) → full in the 50s, gone by decadeF≈3. (Steeper than the old linear
      // 1−0.5·p, which still showed ~50% amber at the collapse; the water should read cold by then.)
      mat.current.opacity = opacity * (1 - THREE.MathUtils.smoothstep(p, 0.0, 0.5))
    }
    // gentle TRANSLATION only — a slow settling drift + a faint lateral sway. The old code ROTATED
    // the whole cloud on Y every frame (rotation.y = t*spin), which swept every point through a
    // circle: near points crossed pixels fast and, being sub-pixel additive with no MSAA, twinkled
    // hard across the whole frame — the "flickering/clipping" read. Translating instead keeps each
    // point's screen motion slow and coherent.
    // wrap over `span` in whichever direction driftY points (negative = rising plankton). JS `%` keeps
    // the sign of the dividend, so add `span` before the final mod to guarantee a [0,span) offset —
    // otherwise a negative driftY would jump instead of looping seamlessly.
    const off = (((t * driftY) % span) + span) % span
    ref.current.position.y = driftY >= 0 ? -off : off - span
    ref.current.position.x = Math.sin(t * spin * 6.0) * 0.4
  })
  return (
    <points ref={ref} renderOrder={0}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        color={color}
        size={size}
        sizeAttenuation
        map={dotTexture()}
        alphaTest={0.01}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// A distant shoal of small fish drifting in the back of the tank — the OTHER life the fishery held,
// present in the living early water and the first thing to vanish as it collapses. Deliberately an
// AGGREGATE: ~64 warm flecks read as one flock, never as N countable fish. Whole-cloud sum-of-sines
// TRANSLATION only (no rotation, no per-point jitter) so it can't twinkle without MSAA — same anti-
// flicker discipline as MarineSnow. Sits at z≈-11, just behind the backmost creature (~z=-10.5) and
// the ambient snow's z=-10 reach, with fog OFF (FogExp2 0.09→0.15 would erase it this deep) and
// renderOrder -45 + depthTest off so it composites BEHIND every medusa — an additive cloud must never
// paint over a back-row husk's bell. Recession comes from sizeAttenuation + dimness + the fade, not
// fog; a manual distance-dim replaces the recession the removed fog would have given.
function FishShoal() {
  const { positions, sizes } = useMemo(() => {
    const count = 64
    let s = 0x9e3779b9 // seeded so the flock is stable across scrubs/re-renders
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pos = new Float32Array(count * 3)
    const sz = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 22 // wide horizontal spread
      pos[i * 3 + 1] = (rnd() - 0.5) * 5 // FLAT band — a shoal, not a sphere
      pos[i * 3 + 2] = (rnd() - 0.5) * 3 // shallow depth jitter around the back plane
      sz[i] = 0.11 + rnd() * 0.06 // above the sub-pixel floor so flecks don't scintillate
    }
    return { positions: pos, sizes: sz }
  }, [])
  const ref = useRef<THREE.Points>(null)
  const mat = useRef<THREE.PointsMaterial>(null)
  const baseOpacity = 0.5
  useFrame((st) => {
    if (!ref.current) return
    const t = st.clock.elapsedTime
    // whole-cloud sum-of-sines drift: a slow lateral cruise + a gentle vertical bob, incommensurate
    // frequencies so the flock never visibly loops. Translation of the group only — each fleck's
    // screen motion stays slow and coherent (no per-point sweep → no twinkle).
    ref.current.position.set(
      Math.sin(t * 0.06) * 2.2 + Math.sin(t * 0.017) * 1.1,
      -1 + Math.sin(t * 0.043) * 0.6,
      -11 + Math.sin(t * 0.021) * 0.8,
    )
    if (mat.current) {
      const p = useBloomControls.getState().decadeProgress
      // TIGHT fade — the fish go FIRST, before the water's warmth: smoothstep(p, 0.05, 0.30) → full in
      // the earliest water, gone by decadeF≈1.8 (well before the collapse story). Read order across the
      // warmth layers is fish → god-light/warm-snow → (later) the medusae's own palette.
      const fishFade = 1 - THREE.MathUtils.smoothstep(p, 0.05, 0.3)
      // distance-dim: with fog off the shoal won't recede on its own if the establishing crane dollies
      // toward the back plane. camDist≈28 at rest (cam [0,1,17] → shoal z≈-11) pins this to 1.0 — full
      // strength at rest — and only softens if the camera pushes inside ~16u. Reproduces the fog it lost.
      const camDist = ref.current.position.distanceTo(st.camera.position)
      mat.current.opacity = baseOpacity * fishFade * THREE.MathUtils.smoothstep(camDist, 6, 16)
    }
  })
  return (
    <points ref={ref} renderOrder={-45}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        color="#f0b56a"
        size={0.13}
        sizeAttenuation
        map={dotTexture()}
        alphaTest={0.01}
        transparent
        opacity={baseOpacity}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export function Atmosphere() {
  return (
    <>
      {/* Surface light is carried by TankBackground and revealed by particulate. Large
          camera-facing ray quads were intentionally removed: their 36–44 unit transparent planes
          intersected the camera path and produced the hard, full-frame wedges seen during drift. */}
      {/* Suspended particulate — TRANSLATES gently (no rigid rotation). Sizes kept above sub-pixel so
          points don't twinkle without MSAA. Three layers now: a dense fine haze, coarse bokeh motes,
          and a slow RISING plankton layer (negative driftY → drifts UP) so the water reads as a moving
          column the creatures climb through — reinforcing the vertical pulse-glide. Densities/opacity
          restored toward the lived-in look; still additive-low so they never sum to a white veil. */}
      {/* Documentary grade: motes pulled ONTO the water's deep-teal hue (were mint/ice-blue/sea-green,
          which drifted off-palette as separate cool notes). Now they read as suspended particulate IN
          this water, one family with the backdrop + shafts. Warm amber layer below stays the accent. */}
      <MarineSnow count={1300} size={0.075} color="#4d94a6" opacity={0.30} driftY={0.16} spin={0.05} span={22} seed={7} />
      <MarineSnow count={220} size={0.16} color="#6fb4c4" opacity={0.48} driftY={0.06} spin={-0.04} span={28} seed={19} />
      <MarineSnow count={340} size={0.055} color="#3f8fa0" opacity={0.26} driftY={-0.11} spin={0.03} span={24} seed={31} />
      {/* WARM LIVING-WATER layer — amber plankton/eggs/larvae rising from the deep. Confined to the
          dark lower third (lowBias) so it can't stack into the bright god-ray zone, and it THINS as
          the fishery dies (fadeWithDecade) — the water's own life fading, tied only to aggregate
          decade progress, never faking a per-stock channel. This replaces the retired per-creature
          motes as the lived-in cue. */}
      <MarineSnow count={170} size={0.05} color="#d9b48a" opacity={0.18} driftY={-0.09} spin={0.02} span={24} seed={53} lowBias fadeWithDecade />
      {/* Distant shoal of fish in the back of the tank — the other life the fishery held. Warm and
          present in the living early water, first to vanish as it collapses (tightest fade). */}
      <FishShoal />
    </>
  )
}
