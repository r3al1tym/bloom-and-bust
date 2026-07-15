// BLOOM — the cinematic jellyfish renderer. A drift of medusae in a deep, dark tank; each one a
// fish stock of the Northeast Atlantic. three.js + react-three-fiber, with a neuro-noise water
// column, god-ray atmosphere, a slow crane camera, and a postprocessing Bloom pass that amplifies
// only the HDR glow/spike terms (so meaning glows, not everything).
//
// This is the v2 "Thinking Medusa" renderer, severed from its origin project: it consumes a
// BloomSpec[] (built by bloomModel.ts from real catch data) and takes its data + selection as
// PROPS — no shared store, no pace-engine domain code.
import { useMemo, useRef, useLayoutEffect, type ComponentRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { buildBloom, visualsAsOf, type BloomSpec } from './bloomModel'
import { Jellyfish } from './Jellyfish'
import { Atmosphere } from './Atmosphere'
import { useBloomControls, worldDarkness, beatEnvelope } from './bloomControls'
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
  const heroIndices = specs
    .map((spec, index) => ({ index, score: spec.glow * spec.bellRadius }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ index }) => index)
  const heroSlots: [number, number, number][] = [[2.6, 1.4, 3.6], [-4.3, 2.3, 1.2], [6.3, -1.2, -0.2]]

  const out: [number, number, number][] = new Array(n)
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)) // golden angle ≈ 2.399963 rad — even angular spread
  // half-axes of the drift ellipsoid (world units). WIDE + shallow-tall + deep for a big legible field.
  const RX = 13.8
  const RY = 7.6
  const RZ = 11.5
  specs.forEach((_, idx) => {
    const heroSlot = heroIndices.indexOf(idx)
    if (heroSlot >= 0) {
      out[idx] = heroSlots[heroSlot]
      return
    }
    // Fibonacci-sphere point: cosθ walks evenly down [-1,1], φ advances by the golden angle. This is
    // the classic even-point-on-a-sphere construction — no clustering, no seams, fully deterministic.
    const t = (idx + 0.5) / n
    const cosPol = 1 - 2 * t // -1..1
    const sinPol = Math.sqrt(Math.max(0, 1 - cosPol * cosPol))
    const phi = idx * GOLDEN
    const ux = Math.cos(phi) * sinPol
    const uy = cosPol
    const uz = Math.sin(phi) * sinPol
    // A gentle deterministic radial jitter so it reads as an organic drift, not a taut shell.
    const rj = 0.82 + 0.18 * Math.sin(idx * 1.7 + 0.5)
    const x = ux * RX * rj
    // bias the field a touch downward so the forward hero reads as rising above the drift
    const y = uy * RY * rj - 0.6
    // keep the whole field behind the hero plane (hero at z=3.2) so it never occludes the subject
    const z = uz * RZ * rj - 5.0
    out[idx] = [x, y, Math.min(z, 0.2)]
  })
  return out
}

