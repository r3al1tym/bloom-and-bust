// BLOOM — the cinematic jellyfish renderer. A drift of medusae in a deep, dark tank; each one a
// fish stock of the Northeast Atlantic. three.js + react-three-fiber, with a neuro-noise water
// column, god-ray atmosphere, a slow crane camera, and a postprocessing Bloom pass that amplifies
// only the HDR glow/spike terms (so meaning glows, not everything).
//
// This is the v2 "Thinking Medusa" renderer, severed from its origin project: it consumes a
// BloomSpec[] (built by bloomModel.ts from real catch data) and takes its data + selection as
// PROPS — no shared store, no pace-engine domain code.
import { useMemo, useRef, useEffect, type ComponentRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  EffectComposer,
  Bloom,
  ToneMapping,
  Vignette,
  SMAA,
  Noise,
} from '@react-three/postprocessing'
import { ToneMappingMode, BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { buildBloom, type BloomSpec } from './bloomModel'
import { Jellyfish } from './Jellyfish'
import { Atmosphere } from './Atmosphere'
import { useBloomControls, liveCamPose } from './bloomControls'
import { BloomControlPanel } from './BloomControlPanel'
import type { Stock } from '@/data/bloom'
import './bloom.css'

// Compose the bloom as a DRIFT the eye can read creature-by-creature — not the tight two-ring cram
// that made 28 large bells overlap into an unreadable clump. A Fibonacci (golden-angle) distribution
// projected into a wide, shallow ellipsoidal volume gives even, organic, NON-overlapping spacing so
// every stock is individually legible and the hue pattern (green survivors vs coral/slate husks)
// reads at a glance. Deterministic — no Math.random.
//
// The volume is WIDE in X (fills a cinematic frame), moderate in Y, and generous in Z so the
// front-to-back translucency + fog depth still read; the hero sits alone, forward and centred, as
// the lone lantern the camera cranes to.
function layout(specs: BloomSpec[]): [number, number, number][] {
  const n = specs.length
  // hero = a thriving survivor if any (the lone green lantern); else the biggest bell (most catch)
  let heroIdx = specs.findIndex((s) => s.vitality === 'sealed')
  if (heroIdx < 0) heroIdx = specs.reduce((best, s, i) => (s.bellRadius > specs[best].bellRadius ? i : best), 0)

  const out: [number, number, number][] = new Array(n)
  out[heroIdx] = [0, -0.2, 3.2] // centre, forward and slightly low — the subject the crane lands on

  const others = specs.map((_, i) => i).filter((i) => i !== heroIdx)
  const m = others.length
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)) // golden angle ≈ 2.399963 rad — even angular spread
  // half-axes of the drift ellipsoid (world units). WIDE + shallow-tall + deep for a big legible field.
  const RX = 13.5
  const RY = 7.0
  const RZ = 8.5
  others.forEach((idx, k) => {
    // Fibonacci-sphere point: cosθ walks evenly down [-1,1], φ advances by the golden angle. This is
    // the classic even-point-on-a-sphere construction — no clustering, no seams, fully deterministic.
    const t = (k + 0.5) / m
    const cosPol = 1 - 2 * t // -1..1
    const sinPol = Math.sqrt(Math.max(0, 1 - cosPol * cosPol))
    const phi = k * GOLDEN
    const ux = Math.cos(phi) * sinPol
    const uy = cosPol
    const uz = Math.sin(phi) * sinPol
    // A gentle deterministic radial jitter so it reads as an organic drift, not a taut shell.
    const rj = 0.82 + 0.18 * Math.sin(k * 1.7 + 0.5)
    const x = ux * RX * rj
    // bias the field a touch downward so the forward hero reads as rising above the drift
    const y = uy * RY * rj - 0.6
    // keep the whole field behind the hero plane (hero at z=3.2) so it never occludes the subject
    const z = uz * RZ * rj - 2.0
    out[idx] = [x, y, z]
  })
  return out
}

