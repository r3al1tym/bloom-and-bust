// The tank as a character: god-ray shafts, drifting marine snow, and a teal depth-haze. All
// additive at low alpha and always subordinate to the data — bloom is a strict semantic amplifier,
// so atmosphere can tint and soften the far creatures but never drowns the read.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rayVertex, rayFragment } from './bloomShaders'
import { makeMarineSnow } from './bloomGeometry'
import { dotTexture } from './dotTexture'

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
    }),
    [seed, color],
  )
  const mat = useRef<THREE.ShaderMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (mat.current) mat.current.uniforms.uTime.value = s.clock.elapsedTime
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
}: {
  count: number
  size: number
  color: string
  opacity: number
  driftY: number
  spin: number
  span: number
}) {
  const { positions, sizes } = useMemo(() => makeMarineSnow(count), [count])
  const ref = useRef<THREE.Points>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.elapsedTime
    // gentle TRANSLATION only — a slow settling drift + a faint lateral sway. The old code ROTATED
    // the whole cloud on Y every frame (rotation.y = t*spin), which swept every point through a
    // circle: near points crossed pixels fast and, being sub-pixel additive with no MSAA, twinkled
    // hard across the whole frame — the "flickering/clipping" read. Translating instead keeps each
    // point's screen motion slow and coherent.
    ref.current.position.y = -((t * driftY) % span)
    ref.current.position.x = Math.sin(t * spin * 6.0) * 0.4
  })
  return (
    <points ref={ref} renderOrder={0}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
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
          the DoF turns the near ones into soft glowing columns. */}
      <GodRay x={-7} y={8} z={2} rot={0.1} seed={0.1} w={4} h={34} color="#5aa6c4" />
      <GodRay x={-3} y={8} z={-3} rot={0.06} seed={0.5} w={6} h={36} color="#78c4dc" />
      <GodRay x={2} y={8} z={4} rot={0.12} seed={0.8} w={3.5} h={32} color="#8fd4e6" />
      <GodRay x={5} y={8} z={-2} rot={0.05} seed={0.3} w={5} h={34} color="#8fd4e6" />
      <GodRay x={9} y={8} z={1} rot={0.09} seed={0.65} w={4} h={32} color="#5aa6c4" />
      <GodRay x={0} y={8} z={-8} rot={0.04} seed={0.42} w={9} h={38} color="#4a94b2" />
      {/* suspended particulate — TRANSLATES gently (no rigid rotation). Sizes kept above sub-pixel so
          points don't twinkle without MSAA: fine near layer + coarse far motes. */}
      <MarineSnow count={800} size={0.08} color="#9fc7d6" opacity={0.3} driftY={0.15} spin={0.05} span={20} />
      <MarineSnow count={140} size={0.16} color="#bfe9ff" opacity={0.5} driftY={0.07} spin={-0.04} span={26} />
    </>
  )
}
