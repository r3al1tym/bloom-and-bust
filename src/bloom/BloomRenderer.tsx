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

// Compose the bloom as a PORTFOLIO, not a portrait: the hero (a thriving survivor) centered and
// forward — the lone lantern — the rest in a loose depth-staggered arc so camera-Z varies and the
// layered front-to-back translucency reads. Deterministic — no Math.random.
function layout(specs: BloomSpec[]): [number, number, number][] {
  const n = specs.length
  // hero = a thriving stock if any survive; else the biggest bell (most catch)
  let heroIdx = specs.findIndex((s) => s.vitality === 'sealed')
  if (heroIdx < 0) heroIdx = specs.reduce((best, s, i) => (s.bellRadius > specs[best].bellRadius ? i : best), 0)
  const out: [number, number, number][] = new Array(n)
  out[heroIdx] = [0, -0.3, 2.2] // center, slightly forward and low
  const others = specs.map((_, i) => i).filter((i) => i !== heroIdx)
  const count = others.length
  others.forEach((idx, k) => {
    const ring = k % 2 === 0 ? 0 : 1
    const perRing = Math.ceil(count / 2)
    const a = ((k >> 1) / Math.max(perRing, 1)) * Math.PI * 2 + (ring ? 0.5 : 0)
    const rad = ring ? 6.4 : 4.4
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad * 0.62 + (ring ? 0.4 : -0.2)
    const z = -1.5 - ring * 3.5 - ((k * 7) % 3)
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
  decade: number
  onDecade: (d: number) => void
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
  decade,
  onDecade,
  selectedId,
  onSelect,
}: Props) {
  const specs = useMemo(() => buildBloom(stocks, decade), [stocks, decade])
  // layout is anchored to the stock set (not the decade) so creatures hold position as you scrub
  const positions = useMemo(() => layout(buildBloom(stocks, 2)), [stocks])
  const hasSelection = selectedId != null
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const detail = stocks.find((s) => s.id === selectedId) ?? null

  const bloomIntensity = useBloomControls((s) => s.bloomIntensity)
  const bloomThreshold = useBloomControls((s) => s.bloomThreshold)
  const bloomRadius = useBloomControls((s) => s.bloomRadius)
  const grain = useBloomControls((s) => s.grain)
  const vignette = useBloomControls((s) => s.vignette)
  const fogDensity = useBloomControls((s) => s.fogDensity)

  return (
    <div className="bloom">
      <BloomControlPanel />
      <div className="bloom-tank">
        <Canvas
          camera={{ position: [0, 0.5, 11], fov: 50 }}
          gl={{ antialias: false, toneMappingExposure: 1.15 }}
          dpr={[1, 1.75]}
          onPointerMissed={() => onSelect(null)}
        >
          <color attach="background" args={['#02080e']} />
          <TankBackground />
          <fogExp2 attach="fog" args={['#071a26', fogDensity]} />
          <ambientLight intensity={0.2} />
          <pointLight position={[-2, 12, 5]} intensity={0.5} color="#8fd4e6" />
          <Atmosphere />
          <OrbitControls
            ref={controls}
            enablePan={false}
            minDistance={5}
            maxDistance={28}
            enableDamping
            dampingFactor={0.08}
            target={[0, 0, 0]}
          />
          <CinematicCamera controls={controls} />
          {specs.map((spec, i) => (
            <Jellyfish
              key={spec.id}
              spec={spec}
              position={positions[i]}
              selected={spec.id === selectedId}
              dimmed={hasSelection && spec.id !== selectedId}
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
        <div className="bloom-hint mono">drag to orbit · scroll to zoom · click a medusa</div>

        {/* decade scrubber — drag through 70 years and watch the tank go dark */}
        <div className="scrubber">
          <span className="scrubber-decade mono">{decades[decade]}</span>
          <input
            type="range"
            min={0}
            max={6}
            value={decade}
            onChange={(e) => onDecade(Number(e.target.value))}
            aria-label="decade"
          />
          <span className="scrubber-hint mono">drag the years</span>
        </div>
      </div>

      <aside className="bloom-side">
        <div className="bloom-legend">
          <h1 className="bloom-h1">Medusa Bloom</h1>
          <p className="bloom-lede">
            A drift of jellyfish — each one a fish stock of the {region}, {span}. Drag the years and
            watch the tank thin out as the fisheries fall.
          </p>
          <div className="bloom-legend-title mono">Anatomy</div>
          <ul className="bloom-anatomy">
            <li><b>Bell size</b> — the stock's total catch (its mass)</li>
            <li><b>Hue</b> — its fate vs its own historical peak</li>
            <li><b>Pulse</b> — <i>thriving</i> breathes slow · <i>declining</i> flutters · a <i>husk</i> is nearly still</li>
            <li><b>7 tentacles</b> — the seven decades; a <i>stump</i> from the decade the stock collapsed</li>
            <li><b>Oral arms</b> — length is the share of catch on the official books</li>
            <li><b>Stings</b> — dead bycatch discarded at sea</li>
            <li><b>Two-tone</b> — industrial vs small-scale fleet</li>
          </ul>
          <p className="bloom-outofframe mono">
            Out of frame: a fish stock produces no sub-artifacts, so the drifting motes stay unlit.
          </p>
        </div>

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
          Data: <a href={sourceUrl} target="_blank" rel="noreferrer">{source}</a>. Rendered
          client-side with three.js — no server, no cloud at runtime.
        </p>
      </aside>
    </div>
  )
}

import { FATE_COLOR, type Fate } from '@/data/bloom'
const FATE_HEX = (f: Fate) => FATE_COLOR[f]

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
  const tgt = useMemo(() => new THREE.Vector3(), [])
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
    const START_RAD_MUL = 1.6
    const START_AZ_OFF = 0.7
    const HERO_RAD_MUL = establishing ? 0.78 : 1.0
    const START = authored
      ? camStart!
      : { az: b.az + START_AZ_OFF, pol: Math.min(b.pol, START_POL), rad: b.rad * START_RAD_MUL }
    const HERO = authored ? camEnd! : { az: b.az, pol: b.pol, rad: b.rad * HERO_RAD_MUL }

    const ORBIT_SPEED = 0.06
    const orbit = ORBIT_SPEED * (t - TAU * (1 - Math.exp(-t / TAU)))
    const heroAz = HERO.az + orbit
    const az = START.az + (heroAz - START.az) * descend
    const pol = START.pol + (HERO.pol - START.pol) * descend + Math.sin(t * 0.05) * 0.02 * driftAmount

    const settledRad = START.rad + (HERO.rad - START.rad) * drawIn
    const PULL = 0.28 * driftAmount
    const rad = settledRad * (1 - PULL * drawIn * Math.sin(t * 0.24))
    tgt.copy(c.target)
    sph.set(rad, pol, az)
    sph.makeSafe()
    want.setFromSpherical(sph).add(tgt)
    camera.position.copy(want)
    camera.lookAt(tgt)
    c.update()
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
      <sphereGeometry args={[1, 128, 128]} />
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
