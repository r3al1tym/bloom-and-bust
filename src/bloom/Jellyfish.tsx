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
import { useBloomControls, beatEnvelope } from './bloomControls'

// FIXED pulse phase rate. The PHASE must ramp linearly with the clock — phase = t·RATE means angular
// velocity is exactly RATE. Multiplying the clock by a time-VARYING rate (as an earlier version did:
// t·pRate where pRate tracked live vitality) injects a spurious t·(dRate/dt) term that grows with
// elapsed wall-clock time — the pulse reverses mid-scrub and pops unboundedly the longer the page is
// open. So vitality drives pulse AMPLITUDE (pDepth) only, never the phase rate. (Verified defect.)
const PULSE_BASE_RATE = 1.2

// ── #2 UNIFORMITY = DEATH — the clinical over-saturated cyan the whole field drains toward as the bloom
// fills the frame. A jellyfish bloom is a MONOCULTURE: the varied ecosystem (many hues, independent
// breathing) collapses into one over-abundant species pulsing as a single organism. The fate hue is
// VESTIGIAL under the inverted premise (presence already signals collapse), so it's repurposed as a live
// "death" channel. Allocated ONCE at module scope. CYAN_MAX_PULL < 1 leaves a whisper of the original hue
// at full bloom so the field reads as drained, not a flat cyan fill. Keyed to the SHARED decadeProgress
// (never per-creature) so the whole field converges together. Pure f(clock, decadeProgress, seed) —
// reversible: hues re-vary and phases re-diverge on a backward scrub, no latch.
const CLINICAL_CYAN = new THREE.Color('#7FE8FF')
const CYAN_MAX_PULL = 0.9

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
    // ── #2 UNIFORMITY = DEATH (hue) — drain every medusa toward ONE clinical cyan as the bloom fills the
    // frame, so the varied 1950 ecosystem becomes a 2018 monoculture. targetColor is the single source
    // every channel (bell/neural/halo/tentacles) eases toward, so this one lerp drains the whole creature.
    // pow(dp,1.5) → the colour goes slightly BEFORE the pulse locks (#2 step below): hue first, then unison.
    targetColor.lerp(CLINICAL_CYAN, CYAN_MAX_PULL * Math.pow(ctl.decadeProgress, 1.5))
    targetColorB.copy(targetColor).multiplyScalar(1.5)

    // ── BLOOM PRESENCE — the inversion at the heart of the piece. A jellyfish is the SIGN of a
    // collapsed fishery: overfish a sea, the fish vanish, and jellyfish move into the empty water. So a
    // medusa here is ABSENT while its stock is healthy and BLOOMS into being — grows, brightens, swims —
    // as the stock collapses. `collapse` = how far the stock has fallen from its peak (0 healthy → 1
    // gone); `bloom` is its presence, with a faint floor so a healthy sea still holds a few drifting
    // jellyfish that then multiply and take over. The 2 survivors (mackerel, Norway lobster) never
    // collapse, so their slots stay near-empty — the ABSENCE of a jellyfish is the healthy outcome, and
    // the aggregate bloom fills the frame as the sum of every stock that fell. Pure f(glow ⟸ decadeF),
    // so it grows on a forward scrub and recedes on a backward one — no latch.
    const collapse = 1 - v.glow // 0 healthy → 1 collapsed
    const bloom = 0.05 + 0.95 * Math.pow(collapse, 0.9) // presence: faint floor → full vibrant medusa

    // #4 THE BEAT — during the scripted tipping point the medusae themselves dim (so the whole tank, not
    // just the world, goes dark in 'black') then flare on the ignite. `doom` 0..1 dims bell/glow/halo;
    // `flare` 0..1 lifts them as the light returns. Read via the shared envelope so every layer agrees.
    const beat = ctl.beatActive ? beatEnvelope(ctl.beatPhase, ctl.beatT) : { dark: 0, ignite: 0 }
    const doom = beat.dark
    const flare = beat.ignite
    // a bloomed jelly is VIBRANT and swimming; a barely-present one is faint and near-still. This drives
    // vitality/brightness (was the fish stock's own survival) — now it's the jellyfish's own thriving.
    const bloomAlive = 0.14 + 0.86 * bloom

    // pulse DEPTH + neural rate scale with the jellyfish's bloom (a full bloom breathes deep and fires
    // lively, a faint seed jelly is nearly still). The phase RATE is the fixed PULSE_BASE_RATE — vitality
    // never drives the phase (see the const: t·varying-rate injects a wall-clock-growing frequency error).
    const pDepth = 0.02 + 0.2 * bloom // shallow → deep muscular jet
    const pNeural = 0.1 + 1.0 * bloom

    // ── #2 UNIFORMITY = DEATH (pulse) — as the bloom fills the frame each medusa's independent pulse
    // offset collapses toward a single global clock, so the whole field contracts in eerie unison (the
    // monoculture breathing as one organism). pow(dp,2) keeps 1950 a living ecosystem of independent
    // phases and lets the lock bite only late. phaseOffset = mix(seed·2π, 0, unison): at full bloom every
    // creature's offset is 0 → identical phase. Pure f(clock, decadeProgress, seed), reversible.
    const unison = Math.pow(ctl.decadeProgress, 2)
    const phaseOffset = seed * 6.2831853 * (1 - unison)

    // ── #5 SHARED CAUSTIC DAPPLE — ripples of surface light graze the whole drift together, like
    // sun-dapple through moving water. Keyed to the creature's FIXED slot (position) × clock, so it
    // travels as a slow diagonal ripple across the field rather than every bell flickering in unison.
    // Scaled by v.glow (a dead husk isn't lit) and faded with the failing surface light
    // (decadeProgress → the dapple thins as the sea darkens). Folded into uGlowBoost (bell) at full and
    // the halo target at HALF (the additive halo already breathes ±15%, so full dapple there would throb).
    const caustic = 0.5 + 0.5 * Math.sin(t * 0.23 + position[0] * 0.35) * Math.sin(t * 0.15 - position[2] * 0.28 + 1.3)
    const dapple = 1 + 0.11 * (caustic * 2 - 1) * bloom * (1 - 0.5 * ctl.decadeProgress)

    // camera distance for this creature, computed ONCE per frame and reused by the halo-fog and the
    // draw-order rank (was two independent subtract+sqrt for the same value).
    const camDist = group.current ? group.current.position.distanceTo(state.camera.position) : 0
    if (bellMat.current) {
      const u = bellMat.current.uniforms
      u.uTime.value = t
      u.uGlowBoost.value = ctl.glowBoost * dapple // sun-dapple grazes the gel
      u.uFogDensity.value = ctl.fogDensity
      // BLOOM IN / FADE OUT — a medusa's opacity IS its bloom presence: near-invisible where its stock
      // is healthy (barely there in the empty 1950 water), fading up to a solid gel bell as the stock
      // collapses and the jellyfish takes over. So the frame fills with substance as the fishery empties.
      const target = (dimmed ? 0.55 : 1) * (0.06 + 0.94 * bloom) * (1 - 0.85 * doom)
      // during the beat the opacity must snap with it, not lag on the slow dt*4 low-pass
      u.uOpacity.value += (target - u.uOpacity.value) * (ctl.beatActive ? 0.3 : Math.min(1, dt * 4))
      // ease uniforms toward the current bloom state (colour / glow / pulse / aliveness)
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      ;(u.uColorB.value as THREE.Color).lerp(targetColorB, k)
      // interior lantern brightens as the jellyfish blooms — its own vitality, not a fish stock's. The
      // beat dims it toward dark (doom) then flares it brighter-than-normal as the light returns (flare).
      const glowTarget = bloom * (1 - 0.9 * doom) + 0.6 * flare
      u.uGlow.value += (glowTarget - u.uGlow.value) * (ctl.beatActive ? 0.3 : k)
      u.uAlive.value += (bloomAlive - u.uAlive.value) * k
      u.uSplit.value += (spec.engWeight - u.uSplit.value) * k
      u.uPulseRate.value += (PULSE_BASE_RATE - u.uPulseRate.value) * k // fixed phase rate (see const)
      u.uPulseDepth.value += (pDepth - u.uPulseDepth.value) * k
    }
    if (neuralMat.current) {
      const u = neuralMat.current.uniforms
      u.uTime.value = t
      u.uFogDensity.value = ctl.fogDensity
      u.uSpeed.value += (pNeural - u.uSpeed.value) * k
      ;(u.uColor.value as THREE.Color).lerp(targetColor, k)
      // the mind brightens as the jellyfish blooms into being — faint seed → lively full medusa. The
      // dendrite fan is HDR (the brightest element, bloom-amplified), so it MUST answer the beat too —
      // else the minds stay lit while the bells/halos go dark in 'black' (glowing brains in a black tank).
      // doom dims it toward dark; flare*bloom re-fires it on ignite (bloom-gated so faint survivors stay dark).
      // NEURAL doom is DEEPER than bell/halo (0.97 vs 0.9): the dendrite fan is HDR-spiked ×3.4 in-shader,
      // so at the bell's 0.1-floor the minds still bloom visibly — twinkling in a tank meant to hold its
      // breath. 0.97 near-extinguishes them so the minds go fully dark in 'black' (the emotional point).
      // gate the mind by bloom (× bloom) so a barely-present 1950 jelly has a DARK brain, not a lit one
      // floating over an invisible bell — the dendrite fan was the brightest thing left at the start.
      u.uIntensity.value = bloomAlive * bloom * (dimmed ? 0.4 : 1) * (1 - 0.97 * doom) + 0.35 * flare * bloom
    }
    if (glassRef.current) {
      // HERO GLASS SHELL — MeshTransmissionMaterial runs its own vertex shader, so it CAN'T carry the
      // bell's jet-pulse displacement; left alone it sits rigid inside the breathing bell, which is
      // exactly why the focused hero read as static/glassy. Reproduce the bell's dominant pulse
      // envelope (bloomShaders.bellVertex, sampled at the apex h≈1) as a non-uniform scale so the
      // refraction core squashes/bulges in lockstep with the gel around it. Base 0.94 = shell inset.
      const phase = t * PULSE_BASE_RATE + phaseOffset // fixed rate; offset converges with the field (#2)
      const s = Math.sin(phase)
      const p = (s > 0 ? Math.pow(s, 0.6) : -Math.pow(-s, 1.4)) * pDepth
      glassRef.current.scale.set(0.94 * (1 - p * 0.55), 0.94 * (1 + p), 0.94 * (1 - p * 0.55))
    }
    if (haloMat.current && group.current) {
      // ── #6 AURA BREATH-LAG — the glow swells just AFTER the bell contracts (a 0.8-rad lag) and drifts
      // on a slow second, incommensurate period, so the light feels emitted-and-diffusing rather than
      // painted in lockstep with the muscle. Same ±0.15 envelope as before, split across the two periods.
      // #2: the primary breath term converges (phaseOffset) so late-bloom auras swell together; the second
      // incommensurate term (seed·17) stays untouched so the field never reads as a perfectly dead metronome.
      const breath =
        0.85 + 0.1 * Math.sin(t * PULSE_BASE_RATE * 0.9 + phaseOffset - 0.8) + 0.05 * Math.sin(t * 0.13 + seed * 17.0)
      // atmospheric fog: the halo also attenuates into the haze with distance (same fogExp2 as the
      // scene + shaders) so far medusae don't glow sharp over the backdrop
      const fd = ctl.fogDensity * camDist
      const fog = 1 - Math.exp(-fd * fd)
      // halo strength scales with the jellyfish's bloom — a barely-present seed jelly has almost no aura,
      // a full bloom glows strong. The caustic dapple grazes it at HALF amplitude (it already breathes
      // above) so the shared sun-ripple lights the auras too without throbbing.
      // halo scales from ~0 (absent jelly = no aura) to full at bloom — the old 0.14 floor gave every
      // barely-present 1950 jelly a visible glow, part of the "too many at the start" read.
      const liveHaloBase = 0.02 + 0.84 * bloom
      const haloDapple = 1 + (dapple - 1) * 0.5
      const target =
        liveHaloBase * ctl.haloBoost * breath * haloDapple * (dimmed ? 0.4 : 1) * (1 - 0.7 * fog) * (1 - 0.9 * doom) + 0.25 * flare
      const cur = haloMat.current.opacity
      haloMat.current.opacity = cur + (target - cur) * (ctl.beatActive ? 0.3 : Math.min(1, dt * 4))
      haloMat.current.color.lerp(targetColor, k) // aura follows the current fate hue
      // P8: a fully-faded halo (fogged/dimmed husk) still rasterizes its giant additive quad — skip
      // the draw entirely below an epsilon (toggle the SPRITE object, not the material), restore above
      // it. Lossless (it contributes ~nothing there).
      if (haloSprite.current) haloSprite.current.visible = haloMat.current.opacity >= 0.012
    }
    // ── THE STROKE — hoisted above the tentacle loop so every layer (bell bob, body nod, tentacle
    // recoil) phase-locks to ONE propulsive stroke. `pulsePhase` is the shared jet clock; `stillness`
    // (1 alive → 0.15 husk) gates every living motion so a dying stock calms across all channels at
    // once. This coupling is what makes the animal read as swimming BECAUSE of its own pulse, rather
    // than a bell breathing while independent tentacles wave on a separate clock.
    // fixed phase rate (see PULSE_BASE_RATE) — vitality drives pulse AMPLITUDE (pDepth), never the phase.
    // #2: + phaseOffset (not raw seed·2π) so as the bloom fills, every creature's stroke converges to one
    // global clock and the whole field jets in unison — the single shared jet clock every layer locks to.
    const pulsePhase = t * PULSE_BASE_RATE + phaseOffset
    // LIVELINESS — living motion (bob, nod, tentacle recoil) scales with the jellyfish's BLOOM: a faint,
    // barely-present seed jelly drifts nearly still; a full bloom swims with muscle. So the sea comes
    // alive with motion exactly as it fills with jellyfish. (Was glow-gated for the old die-as-fish-die
    // reading; now bloom-gated for the fish-collapse-→-jellyfish-bloom reading.)
    // liveliness follows bloom but with a gentler curve (pow 1.1→0.8) so anything VISIBLE always drifts —
    // a present jelly should never read as a frozen prop. Absent jellies (bloom≈0.05) are now faded out by
    // the opacity/halo/neural gates above, so their stillness is invisible rather than a field of frozen skeletons.
    const liveliness = Math.pow(bloom, 0.8)

    // tentacles gain MUSCLE TONE as the jellyfish blooms: a seed jelly's trails barely stir, a full
    // bloom's swing with a live sway. Scale amp/freq by bloom off each material's own base (captured
    // once). A severed stub has base amp 0, so the multiply leaves it 0.
    const slackAmp = 0.25 + 0.75 * bloom
    const slackFreq = 0.4 + 0.6 * bloom
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
        // FADE THE TRAIL WITH THE BLOOM — the tentacles/arms must be near-invisible where the jelly is
        // barely present (else the 1950 sea reads as a field of skeletal trails + glowing minds while the
        // bells are gone — the "why so many jellyfish at the start" bug). Same 0.06→full curve as the bell
        // opacity, dimmed further by the beat's doom so they go dark in the tipping-point black too.
        m.uniforms.uOpacity.value = (0.04 + 0.96 * bloom) * (1 - 0.85 * doom)
        // ── #2 JET-RECOIL SURGE — the whole bundle whips taut on the contraction kick and streams back
        // out on the glide (overlapping action across the bell→tentacle boundary — the medusa's defining
        // secondary motion). Drives the shader's uSurge* uniforms off the SAME pulsePhase as the bell, so
        // the trail recoils exactly when the bell jets. `liveliness` scales it with the bloom; the
        // shader's own step(uAmp) guard keeps a severed stub from re-animating.
        if ('uSurgePhase' in m.uniforms) {
          m.uniforms.uSurgePhase.value = pulsePhase
          m.uniforms.uSurgeDepth.value = pDepth * liveliness
        }
      }
    if (group.current) {
      // shared water current — a slow common drift phased by world position, so the whole tank moves
      // as ONE medium (nearby creatures sway together) rather than as independent puppets. Layered
      // over each creature's own deterministic bob so the bloom breathes like a single body of water.
      const curX = Math.sin(t * 0.18 + position[0] * 0.25) * 0.18 + Math.sin(t * 0.11 + position[2] * 0.3) * 0.1
      const curY = Math.cos(t * 0.15 + position[0] * 0.2) * 0.12

      // (stillness + pulsePhase are hoisted above the tentacle loop so every layer shares one stroke.)

      // ── JET-AND-GLIDE BOB — the medusa KICKS then COASTS, it doesn't hover on a symmetric sine. A
      // fundamental + a small 2nd harmonic skews the waveform to a fast contraction (~37% of cycle) and
      // a slow drag-glide (~63%) — a real jet-propulsion silhouette. The harmonic coeff stays ≤0.30 so
      // vertical velocity keeps just two zero-crossings. `* liveliness` so a faint seed jelly barely stirs.
      const bob = pDepth * 0.55 * (Math.sin(pulsePhase) + 0.3 * Math.sin(2 * pulsePhase + 0.5)) * liveliness

      // ── BUOYANT ASCENT — the bloom drifts up the water column as ONE coherent mass. One IDENTICAL
      // vertical phase across the whole field (no seed, no position term) so it heaves together, not as
      // 28 independent bobs. Lift scales with the jellyfish's bloom, so as the sea fills with medusae the
      // whole rising mass builds. A tiny per-creature detune keeps the unison organic. Bounded pure
      // f(clock, bloom) — slot-anchored, no accumulator, reversible on forward/backward scrub.
      const riseCommon = 0.5 + 0.5 * Math.sin(t * 0.10) // 0..1, SHARED phase — the field lifts as one
      const detune = Math.sin(t * 0.13 + seed * 6.28) * 0.06 // ±0.06 organic jitter, well below the unison
      const lift = bloom * (0.15 + 0.55 * riseCommon + detune) // 0 when absent → hovers 0.15–0.70 when bloomed

      group.current.position.x = position[0] + curX
      group.current.position.y = position[1] + curY + bob + lift
      group.current.position.z = position[2] + Math.sin(t * 0.13 + position[0] * 0.35) * 0.12

      // ── ORIENTATION — vary the bell's tilt like a real drifting bloom instead of a field of upright
      // umbrellas: a deterministic resting pitch/roll per creature + a slow wander, and a lean into the
      // current. Kept gentle so the anatomy still reads. rotation.y keeps a slow turn so tentacles trail.
      // ── #3 STROKE COUNTER-NOD — the body rocks a hair with each jet (Newton's third law on the
      // water it pushes), lagged ~0.9rad behind the contraction so it reads as a REACTION to its own
      // thrust, not a synchronized tilt. `* liveliness` so a faint seed jelly doesn't nod. Phase-locked
      // to the same pulsePhase as the bob → the whole animal swims off one stroke.
      const nod = Math.sin(pulsePhase - 0.9) * pDepth * 0.22 * liveliness
      group.current.rotation.x = tilt.pitch + Math.sin(t * tilt.wSpeed + seed * 6.28) * 0.12 + nod
      group.current.rotation.z = tilt.roll + curX * 0.15 + Math.cos(t * tilt.wSpeed * 0.8 + seed * 3.1) * 0.1
      group.current.rotation.y = Math.sin(t * 0.15 + seed * 6.28) * 0.22
      // ── BLOOM SCALE — a jellyfish grows from a faint seed into a full medusa as its stock collapses,
      // so the tank fills with mass exactly as the fishery empties. Floored at 0.35 so an absent jelly is
      // a small drifting presence, not gone (the datum stays countable). Eased smoothly so scrubbing a
      // stock into collapse GROWS its jellyfish before your eyes.
      const s = (0.35 + 0.65 * bloom) * (selected ? 1.12 : 1)
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
      uSurgePhase: { value: 0 }, // driven per-frame from the creature's bell pulse (jet-recoil surge)
      uSurgeDepth: { value: 0 }, // = pDepth·stillness
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