function RenderProbe() {
  const { gl, scene, camera } = useThree()
  const frames = useRef(0)
  useFrame(() => {
    frames.current += 1
    if (frames.current % 30 !== 0) return
    ;(window as Window & { __bloomProbe?: unknown }).__bloomProbe = {
      frames: frames.current,
      camera: camera.position.toArray(),
      direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      children: scene.children.map((child) => ({ name: child.name, type: child.type, visible: child.visible })),
      render: { ...gl.info.render },
      memory: { ...gl.info.memory },
      background: scene.background instanceof THREE.Color ? scene.background.getHexString() : null,
    }
  }, -1000)
  return null
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
  const finalSpecs = useMemo(() => buildBloom(stocks, 6), [stocks])
  const focalIndex = useMemo(
    () => finalSpecs.reduce(
      (best, spec, i) => (
        spec.glow * spec.bellRadius > finalSpecs[best].glow * finalSpecs[best].bellRadius ? i : best
      ),
      0,
    ),
    [finalSpecs],
  )
  const positions = useMemo(() => layout(baseSpecs), [baseSpecs])
  const focalId = finalSpecs[focalIndex]?.id ?? null
  const hasSelection = selectedId != null
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const ambientRef = useRef<THREE.AmbientLight>(null) // #1 — dimmed/cooled by WorldDarkClock as the sea dies
  const pointRef = useRef<THREE.PointLight>(null)
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
    // clear the scripted beat too so a reset re-arms it (App.tsx also re-arms its own hasFiredBeat)
    useBloomControls.setState((s) => ({ replayNonce: s.replayNonce + 1, beatActive: false, beatT: 0, beatPhase: 'idle' }))
    onReset?.()
  }

  // LIGHT AS A CLOCK — publish the continuous clock to the store on every change (autoplay frame OR
  // scrubber drag). These are plain store values with no React subscribers, so writing them per-frame
  // costs no re-render; the per-frame useFrame loops (fog, god-rays, warm plankton, each Jellyfish)
  // read them via getState(). Fog itself is driven imperatively in FogClock below so the murk thickens
  // 0.09 → 0.15 as the fishery dies without a reactive fogDensity subscription re-rendering the scene.
  const decadeCount = Math.max(decades.length - 1, 1)
  useLayoutEffect(() => {
    const p = decade / decadeCount
    // AGGREGATE BLOOM LEVEL — mean over the 28 stocks of (1 - glow) at the live decade, the exact
    // per-creature `collapse` averaged. Computed ONCE here (28 cheap pure calls, no re-render — plain
    // store write with no subscribers) so darkness-rise / uniformity / the beat all read one honest
    // number rather than re-deriving it per creature.
    let sum = 0
    for (const s of stocks) sum += visualsAsOf(s, decade).glow
    const bloomLevel = sum / Math.max(1, stocks.length)
    useBloomControls.setState({ decadeF: decade, decadeProgress: p, bloomLevel })
  }, [decade, decadeCount, stocks])

  // current year, continuous (1950..2018), for the scrubber readout
  const year = Math.round(1950 + (decade / decadeCount) * spanYears)

  return (
    <div className="bloom">
      <BloomControlPanel />
      <div className={`bloom-tank${hasSelection ? ' has-selection' : ''}`}>
        <span className="bloom-build-stamp" aria-hidden="true">gel-ruffle-3</span>
        <Canvas
          camera={{ position: [0, 1.0, 17], fov: 52 }}
          gl={{
            antialias: false,
            toneMapping: THREE.NoToneMapping,
            toneMappingExposure: 1,
          }}
          dpr={[1, 1.75]}
          onCreated={(state) => {
            ;(window as Window & { __bloomState?: unknown; __bloomFocal?: unknown }).__bloomState = state
            ;(window as Window & { __bloomFocal?: unknown }).__bloomFocal = {
              id: focalId,
              index: focalIndex,
              position: positions[focalIndex],
              spec: finalSpecs[focalIndex],
            }
          }}
          onPointerMissed={() => onSelect(null)}
        >
          <color attach="background" args={['#02080e']} />
          <RenderProbe />
          <TankBackground />
          <fogExp2 attach="fog" args={['#071a26', 0.09]} />
          <FogClock />
          <WorldDarkClock ambient={ambientRef} point={pointRef} />
          <ambientLight ref={ambientRef} intensity={0.2} />
          <pointLight ref={pointRef} position={[-2, 12, 5]} intensity={0.5} color="#8fd4e6" />
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
          {/* The data field animates continuously; keep the camera composed and stable. User orbit
              remains available, but an unattended camera must never fly through a foreground bell. */}
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
              luminanceThreshold={0.72}
              luminanceSmoothing={0.22}
              intensity={1.15}
              radius={0.62}
            />
            <Vignette eskil={false} offset={0.3} darkness={hasSelection ? 0.62 : 0.48} />
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
            <span className="scrubber-hint">the light follows catch falling from historical peaks</span>
          )}
        </div>
      </div>

      {/* WALL-LABEL — type floating on the water, top-left, no panel. A confident title, one deck line,
          and the anatomy folded behind a small cue (a gallery label you can open, not a HUD). */}
      <aside className="bloom-side">
        <h1 className="bloom-h1">Bloom &amp; Bust</h1>
        <p className="bloom-lede">
          Fish declines can help jellyfish flourish. Here that ecological pattern becomes a metaphor:
          28 medusae embody reconstructed {region} catch from {span}. Their changing bodies show catch
          relative to each taxon's observed peak — not measured jellyfish abundance or an independent
          stock assessment.
        </p>
        <details className="bloom-anatomy-fold">
          <summary className="bloom-anatomy-cue mono">Read the bodies</summary>
          <ul className="bloom-anatomy">
            <li><b>Bell size</b> — the taxon's lifetime reconstructed catch</li>
            <li><b>Hue</b> — catch relative to its own observed peak</li>
            <li><b>Pulse</b> — near-peak catch breathes slow · lower catch fades and stills</li>
            <li><b>7 tentacles</b> — seven decade buckets; a <i>stump</i> once catch fell below one-third of peak</li>
            <li><b>Oral arms</b> — the share of catch on the official books</li>
            <li><b>Stings</b> — catch discarded at sea</li>
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
          Catch data: <a href={sourceUrl} target="_blank" rel="noreferrer">{source}</a> · three.js, client-side.
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
    const target = 0.07 + (0.095 - 0.07) * p
    const fog = scene.fog as THREE.FogExp2 | null
    if (fog && 'density' in fog) {
      fog.density += (target - fog.density) * 0.06 // ease so a scrub isn't a snap
      if (useBloomControls.getState().fogDensity !== fog.density)
        useBloomControls.setState({ fogDensity: fog.density }) // keep shaders' getState() read in sync
    }
  })
  return null
}

