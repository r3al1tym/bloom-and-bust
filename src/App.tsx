import { useEffect, useRef, useState } from 'react'
import { BloomRenderer } from './bloom/BloomRenderer'
import { loadBloom, type BloomData } from './data/bloom'
import './app.css'

// The emotional arc plays itself. On load the tank opens in the 1950s — full and green — then the
// decades AUTOPLAY forward to the 2010s: the viewer watches the North Atlantic go dark on its own
// before touching a thing. That unattended reveal is what turns a pretty screensaver into a story.
// The first decade holds a beat longer (establish the healthy tank); the collapse decades linger too
// (let the darkening land). Any scrubber touch cancels autoplay and hands control to the viewer.
const DWELL_MS = [2600, 2000, 2000, 2200, 2400, 2600, 3000] // per-decade hold, 1950s…2010s

export function App() {
  const [data, setData] = useState<BloomData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // open on the 1950s so the autoplay can sweep the FULL arc (full green tank → collapse).
  const [decade, setDecade] = useState(0)
  const [autoplay, setAutoplay] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadBloom().then(setData).catch((e) => setErr(String(e)))
  }, [])

  // autoplay the decades forward, then stop on the 2010s (the collapsed present). Self-cancels when
  // the viewer grabs the scrubber (setDecadeManual flips autoplay off).
  useEffect(() => {
    if (!autoplay || !data) return
    if (decade >= 6) return
    timer.current = setTimeout(() => setDecade((d) => Math.min(6, d + 1)), DWELL_MS[decade] ?? 2200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [autoplay, data, decade])

  // a manual scrubber move takes over: cancel autoplay for the rest of the session.
  const setDecadeManual = (d: number) => {
    setAutoplay(false)
    if (timer.current) clearTimeout(timer.current)
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
      decade={decade}
      onDecade={setDecadeManual}
      autoplaying={autoplay && decade < 6}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}
