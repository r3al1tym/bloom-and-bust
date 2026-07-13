import { useEffect, useState } from 'react'
import { BloomRenderer } from './bloom/BloomRenderer'
import { loadBloom, type BloomData } from './data/bloom'
import './app.css'

export function App() {
  const [data, setData] = useState<BloomData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // open on the 1970s — the historical peak for most NE Atlantic stocks, when the tank is full and
  // glowing. Dragging the scrubber forward then reveals the collapse.
  const [decade, setDecade] = useState(2)

  useEffect(() => {
    loadBloom().then(setData).catch((e) => setErr(String(e)))
  }, [])

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
      onDecade={setDecade}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}
