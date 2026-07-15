// GLSL for the Bloom v2 "Thinking Medusa". Kept out of the components so the shaders read as one
// document. Every term is data-bound (see bloomModel.ts): the glow carries the arbiter outcome, the
// hue carries the semantic verdict, the pulse carries vitality. HDR (>1.0) is written ONLY on the
// glow/spike terms so the postprocessing Bloom pass amplifies meaning, not everything.

// ── ATMOSPHERIC FOG ───────────────────────────────────────────────────────────
// The depth cue that GLUES the medusae into the water. The custom ShaderMaterials don't use three's
// fog chunks, so nothing recedes — every creature renders at full clarity regardless of depth, which
// is exactly what makes them read as a sharp overlay pasted on the backdrop. This exponential-squared
// fog (matched to the scene <fogExp2> in BloomRenderer) fades distant medusae toward the haze and
// bleeds their contrast so near ones sit forward and far ones dissolve into the medium — aerial
// perspective. Opaque bodies MIX toward the fog colour; additive glows ATTENUATE (fade to nothing).
// FOG_COLOR / FOG_DENSITY MUST track the scene fogExp2 args in BloomRenderer.tsx.
const FOG = /* glsl */ `
  const vec3 FOG_COLOR = vec3(0.027, 0.102, 0.149); // #071a26
  uniform float uFogDensity; // live-tuned; matches the scene fogExp2 density (default 0.058)
  float fogFactor(float depth){
    float f = uFogDensity * depth;
    return 1.0 - exp(-f * f);
  }
`

// ── THE BELL ────────────────────────────────────────────────────────────────
// A translucent sea-nettle bell: a lathe dome with a frilled, flaring margin that swims with an
// asymmetric, propagating jet-pulse. Normals are recomputed per-fragment from world-space
// derivatives (WebGL2) so lighting is correct after the vertex displacement — v1 skipped this and
// its lit term was wrong. Three SUMMED translucency terms (never multiplied, never additive on the
// body) keep the saturated hue its own color while the thin backlit lappet edges blow bright.

export const bellVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPulseRate;
  uniform float uPulseDepth;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uFrillFreq;
  uniform float uFrillAmp;
  uniform float uMarginFlare;
  uniform float uJiggle;

  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vHeight;
  varying float vFrill;
  varying vec3 vLocal;
  varying float vFogDepth;
  varying float vCaustic;

  void main() {
    vec3 p = position;
    float safeRadius = max(uRadius, 0.001);
    vLocal = position / safeRadius;

    float apexY = safeRadius * 0.76;
    float h = clamp(p.y / max(apexY, 0.001), 0.0, 1.0);
    float margin = 1.0 - smoothstep(0.0, 0.55, h);
    vHeight = h;

    // Strictly bounded pulse. Keeping every displacement as a small scalar multiple of the authored
    // radius prevents a malformed noise sample or driver-specific transcendental edge case from ever
    // projecting a triangle across the viewport.
    float phase = uTime * uPulseRate + uSeed * 6.2831853;
    float wave = sin(phase - (1.0 - h) * 2.2);
    float pulse = clamp(wave * uPulseDepth, -0.22, 0.22);
    p.y *= 1.0 + pulse * 0.72;
    p.xz *= 1.0 - pulse * 0.32;

    float theta = atan(p.z, p.x);
    float scallop = 0.5 + 0.5 * cos(theta * 12.0 + uSeed * 6.2831853);
    float lace = sin(theta * uFrillFreq + phase * 0.18);
    float lobeScale = mix(1.0, 0.92 + 0.08 * scallop, margin);
    p.xz *= lobeScale;

    vec2 radial = length(p.xz) > 0.0001 ? normalize(p.xz) : vec2(0.0);
    float frill = clamp(lace, -1.0, 1.0) * margin;
    p.xz += radial * (uMarginFlare * margin + uFrillAmp * frill);
    // Gentle bounded tissue ripple; no procedural vertex noise.
    p.y += sin(theta * 5.0 + phase * 0.35) * uJiggle * safeRadius * 0.12 * margin;
    vFrill = margin * (0.5 + 0.5 * lace);

    // Cheap bounded caustic carried as a varying for the fragment material.
    vCaustic = 0.5 + 0.25 * sin(theta * 4.0 + h * 7.0 + phase * 0.22)
                       + 0.15 * sin(theta * 9.0 - h * 4.0 - phase * 0.13);
    vCaustic = clamp(vCaustic, 0.0, 1.0);

    // Hand the final transform to Three's canonical projection path. The transformed variable is the deformed
    // local vertex expected by <project_vertex>; using the engine chunk keeps model/view/projection
    // state synchronized with R3F even on the first WebGL frames after a timeline remount.
    vec3 transformed = p;
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = world.xyz;
    vViewDir = normalize(cameraPosition - world.xyz);
    #include <project_vertex>
    vFogDepth = -mvPosition.z;
  }
