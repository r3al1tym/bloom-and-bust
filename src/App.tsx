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

export function App() {
  const [data, setData] = useState<BloomData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // continuous decade position 0..6 (0 = 1950, 6 = 2018). Starts at 0; autoplay eases it to 6.
  const [decade, setDecade] = useState(0)
  const [autoplay, setAutoplay] = useState(true)
  const raf = useRef<number | null>(null)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    loadBloom().then(setData).catch((e) => setErr(String(e)))
  }, [])

  // CONTINUOUS autoplay — a single eased rAF sweep 0→6, then stop on 2018. Self-cancels the instant the
  // viewer grabs the scrubber (setDecadeManual flips autoplay off and cancels the frame).
  useEffect(() => {
    if (!autoplay || !data) return
    let alive = true
    const step = (now: number) => {
      if (!alive) return
      if (startedAt.current == null) startedAt.current = now
      const elapsed = now - startedAt.current - HOLD_START_MS
      const t = Math.max(0, Math.min(1, elapsed / SWEEP_MS))
      setDecade(easeInOut(t) * 6)
      if (t >= 1) {
        setAutoplay(false)
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      alive = false
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [autoplay, data])

  // a manual scrubber move takes over: cancel autoplay for the rest of the session.
  const setDecadeManual = (d: number) => {
    if (autoplay) setAutoplay(false)
    if (raf.current != null) cancelAnimationFrame(raf.current)
    setDecade(d)
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
      autoplaying={autoplay && decade < 6}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}
