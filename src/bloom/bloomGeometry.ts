// Pure geometry builders for the Bloom v2 medusa — no React, no store. Deterministic (seeded, no
// Math.random) so the bloom is identical across reloads, mirroring loomGeometry.ts. All sizes derive
// off the bell radius R so proportions hold at any tier.
import * as THREE from 'three'

/** A hand-shaped sea-nettle bell profile: flattened paraboloid, apex knob, near-knife margin.
 *  Returns a LatheGeometry (revolved around Y). apex height = 0.6R. */
export function makeBellGeometry(R: number, hero: boolean): THREE.LatheGeometry {
  const profilePts: THREE.Vector2[] = []
  const N = hero ? 72 : 56
  const apexY = R * 0.78
  for (let i = 0; i <= N; i++) {
    const u = i / N // 0 at apex (center) → 1 at margin
    // A rounded sea-nettle bell (not a flat parasol): radius follows a quarter-sine so the dome is
    // full and round, then FLARES past the shoulder into a scalloped skirt; height follows a cosine
    // fall from a slightly-thickened apex knob to a knife-thin, out-turned margin.
    const dome = Math.sin(Math.min(u, 0.82) / 0.82 * (Math.PI / 2)) // full round to the shoulder
    const flare = u > 0.82 ? (u - 0.82) / 0.18 : 0 // skirt turns outward past the shoulder
    const radius = R * (0.98 * dome + 0.14 * flare)
    const knob = Math.exp(-Math.pow(u / 0.16, 2.0)) * R * 0.05 // subtle apex bump
    const domeHeight = Math.max(0, Math.cos(u * (Math.PI / 2) * 1.01))
    const y = apexY * Math.pow(domeHeight, 0.82) + knob - flare * R * 0.05
    profilePts.push(new THREE.Vector2(Math.max(radius, 0.0008), y))
  }
  const segs = hero ? 96 : 64
  const g = new THREE.LatheGeometry(profilePts, segs)
  g.computeVertexNormals()
  return g
}

interface DendriteVerts {
  positions: Float32Array
  arc: Float32Array // arc length from root along the branch (drives the firing spike)
  count: number // vertex count (line-segment pairs)
  nodes: Float32Array // junction positions for the synaptic-flare Points
}

/** A deterministic recursive bifurcation tree = the radial canals / dendritic arborization. Grows
 *  OUTWARD from the central stomach, clipped inside 0.85R and under the dome profile so it always
 *  reads as a mind seen through the gel. Emitted as GL_LINES vertex pairs + junction node points. */
export function makeDendrites(R: number, seed: number, levels = 3): DendriteVerts {
  const clip = R * 0.85
  const apexY = R * 0.76
  const pos: number[] = []
  const arc: number[] = []
  const nodes: number[] = []
  // deterministic LCG seeded per creature
  let s = Math.floor(seed * 100000) + 1
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }

  // dome height at a given planar radius (keep branches under the bell surface)
  const domeY = (rad: number) => {
    const u = Math.min(rad / R, 1)
    return apexY * (1.0 - Math.pow(u, 1.35)) * 0.72 // sit a little below the wall
  }

  // primary canals fan out from the stomach; count in the sea-nettle range (16)
  const primaries = 16
  function grow(
    x: number,
    y: number,
    z: number,
    ang: number,
    len: number,
    level: number,
    a0: number,
  ) {
    const rad0 = Math.hypot(x, z)
    // taper the reach so we stay inside the clip radius
    const reach = Math.min(len, clip - rad0)
    if (reach <= R * 0.04 || level > levels) return
    const nx = x + Math.cos(ang) * reach
    const nz = z + Math.sin(ang) * reach
    const rad1 = Math.hypot(nx, nz)
    const ny = domeY(rad1)
    const a1 = a0 + reach
    pos.push(x, y, z, nx, ny, nz)
    arc.push(a0, a1)
    nodes.push(nx, ny, nz)
    // bifurcate
    const branches = level === 0 ? 1 : 2
    for (let b = 0; b < branches; b++) {
      const spread = (rnd() - 0.5) * 0.9 + (b === 0 ? -0.25 : 0.25)
      grow(nx, ny, nz, ang + spread, reach * (0.62 + rnd() * 0.2), level + 1, a1)
    }
  }

  for (let i = 0; i < primaries; i++) {
    const ang = (i / primaries) * Math.PI * 2 + rnd() * 0.15
    grow(0, apexY * 0.05, 0, ang, R * 0.42, 0, 0)
  }

  return {
    positions: new Float32Array(pos),
    arc: new Float32Array(arc),
    count: pos.length / 3,
    nodes: new Float32Array(nodes),
  }
}