`

export const bellFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;         // saturated tank hue (the semantic verdict color)
  uniform vec3 uColorB;        // brighter twin of the SAME hue for the eng/exp sheen split
  uniform float uSplit;        // engineering share (0..1) — a sheen boundary, never a 2nd color
  uniform float uGlow;         // arbiter cleared the bar → interior lantern (HDR)
  uniform float uAlive;        // vitality baseline self-illumination
  uniform float uOpacity;      // selection/dim fade
  uniform float uThicknessPow; // backlight transmission falloff
  uniform float uSeed;
  uniform float uGlowBoost;    // live-tuning multiplier on the emissive (1.0 = as authored)
  uniform float uPulseRate;    // the bell's jet rate — reused here to flash the margin ON the contraction

  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vHeight;
  varying float vFrill;
  varying vec3 vLocal;
  varying float vFogDepth;
  varying float vCaustic;      // subsurface caustic, computed per-vertex (see bellVertex)

  ${FOG}

  void main() {
    // geometric normal from screen-space derivatives — correct AFTER vertex displacement
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    vec3 V = normalize(vViewDir);
    if (dot(N, V) < 0.0) N = -N;                 // face the camera on the DoubleSide inner wall
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    // fake wall-thickness: thick warm apex knob → near-knife margin
    float thickness = mix(0.02, 0.16, vHeight);

    // two-tone hemisphere sheen (single hue) → the SATURATED fate pigment.
    float side = smoothstep(uSplit - 0.15, uSplit + 0.15, N.x * 0.5 + 0.5);
    vec3 pigment = mix(uColor, uColorB, side);   // the saturated fate hue (rim/lantern/frill carry this)

    // NATURALISTIC GEL — a real medusa is mostly clear, caustic-lit gel with only faint pigment, not a
    // flat coloured swatch. Drain most of the saturated hue out of the translucent DOME FILL toward a
    // neutral deep-water gel, and CONCENTRATE the fate hue in the rim, the lantern core, the halo, and
    // the trailing brain/tentacles. The fate then reads as the creature's glowing coloured CORE seen
    // through clear gel — more real, and the clear dome is exactly what lets the brighter brain read
    // through it. (Fate still legible at a 28-glance via rim + core + halo + coloured trails.)
    const vec3 GEL_TINT = vec3(0.27, 0.72, 0.86);
    vec3 body = mix(GEL_TINT, vec3(0.24, 0.58, 0.92), 0.48);

    // (1) split Fresnel — tight glassy edge + broad body falloff. Rim keeps the SATURATED pigment so
    // the fate reads as a bright coloured contour even though the dome fill is near-clear gel.
    float rimT = pow(1.0 - ndv, 4.0);
    float rimB = pow(1.0 - ndv, 1.5);
    vec3 rimGlow = min(mix(vec3(0.18, 0.96, 1.0), vec3(1.0, 0.22, 0.8), 0.34 + 0.28 * vFrill) * 2.05, vec3(1.65));
    vec3 rim = (rimT * 2.05 + rimB * 0.82) * rimGlow * uGlowBoost;

    // (2) thickness/backlight transmission — the SSS fake. Key light below/behind.
    vec3 L = normalize(vec3(0.0, -1.0, 0.3));
    float back = pow(clamp(dot(-N, L) * 0.5 + 0.5, 0.0, 1.0), uThicknessPow);
    vec3 transmit = body * back * thickness * (1.5 + 2.0 * uAlive);

    // (3) interior radiance — the arbiter lantern (HDR when cleared) + vitality baseline.
    // The tank hues are pale (a sea-green like #79e0a6 is already near-white), so brightening them
    // toward HDR desaturates to a white blob (spec RISK 1 — the cardinal failure). Build a SATURATED
    // twin of the hue and glow along THAT, so a cleared run blooms unmistakably GREEN, not white.
    // derive satHue from the SATURATED PIGMENT, not the desaturated gel body — the lantern is the fate
    // core and MUST stay unmistakably coloured (a green survivor glows green, a coral husk glows coral),
    // else draining the dome to gel would also grey out the one term that carries the fate at a glance.
    float lum = dot(pigment, vec3(0.299, 0.587, 0.114));
    vec3 satHue = clamp(lum + (pigment - lum) * 2.4, 0.0, 1.0); // push chroma away from grey
    satHue = normalize(satHue + 1e-4);
    float core = pow(1.0 - rimB, 1.6);           // tight apex weighting → a lantern, not a fill

    // ── drifting subsurface caustics — the single biggest "living gel" cue. Mottled brighter/darker
    // veins move slowly THROUGH the flesh (sampled on stable local pos so they ride the body, not the
    // screen), richer where the flesh is thick. Now computed per-VERTEX (vCaustic) and interpolated —
    // this is what a smooth glass dome lacks, at a fraction of the per-fragment cost.
    float caustic = vCaustic;                    // 0..1, from bellVertex (2-octave)
    float mottle = mix(0.62, 1.35, caustic) * (0.55 + 0.45 * thickness / 0.16);

    vec3 interior = body * (0.72 + 1.65 * uAlive) * core * mottle * uGlowBoost;
    vec3 lantern = satHue * uGlow * core * 3.25 * mix(0.85, 1.15, caustic) * uGlowBoost;

    // Keep the hue-carrying CORE its colour even when bright: reproject toward the SATURATED hue as
    // it brightens. The thin Fresnel EDGES may blow white (real glass) — a separate additive term so
    // they never wash the body.
    vec3 bodyGlow = interior + transmit + lantern;
    float bl = max(max(bodyGlow.r, bodyGlow.g), bodyGlow.b);
    if (bl > 0.85) bodyGlow = mix(bodyGlow, satHue * bl, clamp((bl - 0.85) * 1.1, 0.0, 0.9));
    // Radial canals and petal chambers are the defining anatomy in the reference medusae. They are
    // shaded into the single bell surface (rather than layered transparent shells), preserving stable
    // sorting while giving the dome a richly segmented, internally illuminated construction.
    float theta = atan(vLocal.z, vLocal.x);
    float radial = length(vLocal.xz);
    float ribWave = 0.5 + 0.5 * cos(theta * 16.0 + uSeed * 6.2831853);
    float ribs = pow(ribWave, 12.0) * smoothstep(0.08, 0.72, radial) * smoothstep(1.05, 0.5, radial);
    float chambers = pow(0.5 + 0.5 * cos(theta * 12.0 + uSeed * 3.1), 4.0)
                   * smoothstep(0.38, 0.82, radial) * (1.0 - smoothstep(0.82, 1.08, radial));
    vec3 anatomyHue = mix(vec3(0.16, 0.92, 1.0), vec3(1.0, 0.12, 0.72), 0.62 + 0.24 * chambers);
    vec3 anatomy = anatomyHue * (ribs * (0.85 + 1.15 * uAlive) + chambers * 0.72)
                 * (0.65 + 0.35 * caustic) * uGlowBoost;
    vec3 edge = rim * (0.3 + 0.5 * uAlive) + body * vFrill * 0.28 * (0.4 + uAlive) + anatomy;

    // ── #1 PULSE-SYNCED MARGIN BIOLUMINESCENCE — the lace rim flashes softly on each contraction, the
    // way Aequorea flare at the bell margin. It RECONSTRUCTS the exact vertex jet phase (bellVertex:
    // travel = phase - (1-h)*2.5) so light and breath physically cannot disagree. Positive half only,
    // cubed → a sharp flare on the peak of the squeeze that decays fast. Multiplies body (fate-tinted,
    // never rimGlow so it never whitens) x vFrill (margin-weighted) x uAlive (a husk never flashes).
    // The flash cadence follows uPulseRate for free: ~2.7s alive, ~12s husk.
    float mTravel = uTime * uPulseRate + uSeed * 6.2831853 - (1.0 - vHeight) * 2.5;
    float flash = pow(max(sin(mTravel), 0.0), 3.0);
    edge += body * vFrill * flash * 0.35 * uAlive;

    vec3 col = (bodyGlow + edge) * 1.85;

    // NormalBlending; density scales with aliveness so a husk stays wispy and a sealed bell is
    // dense — but the apex stays translucent (lower center alpha) so the neural mind reads through
    // the gel, while the frilled margin/edges stay glassy-bright. Raised the BODY-fill floor (0.22→
    // 0.34) so the dome carries its hue as a coloured membrane, not a near-clear glass — at distance
    // the low floor made the head wash out to nothing while the additive tentacles kept their colour
    // (the "head clear, tentacles coloured until you get close" bug).
    float apexClear = 1.0 - vHeight * 0.28;      // thinner, clearer over the brain
    float a = uOpacity * (0.62 + 0.48 * uAlive + 0.46 * (rimT + rimB) * 0.5 + uGlow * 0.18 + vFrill * 0.18) * apexClear;

    // atmospheric perspective: fade the body toward the water haze with distance so far medusae sink
    // INTO the medium. BUT the colour must survive the fade or the head reads as a clear dome next to
    // its still-coloured (additive) tentacles. So: mix toward a HUE-TINTED haze (fog colour lifted
    // toward the body hue), and soften the alpha fade (0.55→0.35) to match the tentacles' 0.5 colour
    // attenuation — head and trail now recede together, both keeping their colour.
    float fog = fogFactor(vFogDepth);
    vec3 hazeTint = mix(FOG_COLOR, body, 0.35);  // fog that still carries the creature's colour
    col = mix(col, hazeTint, fog * 0.8);
    a *= (1.0 - 0.35 * fog);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
  }
`

