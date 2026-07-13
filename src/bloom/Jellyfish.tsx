// One jellyfish = one engagement, and now a working MIND. The component is a pure function of a
// BloomSpec (built by bloomModel.ts from the shared RecordView) + an animation clock. It owns NO
// data and reads NO store — the renderer wires selection in. Every visible part maps to a real
// record field; see bloomModel.ts for the field→anatomy table.
//
// v2 "Thinking Medusa": a lathe sea-nettle bell with a frilled flaring margin and an asymmetric
// propagating jet-pulse; a dendrite brain firing HDR spikes outward from the stomach along the real
// radial canals; long GPU-swayed gate-tentacles (severed → blunt stub) and twisted oral-arm ribbons
// (PA solid / DT ghosted). Only glow/spike terms are HDR, so the postprocessing Bloom amplifies
// meaning, not everything.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial } from '@react-three/drei'
import * as THREE from 'three'
import type { BloomSpec } from './bloomModel'
import { driftSeed, STAGE_COUNT } from './bloomModel'
import {
  bellVertex,
  bellFragment,
  swayVertex,
  swayFragment,
  neuralVertex,
  neuralFragment,
} from './bloomShaders'
import {
  makeBellGeometry,
  makeDendrites,
  makeTentacleGeometry,
  makeStubGeometry,
  makeRibbonGeometry,
} from './bloomGeometry'
import { dotTexture, haloTexture } from './dotTexture'
import { useBloomControls } from './bloomControls'

// Pulse rate / depth by vitality — the bell's "mood", and (same field) the neural firing rate, so
// the mind can never disagree with the breath.
const PULSE: Record<BloomSpec['vitality'], { rate: number; depth: number; neural: number }> = {
  // sealed = the hero's profile. It stays the CALMEST rate (slow confident breath — the semantic that
  // it isn't anxious), but the dome CONTRACTION is now the DEEPEST of the four (depth 0.22 > flutter's
  // 0.14): big, slow, muscular jet-pulses rather than anxious flutters. This is what makes the focused
  // hero's dome pump visibly harder than the peripheral medusae — a powerful calm, not a limp one.
  sealed: { rate: 1.05, depth: 0.22, neural: 0.4 }, // slow but the strongest, most muscular breath
  flutter: { rate: 2.6, depth: 0.14, neural: 1.1 }, // anxious, fast flicker — waiting on a signer
  dim: { rate: 0.4, depth: 0.03, neural: 0.18 }, // stalled at the floor — a held breath
  husk: { rate: 0.15, depth: 0.015, neural: 0.05 }, // barely formed, near-dark mind
}

interface Props {
  spec: BloomSpec
  position: [number, number, number]
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}

