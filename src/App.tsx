import { useEffect, useRef, useState } from 'react'
import { BloomRenderer } from './bloom/BloomRenderer'
import { loadBloom, type BloomData } from './data/bloom'
import {
  useBloomControls,
  BEAT_INFLECTION_DECADEF,
  BEAT_ARM_BELOW,
  BEAT_FADE_S,
  BEAT_BLACK_S,
  BEAT_IGNITE_S,
  BEAT_SETTLE_S,
  BEAT_TOTAL_S,
} from './bloom/bloomControls'
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

// ── THE SCRIPTED TIPPING-POINT BEAT (technique #4) ──────────────────────────────────────────────────
// The one place the piece breaks its own pure-f(decadeF) reversibility. When autoplay crosses ~1980
// going forward, an ~8s beat plays on WALL-CLOCK time: fade→black→ignite→settle. It is the climax that
// lands the 2018 end-state — during ignite+settle it RAMPS decadeF from the inflection to 6.0 (2018) on
// an ease-out, so the lights come back on a visibly transformed, full sea, then hands control to the
// slider at 2018. `beatDecade` maps beat elapsed-seconds → the year the renderer should show; `beatPhase`
// names the sub-beat for the visual overrides. All from the store's fields (see bloomControls).
const easeOut = (x: number) => 1 - (1 - x) * (1 - x)
const ENABLE_TIPPING_POINT_BEAT = false
function beatPhaseAt(elapsedS: number): 'fade' | 'black' | 'ignite' | 'settle' {
  if (elapsedS < BEAT_FADE_S) return 'fade'
  if (elapsedS < BEAT_FADE_S + BEAT_BLACK_S) return 'black'
  if (elapsedS < BEAT_FADE_S + BEAT_BLACK_S + BEAT_IGNITE_S) return 'ignite'
  return 'settle'
}
// the decade the beat is displaying at `elapsedS`: held at the inflection through fade+black, then
// ramped inflection→6.0 across ignite+settle (ease-out — fastest right as the light returns).
function beatDecadeAt(elapsedS: number, fromDecade: number): number {
  const rampStart = BEAT_FADE_S + BEAT_BLACK_S
  if (elapsedS <= rampStart) return fromDecade
  const k = Math.min(1, (elapsedS - rampStart) / (BEAT_IGNITE_S + BEAT_SETTLE_S))
  return fromDecade + (6 - fromDecade) * easeOut(k)
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
  // scripted-beat state: has it fired this forward pass, when (wall-clock ms) it started, and the
  // decade it fired at (the ramp origin). Kept in refs so the rAF loop drives it without re-render.
  const hasFiredBeat = useRef(false)
  const beatStart = useRef<number | null>(null)
  const beatFromDecade = useRef(0)

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

      // ── SCRIPTED BEAT takes over the playhead while it runs ──────────────────────────────────────
      if (beatStart.current != null) {
        const elapsedS = (now - beatStart.current) / 1000
        if (elapsedS >= BEAT_TOTAL_S) {
          // beat done — land at 2018 and hand back to the slider (normal progress>=1 stop fires below)
          beatStart.current = null
          progress.current = 1
          setDecade(6)
          useBloomControls.setState({ beatActive: false, beatT: 0, beatPhase: 'idle' })
          setPlaying(false)
          return
        }
        const phase = beatPhaseAt(elapsedS)
        const beatDecade = beatDecadeAt(elapsedS, beatFromDecade.current)
        // keep `progress` aligned to the ramped decade so a later pause/scrub resumes coherently
        progress.current = invEaseInOut(beatDecade / 6)
        useBloomControls.setState({ beatActive: true, beatT: Math.min(1, elapsedS / BEAT_TOTAL_S), beatPhase: phase })
        setDecade(beatDecade)
        raf.current = requestAnimationFrame(step)
        return
      }

      if (now >= holdUntil.current) {
        const prevDecade = easeInOut(progress.current) * 6
        progress.current = Math.min(1, progress.current + dt / SWEEP_MS)
        const nextDecade = easeInOut(progress.current) * 6
        // re-arm once we've rewound below the inflection (covers a scrub-back-then-play)
        if (hasFiredBeat.current && nextDecade < BEAT_ARM_BELOW) hasFiredBeat.current = false
        // FIRE — a forward crossing of the inflection this frame starts the beat
        if (ENABLE_TIPPING_POINT_BEAT && !hasFiredBeat.current && prevDecade < BEAT_INFLECTION_DECADEF && nextDecade >= BEAT_INFLECTION_DECADEF) {
          hasFiredBeat.current = true
          beatStart.current = now
          beatFromDecade.current = nextDecade
          useBloomControls.setState({ beatActive: true, beatT: 0, beatPhase: 'fade' })
          setDecade(nextDecade)
          raf.current = requestAnimationFrame(step)
          return
        }
        setDecade(nextDecade)
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
    // a manual scrub cancels any in-flight beat and re-arms it once dragged below the inflection, so
    // scrubbing back and replaying re-fires the tipping point (pure-reversible everywhere else).
    if (beatStart.current != null) {
      beatStart.current = null
      useBloomControls.setState({ beatActive: false, beatT: 0, beatPhase: 'idle' })
    }
    if (d < BEAT_ARM_BELOW) hasFiredBeat.current = false
    setDecade(d)
  }

  // play/pause toggle. If the sweep already finished (at 2018), Play replays from 1950.
  const togglePlay = () => {
    if (progress.current >= 1) {
      progress.current = 0
      lastTs.current = null
      hasFiredBeat.current = false // replay from 1950 → the beat can fire again
      beatStart.current = null
      useBloomControls.setState({ beatActive: false, beatT: 0, beatPhase: 'idle' })
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
    hasFiredBeat.current = false // reset re-arms the tipping-point beat
    beatStart.current = null
    useBloomControls.setState({ beatActive: false, beatT: 0, beatPhase: 'idle' })
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