// ── TRAILING APPENDAGES ──────────────────────────────────────────────────────
// Gate-tentacles and oral-arm ribbons share a GPU traveling-wave sway with arc-length lag: the
// anchor barely moves, the tip swings wide and LATE (true inertia). uv.x is the arc param (0 anchor
// → 1 tip) from TubeGeometry / PlaneGeometry. A severed tentacle is a blunt retracted stub that
// does not sway — the run halted.

export const swayVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uAmp;        // sway amplitude (0 if severed)
  uniform float uFreq;       // SLOW — 0.6..1.0
  uniform float uLag;        // ~5, so the wave visibly travels tip-ward
  uniform float uStiff;      // ~1.8, so the tip lags well behind the anchor
  uniform float uTwist;      // ribbons only — twist around the tangent
  uniform float uSurgePhase; // the bell's jet phase (t*pulseRate + seed·2π) — couples the trail to the pulse
  uniform float uSurgeDepth; // = pDepth·stillness (0.02→0.22 alive, →0 as it dies)
  varying vec2 vUv;
  varying float vT;
  varying float vFogDepth;

  void main() {
    vUv = uv;
    float t = uv.x;              // 0 at anchor, 1 at tip
    vT = t;
    vec3 p = position;

    // twist the ribbon around its length (0 for round tentacles → uTwist=0)
    float tw = t * uTwist + uTime * 0.3;
    float c = cos(tw), s = sin(tw);
    p.xz = mat2(c, -s, s, c) * p.xz;

    // traveling wave, lagged by arc length, weighted so the anchor is stiff and the tip swings late
    float w = pow(t, uStiff);
    float ph = uTime * uFreq - t * uLag + uSeed * 6.2831853;
    p.x += sin(ph) * uAmp * w;
    p.z += cos(ph * 0.83 + uSeed) * uAmp * w * 0.8;
    // a touch of non-periodic drift so the bundle never combs into one line
    p.x += sin(uTime * 0.37 + t * 3.1 + uSeed * 5.0) * uAmp * 0.15 * w;

    // ── JET-RECOIL SURGE — the bundle whips taut UP toward the bell on the contraction kick, then
    // streams back down/out on the slow glide (overlapping action off the SAME jet phase as the bell).
    // The recoil travels tip-ward with the same arc-weight (pow(t,uStiff)), so the tip reacts late — a
    // real inertial whip. The skewed sine (fast up-stroke pow .6, slow relax pow 1.4) matches the bell's
    // own asymmetry. step(uAmp) → a severed stub (uAmp=0) never surges. Gathers xz inward on the kick so
    // it doesn't just translate. Bounded by uSurgeDepth (≤0.22), well under the sink/lift budget.
    float lag = uSurgePhase - t * 2.5;
    float ss = sin(lag);
    float surge = (ss > 0.0 ? pow(ss, 0.6) : -pow(-ss, 1.4)) * uSurgeDepth;
    float alive = step(0.0001, uAmp);
    float ww = pow(t, uStiff) * alive;
    p.y += surge * ww * 1.1;
    p.xz *= (1.0 - surge * ww * 0.25);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

export const swayFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uAdvisory;  // 1 = ghosted (DT advisory head): see-through, desaturated
  uniform float uRibbon;
  uniform float uEmphasis;
  varying vec2 vUv;
  varying float vT;
  varying float vFogDepth;
  ${FOG}
  void main() {
    // ONE CREATURE, ONE COLOUR. The trail stays the stock's own fate hue along its whole length, so a
    // coral stock reads coral tentacles and a slate husk dim-slate — the bell and its trail are the
    // SAME animal. (Was: a blend toward pink-white that decoupled the tips from the bell — the
    // "head colour ≠ tentacle colour when zoomed out" bug.) Only a faint LUMINANCE lift near the tips
    // keeps the flow alive, never a hue swap. Kept low so many additive trails sum to a translucent
    // COLOURED haze, not a white blowout.
    float glow = mix(1.0, 0.28, vT);
    vec3 lift = uColor + vec3(0.08, 0.10, 0.10);          // same hue, a touch brighter — never white
    vec3 tint = mix(uColor, lift, smoothstep(0.15, 0.9, vT) * 0.4);
    // dimmer trails: the tentacles are SUPPORTING structure, not the subject — the bell is. Lowered the
    // luminance (0.42+0.5→0.30+0.4) and the base alpha (0.72→0.5) so many additive trails sum to a faint
    // coloured haze the bell floats above, rather than a field of bright green blades competing with it.
    float across = abs(vUv.y - 0.5) * 2.0;
    float ribbonBody = 1.0 - smoothstep(0.58, 1.0, across);
    float ribbonEdge = smoothstep(0.42, 0.82, across) * ribbonBody * uRibbon;
    vec3 rose = vec3(1.0, 0.20, 0.72);
    vec3 pearl = vec3(0.82, 0.58, 1.0);
    vec3 tissue = mix(rose, pearl, 0.2 + 0.34 * vT);
    vec3 trailColor = tint * (0.12 + 0.12 * glow) * uEmphasis;
    vec3 ribbonColor = tissue * (0.58 + 0.22 * glow) * uEmphasis;
    ribbonColor += mix(vec3(0.45, 0.9, 1.0), pearl, 0.5) * ribbonEdge * 0.24 * uEmphasis;
    vec3 col = mix(trailColor, ribbonColor, uRibbon);
    float tissueAlpha = mix(0.42 - 0.28 * vT, 0.58 - 0.32 * vT, uRibbon);
    float coverage = mix(1.0, ribbonBody, uRibbon);
    float a = uOpacity * tissueAlpha * coverage * (0.68 + ribbonEdge * 0.35) * min(uEmphasis, 1.0);
    if (uAdvisory > 0.5) {                 // DT: visibly not load-bearing
      col = mix(col, vec3(dot(col, vec3(0.33))), 0.55);
      a *= 0.4;
    }
    // additive trails ATTENUATE into the haze (fade to nothing) rather than mixing to fog grey, so
    // distant tentacles dissolve into the water instead of hanging as bright wires over the backdrop
    float fog = fogFactor(vFogDepth);
    a *= (1.0 - 0.75 * fog);
    col *= (1.0 - 0.5 * fog);
    a = clamp(a, 0.0, 0.48);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(col, col * a, uRibbon), a);
  }