export function Jellyfish({ spec, position, selected, dimmed, onSelect }: Props) {
  const group = useRef<THREE.Group>(null)
  const bellMat = useRef<THREE.ShaderMaterial>(null)
  const neuralMat = useRef<THREE.ShaderMaterial>(null)
  const haloMat = useRef<THREE.SpriteMaterial>(null)
  const glassRef = useRef<THREE.Mesh>(null) // hero-only refraction shell — pulsed to match the bell
  const swayMats = useRef<THREE.ShaderMaterial[]>([])
  const seed = useMemo(() => driftSeed(spec.id), [spec.id])
  const pulse = PULSE[spec.vitality]
  const r = spec.bellRadius
  const hero = spec.vitality === 'sealed' && spec.glow >= 1

  // per-jellyfish volumetric halo: EVERY medusa carries a soft aura, so none reads as unlit. A small
  // floor (0.22) keeps even a husk faintly glowing; above it the strength scales with aliveness and
  // the arbiter outcome (uGlow) so a cleared run still glows brighter — the semantic survives.
  const haloBase = 0.22 + 0.5 * spec.alive + 0.35 * spec.glow
  const haloScale = r * (hero ? 5.4 : 4.2)

  // ── bell ──
  const bellGeo = useMemo(() => makeBellGeometry(r, hero), [r, hero])
  const bellUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPulseRate: { value: pulse.rate },
      uPulseDepth: { value: pulse.depth },
      uSeed: { value: seed },
      uRadius: { value: r },
      uFrillFreq: { value: 9.0 },
      uFrillAmp: { value: r * 0.05 },
      uMarginFlare: { value: r * 0.1 },
      // soft-body jiggle: livelier on anxious/fluttering runs, near-still on a husk. Sealed (hero)
      // gets a touch more (0.045) so the focused medusa's wall visibly ripples, not just breathes.
      uJiggle: {
        value:
          spec.vitality === 'husk'
            ? 0.01
            : spec.vitality === 'flutter'
              ? 0.05
              : spec.vitality === 'sealed'
                ? 0.045
                : 0.03,
      },
      uColor: { value: new THREE.Color(spec.tankColor) },
      uColorB: { value: new THREE.Color(spec.tankColor).multiplyScalar(1.5) },
      uSplit: { value: spec.engWeight },
      uGlow: { value: spec.glow },
      uAlive: { value: spec.alive },
      uOpacity: { value: 1 },
      uThicknessPow: { value: 3.0 },
      uGlowBoost: { value: 1.0 }, // live-tuned per frame from the control panel
      uFogDensity: { value: 0.058 }, // live-tuned; matches scene fog
    }),
    [spec.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── neural brain (dendrites) ──
  const dendrite = useMemo(() => makeDendrites(r, seed), [r, seed])
  const dendriteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(dendrite.positions, 3))
    g.setAttribute('aS', new THREE.BufferAttribute(dendrite.arc, 1))
    return g
  }, [dendrite])
  const neuralUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpeed: { value: pulse.neural },
      uIntensity: { value: spec.alive },
      uFogDensity: { value: 0.058 },
      uColor: { value: new THREE.Color(spec.tankColor) },
    }),
    [spec.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Fate-driven targets recomputed each render from the stock's CURRENT decade (the scrubber changes
  // spec.tankColor / alive / pulse / glow). The uniform objects are memoized on [spec.id], so — as in
  // the origin project — they'd freeze at first render; the origin never re-colored a creature after
  // mount, but here dragging the years must recolor and re-dim it. Lerp the uniforms toward these
  // targets in useFrame so the whole bloom ages smoothly as you scrub.
  const targetColor = useMemo(() => new THREE.Color(spec.tankColor), [spec.tankColor])
  const targetColorB = useMemo(() => new THREE.Color(spec.tankColor).multiplyScalar(1.5), [spec.tankColor])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const ctl = useBloomControls.getState() // live-tuning knobs (glow/halo boosts, fog depth)
    const k = Math.min(1, dt * 3) // fate-transition easing rate
    if (bellMat.current) {
      const u = bellMat.current.uniforms
      u.uTime.value = t
      u.uGlowBoost.value = ctl.glowBoost
      u.uFogDensity.value = ctl.fogDensity
      const target = dimmed ? 0.55 : 1 // dim by depth/emissive, NOT an opacity crush (v1 bug)
      u.uOpacity.value += (target - u.uOpacity.value) * Math.min(1, dt * 4)
      // ease fate-driven uniforms toward the current decade's state (color / glow / pulse / aliveness)
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      ;(u.uColorB.value as THREE.Color).lerp(targetColorB, k)
      u.uGlow.value += (spec.glow - u.uGlow.value) * k
      u.uAlive.value += (spec.alive - u.uAlive.value) * k
      u.uSplit.value += (spec.engWeight - u.uSplit.value) * k
      u.uPulseRate.value += (pulse.rate - u.uPulseRate.value) * k
      u.uPulseDepth.value += (pulse.depth - u.uPulseDepth.value) * k
    }
    if (neuralMat.current) {
      const u = neuralMat.current.uniforms
      u.uTime.value = t
      u.uFogDensity.value = ctl.fogDensity
      u.uSpeed.value += (pulse.neural - u.uSpeed.value) * k
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      // dimmed creatures fire fainter so only the focus/hero blooms hard
      u.uIntensity.value = spec.alive * (dimmed ? 0.4 : 1)
    }
    if (glassRef.current) {
      // HERO GLASS SHELL — MeshTransmissionMaterial runs its own vertex shader, so it CAN'T carry the
      // bell's jet-pulse displacement; left alone it sits rigid inside the breathing bell, which is
      // exactly why the focused hero read as static/glassy. Reproduce the bell's dominant pulse
      // envelope (bloomShaders.bellVertex, sampled at the apex h≈1) as a non-uniform scale so the
      // refraction core squashes/bulges in lockstep with the gel around it. Base 0.94 = shell inset.
      const phase = t * pulse.rate + seed * 6.2831853
      const s = Math.sin(phase)
      const p = (s > 0 ? Math.pow(s, 0.6) : -Math.pow(-s, 1.4)) * pulse.depth
      glassRef.current.scale.set(0.94 * (1 - p * 0.55), 0.94 * (1 + p), 0.94 * (1 - p * 0.55))
    }
    if (haloMat.current && group.current) {
      // the aura breathes in time with the bell's own pulse, and dims (doesn't vanish) when another
      // medusa is selected so the whole tank keeps a soft ambient glow
      const breath = 0.85 + 0.15 * Math.sin(t * pulse.rate + seed * 6.28)
      // atmospheric fog: the halo also attenuates into the haze with distance (same fogExp2 as the
      // scene + shaders) so far medusae don't glow sharp over the backdrop
      const depth = group.current.position.distanceTo(state.camera.position)
      const fd = ctl.fogDensity * depth
      const fog = 1 - Math.exp(-fd * fd)
      const target = haloBase * ctl.haloBoost * breath * (dimmed ? 0.4 : 1) * (1 - 0.7 * fog)
      const cur = haloMat.current.opacity
      haloMat.current.opacity = cur + (target - cur) * Math.min(1, dt * 4)
      haloMat.current.color.lerp(targetColor, k) // aura follows the current fate hue
    }
    // tentacles/arms recolor with the fate too (their uColor is memoized per-appendage otherwise)
    for (const m of swayMats.current)
      if (m) {
        m.uniforms.uTime.value = t
        m.uniforms.uFogDensity.value = ctl.fogDensity
        ;(m.uniforms.uColor.value as THREE.Color).lerp(targetColor, k)
      }
    if (group.current) {
      // shared water current — a slow common drift phased by world position, so the whole tank moves
      // as ONE medium (nearby creatures sway together) rather than as independent puppets. Layered
      // over each creature's own deterministic bob so the bloom breathes like a single body of water.
      const curX = Math.sin(t * 0.18 + position[0] * 0.25) * 0.18 + Math.sin(t * 0.11 + position[2] * 0.3) * 0.1
      const curY = Math.cos(t * 0.15 + position[0] * 0.2) * 0.12

      // ── VERTICAL PULSE-GLIDE — real medusa locomotion, WITHOUT scattering the legible layout. A
      // jellyfish jets UP on the contraction and settles on the relaxation, so its motion is a
      // rhythmic ratchet synced to the bell pulse (same phase as bloomShaders.bellVertex), not a
      // lava-lamp float. It stays anchored near its data position (so each stock stays identifiable);
      // the kick amplitude + a slow bounded ascent-and-return read as VITALITY: a thriving stock
      // (fast, deep pulse) climbs eagerly, a husk barely twitches. The whole-drift "rising through the
      // shafts" documentary read comes from the camera crane + falling marine snow, not from creatures
      // migrating across the frame.
      const pulsePhase = t * pulse.rate + seed * 6.2831853
      const ps = Math.sin(pulsePhase)
      // asymmetric thrust: fast up-kick on contraction (ps>0), slower settle on relaxation — matches
      // the bell's own skewed jet so body and motion agree.
      const thrust = ps > 0 ? Math.pow(ps, 0.6) : -Math.pow(-ps, 1.6) * 0.5
      const vigor = 0.35 + 1.4 * spec.alive // husk ~0.4, hero ~1.6 — vitality = how hard it climbs
      const kick = thrust * pulse.depth * vigor * 2.2 // per-pulse vertical excursion (stays local)
      // a slow, BOUNDED ascent-and-return (±~0.6·vigor world units) so a lively creature visibly works
      // its way up and drifts back down — migration, but tethered to its home so the arrangement holds.
      const glide = Math.sin(t * (0.12 + 0.06 * spec.alive) + seed * 6.28) * 0.6 * vigor

      group.current.position.x = position[0] + curX
      group.current.position.y = position[1] + curY + glide + kick
      group.current.position.z = position[2] + Math.sin(t * 0.13 + position[0] * 0.35) * 0.12
      group.current.rotation.z = curX * 0.15 // lean into the current
      group.current.rotation.y = Math.sin(t * 0.15 + seed * 6.28) * 0.22
      // whole-creature scale = this-decade survival (the tank thins as stocks collapse) × a small
      // selection pop. Eased smoothly so scrubbing a stock into collapse SHRINKS it before your eyes.
      const s = spec.decadeScale * (selected ? 1.12 : 1)
      const cs = group.current.scale.x
      group.current.scale.setScalar(cs + (s - cs) * Math.min(1, dt * 3))

      // DEPTH-RANKED DRAW ORDER — the parts are all depthWrite:false (translucent, so the brain reads
      // through the gel and far bells sink into the fog), which means NO depth-buffer occlusion between
      // creatures: they composite purely in draw order. The parts carried a GLOBAL renderOrder
      // (halo 0 / brain 1 / bell 2 / tentacles 3), so every tentacle drew after every bell regardless
      // of distance — a back creature's tentacles painted on top of a front creature's body. Fix:
      // rank each creature by camera distance and offset its whole stack, so a nearer medusa draws
      // entirely after a farther one (painter's algorithm) while the intra-creature layering holds.
      const dist = group.current.position.distanceTo(state.camera.position)
      const base = -dist * 100 // farther → more negative → drawn first (behind)
      group.current.traverse((o) => {
        if (o.userData.layer === undefined) o.userData.layer = o.renderOrder // capture the local layer once
        o.renderOrder = base + o.userData.layer
      })
    }
  })

  swayMats.current = []
  const registerSway = (m: THREE.ShaderMaterial | null) => {
    if (m) swayMats.current.push(m)
  }

  return (
    <group ref={group} position={position}>
      {/* hit target */}
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[r * 1.7, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* VOLUMETRIC HALO — a soft camera-facing aura behind every medusa (not just the hero), tinted
          its own semantic hue and breathing with its pulse. Additive + no depth WRITE so it reads as
          glowing light in the water; Bloom feathers it into a true halo. depthTest stays ON so a far
          medusa's halo is correctly occluded by nearer creatures — with it OFF, back halos popped on
          top of front bells as the camera orbited (a flicker source). */}
      <sprite ref={(s) => { if (s) s.scale.setScalar(haloScale) }} position={[0, r * 0.15, -r * 0.2]} renderOrder={0}>
        <spriteMaterial
          ref={haloMat}
          map={haloTexture()}
          color={spec.tankColor}
          transparent
          opacity={haloBase}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      {/* THE NEURAL BRAIN — fires first (renderOrder 1, under the gel) */}
      <lineSegments geometry={dendriteGeo} renderOrder={1}>
        <shaderMaterial
          ref={neuralMat}
          vertexShader={neuralVertex}
          fragmentShader={neuralFragment}
          uniforms={neuralUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* synaptic nodes — flare where branches meet */}
      <points renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[dendrite.nodes, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color={spec.tankColor}
          size={r * 0.05}
          sizeAttenuation
          map={dotTexture()}
          alphaTest={0.01}
          transparent
          opacity={0.5 * (dimmed ? 0.4 : 1)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* REFRACTION — a real glass shell just inside the hero's bell that BENDS the god-light, the
          other medusae, and the tentacles behind it (drei transmission). Hero-only + low-res sampler
          so 10 full-scene transmission renders don't tank the frame; the biggest "this is real, not
          CG" cue where the eye is already looking. Renders under the tinted shell so the semantic hue
          still reads on top. */}
      {hero && (
        <mesh ref={glassRef} geometry={bellGeo} scale={0.94} renderOrder={1}>
          <MeshTransmissionMaterial
            transmission={1}
            thickness={r * 0.6}
            roughness={0.06}
            ior={1.33} /* water */
            chromaticAberration={0.04}
            distortion={0.4}
            distortionScale={0.4}
            temporalDistortion={0.15}
            samples={4}
            resolution={256}
            backside={false}
            transparent
            depthWrite={false}
            color={spec.tankColor}
            attenuationColor={spec.tankColor}
            attenuationDistance={r * 2}
          />
        </mesh>
      )}

      {/* THE BELL — lathe sea-nettle, frilled margin, SSS translucency (renderOrder 2, over brain) */}
      <mesh geometry={bellGeo} renderOrder={2}>
        <shaderMaterial
          ref={bellMat}
          vertexShader={bellVertex}
          fragmentShader={bellFragment}
          uniforms={bellUniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.NormalBlending}
        />
      </mesh>

      {/* SEVEN TENTACLES — the gates. Long, GPU-swayed, outcome-colored; severed → blunt stub, no sway. */}
      {spec.tentacles.map((tt, i) => {
        const n = STAGE_COUNT
        const ang = (i / n) * Math.PI * 2
        const rx = Math.cos(ang) * r * 0.62
        const rz = Math.sin(ang) * r * 0.62
        const full = r * (8 + (hero ? 5 : (i % 4)))
        return (
          <Appendage
            key={tt.stage}
            x={rx}
            z={rz}
            length={full}
            r={r}
            color={tt.color}
            severed={tt.severed}
            seed={seed + i * 0.13}
            kind="tentacle"
            registerMat={registerSway}
          />
        )
      })}

      {/* ORAL ARMS — the heads. PA solid (gates), DT ghosted (advisory). Length ← confidence. */}
      {spec.arms.map((a, i) => {
        const ang = (i / Math.max(spec.arms.length, 1)) * Math.PI * 2 + 0.4
        const rx = Math.cos(ang) * r * 0.22
        const rz = Math.sin(ang) * r * 0.22
        return (
          <Appendage
            key={a.head}
            x={rx}
            z={rz}
            length={r * (2.5 + a.confidence * 2.0)}
            r={r}
            color={a.color}
            severed={false}
            advisory={a.advisory}
            seed={seed + 5 + i}
            kind="ribbon"
            registerMat={registerSway}
          />
        )
      })}

      {/* FLOOR STINGS — terracotta sparks, one per violation, ringing the bell rim */}
      {Array.from({ length: spec.stings }).map((_, i) => {
        const ang = (i / Math.max(spec.stings, 1)) * Math.PI * 2
        return (
          <mesh
            key={`sting-${i}`}
            position={[Math.cos(ang) * r * 1.0, -r * 0.05, Math.sin(ang) * r * 1.0]}
            renderOrder={3}
          >
            <sphereGeometry args={[r * 0.06, 8, 8]} />
            <meshBasicMaterial color="#ff6a3c" transparent opacity={0.95 * (dimmed ? 0.5 : 1)} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        )
      })}

      {/* ARTIFACT MOTES — warm, clustered, countable; distinct from the cool ambient snow */}
      {spec.motes.map((m, mi) =>
        Array.from({ length: m.count }).map((_, i) => {
          const ang = (mi * 2.0 + i * 1.3) % (Math.PI * 2)
          const rad = r * (1.15 + ((mi + i) % 3) * 0.12)
          return (
            <mesh
              key={`mote-${mi}-${i}`}
              position={[Math.cos(ang) * rad, r * 0.3 + (i % 2) * 0.15, Math.sin(ang) * rad]}
              renderOrder={3}
            >
              <sphereGeometry args={[r * 0.035, 6, 6]} />
              <meshBasicMaterial color="#e8dcae" transparent opacity={0.75 * (dimmed ? 0.5 : 1)} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          )
        }),
      )}
    </group>
  )
}

