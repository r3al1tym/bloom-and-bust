// The tank as a character: god-ray shafts, drifting marine snow, and a teal depth-haze. All
// additive at low alpha and always subordinate to the data — bloom is a strict semantic amplifier,
// so atmosphere can tint and soften the far creatures but never drowns the read.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rayVertex, rayFragment } from './bloomShaders'
import { makeMarineSnow } from './bloomGeometry'
import { dotTexture } from './dotTexture'
import { useBloomControls, worldDarkness, beatEnvelope } from './bloomControls'

function GodRay({
  x,
  y = 4,
  z = -4,
  rot,
  seed,
  w,
  h,
  color = '#6fb2cc',
}: {
  x: number
  y?: number
  z?: number
  rot: number
  seed: number
  w: number
  h: number
  color?: string
}) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uLight: { value: 1 },
    }),
    [seed, color],
  )
  // Early-warmth colour targets for this shaft: baseColor is its authored cyan; warmColor is a golden
  // sunbeam shift of that same tint, reached only in the living early water. Nothing else writes uColor,
  // so the per-frame lerp below ADDS a warmth ease alongside the existing uLight brightness ease.
  const baseColor = useMemo(() => new THREE.Color(color), [color])
  // warm twin for the 1950 living water — a richer amber-gold so the early shafts read as warm sunlight,
  // not a washed pastel. (Documentary grade: the warm accent is the ONE saturated exception to the teal medium.)
  const warmColor = useMemo(() => baseColor.clone().lerp(new THREE.Color('#ffbf73'), 0.62), [baseColor])
  const warmScratch = useMemo(() => new THREE.Color(), [])
  const mat = useRef<THREE.ShaderMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (mat.current) {
      mat.current.uniforms.uTime.value = s.clock.elapsedTime
      // #1 DARKNESS RISES — the surface light doesn't just dim, it nearly GOES OUT as the fishery dies,
      // so by 2018 the bloom is the only light left. worldDarkness(p) (pow 1.15, late-biased) keeps the
      // 50s-70s lit and bites post-1990: target 1.0 → ~0.10 (a faint memory of surface, never full black).
      const st = useBloomControls.getState()
      const p = st.decadeProgress
      const d = worldDarkness(p)
      // #4: the shafts also go out during the beat's fade+black (surface light is the first to die),
      // and ease faster while it runs so the ~1.4s snap lands. `dark` pulls the target to 0 (full black).
      const env = st.beatActive ? beatEnvelope(st.beatPhase, st.beatT) : { dark: 0, ignite: 0 }
      const target = (1 - 0.9 * d) * (1 - env.dark)
      const cur = mat.current.uniforms.uLight.value
      mat.current.uniforms.uLight.value = cur + (target - cur) * (st.beatActive ? 0.22 : 0.05)
      // Early warmth: the god-light itself is golden in the living 50s-60s water and cools to its
      // authored cyan as the fishery collapses. Shared warmth clock — paletteWarmth = 1 − smoothstep(p,
      // 0, 0.42): high through the early decades, fully cool by p≈0.42. Same 0.05 ease so a scrub glides.
      const paletteWarmth = 1 - THREE.MathUtils.smoothstep(p, 0.0, 0.42)
      warmScratch.copy(baseColor).lerp(warmColor, paletteWarmth)
      ;(mat.current.uniforms.uColor.value as THREE.Color).lerp(warmScratch, 0.05)
    }
    // Y-axis billboard: yaw the shaft to face the camera horizontally while staying vertical, so it
    // always presents its broad face (never seen edge-on as a flat card) — reads as a volumetric
    // column from any orbit angle. A slight art-directed lean (rot) is preserved on Z.
    if (mesh.current) {
      const dx = s.camera.position.x - x
      const dz = s.camera.position.z - z
      mesh.current.rotation.set(0, Math.atan2(dx, dz), rot)
    }
  })
  return (
    // renderOrder -50 + depthTest off: the shafts live BEHIND the drift as pure background light and
    // never join the transparent depth-sort against the medusae — kills the sort-order flicker that
    // made whole shafts pop in front of/behind creatures while orbiting.
    <mesh ref={mesh} position={[x, y, z]} renderOrder={-50}>
      <planeGeometry args={[w, h]} />
      <shaderMaterial
        ref={mat}
        vertexShader={rayVertex}
        fragmentShader={rayFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

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
      {/* God-light from the surface far above — steep, near-vertical shafts raking DOWN through the
          water column into the depths, tinted deep-ocean cyan, catching the particulate. Spread
          across depth (some in front of the drift, some behind) so the volumetric light reads and
          the DoF turns the near ones into soft glowing columns. Widened to span the new wide drift
          field and brightened back toward the "lived-in" look (the earlier white-clip retune leaned
          on lower bloomIntensity/threshold + fog — not on starving the shafts, so this is safe). */}
      {/* Documentary grade: the shafts are one SATURATED deep-teal family (was pale washed cyan — a
          low-saturation additive colour reads as flat GRAY, the "gray god-rays" problem). Deeper + more
          saturated so they carry hue as coloured light through the water, not luminance smears. */}
      <GodRay x={-13} y={9} z={2} rot={0.11} seed={0.1} w={5} h={38} color="#1f7f96" />
      <GodRay x={-7} y={9} z={-3} rot={0.07} seed={0.5} w={7} h={40} color="#2e93a8" />
      <GodRay x={-2} y={9} z={5} rot={0.12} seed={0.8} w={4} h={36} color="#3aa6ba" />
      <GodRay x={3} y={9} z={-2} rot={0.06} seed={0.3} w={6} h={38} color="#3aa6ba" />
      <GodRay x={8} y={9} z={2} rot={0.09} seed={0.65} w={5} h={36} color="#1f7f96" />
      <GodRay x={13} y={9} z={-1} rot={0.1} seed={0.22} w={4.5} h={36} color="#1a6f89" />
      <GodRay x={0} y={9} z={-9} rot={0.04} seed={0.42} w={11} h={44} color="#175f7d" />
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