interface Props {
  stocks: Stock[]
  region: string
  span: string
  source: string
  sourceUrl: string
  decades: string[]
  spanYears: number
  decade: number
  onDecade: (d: number) => void
  playing?: boolean
  onPlayPause?: () => void
  onReset?: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function BloomRenderer({
  stocks,
  region,
  span,
  source,
  sourceUrl,
  decades,
  spanYears,
  decade,
  onDecade,
  playing = false,
  onPlayPause,
  onReset,
  selectedId,
  onSelect,
}: Props) {
  // Time flows continuously; React only rebuilds the specs at INTEGER decade boundaries (the only
  // structural change is tentacle severance, a discrete decade event). Everything visual — colour,
  // glow, mass, sink — is interpolated per-frame inside Jellyfish from the store's live decadeF, so a
  // smooth sweep costs zero per-frame React re-renders. Round to the nearest decade for the spec so a
  // severance appears at the decade it happens.
  const decadeInt = Math.round(decade)
  const specs = useMemo(() => buildBloom(stocks, decadeInt), [stocks, decadeInt])
  // layout is anchored to the stock set (not the decade) so creatures hold position as you scrub
  const baseSpecs = useMemo(() => buildBloom(stocks, 2), [stocks])
  const positions = useMemo(() => layout(baseSpecs), [baseSpecs])
  // the SINGLE focal creature the crane lands on — only it renders the costly refraction shell.
  // Same choice as layout()'s hero (a thriving survivor, else the biggest bell), resolved to an id so
  // it's stable across the decade scrub even as vitality flips.
  const focalId = useMemo(() => {
    let i = baseSpecs.findIndex((s) => s.vitality === 'sealed')
    if (i < 0) i = baseSpecs.reduce((best, s, k) => (s.bellRadius > baseSpecs[best].bellRadius ? k : best), 0)
    return baseSpecs[i]?.id ?? null
  }, [baseSpecs])
  const hasSelection = selectedId != null
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const detail = stocks.find((s) => s.id === selectedId) ?? null

  // RESET — snap the camera back to the canonical opening pose and replay the establishing crane, then
  // reset the timeline to 1950. The camera lives inside the Canvas (CinematicCamera owns it per-frame),
  // so we reset via the OrbitControls ref + bump replayNonce: CinematicCamera watches the nonce and,
  // on change, re-captures its base pose from the (now-reset) controls and re-runs the opening crane.
  const handleReset = () => {
    const c = controls.current
    if (c) {
      c.object.position.set(0, 1.0, 17) // the initial Canvas camera position
      c.target.set(0, 0, 0)
      c.update()
    }
    onSelect(null) // drop any open caption so the reset frame is the clean opening
    useBloomControls.setState((s) => ({ replayNonce: s.replayNonce + 1 }))
    onReset?.()
  }

  // LIGHT AS A CLOCK — publish the continuous clock to the store on every change (autoplay frame OR
  // scrubber drag). These are plain store values with no React subscribers, so writing them per-frame
  // costs no re-render; the per-frame useFrame loops (fog, god-rays, warm plankton, each Jellyfish)
  // read them via getState(). Fog itself is driven imperatively in FogClock below so the murk thickens
  // 0.09 → 0.15 as the fishery dies without a reactive fogDensity subscription re-rendering the scene.
  const decadeCount = Math.max(decades.length - 1, 1)
  useEffect(() => {
    const p = decade / decadeCount
    useBloomControls.setState({ decadeF: decade, decadeProgress: p })
  }, [decade, decadeCount])

  // current year, continuous (1950..2018), for the scrubber readout
  const year = Math.round(1950 + (decade / decadeCount) * spanYears)

  const bloomIntensity = useBloomControls((s) => s.bloomIntensity)
  const bloomThreshold = useBloomControls((s) => s.bloomThreshold)
  const bloomRadius = useBloomControls((s) => s.bloomRadius)
  const grain = useBloomControls((s) => s.grain)
  const vignette = useBloomControls((s) => s.vignette)

  return (
    <div className="bloom">
      <BloomControlPanel />
      <div className={`bloom-tank${hasSelection ? ' has-selection' : ''}`}>
        <Canvas
          camera={{ position: [0, 1.0, 17], fov: 52 }}
          gl={{ antialias: false, toneMappingExposure: 1.15 }}
          dpr={[1, 1.75]}
          onPointerMissed={() => onSelect(null)}
        >
          <color attach="background" args={['#02080e']} />
          <TankBackground />
          <fogExp2 attach="fog" args={['#071a26', 0.09]} />
          <FogClock />
          <ambientLight intensity={0.2} />
          <pointLight position={[-2, 12, 5]} intensity={0.5} color="#8fd4e6" />
          <Atmosphere />
          <OrbitControls
            ref={controls}
            enablePan={false}
            minDistance={5}
            maxDistance={40}
            enableDamping
            dampingFactor={0.08}
            target={[0, 0, 0]}
          />
          <CinematicCamera controls={controls} />
          {specs.map((spec, i) => (
            <Jellyfish
              key={spec.id}
              spec={spec}
              stock={stocks[i]}
              position={positions[i]}
              selected={spec.id === selectedId}
              dimmed={hasSelection && spec.id !== selectedId}
              focal={spec.id === focalId}
              onSelect={() => onSelect(spec.id)}
            />
          ))}

          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom
              mipmapBlur
              luminanceThreshold={bloomThreshold}
              luminanceSmoothing={0.36}
              intensity={bloomIntensity}
              radius={bloomRadius}
            />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette
              eskil={false}
              darkness={hasSelection ? vignette + 0.13 : vignette}
              offset={hasSelection ? 0.26 : 0.3}
            />
            <SMAA />
            <Noise blendFunction={BlendFunction.OVERLAY} opacity={grain} />
          </EffectComposer>
        </Canvas>
        {/* orbit affordance — a one-shot whisper that fades itself out after the opening beat (CSS
            animation, auto-fade), so it's discoverable on load without standing as permanent chrome. */}
        <div className="bloom-hint mono">drag to orbit · scroll to zoom · click a medusa</div>

        {/* CONTINUOUS year scrubber — plays a smooth 1950→2018 sweep on load (the tank goes dark on its
            own), then drag to explore. Play/pause holds the sweep with the playhead intact; reset
            returns to 1950 AND snaps the camera back to the opening crane. Fine step so a hand-drag
            flows like playback, not in decade jumps. */}
        <div className={`scrubber${playing ? ' is-playing' : ''}`}>
          <button
            className="scrubber-btn"
            onClick={onPlayPause}
            aria-label={playing ? 'pause' : 'play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            className="scrubber-btn"
            onClick={handleReset}
            aria-label="reset to 1950"
            title="Reset — year and camera"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v4h4" />
            </svg>
          </button>
          <span className="scrubber-decade mono">{year}</span>
          <input
            type="range"
            min={0}
            max={6}
            step={0.02}
            value={decade}
            onChange={(e) => onDecade(Number(e.target.value))}
            aria-label="year"
            style={{ ['--fill' as string]: `${(decade / 6) * 100}%` }}
          />
          {playing && (
            <span className="scrubber-hint">the light going out is the fishery’s decline</span>
          )}
        </div>
      </div>

      {/* WALL-LABEL — type floating on the water, top-left, no panel. A confident title, one deck line,
          and the anatomy folded behind a small cue (a gallery label you can open, not a HUD). */}
      <aside className="bloom-side">
        <h1 className="bloom-h1">Bloom &amp; Bust</h1>
        <p className="bloom-lede">
          Each jellyfish is a fish stock of the {region}, {span}. Scrub the years; the tank thins as the
          fisheries fall.
        </p>
        <details className="bloom-anatomy-fold">
          <summary className="bloom-anatomy-cue mono">Read the bodies</summary>
          <ul className="bloom-anatomy">
            <li><b>Bell size</b> — the stock's total catch</li>
            <li><b>Hue</b> — its fate vs its own historical peak</li>
            <li><b>Pulse</b> — <i>thriving</i> breathes slow · <i>declining</i> flutters · a <i>husk</i> is nearly still</li>
            <li><b>7 tentacles</b> — the seven decades; a <i>stump</i> where it collapsed</li>
            <li><b>Oral arms</b> — the share of catch on the official books</li>
            <li><b>Stings</b> — dead bycatch discarded at sea</li>
            <li><b>Two-tone</b> — industrial vs small-scale fleet</li>
          </ul>
        </details>
      </aside>

      {/* the selected-stock memorial + source credit float bottom-right, on the scrim, no box. Pinned
          bottom-right where the drift is sparser and the centre-forward hero never reaches. */}
      <div className={`bloom-footer${detail ? ' has-detail' : ''}`}>
        {detail && (
          <div className="bloom-caption">
            <div className="bloom-caption-id mono">{detail.scientific}</div>
            <div className="bloom-caption-title">{detail.name}</div>
            <p className="bloom-caption-status">
              Peaked in the <strong>{detail.peakDecade}</strong> at{' '}
              <strong>{detail.peakTonnes.toLocaleString()} t</strong>. By the 2010s the catch was{' '}
              <strong style={{ color: FATE_HEX(detail.status) }}>{detail.pctOfPeak}%</strong> of
              that — {detail.lastTonnes.toLocaleString()} t.
              {detail.discardShare > 0.2 && ` ${Math.round(detail.discardShare * 100)}% discarded dead.`}
              {detail.reportedShare < 0.6 &&
                ` Only ${Math.round(detail.reportedShare * 100)}% ever reached the official books.`}
            </p>
          </div>
        )}
        <p className="bloom-src mono">
          Data: <a href={sourceUrl} target="_blank" rel="noreferrer">{source}</a> · three.js, client-side.
        </p>
      </div>
    </div>
  )
}

import { FATE_COLOR, type Fate } from '@/data/bloom'
const FATE_HEX = (f: Fate) => FATE_COLOR[f]

// The murk thickens as the fishery dies — driven imperatively from the store clock so continuous time
// costs no per-frame React re-render. Eases the scene fogExp2 density (and mirrors it into the store's
// fogDensity, which the custom shaders read via getState()) from clear water (0.09) toward murk (0.15).
// Capped at 0.15 so the 8 collapsed + 3 husk creatures stay individually countable in the 2018 frame.
function FogClock() {
  const { scene } = useThree()
  useFrame(() => {
    const p = useBloomControls.getState().decadeProgress
    const target = 0.09 + (0.15 - 0.09) * p
    const fog = scene.fog as THREE.FogExp2 | null
    if (fog && 'density' in fog) {
      fog.density += (target - fog.density) * 0.06 // ease so a scrub isn't a snap
      if (useBloomControls.getState().fogDensity !== fog.density)
        useBloomControls.setState({ fogDensity: fog.density }) // keep shaders' getState() read in sync
    }
  })
  return null
}

// A slow cinematic camera drift — a high reveal that cranes down and around to the hero, then a
// sustained orbit. Yields to any user drag/zoom and eases back in after an idle beat. Verbatim from
// v2 (domain-agnostic — only touches the camera).
function CinematicCamera({ controls }: { controls: RefObject<ComponentRef<typeof OrbitControls> | null> }) {
  const { camera } = useThree()
  const idle = useRef(0)
  const hold = useRef(0)
  const phase = useRef(0)
  const base = useRef<{ az: number; pol: number; rad: number } | null>(null)
  const firstRun = useRef(true)
  const lastNonce = useRef(0)
  const sph = useMemo(() => new THREE.Spherical(), [])
  const want = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const dom = c.domElement || document.querySelector('.bloom-tank canvas')
    const onUser = () => {
      idle.current = 0
      hold.current = 0.8
      base.current = null
      firstRun.current = false
    }
    if (!dom) return
    dom.addEventListener('pointerdown', onUser)
    dom.addEventListener('wheel', onUser, { passive: true })
    return () => {
      dom.removeEventListener('pointerdown', onUser)
      dom.removeEventListener('wheel', onUser)
    }
  }, [controls])