// #1 DARKNESS RISES — the master light levers. As the fishery collapses the whole SCENE loses its own
// light so the emissive bloom is all that's left: tone-mapping exposure drops (ACES applies exposure
// pre-fit, so this ~halves the linear gain on the dark water while the HDR glow cores stay on the ACES
// shoulder → the bloom reads as self-lit and GAINS contrast as the water falls away), and the fill
// lights dim + go cold. Exposure is FLOORED at 0.60 so the 28 bell silhouettes never crush out — the
// cardinal failure. worldDarkness(0)=0 so at 1950 exposure=1.15 / lights=baseline (frame unchanged).
function WorldDarkClock({ ambient, point }: { ambient: RefObject<THREE.AmbientLight | null>; point: RefObject<THREE.PointLight | null> }) {
  const gl = useThree((s) => s.gl)
  const baseKey = useMemo(() => new THREE.Color('#8fd4e6'), [])
  const deadKey = useMemo(() => new THREE.Color('#24424a'), [])
  useFrame(() => {
    const st = useBloomControls.getState()
    const d = worldDarkness(st.decadeProgress)
    // #4 THE BEAT rides ON TOP of the steady-state darkness: `dark` pushes exposure toward black through
    // fade+black, `ignite` lifts it back as the light returns. When the beat is active we ease faster so
    // the ~1.4s snap actually lands (the 0.06 low-pass is tuned for a slow scrub, too slow for the beat).
    const env = st.beatActive ? beatEnvelope(st.beatPhase, st.beatT) : { dark: 0, ignite: 0 }
    const ease = st.beatActive ? 0.22 : 0.06
    // exposure: steady-state floor 0.60, dropped toward ~0.06 by the beat's dark, lifted +0.5 by ignite.
    const expBase = 1
    const expTarget = expBase * (1 - 0.9 * env.dark) + 0.5 * env.ignite
    gl.toneMappingExposure += (expTarget - gl.toneMappingExposure) * ease
    if (ambient.current) {
      const at = (0.32 - 0.12 * d) * (1 - env.dark) + 0.15 * env.ignite
      ambient.current.intensity += (at - ambient.current.intensity) * ease
    }
    if (point.current) {
      const pt = (0.92 - 0.42 * d) * (1 - env.dark) + 0.4 * env.ignite
      point.current.intensity += (pt - point.current.intensity) * ease
      point.current.color.copy(baseKey).lerp(deadKey, d) // teal fill cools to a dead slate
    }
  })
  return null
}

