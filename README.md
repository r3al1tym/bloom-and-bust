# Bloom & Bust

*As the fish go bust, the jellyfish bloom.* Fish declines can create conditions in which jellyfish
flourish. Bloom & Bust turns that documented ecological pattern into a visual metaphor: 28 medusae
embody 70 years of reconstructed Northeast Atlantic catch.

Each jellyfish represents a named taxon aggregated across the region. On load the piece plays a
slow sweep from 1950 to 2018; bodies change as reconstructed catch rises or falls relative to each
taxon's own observed peak. Grab the scrubber at any time to drive the years yourself.

This is an expressive rendering of **catch history**, not a direct measure of fish abundance,
biomass, or stock health. It does not measure jellyfish abundance or claim that a bloom occurred in
the Northeast Atlantic during this period. Catch can also change because of quotas, fishing effort,
markets, reporting, management, and other factors.

Every jellyfish is one named taxon. Its body is the data:

| part | field |
|---|---|
| **bell size** | lifetime reconstructed catch on a logarithmic scale |
| **hue** | catch relative to the taxon's own observed peak (near peak green · below peak gold · far below peak coral · minimal catch slate) |
| **pulse** | near-peak catch breathes slowly; lower catch fades and stills |
| **7 tentacles** | seven decade buckets from the 1950s→2010s; a tentacle becomes a *stump* once post-peak catch falls below one-third of peak |
| **oral arms** | length is the share of catch on the official books (vs unreported) |
| **stings** | the share of catch discarded at sea |
| **two-tone** | industrial vs small-scale fleet |

The piece selects the 28 named taxa with the largest lifetime reconstructed catch in the dataset.
Its colors and motion compare each taxon only with its own catch history; categories are descriptive
visual thresholds, not biological stock assessments.

## The data

[Sea Around Us — Global Fisheries Catch](https://registry.opendata.aws/sau-global-fisheries-catch-data/),
via the **AWS Registry of Open Data**. Reconstructed catch (landings + discards, reported +
unreported) for the NEAFC region, 1950–2018, from the University of British Columbia's Sea
Around Us project.

`scripts/extract.ts` streams the public catch CSV over plain HTTPS — **no AWS account, no
credentials** — aggregates each named taxon into a per-decade curve, and writes a small JSON to
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
