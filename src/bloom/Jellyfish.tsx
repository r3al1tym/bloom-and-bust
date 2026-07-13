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
import { driftSeed, STAGE_COUNT, visualsAsOf } from './bloomModel'
import type { Stock } from '@/data/bloom'
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
  /** The raw stock — Jellyfish interpolates its CONTINUOUS visual state (glow/alive/mass/sink/colour)
   *  from the store's live decadeF each frame via visualsAsOf(), so time flows like water with zero
   *  per-frame React re-render. `spec` still carries the discrete/structural fields (severance, arms). */
  stock: Stock
  position: [number, number, number]
  selected: boolean
  dimmed: boolean
  /** The ONE focal creature (the composed hero the crane lands on) — only it renders the expensive
   *  full-scene refraction shell. Distinct from `hero` (the vitality-sealed look), which at the 1950s
   *  opening is true for ALL 28 stocks (each at 100% of its own then-peak) — gating the transmission
   *  on `hero` fired 28 FBO refraction passes/frame at load. */
  focal: boolean
  onSelect: () => void
}

export function Jellyfish({ spec, stock, position, selected, dimmed, focal, onSelect }: Props) {
  const group = useRef<THREE.Group>(null)
  const bellMat = useRef<THREE.ShaderMaterial>(null)
  const neuralMat = useRef<THREE.ShaderMaterial>(null)
  const haloMat = useRef<THREE.SpriteMaterial>(null)
  const haloSprite = useRef<THREE.Sprite>(null)
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

  // reusable scratch colours so the per-frame lerp allocates nothing (targets are recomputed live from
  // the continuous decade, not memoized on a discrete spec value).
  const targetColor = useMemo(() => new THREE.Color(spec.tankColor), [spec.tankColor])
  const targetColorB = useMemo(() => new THREE.Color(spec.tankColor).multiplyScalar(1.5), [spec.tankColor])

  // per-creature orientation character — a deterministic resting tilt (pitch/roll) + a slow wander so
  // the bloom drifts at varied angles like real medusae, not a field of upright umbrellas. Bounded
  // small so the bell/anatomy still reads. Phases derived from the seed so every creature differs.
  const tilt = useMemo(() => ({
    pitch: (seed - 0.5) * 0.7, // resting fore/aft lean, ±0.35 rad (~20°)
    roll: (driftSeed(spec.id + 'r') - 0.5) * 0.7, // resting side lean
    wSpeed: 0.05 + seed * 0.05, // slow wander frequency
  }), [seed, spec.id])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const ctl = useBloomControls.getState() // live-tuning knobs (glow/halo boosts, fog depth) + clock
    const k = Math.min(1, dt * 3) // fate-transition easing rate

    // CONTINUOUS state — interpolate this stock's visual targets from the live decade float, so colour,
    // glow, mass and sink all flow like water as the year sweeps (no discrete decade jumps). Pure, and
    // the only per-frame cost is a little arithmetic; the eased uniforms below smooth it to 60fps.
    const v = visualsAsOf(stock, ctl.decadeF)
    targetColor.set(v.tankColor)
    targetColorB.copy(targetColor).multiplyScalar(1.5)

    // ── DEATH-THROE — the one MOMENT the continuous fade was missing. As survival (glow) falls through
    // 0.1 (the collapsed→husk boundary — "all but gone"), the creature gives a last surge: the mind
    // flares, the bell flushes a final coral, before the light releases and goes out. A Gaussian bump in
    // glow-space centred on 0.1 (≈1 at the boundary, ~0 by glow 0 and 0.2). Because it's a pure function
    // of glow (⟸ decadeF) it swells-and-releases on a forward scrub and RE-swells on a backward scrub —
    // never a fired-once latch. The throes self-stagger because every stock crosses 0.1 at a different
    // year, and the flare lives on the small dendrite brain (not the giant halo), so 8 near-simultaneous
    // collapses read as scattered embers, not a fireworks show.
    const throe = Math.exp(-Math.pow((v.glow - 0.1) / 0.045, 2))
    // pulse rate/depth/neural interpolated CONTINUOUSLY from survival (glow) — a stock's breath slows
    // smoothly as it dies rather than snapping at fate thresholds. Healthy ≈ slow-deep hero breath;
    // husk ≈ near-still. (Replaces the discrete PULSE[vitality] lookup for the animated targets.)
    const pRate = 0.4 + 1.9 * v.glow // ~0.4 (still) → ~2.3 (lively)
    const pDepth = 0.02 + 0.2 * v.glow // shallow held breath → deep muscular jet
    const pNeural = 0.1 + 1.0 * v.glow

    // camera distance for this creature, computed ONCE per frame and reused by the halo-fog and the
    // draw-order rank (was two independent subtract+sqrt for the same value).
    const camDist = group.current ? group.current.position.distanceTo(state.camera.position) : 0
    if (bellMat.current) {
      const u = bellMat.current.uniforms
      u.uTime.value = t
      u.uGlowBoost.value = ctl.glowBoost
      u.uFogDensity.value = ctl.fogDensity
      // dying stocks also dim their bell (sink darkens): a husk sinking into the deep loses its light.
      const target = (dimmed ? 0.55 : 1) * (1 - 0.35 * v.sink)
      u.uOpacity.value += (target - u.uOpacity.value) * Math.min(1, dt * 4)
      // ease fate-driven uniforms toward the current decade's state (color / glow / pulse / aliveness)
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      ;(u.uColorB.value as THREE.Color).lerp(targetColorB, k)
      // a final coral flush at the husk-crossing (throe rides the eased glow target so it swells then
      // releases). Magnitude kept modest so the bell brightens relative to its own dim floor — an ember,
      // not a hero flare — and stays under the Bloom threshold with the rest of the drift.
      u.uGlow.value += (v.glow + throe * 0.5 - u.uGlow.value) * k
      u.uAlive.value += (v.alive - u.uAlive.value) * k
      u.uSplit.value += (spec.engWeight - u.uSplit.value) * k
      u.uPulseRate.value += (pRate - u.uPulseRate.value) * k
      u.uPulseDepth.value += (pDepth - u.uPulseDepth.value) * k
    }
    if (neuralMat.current) {
      const u = neuralMat.current.uniforms
      u.uTime.value = t
      u.uFogDensity.value = ctl.fogDensity
      u.uSpeed.value += (pNeural - u.uSpeed.value) * k
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      // dimmed creatures fire fainter; a sinking husk's mind goes nearly dark (0.8, so the dendrites
      // fall toward ~0.03 while the bell membrane keeps its 0.12 alive floor — a ghost shell). At the
      // husk-crossing the mind gives one last SURGE (+throe) before it releases: a body's final signal.
      u.uIntensity.value = v.alive * (dimmed ? 0.4 : 1) * (1 - 0.8 * v.sink) + throe * 0.6
    }
    if (glassRef.current) {
      // HERO GLASS SHELL — MeshTransmissionMaterial runs its own vertex shader, so it CAN'T carry the
      // bell's jet-pulse displacement; left alone it sits rigid inside the breathing bell, which is
      // exactly why the focused hero read as static/glassy. Reproduce the bell's dominant pulse
      // envelope (bloomShaders.bellVertex, sampled at the apex h≈1) as a non-uniform scale so the
      // refraction core squashes/bulges in lockstep with the gel around it. Base 0.94 = shell inset.
      const phase = t * pRate + seed * 6.2831853
      const s = Math.sin(phase)
      const p = (s > 0 ? Math.pow(s, 0.6) : -Math.pow(-s, 1.4)) * pDepth
      glassRef.current.scale.set(0.94 * (1 - p * 0.55), 0.94 * (1 + p), 0.94 * (1 - p * 0.55))
    }
    if (haloMat.current && group.current) {
      // the aura breathes in time with the bell's own pulse, and dims (doesn't vanish) when another
      // medusa is selected so the whole tank keeps a soft ambient glow
      const breath = 0.85 + 0.15 * Math.sin(t * pRate + seed * 6.28)
      // atmospheric fog: the halo also attenuates into the haze with distance (same fogExp2 as the
      // scene + shaders) so far medusae don't glow sharp over the backdrop
      const fd = ctl.fogDensity * camDist
      const fog = 1 - Math.exp(-fd * fd)
      // live halo strength from CONTINUOUS aliveness/glow (was memoized haloBase); a sinking husk's
      // aura fades out with it.
      const liveHaloBase = 0.22 + 0.5 * v.alive + 0.35 * v.glow
      const target = liveHaloBase * ctl.haloBoost * breath * (dimmed ? 0.4 : 1) * (1 - 0.7 * fog) * (1 - 0.5 * v.sink)
      const cur = haloMat.current.opacity
      haloMat.current.opacity = cur + (target - cur) * Math.min(1, dt * 4)
      haloMat.current.color.lerp(targetColor, k) // aura follows the current fate hue
      // P8: a fully-faded halo (fogged/dimmed husk) still rasterizes its giant additive quad — skip
      // the draw entirely below an epsilon (toggle the SPRITE object, not the material), restore above
      // it. Lossless (it contributes ~nothing there).
      if (haloSprite.current) haloSprite.current.visible = haloMat.current.opacity >= 0.012
    }
    // tentacles/arms recolor with the fate too (their uColor is memoized per-appendage otherwise), and
    // lose MUSCLE TONE as the stock dies: a dying medusa stops actively swimming, so its trails slow and
    // shorten to a limp drag rather than a live swing. Scale amp/freq by glow off each material's own
    // base (captured once) — keep SOME amp (→0 reads rigid, not slack). A severed stub has base amp 0,
    // so the multiply leaves it 0 (never re-animates a snapped tentacle).
    const slackAmp = 0.5 + 0.5 * v.glow
    const slackFreq = 0.35 + 0.65 * v.glow
    for (const m of swayMats.current)
      if (m) {
        m.uniforms.uTime.value = t
        m.uniforms.uFogDensity.value = ctl.fogDensity
        ;(m.uniforms.uColor.value as THREE.Color).lerp(targetColor, k)
        if (m.userData.baseAmp === undefined) {
          m.userData.baseAmp = m.uniforms.uAmp.value
          m.userData.baseFreq = m.uniforms.uFreq.value
        }
        m.uniforms.uAmp.value = m.userData.baseAmp * slackAmp
        m.uniforms.uFreq.value = m.userData.baseFreq * slackFreq
      }
    if (group.current) {
      // shared water current — a slow common drift phased by world position, so the whole tank moves
      // as ONE medium (nearby creatures sway together) rather than as independent puppets. Layered
      // over each creature's own deterministic bob so the bloom breathes like a single body of water.
      const curX = Math.sin(t * 0.18 + position[0] * 0.25) * 0.18 + Math.sin(t * 0.11 + position[2] * 0.3) * 0.1
      const curY = Math.cos(t * 0.15 + position[0] * 0.2) * 0.12

      // ── STILLNESS AT DEATH — death is the absence of motion. As a stock sinks toward husk, damp its
      // OWN living motion (breath-bob + buoyant rise) toward a near-frozen rest; leave the shared water
      // current (curX/curY) untouched so the corpse still drifts in the medium rather than freezing out
      // of it. 1 while alive → 0.15 at full husk.
      const stillness = 1 - 0.85 * v.sink

      // ── ORGANIC VERTICAL DRIFT — a real medusa breathes with a gentle vertical lilt, it does not
      // pogo. Small slow bob synced to the (gentle) pulse; the tentacle sway + shared current are the
      // dominant motion. Amplitude is small (world units) and tethered to the data slot. Damped by
      // stillness so a dying bell stops breathing.
      const pulsePhase = t * pRate + seed * 6.2831853
      const bob = Math.sin(pulsePhase) * pDepth * 0.6 * stillness // a soft breath-bob

      // ── BUOYANT ASCENT — the bloom RISES with purpose instead of bobbing aimlessly in place. The old
      // `lilt` was zero-mean AND phased by each creature's own seed, so 28 independent lifts averaged to
      // nothing — a static diorama. The fix is COHERENCE: one IDENTICAL vertical phase across the whole
      // field (no seed, no position term) so the bloom heaves up the water column as a single mass. The
      // slowest motion in the tank (~63s period, below curX's ~35s) so it reads as deliberate ascent.
      // Lift scales with survival: a healthy sea hovers UP toward the surface light; a dying one loses
      // lift and the sink takes over. A tiny per-creature detune (an order below the shared term) keeps
      // the unison organic, not a rigid elevator. Bounded pure f(clock, glow) — slot-anchored, no
      // accumulator, reversible on forward/backward scrub.
      const riseCommon = 0.5 + 0.5 * Math.sin(t * 0.10) // 0..1, SHARED phase — the field lifts as one
      const detune = Math.sin(t * 0.13 + seed * 6.28) * 0.06 // ±0.06 organic jitter, well below the unison
      const lift = v.glow * (0.15 + 0.55 * riseCommon + detune) * stillness // 0 dead → hovers 0.15–0.70 alive

      // ── DEATH SINK — a collapsing stock loses buoyancy and slowly settles DOWN into the dark deep,
      // visibly losing life (bell/halo/mind dimming handled above). Healthy = 0; a husk sinks ~3.4
      // units below its slot into the fog. Composes with `lift` so the vertical axis itself tells the
      // story: alive = drawn up toward the light, collapse = released down into the dark.
      const SINK_DEPTH = 3.4
      const sinkY = -v.sink * SINK_DEPTH

      group.current.position.x = position[0] + curX
      group.current.position.y = position[1] + curY + bob + lift + sinkY
      group.current.position.z = position[2] + Math.sin(t * 0.13 + position[0] * 0.35) * 0.12

      // ── ORIENTATION — vary the bell's tilt like a real drifting bloom instead of a field of upright
      // umbrellas: a deterministic resting pitch/roll per creature + a slow wander, and a lean into the
      // current. A dying stock also tips further over as it sinks (loses its righting control). Kept
      // gentle so the anatomy still reads. rotation.y keeps a slow turn so tentacles trail.
      // sinking stocks list further as they die — righting control fails. Capped so the dome still faces
      // up-ish (past ~horizontal the silhouette read breaks); 0.8 tips it well over without capsizing.
      const sag = Math.min(v.sink * 0.8, 0.85)
      group.current.rotation.x = tilt.pitch + Math.sin(t * tilt.wSpeed + seed * 6.28) * 0.12 + sag
      group.current.rotation.z = tilt.roll + curX * 0.15 + Math.cos(t * tilt.wSpeed * 0.8 + seed * 3.1) * 0.1
      group.current.rotation.y = Math.sin(t * 0.15 + seed * 6.28) * 0.22
      // whole-creature scale = this-decade survival (the tank thins as stocks collapse) × a small
      // selection pop. Eased smoothly so scrubbing a stock into collapse SHRINKS it before your eyes.
      const s = v.decadeScale * (selected ? 1.12 : 1)
      const cs = group.current.scale.x
      group.current.scale.setScalar(cs + (s - cs) * Math.min(1, dt * 3))

      // DEPTH-RANKED DRAW ORDER — the parts are all depthWrite:false (translucent, so the brain reads
      // through the gel and far bells sink into the fog), which means NO depth-buffer occlusion between
      // creatures: they composite purely in draw order. The parts carried a GLOBAL renderOrder
      // (halo 0 / brain 1 / bell 2 / tentacles 3), so every tentacle drew after every bell regardless
      // of distance — a back creature's tentacles painted on top of a front creature's body. Fix:
      // rank each creature by camera distance and offset its whole stack, so a nearer medusa draws
      // entirely after a farther one (painter's algorithm) while the intra-creature layering holds.
      const base = -camDist * 100 // farther → more negative → drawn first (behind)
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
        <sphereGeometry args={[r * 1.7, 10, 10]} />
        {/* invisible raycast target: colorWrite:false skips the framebuffer color write + alpha blend
            entirely (transparent+opacity:0 still rasterizes and blends every frame otherwise). The
            mesh stays in the scene so the r3f raycaster still hits it. */}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      {/* VOLUMETRIC HALO — a soft camera-facing aura behind every medusa (not just the hero), tinted
          its own semantic hue and breathing with its pulse. Additive + no depth WRITE so it reads as
          glowing light in the water; Bloom feathers it into a true halo. depthTest stays ON so a far
          medusa's halo is correctly occluded by nearer creatures — with it OFF, back halos popped on
          top of front bells as the camera orbited (a flicker source). */}
      <sprite ref={(s) => { haloSprite.current = s; if (s) s.scale.setScalar(haloScale) }} position={[0, r * 0.15, -r * 0.2]} renderOrder={0}>
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
        {/* nodes flare a touch larger/brighter (0.05→0.07, 0.5→0.65) so the branch junctions thicken
            the fan and reinforce the "living mind" read through the now-clearer gel. */}
        <pointsMaterial
          color={spec.tankColor}
          size={r * 0.07}
          sizeAttenuation
          map={dotTexture()}
          alphaTest={0.01}
          transparent
          opacity={0.65 * (dimmed ? 0.4 : 1)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* REFRACTION — a real glass shell just inside the FOCAL creature's bell that BENDS the
          god-light, the other medusae, and the tentacles behind it (drei transmission). Each
          MeshTransmissionMaterial does a full-scene FBO render, so this MUST be the single focal hero
          only — gating on `hero` (vitality-sealed) fired one per creature (all 28 at the 1950s peak),
          the scene's dominant cost. The biggest "this is real, not CG" cue, kept where the eye is. */}
      {focal && (
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

      {/* FLOOR STINGS — terracotta sparks, one per discard unit, ringing the bell rim. One
          InstancedMesh instead of up to ~10 separate sphere meshes (was up to ~280 draws across the
          tank); identical additive coral dots. */}
      {spec.stings > 0 && (
        <StingSparks count={spec.stings} r={r} dimmed={dimmed} />
      )}

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

// Floor stings as ONE InstancedMesh — a shared unit sphere, one instance per discard unit placed
// around the bell rim. Collapses up to ~10 sphere draws (+ 10 geometry allocations) per creature to a
// single instanced draw; the additive coral look is byte-identical to the old per-mesh spheres.
const STING_GEO = new THREE.SphereGeometry(1, 8, 8) // unit sphere, scaled per-instance via the matrix
function StingSparks({ count, r, dimmed }: { count: number; r: number; dimmed: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const setMatrices = (m: THREE.InstancedMesh | null) => {
    ref.current = m
    if (!m) return
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(count, 1)) * Math.PI * 2
      dummy.position.set(Math.cos(ang) * r, -r * 0.05, Math.sin(ang) * r)
      dummy.scale.setScalar(r * 0.06)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }
  return (
    <instancedMesh ref={setMatrices} args={[STING_GEO, undefined, count]} renderOrder={3}>
      <meshBasicMaterial
        color="#ff6a3c"
        transparent
        opacity={0.95 * (dimmed ? 0.5 : 1)}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
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
