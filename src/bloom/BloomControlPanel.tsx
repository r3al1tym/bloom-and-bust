// The live control panel (leva) for tuning Bloom. Hidden by default — press ` (backtick) or ~ to
// toggle — so the exec-facing share opens clean; the tuner is there when you want it. Every control
// writes straight into the useBloomControls store, which the shaders/props/loops read live, so
// dragging a slider updates the scene in real time with no rebuild.
import { useEffect, useRef, useState } from 'react'
import { useControls, folder, Leva, button } from 'leva'
import { useBloomControls, BLOOM_DEFAULTS, liveCamPose, type CamPose } from './bloomControls'

// round a pose's angles/radius to clean numbers for display + clipboard
const roundPose = (p: CamPose): CamPose => ({
  az: Math.round(p.az * 1000) / 1000,
  pol: Math.round(p.pol * 1000) / 1000,
  rad: Math.round(p.rad * 100) / 100,
})

export function BloomControlPanel() {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')

  // ` or ~ toggles the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const set = useBloomControls.setState

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 1800)
  }

  // leva's setter, held in a ref so button handlers can keep the `freeze` checkbox in sync when they
  // flip freeze in the store (e.g. "preview opening" unfreezes) — otherwise leva's stale checkbox
  // value would re-push freeze:true on the next slider change and silently re-freeze the camera.
  const setLevaRef = useRef<((v: Record<string, unknown>) => void) | null>(null)

  const [values, setLeva] = useControls(() => ({
    Glow: folder({
      bloomIntensity: { value: BLOOM_DEFAULTS.bloomIntensity, min: 0, max: 6, step: 0.05, label: 'bloom intensity' },
      bloomThreshold: { value: BLOOM_DEFAULTS.bloomThreshold, min: 0, max: 1, step: 0.01, label: 'bloom threshold' },
      bloomRadius: { value: BLOOM_DEFAULTS.bloomRadius, min: 0, max: 1, step: 0.01, label: 'bloom radius' },
      glowBoost: { value: BLOOM_DEFAULTS.glowBoost, min: 0, max: 2.5, step: 0.05, label: 'jelly glow ×' },
      haloBoost: { value: BLOOM_DEFAULTS.haloBoost, min: 0, max: 2.5, step: 0.05, label: 'halo ×' },
    }),
    Film: folder({
      grain: { value: BLOOM_DEFAULTS.grain, min: 0, max: 0.6, step: 0.01, label: 'film grain' },
      vignette: { value: BLOOM_DEFAULTS.vignette, min: 0, max: 1, step: 0.01, label: 'vignette' },
    }),
    Water: folder({
      waterSpeed: { value: BLOOM_DEFAULTS.waterSpeed, min: 0, max: 2, step: 0.05, label: 'water speed ×' },
      fogDensity: { value: BLOOM_DEFAULTS.fogDensity, min: 0, max: 0.15, step: 0.002, label: 'fog / depth haze' },
    }),
    Camera: folder({
      driftSpeed: { value: BLOOM_DEFAULTS.driftSpeed, min: 0, max: 3, step: 0.05, label: 'orbit speed ×' },
      driftAmount: { value: BLOOM_DEFAULTS.driftAmount, min: 0, max: 3, step: 0.05, label: 'orbit amount ×' },
    }),
    // Author the opening move in-browser: freeze the auto-orbit, drag/zoom to compose a shot, then
    // capture it as the START (high reveal) or HERO (settled) pose. Preview replays the START→HERO
    // arc-in. When it looks right, "copy framing" dumps both poses so Clod can bake them in as the
    // default opening. camStart/camEnd steer only the load-time reveal, not the sustained orbit.
    Framing: folder(
      {
        freeze: { value: false, label: 'freeze (compose)' },
        'set START (high reveal)': button(() => {
          const p = roundPose(liveCamPose)
          set({ camStart: p })
          flash(`START set — az ${p.az} · pol ${p.pol} · rad ${p.rad}`)
        }),
        'set HERO (settled)': button(() => {
          const p = roundPose(liveCamPose)
          set({ camEnd: p })
          flash(`HERO set — az ${p.az} · pol ${p.pol} · rad ${p.rad}`)
        }),
        'preview opening ▶': button(() => {
          // unfreeze and re-arm the establishing move so the authored (or derived) arc-in replays
          setLevaRef.current?.({ freeze: false }) // keep leva's checkbox in sync with the store
          set((s) => ({ freeze: false, replayNonce: s.replayNonce + 1 }))
        }),
        'copy framing': button(() => {
          const s = useBloomControls.getState()
          const framing = {
            camStart: s.camStart ?? roundPose(liveCamPose),
            camEnd: s.camEnd,
          }
          const text = 'BLOOM_FRAMING ' + JSON.stringify(framing)
          navigator.clipboard?.writeText(text).then(() => flash('framing copied — paste to Clod')).catch(() => {})
        }),
        'clear framing': button(() => {
          set({ camStart: null, camEnd: null })
          flash('framing cleared — derived arc-in restored')
        }),
      },
      { collapsed: true },
    ),
    'copy settings': button(() => {
      // dump the live VISUAL values as a labeled JSON block so you can paste your preferred look
      // back in and bake it in as the new BLOOM_DEFAULTS. Only the numeric visual knobs (the
      // keys in BLOOM_DEFAULTS) — framing/freeze state is copied separately via "copy framing".
      const s = useBloomControls.getState() as unknown as Record<string, number>
      const rounded = Object.fromEntries(
        Object.keys(BLOOM_DEFAULTS).map((k) => [k, Math.round(s[k] * 1000) / 1000]),
      )
      const text = 'BLOOM_SETTINGS ' + JSON.stringify(rounded)
      navigator.clipboard?.writeText(text).then(() => flash('settings copied — paste to Clod')).catch(() => {})
    }),
    'reset all': button(() => {
      setLeva({ ...BLOOM_DEFAULTS }) // snaps the sliders back; the effect below pushes it to the store
    }),
  }))

  setLevaRef.current = setLeva as unknown as (v: Record<string, unknown>) => void

  // push leva → store on any change (visual knobs + the freeze toggle live in `values`)
  useEffect(() => {
    set(values)
  }, [values, set])

  return (
    <>
      <Leva hidden={!open} collapsed={false} titleBar={{ title: 'Bloom · tuner' }} />
      {open && toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '6px 14px',
            borderRadius: 8,
            background: 'rgba(6, 19, 26, 0.85)',
            border: '1px solid rgba(191, 233, 255, 0.2)',
            color: '#cfe3ec',
            font: '12px/1 ui-monospace, monospace',
            letterSpacing: '0.04em',
            backdropFilter: 'blur(8px)',
          }}
        >
          {toast}
        </div>
      )}
    </>
  )
}