`

export const filamentVertex = /* glsl */ `
  attribute float aT;
  attribute float aPhase;
  uniform float uTime;
  uniform float uSeed;
  uniform float uAmp;
  varying float vT;
  varying float vFogDepth;
  void main() {
    vT = aT;
    vec3 p = position;
    float w = pow(aT, 1.55);
    float phase = uTime * 0.42 - aT * 4.8 + aPhase + uSeed * 6.2831853;
    p.x += sin(phase) * uAmp * w;
    p.z += cos(phase * 0.83 + aPhase) * uAmp * 0.72 * w;
    p.x += sin(uTime * 0.17 + aPhase * 2.0) * uAmp * 0.12 * aT;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

export const filamentFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uOpacity;
  varying float vT;
  varying float vFogDepth;
  ${FOG}
  void main() {
    float fade = pow(1.0 - vT, 0.42);
    vec3 color = mix(vec3(1.0, 0.03, 0.58), vec3(1.0, 0.62, 0.96), 0.2 + 0.28 * vT);
    float fog = fogFactor(vFogDepth);
    float alpha = uOpacity * fade * (1.0 - 0.72 * fog);
    gl_FragColor = vec4(color * (3.8 + 2.1 * fade), alpha);
  }
`

// ── THE NEURAL BELL (the big swing) ──────────────────────────────────────────
// The bell is a working mind: signal spikes fire OUTWARD from the central stomach along the real
// radial canals (a deterministic dendrite tree). Base filaments stay DIM; only the traveling
// gaussian spike is HDR-bright, so Bloom streaks JUST the spike, never a white blob. Colour is the
// bell's OWN hue (a cleared run fires green, a blocked run fires coral) — neural colour IS semantic.
export const neuralVertex = /* glsl */ `
  attribute float aS;        // arc length from the root along this branch
  varying float vS;
  varying float vRad;        // distance from center, for a gentle core anchor
  varying float vFogDepth;
  void main() {
    vS = aS;
    vRad = length(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

export const neuralFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uSpeed;      // firing rate ← vitality (same field as the bell pulse)
  uniform float uIntensity;  // ← spec.alive (+ death throe): husk near-dark, hero brilliant
  uniform vec3 uColor;       // the bell's own semantic hue
  varying float vS;
  varying float vRad;
  varying float vFogDepth;
  ${FOG}
  void main() {
    // two spikes per branch at offset phases, propagating outward from the stomach
    float x1 = fract(vS * 1.3 - uTime * uSpeed);
    float x2 = fract(vS * 1.3 - uTime * uSpeed + 0.5);
    float spike = exp(-pow(x1 / 0.11, 2.0)) + exp(-pow(x2 / 0.11, 2.0));
    // PROMINENT FAN — the fanned radial canals are the creature's "alive" signal, so make them read as
    // its glowing core through the now-clearer gel. Raise the resting filament toward HDR (0.42→0.55)
    // and add a gain so mipmapBlur Bloom feathers the 1px GL lines into apparent thickness (raw
    // gl.LINES can't do width). A gamma-LIFT on intensity (pow<1) brightens living + mid-collapse minds
    // so the fan is bold, WITHOUT giving a husk a bright brain — pow keeps 0→0, so "the mind goes out"
    // (death-director) still holds while the fan gains prominence everywhere it's alive.
    float base = 0.55;                                  // resting filament — HDR, reads through the gel
    float core = 1.35 * exp(-vRad * vRad * 2.0);        // dense glowing stomach anchor
    float lift = pow(clamp(uIntensity, 0.0, 1.0), 0.6); // brighten the living, leave the dead dark
    float gain = 1.7;                                   // feed Bloom's mipmapBlur so lines gain width
    vec3 col = uColor * ((base + core) * gain + spike * 3.4) * lift;
    col = min(col, vec3(1.8));                          // cap: overlapping stomachs can't clip to white
    float a = clamp((base + core) * 0.95 + spike, 0.0, 1.0) * lift;
    // the mind fades into the haze with distance too (additive → attenuate)
    float fog = fogFactor(vFogDepth);
    a *= (1.0 - 0.75 * fog);
    col *= (1.0 - 0.5 * fog);
    gl_FragColor = vec4(col, a);
  }
`

// ── ATMOSPHERE ────────────────────────────────────────────────────────────────
// God-ray shafts: art-directed cone geometry (not screen-space) so we control exactly where the
// light falls. Bright at the top, gone by mid-tank, soft fresnel-to-edge alpha, slow breathing.
export const rayVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

export const rayFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uLight;   // 1 at the 1950s peak → ~0.45 by 2018: the surface light fails as the
                          // fishery dies. Scales the shaft brightness AND alpha (dims + thins the beam).
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;

  // 1D-ish value noise for caustic flicker inside the shaft
  float h1(float n){ return fract(sin(n) * 43758.5453); }
  float n2(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a = h1(i.x + i.y*57.0), b = h1(i.x+1.0 + i.y*57.0);
    float c = h1(i.x + (i.y+1.0)*57.0), d = h1(i.x+1.0 + (i.y+1.0)*57.0);
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  void main() {
    float topDown = smoothstep(0.0, 1.0, 1.0 - vUv.y);   // bright where light enters, fading with depth
    // fade BOTH ends of the shaft to zero so the plane doesn't terminate with a hard edge — the top
    // eases in over the first 25%, the bottom dissolves over the last 35%, so the column emerges from
    // and melts into the water instead of cutting off abruptly.
    float endFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
    topDown *= endFade;
    // ACROSS-SHAFT profile: a smooth Gaussian so the shaft is diffuse volume, NOT a beam. The old
    // pow(1-|x|,1.6) triangular falloff peaked sharply at the center, and on a flat camera-facing
    // billboard that peak read as a hard bright SPINE down the middle. A gaussian with a soft
    // plateau (no cusp at center) + a gentle center-dip removes the spine so it blends as fog-light.
    float d = (vUv.x - 0.5) * 2.0;                        // -1..1 across the shaft
    float edge = exp(-d * d * 3.2);                       // soft round falloff, no central cusp
    edge *= 0.82 + 0.18 * smoothstep(0.0, 0.5, abs(d));   // slight center-dip → hollow, not a spine
    // volumetric caustic drift — soft low-frequency banding that flows DOWN the shaft (vUv.y + time),
    // so the beam looks like light scattering through moving water. NB: the shaft is a camera-facing
    // Y-billboard, so anything keyed to vUv.x (across-shaft) shears + aliases as it yaws — the old
    // 40-stripe striation + view-Fresnel did exactly that and read as flicker with AA off. Keep the
    // animation on vUv.y (stable under yaw).
    float caustic = n2(vec2(vUv.x * 3.0 + uSeed * 10.0, vUv.y * 3.0 - uTime * 0.3));
    caustic = mix(0.7, 1.2, caustic);
    float striate = 0.85 + 0.15 * sin(vUv.y * 9.0 - uTime * 0.5 + uSeed * 6.28); // gentle vertical flow
    float breathe = 0.8 + 0.2 * sin(uTime * 0.25 + uSeed * 6.28);
    float a = topDown * edge * breathe * caustic * striate * 0.26 * uLight;
    // keep the *3.4 HDR term unchanged (white-clip guard); uLight rides on top to fade the shaft.
    gl_FragColor = vec4(uColor * a * 3.4, a);
  }
`
