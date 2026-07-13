# Medusa Bloom

A drift of jellyfish, each one a fish stock of the Northeast Atlantic. On load it plays itself —
a slow, continuous sweep from 1950 to 2018 — and you watch the tank fill green then go dark as the
fisheries collapse, the surface light failing and the dead stocks sinking into the deep. Grab the
scrubber any time to drive the years yourself.

Every jellyfish is one species. Its body is the data:

| part | field |
|---|---|
| **bell size** | the stock's total catch — its mass |
| **hue** | its fate vs its own historical peak (thriving green · declining gold · collapsed coral · husk slate) |
| **pulse** | thriving breathes slow · declining flutters · a husk is nearly still |
| **7 tentacles** | the seven decades 1950s→2010s; a tentacle is a *stump* from the decade the stock collapsed |
| **oral arms** | length is the share of catch on the official books (vs unreported) |
| **stings** | dead bycatch discarded at sea |
| **two-tone** | industrial vs small-scale fleet |

The story the bloom tells: of the 28 largest NE Atlantic stocks, most are a fraction of their
peak by the 2010s — capelin down 89%, herring 71%, blue whiting 66%, cod 56%. Only Atlantic
mackerel and Norway lobster are near their historical high. A tank that glowed green in 1970
is a field of amber and coral husks by 2018.

## The data

[Sea Around Us — Global Fisheries Catch](https://registry.opendata.aws/sau-global-fisheries-catch-data/),
via the **AWS Registry of Open Data**. Reconstructed catch (landings + discards, reported +
unreported) for the NEAFC region, 1950–2018, from the University of British Columbia's Sea
Around Us project.

`scripts/extract.ts` streams the public catch CSV over plain HTTPS — **no AWS account, no
credentials** — aggregates each species into a per-decade curve, and writes a small JSON to
`public/data/bloom.json` (committed to this repo). The cloud is the data *source*, never a
runtime dependency: the site is pure client-side three.js.

## Run it

```bash
pnpm install
pnpm dev            # → http://localhost:5173
```

To rebuild the data from source (optional — the JSON is committed):

```bash
pnpm extract
```

## How it's built

- **React 19 + TypeScript + Vite**, three.js via `@react-three/fiber` + `drei`, with a
  `@react-three/postprocessing` Bloom / tone-mapping / vignette / grain stack.
- Each medusa is a lathe sea-nettle bell with a frilled flaring margin and an asymmetric
  jet-pulse, sub-surface-scatter translucency, a dendrite "brain" firing HDR spikes along its
  radial canals, GPU-swayed tentacles (a traveling wave with arc-length lag), and a volumetric
  halo — all custom GLSL. Only glow/spike terms are HDR, so the Bloom pass amplifies meaning, not
  everything. A deep-water column (a recursive rotating-sine "neuro-noise" fractal) reads at once
  as neural mesh and underwater caustics; god-ray shafts and a slow crane camera finish the tank.
- The renderer owns no data. `src/data/bloom.ts` is the contract; `scripts/extract.ts` produces
  it; `src/bloom/bloomModel.ts` maps a `Stock` → a `BloomSpec`; the visual layer
  (`Jellyfish.tsx`, `bloomShaders.ts`, `bloomGeometry.ts`, `Atmosphere.tsx`) is a pure function of
  that spec + an animation clock.
- No server, no backend, no cloud at runtime — it hosts as static files anywhere.

The rendering technique began life on a very different dataset; this is a clean reimplementation
around open ocean data, severed from its origins.

## License

Code: MIT. Data: CC-BY (Sea Around Us) — cite the source above.