  useFrame((_s, dt) => {
    const c = controls.current
    if (!c) return
    const st = useBloomControls.getState()

    liveCamPose.az = c.getAzimuthalAngle()
    liveCamPose.pol = c.getPolarAngle()
    liveCamPose.rad = c.getDistance()

    if (st.freeze) {
      base.current = null
      firstRun.current = false
      idle.current = 0
      hold.current = 0.4
      return
    }

    if (st.replayNonce !== lastNonce.current) {
      lastNonce.current = st.replayNonce
      phase.current = 0
      idle.current = 3
      hold.current = 0
      base.current = null
      firstRun.current = true
    }

    idle.current += dt
    const gate = Math.min(1, Math.max(0, (idle.current - hold.current) / 2.2))
    if (gate <= 0) return
    const { driftSpeed, driftAmount, camStart, camEnd } = st
    phase.current += dt * gate * driftSpeed

    if (!base.current) {
      base.current = { az: c.getAzimuthalAngle(), pol: c.getPolarAngle(), rad: c.getDistance() }
    }
    const b = base.current
    const t = phase.current
    const establishing = firstRun.current
    const authored = establishing && camStart != null && camEnd != null

    const TAU = 5.0
    const descend = establishing ? 1 - Math.exp(-t / 7.0) : 1
    const drawIn = establishing ? 1 - Math.exp(-t / 1.75) : 1

    const START_POL = 0.42
    const START_RAD_MUL = 1.45
    const START_AZ_OFF = 0.7
    // Settle FARTHER than the origin's 0.78 crowd-in: the drift is now a wide 28-creature field, so the
    // hero-landing frame must keep the whole bloom legible (green survivors vs coral/slate husks reading
    // across the frame) rather than filling the view with a few foreground bells. 0.98 = a gentle
    // draw-in that still lands on the hero without crowding out the data pattern.
    const HERO_RAD_MUL = establishing ? 0.98 : 1.0
    const START = authored
      ? camStart!
      : { az: b.az + START_AZ_OFF, pol: Math.min(b.pol, START_POL), rad: b.rad * START_RAD_MUL }
    const HERO = authored ? camEnd! : { az: b.az, pol: b.pol, rad: b.rad * HERO_RAD_MUL }

    // ── ESTABLISHING CRANE (unchanged intent): descend from the high, wide START to the settled HERO
    // framing, winding a gentle net orbit so the reveal arcs IN rather than just dropping straight down.
    const ORBIT_SPEED = 0.05
    const orbit = ORBIT_SPEED * (t - TAU * (1 - Math.exp(-t / TAU)))
    const heroAz = HERO.az + orbit
    const baseAz = START.az + (heroAz - START.az) * descend
    const basePol = START.pol + (HERO.pol - START.pol) * descend
    const settledRad = START.rad + (HERO.rad - START.rad) * drawIn

    // ── DIVER-CAM — once the crane settles, the camera stops behaving like a tripod on a turntable
    // circling a tank and starts behaving like a National Geographic operator in neutral buoyancy in
    // the deep: it drifts THROUGH the bloom, its look-point wandering across the swarm, with slow
    // non-circular dolly pushes-and-retreats, a buoyant bob, and a touch of handheld roll — never a
    // clean circle. Everything is a sum of sines at incommensurate (irrational-ish) frequencies so the
    // path has no repeating period and never reads as a loop. It FADES IN as the establishing crane
    // completes (t 4s→9s) so it doesn't fight the reveal, and is full-strength on every later drift-in.
    const diver = establishing ? THREE.MathUtils.smoothstep(t, 4.0, 9.0) : 1.0
    const A = driftAmount * diver
    // two-octave sine wander: two incommensurate frequencies so it wanders like a current, not a wave.
    const w = (f1: number, a1: number, f2: number, a2: number, ph: number) =>
      a1 * Math.sin(t * f1 + ph) + a2 * Math.sin(t * f2 + ph * 1.7)

    const az = baseAz + w(0.037, 0.17, 0.019, 0.11, 0.0) * A // drift around the bloom, not a clean circle
    const pol = basePol + w(0.028, 0.10, 0.015, 0.05, 2.1) * A // the eye-line rises and sinks
    // slow dolly: push IN toward the bloom then pull back OUT (a diver approaching subjects and easing
    // off), plus a faint faster breath on the radius. During establishing keep the old gentle pull.
    const dolly = 1 + (w(0.023, 0.11, 0.041, 0.05, 4.3) + 0.018 * Math.sin(t * 0.6)) * A
    const rad = establishing
      ? settledRad * (1 - 0.06 * drawIn * Math.sin(t * 0.24)) * dolly
      : settledRad * dolly

    // the LOOK-POINT drifts through the swarm (the operator tracking subjects), so the framing isn't
    // pinned dead-centre. Ease OrbitControls' own target toward the wander point so c.update() looks
    // there — and so a later user-orbit pivots around wherever the camera had drifted to. Bounded +
    // slight downward bias (peering into the deep). Lerped (not set) so resuming from a user drag eases
    // in without a snap. During establishing A≈0, so the target stays at origin for a clean crane.
    const tx = w(0.024, 2.0, 0.013, 1.2, 0.5) * A
    const ty = (w(0.020, 1.1, 0.038, 0.5, 3.4) - 0.4) * A
    const tz = w(0.017, 1.7, 0.031, 0.9, 1.2) * A
    c.target.x += (tx - c.target.x) * Math.min(1, dt * 1.5)
    c.target.y += (ty - c.target.y) * Math.min(1, dt * 1.5)
    c.target.z += (tz - c.target.z) * Math.min(1, dt * 1.5)

    sph.set(rad, pol, az)
    sph.makeSafe()
    want.setFromSpherical(sph).add(c.target)
    // buoyant bob on the camera body itself — a small, slightly faster vertical breath (the operator
    // floating in place), layered so it doesn't beat against the eye-line wander.
    want.y += (0.14 * Math.sin(t * 0.9 + 1.0) + 0.06 * Math.sin(t * 1.7)) * A
    camera.position.copy(want)
    c.update() // orients the camera to look at c.target (the wandering look-point)
    // handheld ROLL — a subtle tilt around the view axis so the horizon isn't locked dead-flat. Applied
    // AFTER c.update() (which enforces up-vector); re-applied each frame, and harmless to orbit state
    // (OrbitControls derives its angles from camera POSITION, not roll).
    const roll = (0.02 * Math.sin(t * 0.23) + 0.011 * Math.sin(t * 0.52 + 2.0)) * A
    camera.rotateZ(roll)
  })
  return null
}

