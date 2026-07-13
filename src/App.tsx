import { useEffect, useRef, useState } from 'react'
import { BloomRenderer } from './bloom/BloomRenderer'
import { loadBloom, type BloomData } from './data/bloom'
import './app.css'

// The emotional arc plays itself, and time flows CONTINUOUSLY — not in decade jumps. On load the tank
// opens in 1950 (full and green); a slow, eased sweep carries the year forward to 2018 and the viewer
// watches the North Atlantic go dark on its own before touching a thing. `decade` is a FLOAT position
// 0..6 (mapped to 1950..2018); the renderer interpolates every stock's state along it, so colour,
// mass, light and murk all move like water, never snapping. Any scrubber touch hands control over.
const SPAN_YEARS = 68 // 1950 → 2018
const SWEEP_MS = 26000 // full 1950→2018 sweep — slow enough to feel like a dive, not a slideshow
const HOLD_START_MS = 2200 // linger on the healthy 1950 tank before the descent begins

// ease-in-out so the sweep accelerates gently out of 1950 and settles gently into 2018 (no hard start/stop)
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
// its inverse — recover the normalized sweep position from an eased decade value, so playback can
// RESUME (or restart forward) from wherever a manual scrub or a pause left the year, at the correct
// eased speed rather than snapping the phase.
const invEaseInOut = (y: number) => {
  const c = Math.max(0, Math.min(1, y))
  return c < 0.5 ? Math.sqrt(c / 2) : (2 - Math.sqrt(2 * (1 - c))) / 2
}

export function App() {
  const [data, setData] = useState<BloomData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // continuous decade position 0..6 (0 = 1950, 6 = 2018). Starts at 0; playback eases it to 6.
  const [decade, setDecade] = useState(0)
  const [playing, setPlaying] = useState(true)
  const raf = useRef<number | null>(null)
  // normalized sweep position 0..1 (decade = easeInOut(progress)*6). Kept in a ref so pause/resume,
  // manual scrub, and reset can all set the playhead without re-rendering, and the loop reads it live.
  const progress = useRef(0)
  const lastTs = useRef<number | null>(null)
  const holdUntil = useRef(0)

  useEffect(() => {
    loadBloom().then(setData).catch((e) => setErr(String(e)))
  }, [])

  // CONTINUOUS playback — advances `progress` in real time and derives the eased year. Pausing stops
  // the loop with the playhead intact; resuming continues from there. On a fresh start (progress≈0) it
  // holds on the healthy 1950 tank for HOLD_START_MS before the descent, so the opening still lingers.
  useEffect(() => {
    if (!playing || !data) return
    let alive = true
    lastTs.current = null
    const step = (now: number) => {
      if (!alive) return
      if (lastTs.current == null) {
        lastTs.current = now
        holdUntil.current = progress.current <= 0 ? now + HOLD_START_MS : now
      }
      const dt = now - lastTs.current
      lastTs.current = now
      if (now >= holdUntil.current) {
        progress.current = Math.min(1, progress.current + dt / SWEEP_MS)
        setDecade(easeInOut(progress.current) * 6)
      }
      if (progress.current >= 1) {
        setPlaying(false) // reached 2018 — stop; the play button will replay from the start
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      alive = false
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [playing, data])

  // a manual scrubber DRAG takes over: pause playback and align the playhead to the dragged year, so a
  // later Play resumes forward from there at the right eased speed.
  const setDecadeManual = (d: number) => {
    setPlaying(false)
    progress.current = invEaseInOut(d / 6)
    setDecade(d)
  }

  // play/pause toggle. If the sweep already finished (at 2018), Play replays from 1950.
  const togglePlay = () => {
    if (progress.current >= 1) {
      progress.current = 0
      lastTs.current = null
      setDecade(0)
      setPlaying(true)
      return
    }
    setPlaying((p) => !p)
  }

  // reset the year to 1950 and restart the sweep (with the opening hold). Camera reset is handled in
  // BloomRenderer, which owns the OrbitControls + establishing-crane replay.
  const reset = () => {
    progress.current = 0
    lastTs.current = null // re-inits the loop's timing → re-applies the opening hold even if mid-play
    setDecade(0)
    setPlaying(true)
  }

  if (err) return <div className="fatal">Failed to load data: {err}</div>
  if (!data) return <div className="loading mono">loading the bloom…</div>

  return (
    <BloomRenderer
      stocks={data.stocks}
      region={data.region}
      span={data.span}
      source={data.source}
      sourceUrl={data.sourceUrl}
      decades={data.decades}
      spanYears={SPAN_YEARS}
      decade={decade}
      onDecade={setDecadeManual}
      playing={playing}
      onPlayPause={togglePlay}
      onReset={reset}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}