/** A single tapered gate-tentacle tube built once in LOCAL space (anchor at origin, drooping down).
 *  uv.x carries the arc param 0→1 for the sway/glow shaders. Radius tapers over the final 20%. */
export function makeTentacleGeometry(length: number, thick: boolean): THREE.TubeGeometry {
  const segs = 36
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    // a gentle outward-then-down droop
    const lean = Math.sin(t * Math.PI * 0.6) * length * 0.14
    pts.push(new THREE.Vector3(lean, -t * length, 0))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  // Thinner base radius than before (0.014→0.009) so the trail reads as a delicate filament, not a
  // thick blade — with additive blending + Bloom, a fat tube halos into a wide green streak that swamps
  // the bell. 5 radial segments is plenty at this sub-pixel cross-section; tubularSegments=36 for the sway wave.
  const g = new THREE.TubeGeometry(curve, segs, thick ? 0.022 : 0.009, 5, false)
  // ORGANIC TAPER — a real tentacle is thick at the bell and tapers to a wisp, not a uniform rod that
  // only pinches at the very tip. Scale EVERY radial ring toward the centerline by a full-length taper
  // (≈1 at the anchor → ≈0.12 at the tip, curved), so the trail thins continuously and dissolves away
  // instead of hanging as a solid strip. This is the single biggest "reads as a living tentacle" lever.
  const posAttr = g.attributes.position as THREE.BufferAttribute
  const uvAttr = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < posAttr.count; i++) {
    const t = uvAttr.getX(i) // TubeGeometry uv.x runs along the length (0 anchor → 1 tip)
    const k = Math.pow(1 - t, 0.7) * 0.88 + 0.12 // full-length taper: ~1 at root, ~0.12 at tip
    const cp = curve.getPoint(t)
    const px = posAttr.getX(i),
      py = posAttr.getY(i),
      pz = posAttr.getZ(i)
    posAttr.setXYZ(i, cp.x + (px - cp.x) * k, py, cp.z + (pz - cp.z) * k)
  }
  posAttr.needsUpdate = true
  return g
}

/** A single hairline data tentacle emitted as independent line segments. Unlike TubeGeometry this has
 * no screen-space area to stack into a luminous column when seven appendages overlap; uv.x still
 * carries arc length so the shared sway shader preserves the same data-bound motion. */
export function makeTentacleLineGeometry(length: number, severed: boolean): THREE.BufferGeometry {
  const segments = severed ? 4 : 42
  const actualLength = severed ? length * 0.03 : length
  const positions: number[] = []
  const uvs: number[] = []
  const point = (t: number) => {
    const lean = Math.sin(t * Math.PI * 0.62) * actualLength * 0.12
    const curl = Math.sin(t * Math.PI * 2.1) * actualLength * 0.018 * t
    return new THREE.Vector3(lean, -t * actualLength, curl)
  }
  for (let i = 0; i < segments; i++) {
    const a = i / segments
    const b = (i + 1) / segments
    const pa = point(a)
    const pb = point(b)
    positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z)
    uvs.push(a, 0.5, b, 0.5)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingSphere()
  return geometry
}

/** A blunt, retracted stub for a SEVERED gate — thicker cut end, no taper. */
export function makeStubGeometry(R: number, thick: boolean): THREE.TubeGeometry {
  const len = R * 0.22
  const segs = 6
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) pts.push(new THREE.Vector3(0, -(i / segs) * len, 0))
  const curve = new THREE.CatmullRomCurve3(pts)
  return new THREE.TubeGeometry(curve, segs, thick ? 0.06 : 0.03, 5, false)
}

/** A twisted, frilly oral-arm ribbon (PlaneGeometry strip). uv.x = arc 0→1 for the sway shader. */
export function makeRibbonGeometry(length: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(0.4, length, 3, 28)
  // rotate so the length runs down -Y and uv.x maps to arc-length along it
  g.rotateZ(Math.PI / 2) // now length is along X... map by remapping uv below
  // simpler: build unrotated, then remap in the shader via uv.y. But swayVertex reads uv.x as arc.
  // Reset and rebuild with arc on uv.x:
  const g2 = new THREE.PlaneGeometry(length, 0.38, 64, 10)
  // TAPER the ribbon along its length so the oral arm narrows to a point like the tentacles, instead of
  // a uniform 0.4-wide banner (which, additive + bloomed, read as a broad green blade). Width scales from
  // full at the anchor (local x=-length/2) to a wisp at the tip. Also narrower base (0.4→0.26).
  const rp = g2.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i) // -length/2 (anchor) → +length/2 (tip)
    const along = THREE.MathUtils.clamp((x + length / 2) / length, 0, 1) // 0 anchor → 1 tip
    const taper = Math.pow(1 - along, 0.6) * 0.85 + 0.15
    const across = rp.getY(i) / 0.19
    const edge = Math.pow(Math.abs(across), 1.7)
    const broadFold = Math.sin(along * Math.PI * 5.2 + across * 1.7) * length * 0.052
    const lace = Math.sin(along * Math.PI * 24 + across * 4.4) * length * 0.018 * edge
    rp.setY(i, rp.getY(i) * taper + (broadFold + lace) * (0.2 + 0.8 * along))
    rp.setZ(
      i,
      Math.sin(along * Math.PI * 6.5 + across * 2.7) * length * 0.075 * along
        + Math.sin(along * Math.PI * 2.2) * across * length * 0.04,
    )
  }
  rp.needsUpdate = true
  // center it so the anchor (uv.x=0 → local x=-length/2) sits at origin; translate +length/2, then
  // rotate to hang downward.
  g2.translate(length / 2, 0, 0)
  g2.rotateZ(-Math.PI / 2) // length now runs down -Y, arc (uv.x) from anchor at top to tip at bottom
  g.dispose()
  return g2
}

