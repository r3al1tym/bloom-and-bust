// The tank as a character: god-ray shafts, drifting marine snow, and a teal depth-haze. All
// additive at low alpha and always subordinate to the data — bloom is a strict semantic amplifier,
// so atmosphere can tint and soften the far creatures but never drowns the read.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rayVertex, rayFragment } from './bloomShaders'
import { makeMarineSnow } from './bloomGeometry'
import { dotTexture } from './dotTexture'
import { useBloomControls } from './bloomControls'

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
  const mat = useRef<THREE.ShaderMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (mat.current) {
      mat.current.uniforms.uTime.value = s.clock.elapsedTime
      // the surface light fails as the fishery dies: full at the 1950s peak, ~45% by 2018.
      const p = useBloomControls.getState().decadeProgress
      const target = 1 - 0.55 * p
      const cur = mat.current.uniforms.uLight.value
      mat.current.uniforms.uLight.value = cur + (target - cur) * 0.05 // ease so a scrub isn't a snap
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
    if (fadeWithDecade && mat.current) {
      const p = useBloomControls.getState().decadeProgress
      mat.current.opacity = opacity * (1 - 0.5 * p)
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

export function Atmosphere() {
  return (
    <>
      {/* God-light from the surface far above — steep, near-vertical shafts raking DOWN through the
          water column into the depths, tinted deep-ocean cyan, catching the particulate. Spread
          across depth (some in front of the drift, some behind) so the volumetric light reads and
          the DoF turns the near ones into soft glowing columns. Widened to span the new wide drift
          field and brightened back toward the "lived-in" look (the earlier white-clip retune leaned
          on lower bloomIntensity/threshold + fog — not on starving the shafts, so this is safe). */}
      <GodRay x={-13} y={9} z={2} rot={0.11} seed={0.1} w={5} h={38} color="#6fbcd6" />
      <GodRay x={-7} y={9} z={-3} rot={0.07} seed={0.5} w={7} h={40} color="#8ccfe6" />
      <GodRay x={-2} y={9} z={5} rot={0.12} seed={0.8} w={4} h={36} color="#a6e0f0" />
      <GodRay x={3} y={9} z={-2} rot={0.06} seed={0.3} w={6} h={38} color="#a6e0f0" />
      <GodRay x={8} y={9} z={2} rot={0.09} seed={0.65} w={5} h={36} color="#6fbcd6" />
      <GodRay x={13} y={9} z={-1} rot={0.1} seed={0.22} w={4.5} h={36} color="#5aa6c4" />
      <GodRay x={0} y={9} z={-9} rot={0.04} seed={0.42} w={11} h={44} color="#5299b6" />
      {/* Suspended particulate — TRANSLATES gently (no rigid rotation). Sizes kept above sub-pixel so
          points don't twinkle without MSAA. Three layers now: a dense fine haze, coarse bokeh motes,
          and a slow RISING plankton layer (negative driftY → drifts UP) so the water reads as a moving
          column the creatures climb through — reinforcing the vertical pulse-glide. Densities/opacity
          restored toward the lived-in look; still additive-low so they never sum to a white veil. */}
      <MarineSnow count={1300} size={0.075} color="#9fc7d6" opacity={0.34} driftY={0.16} spin={0.05} span={22} seed={7} />
      <MarineSnow count={220} size={0.16} color="#c6ecff" opacity={0.55} driftY={0.06} spin={-0.04} span={28} seed={19} />
      <MarineSnow count={340} size={0.055} color="#bfe4d8" opacity={0.28} driftY={-0.11} spin={0.03} span={24} seed={31} />
      {/* WARM LIVING-WATER layer — amber plankton/eggs/larvae rising from the deep. Confined to the
          dark lower third (lowBias) so it can't stack into the bright god-ray zone, and it THINS as
          the fishery dies (fadeWithDecade) — the water's own life fading, tied only to aggregate
          decade progress, never faking a per-stock channel. This replaces the retired per-creature
          motes as the lived-in cue. */}
      <MarineSnow count={170} size={0.05} color="#d9b48a" opacity={0.12} driftY={-0.09} spin={0.02} span={24} seed={53} lowBias fadeWithDecade />
    </>
  )
}