// A dark, mysterious deep-water column: a neuro-noise web (recursive rotating-sine fractal) reads at
// once as a neural mesh and as underwater caustics. Verbatim from v2 (pure shader, no domain code).
// #1 DARKNESS RISES: the palette DROWNS toward these near-black targets as the fishery collapses — the
// bright surface band goes out, the top gradient sinks to black, the caustic web desaturates — so by
// 2018 the water emits no light of its own and the bloom is the only thing lit. uBottom is left alone
// (already near-black). Captured from the live uniforms on the first frame so it darkens FROM whatever
// palette is authored, not a hardcode.
const TANK_TOP_DEAD = new THREE.Color('#050d12')
const TANK_CAU_DEAD = new THREE.Color('#17313a')
const TANK_SUR_DEAD = new THREE.Color('#0c1a22')
function TankBackground() {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      // Documentary grade — DEEP WATER, not the surface seen from below. Top gradient is a deep desat
      // teal (was #08202c, lighter/greener); caustic + surface accents pulled deeper + less electric so
      // the column reads as light SCATTERING in deep water rather than a bright ceiling of surface caustics.
      uTop: { value: new THREE.Color('#0a2430') },
      uBottom: { value: new THREE.Color('#01060a') },
      uCaustic: { value: new THREE.Color('#1c6f83') },
      uSurface: { value: new THREE.Color('#2b7e94') },
    }),
    [],
  )
  const captured = useRef(false)
  const base = useMemo(() => ({ top: new THREE.Color(), cau: new THREE.Color(), sur: new THREE.Color() }), [])
  const scratch = useMemo(() => new THREE.Color(), [])
  useFrame((s) => {
    if (!mat.current) return
    const u = mat.current.uniforms
    u.uTime.value = s.clock.elapsedTime * useBloomControls.getState().waterSpeed
    // capture the authored palette once, then ease each channel toward its drowned target by worldDarkness
    if (!captured.current) {
      base.top.copy(u.uTop.value as THREE.Color)
      base.cau.copy(u.uCaustic.value as THREE.Color)
      base.sur.copy(u.uSurface.value as THREE.Color)
      captured.current = true
    }
    const d = worldDarkness(useBloomControls.getState().decadeProgress)
    const ease = 0.06 // low-pass so a scrub glides, matching FogClock / god-rays
    ;(u.uTop.value as THREE.Color).lerp(scratch.copy(base.top).lerp(TANK_TOP_DEAD, d), ease)
    ;(u.uCaustic.value as THREE.Color).lerp(scratch.copy(base.cau).lerp(TANK_CAU_DEAD, d), ease)
    ;(u.uSurface.value as THREE.Color).lerp(scratch.copy(base.sur).lerp(TANK_SUR_DEAD, d), ease)
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
            // steeper falloff (pow 1.5→2.2) so brightness stays LOW through most of the column and only
            // the very top lifts — deep water is dark nearly everywhere, not a broad glow.
            vec3 base = mix(uBottom, uTop, pow(h, 2.2));
            // the light from above is a NARROW, DIM sliver at the very top (smoothstep 0.55→0.82 start,
            // *0.16 not *0.45) — a hint of a distant surface far overhead, NOT a bright ceiling filling
            // the top third (which read as "looking up at the ocean surface"). Deep water: the surface is
            // a faint memory, not a feature.
            float surface = pow(smoothstep(0.82, 1.0, h), 2.2);
            base += uSurface * surface * 0.16;
            float fromAbove = pow(h, 1.6);
            vec3 col = base;
            vec2 web_uv = vPos.xy / (abs(vPos.z) + 0.55);
            web_uv *= 1.15;
            float t = 0.5 * uTime;
            float web = neuroShape(web_uv, t);
            web = (1.0 + 0.05) * web * web;
            web = pow(web, 0.7 + 6.0 * 0.30);
            web = min(1.4, web);
            float nodes = smoothstep(0.7, 1.4, web);
            // the neuro-web is dimmed and pushed DOWN in the column (heavier fromAbove weighting + lower
            // overall gain) so it reads as faint light scattering in the volume, not a bright caustic NET
            // across a ceiling — the bright top-biased web was the other half of the "surface-from-below" read.
            col += uCaustic * web * (0.05 + 0.32 * fromAbove) * 0.22;
            col += uSurface * nodes * (0.06 + 0.34 * fromAbove) * 0.16;
            float swell = fbm(vec3(vPos.xz * 1.6, uTime * 0.03)) * 0.12;
            col += uCaustic * swell * (0.22 + 0.5 * fromAbove);
            float dust = fbm(vec3(vPos * 14.0 + vec3(uTime * 0.05, uTime * 0.11, 0.0)));
            col += uSurface * smoothstep(0.72, 1.0, dust) * 0.05;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  )
}
