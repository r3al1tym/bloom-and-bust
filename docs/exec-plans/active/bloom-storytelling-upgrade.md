# Bloom & Bust — storytelling upgrade (4 techniques) · AS-BUILT

**Status:** BUILT + verified in-browser (1950 / 1985 / 2018 + full beat arc), lint + build green. Uncommitted
on `master` (commit only when Sanju says so). Pre-inversion checkpoint safe in `git stash@{0}` — do NOT pop.
**Project:** `/home/sunsanju/projects/medusa-bloom` · **Dev:** `pnpm dev` (:5173/:5174) · **Gate:** `pnpm lint` then `pnpm build`

> This records what SHIPPED. An earlier auto-generated version of this doc proposed a different beat design
> (`beatT0`/`beatFired` + a Canvas-side `BeatClock`, inflection 2.5, decadeF sweeping independently). That
> is NOT what was built. The shipped beat is the option-B design below: App.tsx owns the playhead and the
> beat RAMPS decadeF 2.6→6.0 so the tipping point IS the climax that lands the 2018 end-state.

## The premise (post-inversion)

Jellyfish literally bloom. Overfish a sea and jellyfish move into the empty niche, so a jellyfish bloom *is*
what a collapsed fishery looks like. The piece opens on a sparse, warm, living 1950 sea; as the year sweeps
to 2018 the water fills with medusae while the fishery — the light, the colour, the life — goes out.
Aggregate collapse drives bloom size. No death animation: the story is arrival. Per-jelly presence scales
with `bloom = 0.05 + 0.95*pow(collapse, 0.9)`, `collapse = 1 - v.glow` (`v = visualsAsOf(stock, decadeF)`).

The honest driver is **`decadeProgress`** (0→1), written every frame by BloomRenderer's decade effect and read
by every per-frame loop via `getState()` (never a subscription — that re-renders the scene each frame).

## Invariants held

- **Reversibility** — #1/#2/#3 are pure `f(clock, decadeProgress, seed)`: a backward scrub fully undoes them,
  no latch. Verified: 1985→1950 restores the living sea exactly. **#4 is the one documented exception**
  (wall-clock-anchored, one-shot per forward crossing, re-arms on rewind/reset).
- **28-creature read** — never over-darkened/flattened past countability. Exposure floored at 0.60; verified
  all bells countable at 2018.
- **No-MSAA discipline** — no per-point rotation/jitter on background sprites; whole-cloud translation only.
- **1950 frame** — byte-identical for #1 (`worldDarkness(0)=0`); #3's cold-open adds warmth that fades to
  nothing by ~decadeF 1.8.
- **Store defaults** — none of the story-clock/beat fields are in `BLOOM_DEFAULTS`.

## Verifying a decade-gated visual (READ THIS before any 1950/2018 QA pass)

Any decade-gated visual check MUST first pause autoplay AND confirm the store `decadeF` HELD at the target
for ≥1s before reading. The scrubber display and App's decade label reflect the decade PROP, not the live
store `decadeF` the rAF playhead actually renders — both lie mid-playback. Force `decadeF` in the store (not
the slider, which the playhead overwrites each frame) and verify it sticks. Skipping this reads a mislabeled
mid-playback frame as "1950": it cost a full false density-regression escalation (bells looked full at
"1950" only because the playhead had run decadeF to ~5.96). Second trap in the same pass: measure the 28
BELL meshes (uniform signature `uGlow+uAlive+uSplit`), not all ~336 meshes — the ~308 tentacle/body meshes
carry a `uOpacity` uniform that does NOT scale with bloom and will poison any per-frame mean. Verified-correct
bell arc at rest: mean uOpacity 1950≈0.08 → 1984≈0.28 → 2018≈0.50 (monotonic; `stockAsOf` ratio=1→glow=1→
bloom=floor at decadeF=0 is the intended sparse 1950).