export function makeRuffledOralGeometry(length: number, seed: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(length, 0.22, 72, 8)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const along = THREE.MathUtils.clamp((x + length / 2) / length, 0, 1)
    const across = position.getY(i) / 0.11
    const taper = 0.22 + 0.78 * Math.pow(1 - along, 0.45)
    const curl = Math.sin(along * Math.PI * (3.2 + seed * 0.8) + seed * 7.1) * length * 0.1 * Math.pow(along, 0.75)
    const ruffle = Math.sin(along * Math.PI * 24 + across * 5.8 + seed * 9) * length * 0.026 * Math.pow(Math.abs(across), 1.4)
    position.setY(i, position.getY(i) * taper + curl + ruffle)
    position.setZ(i, Math.sin(along * Math.PI * 5.2 + across * 2.8 + seed * 4) * length * 0.085 * along)
  }
  position.needsUpdate = true
  geometry.translate(length / 2, 0, 0)
  geometry.rotateZ(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

/** A whole curtain of hair-thin marginal filaments in one line-segment geometry. The seven primary
 * tentacles remain the data-bearing appendages; this secondary veil supplies the dense biological
 * complexity of a sea nettle without adding dozens of meshes and materials per creature. */
export function makeFilamentCurtain(R: number, seed: number, count: number): THREE.BufferGeometry {
  const segments = 22
  const positions: number[] = []
  const arc: number[] = []
  const phase: number[] = []
  let state = Math.floor(seed * 100000) + 17
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
  for (let strand = 0; strand < count; strand++) {
    const angle = (strand / count) * Math.PI * 2 + (rnd() - 0.5) * 0.18
    const radius = R * (0.72 + rnd() * 0.22)
    const length = R * (5.0 + rnd() * 5.6)
    const lean = (rnd() - 0.5) * R * 1.8
    const curl = (rnd() - 0.5) * R * 0.9
    const strandPhase = rnd() * Math.PI * 2
    let previous = new THREE.Vector3(Math.cos(angle) * radius, -R * 0.03, Math.sin(angle) * radius)
    for (let segment = 1; segment <= segments; segment++) {
      const t = segment / segments
      const drag = Math.pow(t, 1.45)
      const lateral = Math.sin(t * Math.PI * (1.2 + rnd() * 0.5) + strandPhase) * curl * drag
      const current = new THREE.Vector3(
        Math.cos(angle) * (radius + lean * drag) + Math.cos(angle + Math.PI / 2) * lateral,
        -length * t,
        Math.sin(angle) * (radius + lean * drag) + Math.sin(angle + Math.PI / 2) * lateral,
      )
      positions.push(previous.x, previous.y, previous.z, current.x, current.y, current.z)
      arc.push((segment - 1) / segments, t)
      phase.push(strandPhase, strandPhase)
      previous = current
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aT', new THREE.Float32BufferAttribute(arc, 1))
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** ~1200 ambient marine-snow points: cool, uncountable, drifting PAST — deliberately distinct from
 *  the warm, clustered, countable artifact-motes. Deterministic layout. */
export function makeMarineSnow(count: number, seed = 7, lowBias = false): {
  positions: Float32Array
  sizes: Float32Array
} {
  const pos = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  let s = seed + 1
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * 38     // widened to blanket the wide drift field (layout RX≈13.5)
    // lowBias: confine the warm plankton to the DEEP third so it lives in the dark below the bright
    // upper god-ray zone and physically cannot stack into it → cannot sum to a white veil.
    pos[i * 3 + 1] = lowBias ? -12 + rnd() * 10 : (rnd() - 0.5) * 24
    pos[i * 3 + 2] = (rnd() - 0.5) * 20
    sizes[i] = 0.02 + rnd() * 0.06
  }
  return { positions: pos, sizes }
}