// A trailing appendage — a gate-tentacle (round tube) or an oral arm (twisted ribbon). Swayed on the
// GPU via a traveling wave with arc-length lag; the anchor is stiff, the tip swings wide and late.
function Appendage({
  x,
  z,
  length,
  r,
  color,
  severed,
  advisory = false,
  seed,
  kind,
  registerMat,
}: {
  x: number
  z: number
  length: number
  r: number
  color: string
  severed: boolean
  advisory?: boolean
  seed: number
  kind: 'tentacle' | 'ribbon'
  registerMat: (m: THREE.ShaderMaterial | null) => void
}) {
  const geo = useMemo(() => {
    if (kind === 'ribbon') return makeRibbonGeometry(length)
    return severed ? makeStubGeometry(r, false) : makeTentacleGeometry(length, false)
  }, [kind, length, severed, r])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSeed: { value: seed },
      uAmp: { value: severed ? 0 : kind === 'ribbon' ? r * 0.5 : r * 0.9 },
      uFreq: { value: 0.6 + (seed % 0.4) },
      uLag: { value: 5.0 },
      uStiff: { value: 1.8 },
      uTwist: { value: kind === 'ribbon' ? 2.5 : 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uAdvisory: { value: advisory ? 1 : 0 },
      uFogDensity: { value: 0.058 },
    }),
    [seed, severed, kind, r, color, advisory],
  )

  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo} renderOrder={3}>
        <shaderMaterial
          ref={registerMat}
          vertexShader={swayVertex}
          fragmentShader={swayFragment}
          uniforms={uniforms}
          transparent
          side={kind === 'ribbon' ? THREE.DoubleSide : THREE.FrontSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