// A dark, mysterious deep-water column: a neuro-noise web (recursive rotating-sine fractal) reads at
// once as a neural mesh and as underwater caustics. Verbatim from v2 (pure shader, no domain code).
function TankBackground() {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTop: { value: new THREE.Color('#08202c') },
      uBottom: { value: new THREE.Color('#02080e') },
      uCaustic: { value: new THREE.Color('#2688a0') },
      uSurface: { value: new THREE.Color('#3ea0bc') },
    }),
    [],
  )
  useFrame((s) => {
    if (mat.current) mat.current.uniforms.uTime.value = s.clock.elapsedTime * useBloomControls.getState().waterSpeed
  })
  return (
    <mesh scale={60} frustumCulled={false} renderOrder={-100}>
      {/* 64×64 is plenty: the vertex shader only normalizes position, so the gradient+neuro-noise is
          entirely pixel-driven — ~32k tris → ~8k tris is visually identical. */}
      <sphereGeometry args={[1, 64, 64]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={true}
        depthTest={true}
        fog={false}
        toneMapped={false}
        vertexShader={/* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform vec3 uTop;
          uniform vec3 uBottom;
          uniform vec3 uCaustic;
          uniform vec3 uSurface;
          varying vec3 vPos;

          float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5); }
          float vnoise(vec3 p){
            vec3 i = floor(p), f = fract(p);
            f = f*f*(3.0-2.0*f);
            float n = mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                              mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                              mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
            return n;
          }
          float fbm(vec3 p){
            float v=0.0, a=0.5;
            for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; }
            return v;
          }
          vec2 rotate(vec2 v, float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c) * v; }
          float neuroShape(vec2 uv, float t){
            vec2 sine_acc = vec2(0.0);
            vec2 res = vec2(0.0);
            float scale = 8.0;
            for (int j = 0; j < 15; j++) {
              uv = rotate(uv, 1.0);
              sine_acc = rotate(sine_acc, 1.0);
              vec2 layer = uv * scale + float(j) + sine_acc - t;
              sine_acc += sin(layer);
              res += (0.5 + 0.5 * cos(layer)) / scale;
              scale *= 1.2;
            }
            return res.x + res.y;
          }
          void main() {
            float h = clamp(vPos.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 base = mix(uBottom, uTop, pow(h, 1.5));
            float surface = pow(smoothstep(0.55, 1.0, h), 2.0);
            base += uSurface * surface * 0.45;
            float fromAbove = pow(h, 1.3);
            vec3 col = base;
            vec2 web_uv = vPos.xy / (abs(vPos.z) + 0.55);
            web_uv *= 1.15;
            float t = 0.5 * uTime;
            float web = neuroShape(web_uv, t);
            web = (1.0 + 0.05) * web * web;
            web = pow(web, 0.7 + 6.0 * 0.30);
            web = min(1.4, web);
            float nodes = smoothstep(0.7, 1.4, web);
            col += uCaustic * web * (0.14 + 0.5 * fromAbove) * 0.34;
            col += uSurface * nodes * (0.18 + 0.55 * fromAbove) * 0.28;
            float swell = fbm(vec3(vPos.xz * 1.6, uTime * 0.03)) * 0.12;
            col += uCaustic * swell * (0.35 + 0.65 * fromAbove);
            float dust = fbm(vec3(vPos * 14.0 + vec3(uTime * 0.05, uTime * 0.11, 0.0)));
            col += uSurface * smoothstep(0.72, 1.0, dust) * 0.07;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  )
}