> A temporary `window.__b` store hook used during this QA pass (`BloomRenderer.tsx`, tagged "remove before
> lint") has been stripped — resolved, no longer in the build.

---

## 0 · Shared infra (built)

**`bloomControls.ts`**
- Store fields (after `decadeProgress`): `bloomLevel: number` (mean of `1-glow` over 28 stocks — the honest
  aggregate, ~0.62 at 2018; reserved for HUD/sound), `beatActive: boolean`, `beatT: number` (0..1 across the
  whole beat), `beatPhase: 'idle'|'fade'|'black'|'ignite'|'settle'`. Initialised in `create()`, NOT in defaults.
- Constants: `BLOOM_LEVEL_FULL=0.62`, `BEAT_INFLECTION_DECADEF=2.6` (~1980, sharpest aggregate drop),
  `BEAT_ARM_BELOW=2.0`, `BEAT_FADE_S=1.4 / BEAT_BLACK_S=1.1 / BEAT_IGNITE_S=2.8 / BEAT_SETTLE_S=2.7`
  (`BEAT_TOTAL_S≈8`).
- Helpers: `worldDarkness(p)=pow(clamp(p),1.15)` (#1's shared curve); `beatEnvelope(phase,t)→{dark,ignite}`
  (#4's visual envelope — `dark` ramps up in fade / holds in black / releases in ignite; `ignite` is a
  decaying flash at the black→ignite hinge).

**`BloomRenderer.tsx`** — imports `visualsAsOf`; the decade effect computes `bloomLevel` at the same single
store-write point; `handleReset` clears the beat.

**`App.tsx`** — owns the beat state machine (the playhead lives here). Refs `hasFiredBeat` / `beatStart` /
`beatFromDecade`; helpers `beatPhaseAt(s)` and `beatDecadeAt(s, from)` (holds decadeF at the inflection through
fade+black, then ease-out ramps it inflection→6.0 across ignite+settle). The rAF `step` detects the forward
crossing of `BEAT_INFLECTION_DECADEF`, drives the beat on wall-clock time, ramps decadeF, and hands to the
slider at 2018. Re-arms on scrub-below-`BEAT_ARM_BELOW`, reset, and replay.

## 1 · Darkness rises as the bloom brightens (built)

By 2018 the tank has no light of its own; the bloom is all that's left. All keyed to `worldDarkness(decadeProgress)`.
- **God-rays** (`Atmosphere.tsx` GodRay): `uLight` target `1 - 0.9*d` (1.0→~0.10). Composes with #3's warmth lerp on `uColor`.
- **Exposure + fills** (`BloomRenderer.tsx` `WorldDarkClock`, mounted by FogClock): exposure `max(0.60, 1.15-0.55*d)`
  (0.60 floor — Bloom runs pre-tone-map so glow cores keep HDR spread and gain contrast); ambient `0.2-0.13*d`;
  point `0.5-0.4*d`, colour `#8fd4e6→#24424a`.
- **Backdrop** (`TankBackground`): captures authored `uTop/uCaustic/uSurface` on frame 1, lerps toward drowned
  `#050d12 / #17313a / #0c1a22` by `d`; `uBottom` untouched.

## 2 · Uniformity = death (built, Jellyfish.tsx only)

The varied ecosystem collapses into one clinical-cyan monoculture pulsing as one organism. Keyed to shared `decadeProgress`.
- Consts `CLINICAL_CYAN=#7FE8FF`, `CYAN_MAX_PULL=0.9`.
- Hue drain: one lerp on `targetColor` right after `targetColor.set(v.tankColor)` — `lerp(CLINICAL_CYAN, 0.9*pow(dp,1.5))`
  — drains bell+neural+halo+tentacles (all ease toward `targetColor`); 10% original hue survives.
- Pulse unison: `unison=pow(dp,2)`, `phaseOffset=seed*2π*(1-unison)`; the three `t*PULSE_BASE_RATE + seed*2π`
  sites (hero glass shell, main `pulsePhase`, halo breath first term) use `phaseOffset` instead. Ascent/orientation
  seed terms untouched (they own the 6 movement techniques). Halo's `seed*17` detune kept so it's never a dead metronome.
- Verified: 2018 is a uniform cyan field, no white-clip / throb (no unison cap needed); 1950 re-varies to fate hues.

## 3 · 1950 living-sea cold-open (built, Atmosphere.tsx — done by workflow agent, verified)

A distant fish shoal + warm water + warm god-light present at 1950, gone by ~decadeF 1.8. `warmth = 1 - smoothstep(dp,0,0.42)`.
- `FishShoal`: 64 warm additive flecks, whole-cloud sum-of-sines drift (no rotation), z≈−11, `renderOrder=-45`,
  `fog=false`, distance-dim `smoothstep(camDist,6,16)`; `fishFade = 1 - smoothstep(dp,0.05,0.30)`.
- Warm-snow: steeper fade `1 - smoothstep(dp,0,0.5)`, base opacity 0.18 (≤0.20 ceiling).
- God-rays warm→cool on `uColor` (`#ffc98a` twin, 0.55 mix), composing with #1's `uLight` fade.

## 4 · Scripted tipping-point beat (built)

App.tsx state machine (§0) + a visual layer reading `beatEnvelope`:
- **WorldDarkClock / GodRay**: during `beatActive`, `dark` pushes exposure/lights/shafts toward black (fade→black),
  `ignite` lifts them as light returns; ease bumped to 0.22 so the ~1.4s snap lands.
- **Jellyfish**: `doom=env.dark` dims bell opacity/glow/halo toward dark in black; `flare=env.ignite` flares them
  above baseline on ignite (ease 0.3 during the beat).
- Neural dendrite fan consumes the beat too (`u.uIntensity.value = bloomAlive*(dimmed?0.4:1)*(1-0.9*doom) + 0.5*flare*bloom`)
  — the HDR minds go dark in `black` with everything else and re-fire on ignite, bloom-gated so faint survivors stay dark.
- Verified: fade(2.66)→black(held 2.66, tank + minds near-fully dark)→ignite(whole medusa incl. brains flare, decadeF
  ramps)→settle(→6.0)→idle(2018, handed to slider). Fires once per forward pass; re-arms after scrub-back/reset/replay.
  No white-clip.

## Rollback

Every override is `base − k·f` (or additive `+k·flare`), so deleting the term restores the prior look. Techniques
are independent. Pre-inversion state in `git stash@{0}` (do NOT pop). No commit until Sanju says so.
