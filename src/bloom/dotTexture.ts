import * as THREE from 'three'

// A soft radial dot sprite so gl.POINTS render as organic round motes, not the default square
// quads. Lazily built once (needs a canvas) and shared by every points cloud — marine snow and the
// synaptic nodes. With additive blending the transparent corners add nothing, so each point reads as
// a soft glowing dot with a feathered edge.
let _tex: THREE.CanvasTexture | null = null
export function dotTexture(): THREE.CanvasTexture {
  if (_tex) return _tex
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.35)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.needsUpdate = true
  _tex = t
  return t
}

// A wide, very soft radial gradient for the per-jellyfish volumetric halo — a gentle bloom that
// falls off gradually to nothing at the edge (no hard disc). Additive-blended behind each bell so
// every medusa carries its own aura; the postprocessing Bloom then feathers it into the water.
let _halo: THREE.CanvasTexture | null = null
export function haloTexture(): THREE.CanvasTexture {
  if (_halo) return _halo
  const s = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.42)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)')
  g.addColorStop(0.75, 'rgba(255,255,255,0.03)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.needsUpdate = true
  _halo = t
  return t
}
