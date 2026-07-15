# Bloom & Bust — Goal and Work Handoff

## Primary Objective

Use these reference images (committed in `docs/references/`):

- `docs/references/ref-01-glowing-bells.webp`
- `docs/references/ref-02-jellyfish.jpg`
- `docs/references/ref-03-glowing-sea-jellyfishes.jpg`

Transform **Bloom & Bust** into a world-class interactive Three.js data-art experience suitable as an exemplar for `r/dataisbeautiful`. Match the references’ bioluminescence, dramatic underwater lighting, translucent and segmented bells, rich internal anatomy, layered ruffled oral arms, and dense hair-fine tentacles—while preserving the core data metaphor that fish-stock decline causes jellyfish to grow, brighten, and flourish, along with all timeline, playback, scrubbing, selection, and encoded-data behavior.

Continuously run the real site in headful Chrome Beta MCP with GPU acceleration, capture screenshots at 1950, intermediate years, and 2018, visually QA animation over multiple frames, and iteratively eliminate flickering, near-camera occlusion, harsh transparent polygons, clipping, sorting artifacts, and unreadable composition.

Do not stop at technical correctness: refine lighting, materials, geometry, motion, depth, color, typography, explanatory clarity, performance, and responsive presentation until the result is stable, polished, visually exceptional, and honestly communicates what the fisheries data does and does not represent.

## Project Context

- Repository: `bloom-and-bust`
- Local path used during this work: `~/projects/bloom-and-bust`
- Stack: React 19, TypeScript, Vite, Three.js, React Three Fiber, Drei, custom GLSL, postprocessing, Zustand, Leva.
- Static client-only site; no backend.
- Main files:
  - `src/App.tsx` — playback and UI
  - `src/data/` — fisheries dataset
  - `src/bloom/BloomRenderer.tsx` — scene, layout, camera, post-processing
  - `src/bloom/Jellyfish.tsx` — jellyfish anatomy and animation
  - `src/bloom/bloomGeometry.ts` — generated geometry
  - `src/bloom/bloomShaders.ts` — GLSL materials
  - `src/bloom/Atmosphere.tsx` — water particles and background life
  - `scripts/extract.ts` — source-data extraction

## Concept and Semantic Invariants

- Fish-stock decline creates a larger, brighter, more active jellyfish. The jellyfish is the metaphorical bloom occupying the ecological niche left by declining fish.
- The visualization does **not** claim to measure jellyfish abundance or provide an independent stock assessment.
- Preserve all 28 stocks and all existing interaction behavior:
  - 1950–2018 autoplay
  - pause/play
  - scrubber
  - stock selection/details
  - orbit and zoom
- Data anatomy must remain meaningful. Current mappings include stock size, catch decline, reporting share, discards, fleet composition, and collapse timing.
- Keep GPU rendering enabled. Visual QA must use Windows headful Chrome Beta; WSL/headless browser captures do not represent the real GPU output accurately.

## Current Worktree State

The worktree contains a large uncommitted visual redesign. It includes:

- Corrected the central data metaphor so collapse increases medusa presence/activity.
- Bundled the static dataset in `src/data/bloom.json`.
- Fixed invalid bell geometry that previously produced `NaN` positions.
- Removed giant camera-facing god-ray quads that caused hard full-frame wedges.
- Removed unstable transmission/refraction usage.
- Added stable custom gel shading with:
  - Fresnel rim lighting
  - cyan/violet/pink palette
  - radial ribs and petal chambers
  - caustic mottling
  - data-driven pulse, opacity, glow, and fog
- Replaced thick tube-like tentacles with line-based tentacles and filament curtains.
- Replaced the worst flat oral-arm sheets with generated ruffled geometry.
- Added internal organs, bell crown chambers, margin lobes, halos, and luminous cores.
- Added restrained selective bloom and vignette.
- Removed or reduced several known flicker sources and transparent near-camera planes.
- Experimented with featured medusae and wider/deeper layout for visual hierarchy.

## Current Honest Visual Status

The project is **not finished** and should not be presented as matching the references yet.

What is working:

- Severe flashing/large black foreground polygons are substantially improved.
- The broad cyan blade artifact from a flat oral ribbon was removed.
- Bell silhouettes and segmented internal structure are visible.
- The full 28-stock field remains interactive and data-driven.
- Production builds pass.

Primary remaining visual failures:

- The scene is still much darker and flatter than the references.
- Appendages often read as dark navy continuous masses instead of pale rose lace plus independent magenta threads.
- Pink/violet tissue does not survive strongly enough into the final composited frame.
- Fine filament density exists in code but is not sufficiently visible in the render.
- Featured medusae do not yet have reference-quality photographic volume or hierarchy.
- The references feature broad luminous caps and separated flowing anatomy; the current field still resembles many dim umbrellas with dark hanging curtains.
- Lighting, responsive composition, and final typography/presentation need more work.

## Critical QA Warning

Do **not** use `dist/qa-file.html` or other temporary `file://` wrappers as authoritative visual evidence.

During this session, those wrappers sometimes:

- loaded stale Vite bundles,
- executed module bundles as classic scripts,
- broke viewport sizing,
- leaked the minified JavaScript into the document below the app,
- produced Chrome DevTools screenshots containing stale compositor content.

This caused misleading visual comparisons.

Use the real Vite server instead:

```bash
cd ~/projects/bloom-and-bust
npm install
npm run dev
```

Open the URL printed by Vite, normally:

```text
http://localhost:5173
```

Use Windows Chrome or Chrome Beta with GPU acceleration. For MCP-based work, point Chrome Beta MCP at that real URL. Do not disable GPU.

## Recommended Continuation Workflow

1. Pull this branch and install dependencies.
2. Run `npm run dev` and open the real HTTP URL in headful Chrome Beta.
3. Pause the animation and capture a clean baseline at:
   - 1950
   - roughly 1980–1990
   - 2018
4. Capture several consecutive frames at each position to check temporal flicker and sorting instability.
5. Compare only those clean captures against the three reference images.
6. Prioritize visual changes in this order:
   - eliminate dark continuous appendage masses,
   - make featured oral tissue pale rose/pink and translucent,
   - make independent magenta filament lines clearly visible,
   - increase luminous volume inside bells without white clipping,
   - create foreground/background hierarchy while preserving all 28 stocks,
   - tune the water/background to support rather than hide anatomy,
   - refine typography and responsive layout.
7. Avoid reintroducing:
   - transmission/refraction FBOs,
   - giant sprites or screen-sized transparent quads,
   - depth-test-disabled large surfaces,
   - camera-near geometry,
   - opaque double-sided ribbon sheets.
8. After visual acceptance:
   - remove `RenderProbe`, `window.__bloomState`, `window.__bloomFocal`, and the temporary build stamp,
   - remove obsolete shader/material code,
   - run `npm run lint`,
   - run `npm run build`,
   - verify desktop and mobile/responsive views,
   - perform final 1950/midpoint/2018 screenshot QA.

## Useful Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

Inspect changes:

```bash
git status --short
git diff --stat
git diff --check
```

## Git State at Handoff

- Branch: `master`
- Remote: `origin` → `https://github.com/r3al1tym/bloom-and-bust.git`
- Starting checkpoint before this work: `64850b6` (`Medusa Bloom pre-codex checkpoint.`)
- Tag at starting checkpoint: `pre-codex-goal`

The commit containing this file is intended as a portable work-in-progress checkpoint, not a declaration that the visual objective is complete.
