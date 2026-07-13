// Pure geometry builders for the Bloom v2 medusa — no React, no store. Deterministic (seeded, no
// Math.random) so the bloom is identical across reloads, mirroring loomGeometry.ts. All sizes derive
// off the bell radius R so proportions hold at any tier.
import * as THREE from 'three'

/** A hand-shaped sea-nettle bell profile: flattened paraboloid, apex knob, near-knife margin.
 *  Returns a LatheGeometry (revolved around Y). apex height = 0.6R. */
export function makeBellGeometry(R: number, hero: boolean): THREE.LatheGeometry {
  const profilePts: THREE.Vector2[] = []
  const N = hero ? 72 : 56
  const apexY = R * 0.62
  for (let i = 0; i <= N; i++) {
    const u = i / N // 0 at apex (center) → 1 at margin
    // A rounded sea-nettle bell (not a flat parasol): radius follows a quarter-sine so the dome is
    // full and round, then FLARES past the shoulder into a scalloped skirt; height follows a cosine
    // fall from a slightly-thickened apex knob to a knife-thin, out-turned margin.
    const dome = Math.sin(Math.min(u, 0.82) / 0.82 * (Math.PI / 2)) // full round to the shoulder
    const flare = u > 0.82 ? (u - 0.82) / 0.18 : 0 // skirt turns outward past the shoulder
    const radius = R * (0.98 * dome + 0.14 * flare)
    const knob = Math.exp(-Math.pow(u / 0.16, 2.0)) * R * 0.05 // subtle apex bump
    const y = apexY * Math.cos(u * (Math.PI / 2) * 1.02) + knob - flare * R * 0.06 // margin dips
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
  const apexY = R * 0.6
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
  const g = new THREE.TubeGeometry(curve, segs, thick ? 0.035 : 0.014, 8, false)
  // taper the final 20% by scaling the tube's radial ring toward the tip
  const posAttr = g.attributes.position as THREE.BufferAttribute
  const uvAttr = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < posAttr.count; i++) {
    const t = uvAttr.getX(i) // TubeGeometry uv.x runs along the length
    if (t > 0.8) {
      const k = Math.sqrt(Math.max(0, (1 - t) / 0.2))
      // pull the ring toward the centerline (approximate: scale x/z around the local axis point)
      // centerline point at this t:
      const cp = curve.getPoint(t)
      const px = posAttr.getX(i),
        py = posAttr.getY(i),
        pz = posAttr.getZ(i)
      posAttr.setXYZ(i, cp.x + (px - cp.x) * k, py, cp.z + (pz - cp.z) * k)
    }
  }
  posAttr.needsUpdate = true
  return g
}

/** A blunt, retracted stub for a SEVERED gate — thicker cut end, no taper. */
export function makeStubGeometry(R: number, thick: boolean): THREE.TubeGeometry {
  const len = R * 0.22
  const segs = 6
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) pts.push(new THREE.Vector3(0, -(i / segs) * len, 0))
  const curve = new THREE.CatmullRomCurve3(pts)
  return new THREE.TubeGeometry(curve, segs, thick ? 0.06 : 0.03, 8, false)
}

/** A twisted, frilly oral-arm ribbon (PlaneGeometry strip). uv.x = arc 0→1 for the sway shader. */
export function makeRibbonGeometry(length: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(0.4, length, 3, 28)
  // rotate so the length runs down -Y and uv.x maps to arc-length along it
  g.rotateZ(Math.PI / 2) // now length is along X... map by remapping uv below
  // simpler: build unrotated, then remap in the shader via uv.y. But swayVertex reads uv.x as arc.
  // Reset and rebuild with arc on uv.x:
  const g2 = new THREE.PlaneGeometry(length, 0.4, 28, 3)
  // center it so the anchor (uv.x=0 → local x=-length/2) sits at origin; translate +length/2, then
  // rotate to hang downward.
  g2.translate(length / 2, 0, 0)
  g2.rotateZ(-Math.PI / 2) // length now runs down -Y, arc (uv.x) from anchor at top to tip at bottom
  g.dispose()
  return g2
}

/** ~1200 ambient marine-snow points: cool, uncountable, drifting PAST — deliberately distinct from
 *  the warm, clustered, countable artifact-motes. Deterministic layout. */
export function makeMarineSnow(count: number, seed = 7): {
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
    pos[i * 3 + 1] = (rnd() - 0.5) * 24
    pos[i * 3 + 2] = (rnd() - 0.5) * 20
    sizes[i] = 0.02 + rnd() * 0.06
  }
  return { positions: pos, sizes }
}
