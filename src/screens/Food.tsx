import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { api, todayISO } from '../api'
import type { Meal, MealRecipe, FoodProduct } from '../types'
import { Button, Card, Field, Input, Select, Loading, Empty, Modal, Stat, useToast } from '../components/UI'

const num = (v: string) => (v === '' ? undefined : Number(v))
const nextDay = (d: string) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
const TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
// Legible macro line, e.g. "30g P · 40g C · 12g F"; null parts are skipped.
const macroLine = (p?: number | null, c?: number | null, f?: number | null) =>
  [p != null ? `${p}g P` : null, c != null ? `${c}g C` : null, f != null ? `${f}g F` : null].filter(Boolean).join(' · ')
const IconEdit = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
)
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
)
type BarcodeDetectorShape = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }
declare global { interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorShape } }
const guessMealType = () => {
  const hr = new Date().getHours()
  if (hr < 11) return 'breakfast'
  if (hr < 16) return 'lunch'
  if (hr < 21) return 'dinner'
  return 'snack'
}

export default function Food() {
  const [tab, setTab] = useState<'log' | 'templates' | 'lookup'>('log')
  const { show, node } = useToast()
  return (
    <div>
      <h1>Food</h1>
      <div className="row-wrap" style={{ marginTop: 12 }}>
        <button className={'chip' + (tab === 'log' ? ' active' : '')} onClick={() => setTab('log')}>Log</button>
        <button className={'chip' + (tab === 'templates' ? ' active' : '')} onClick={() => setTab('templates')}>Templates</button>
        <button className={'chip' + (tab === 'lookup' ? ' active' : '')} onClick={() => setTab('lookup')}>Lookup</button>
      </div>
      {tab === 'log' && <LogTab show={show} />}
      {tab === 'templates' && <TemplatesTab show={show} />}
      {tab === 'lookup' && <LookupTab show={show} />}
      {node}
    </div>
  )
}

function LogTab({ show }: { show: (m: string) => void }) {
  const [date, setDate] = useState(todayISO())
  const [items, setItems] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Meal | 'new' | null>(null)
  const [detail, setDetail] = useState<Meal | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    api.listMeals({ from: date, to: nextDay(date) }).then(setItems).finally(() => setLoading(false))
  }
  useEffect(load, [date])

  const del = async (id: number) => { if (!confirm('Delete this meal?')) return; await api.deleteMeal(id); load(); show('Deleted') }
  const totals = items.reduce((a, m) => ({
    cal: a.cal + (m.calories || 0), p: a.p + (m.protein_g || 0), c: a.c + (m.carbs_g || 0), f: a.f + (m.fat_g || 0),
  }), { cal: 0, p: 0, c: 0, f: 0 })

  const duplicateYesterday = async () => {
    setBusy(true)
    try {
      const from = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
      const created = await api.duplicateMeals(from, date)
      load()
      show(created.length ? `Copied ${created.length} meal(s) from ${from}` : `No meals found on ${from}`)
    } finally { setBusy(false) }
  }

  const sameAsLastDinner = async () => {
    setBusy(true)
    try {
      const last = await api.lastMealOfType('dinner')
      if (!last) { show('No previous dinner found'); return }
      await api.createMeal({
        name: last.name, meal_type: 'dinner', eaten_at: new Date().toISOString(),
        calories: last.calories, protein_g: last.protein_g, carbs_g: last.carbs_g, fat_g: last.fat_g, notes: last.notes,
      })
      load()
      show(`Logged "${last.name}" as dinner`)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="row" style={{ marginTop: 16 }}>
        <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
        <Button variant="primary" onClick={() => setEditing('new')}>Add</Button>
      </div>
      <div className="row-wrap" style={{ marginTop: 12 }}>
        <Button variant="secondary" size="sm" onClick={duplicateYesterday} loading={busy}>Duplicate yesterday</Button>
        <Button variant="secondary" size="sm" onClick={sameAsLastDinner} loading={busy}>Same as last dinner</Button>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card soft>
          <div className="stat-label">Total intake</div>
          <div className="stat-value" style={{ fontSize: 40, lineHeight: '46px' }}>{Math.round(totals.cal).toLocaleString()}<span className="stat-unit">kcal</span></div>
          <div className="grid grid-stats" style={{ marginTop: 16 }}>
            <Stat label="Protein" value={Math.round(totals.p)} unit="g" />
            <Stat label="Carbs" value={Math.round(totals.c)} unit="g" />
            <Stat label="Fat" value={Math.round(totals.f)} unit="g" />
          </div>
        </Card>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No meals logged for this day.</Empty></div>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {items.map((m) => (
            <Card key={m.id} className="card-tight">
              <div className="row between">
                <div role="button" tabIndex={0} onClick={() => setDetail(m)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(m) } }}
                  style={{ cursor: 'pointer', minWidth: 0, flex: 1 }} aria-label={`${m.name} nutrition details`}>
                  <strong style={{ textTransform: 'capitalize' }}>{m.name}</strong>
                  <div className="caption">{[m.meal_type ?? 'meal', `${m.calories ?? 0} kcal`, macroLine(m.protein_g, m.carbs_g, m.fat_g)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="iconbtn" onClick={() => setEditing(m)} aria-label="Edit"><IconEdit /></button>
                  <button className="iconbtn" onClick={() => del(m.id)} aria-label="Delete"><IconTrash /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <MealForm
          meal={editing === 'new' ? null : editing}
          defaultDate={date}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); show('Saved') }}
        />
      )}
      {detail && <MealDetailModal meal={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
    </div>
  )
}

function MealDetailModal({ meal, onClose, onEdit }: { meal: Meal; onClose: () => void; onEdit: () => void }) {
  return (
    <Modal title={meal.name} onClose={onClose}>
      <div className="row-wrap" style={{ marginBottom: 16 }}>
        {meal.meal_type && <span className="tag">{meal.meal_type}</span>}
        <span className="tag">{new Date(meal.eaten_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="grid grid-stats">
        <Stat label="Calories" value={meal.calories ?? null} unit="kcal" />
        <Stat label="Protein" value={meal.protein_g ?? null} unit="g" />
        <Stat label="Carbs" value={meal.carbs_g ?? null} unit="g" />
        <Stat label="Fat" value={meal.fat_g ?? null} unit="g" />
      </div>
      {meal.notes && <div className="caption" style={{ marginTop: 16 }}>{meal.notes}</div>}
      <div style={{ marginTop: 16 }}><Button variant="secondary" onClick={onEdit}>Edit</Button></div>
    </Modal>
  )
}

function MealForm({ meal, defaultDate, onClose, onDone }: { meal: Meal | null; defaultDate: string; onClose: () => void; onDone: () => void }) {
  const initWhen = meal ? new Date(meal.eaten_at).toISOString().slice(0, 16) : `${defaultDate}T12:00`
  const [f, setF] = useState({
    name: meal?.name ?? '', meal_type: meal?.meal_type ?? 'lunch', eaten_at: initWhen,
    calories: meal?.calories?.toString() ?? '', protein_g: meal?.protein_g?.toString() ?? '',
    carbs_g: meal?.carbs_g?.toString() ?? '', fat_g: meal?.fat_g?.toString() ?? '', notes: meal?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return
    setSaving(true)
    const payload = {
      name: f.name.trim(), meal_type: f.meal_type, eaten_at: new Date(f.eaten_at).toISOString(),
      calories: num(f.calories), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g),
      notes: f.notes || undefined,
    }
    try {
      if (meal) await api.updateMeal(meal.id, payload)
      else await api.createMeal(payload)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal title={meal ? 'Edit meal' : 'Add meal'} onClose={onClose}>
      <div className="stack">
        <Field label="Food"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Chicken rice bowl" /></Field>
        <div className="row">
          <Field label="Type"><Select value={f.meal_type} onChange={(e) => setF({ ...f, meal_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="When"><Input type="datetime-local" value={f.eaten_at} onChange={(e) => setF({ ...f, eaten_at: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Calories"><Input type="number" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} /></Field>
          <Field label="Protein (g)"><Input type="number" value={f.protein_g} onChange={(e) => setF({ ...f, protein_g: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Carbs (g)"><Input type="number" value={f.carbs_g} onChange={(e) => setF({ ...f, carbs_g: e.target.value })} /></Field>
          <Field label="Fat (g)"><Input type="number" value={f.fat_g} onChange={(e) => setF({ ...f, fat_g: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Button variant="primary" onClick={save} loading={saving} disabled={!f.name.trim()}>Save</Button>
      </div>
    </Modal>
  )
}

function TemplatesTab({ show }: { show: (m: string) => void }) {
  const [recipes, setRecipes] = useState<MealRecipe[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<MealRecipe | 'new' | null>(null)
  const [detail, setDetail] = useState<MealRecipe | null>(null)
  const [logging, setLogging] = useState<{ id: number; type: string } | null>(null)

  const load = () => { setLoading(true); api.listMealRecipes().then(setRecipes).finally(() => setLoading(false)) }
  useEffect(load, [])

  const logNow = async (r: MealRecipe, mealType: string) => {
    setLogging({ id: r.id, type: mealType })
    try {
      await api.createMeal({
        name: r.name, meal_type: mealType, eaten_at: new Date().toISOString(),
        calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, notes: r.notes,
      })
      show(`Logged "${r.name}" as ${mealType}`)
    } finally { setLogging(null) }
  }

  const del = async (id: number) => { if (!confirm('Delete this template?')) return; await api.deleteMealRecipe(id); load(); show('Template deleted') }

  return (
    <div>
      <div className="row between" style={{ marginTop: 16 }}>
        <div className="caption">Saved meals — one tap logs it now.</div>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>New template</Button>
      </div>
      {loading ? <Loading /> : recipes.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No saved meal templates yet.</Empty></div>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {recipes.map((r) => (
            <Card key={r.id} className="card-tight">
              <div className="row between">
                <div role="button" tabIndex={0} onClick={() => setDetail(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(r) } }}
                  style={{ cursor: 'pointer', minWidth: 0, flex: 1 }} aria-label={`${r.name} nutrition details`}>
                  <strong>{r.name}</strong>
                  <div className="caption">{[`${r.calories ?? 0} kcal`, macroLine(r.protein_g, r.carbs_g, r.fat_g)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="iconbtn" onClick={() => setEditing(r)} aria-label="Edit"><IconEdit /></button>
                  <button className="iconbtn" onClick={() => del(r.id)} aria-label="Delete"><IconTrash /></button>
                </div>
              </div>
              <div className="row-wrap" style={{ marginTop: 10 }}>
                {TYPES.map((t) => (
                  <button key={t} className="chip" disabled={logging?.id === r.id} onClick={() => logNow(r, t)}>
                    {logging?.id === r.id && logging?.type === t ? '…' : `Log as ${t}`}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <RecipeForm recipe={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); show('Saved') }} />
      )}
      {detail && <RecipeDetailModal recipe={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
    </div>
  )
}

function RecipeDetailModal({ recipe, onClose, onEdit }: { recipe: MealRecipe; onClose: () => void; onEdit: () => void }) {
  return (
    <Modal title={recipe.name} onClose={onClose}>
      <div className="grid grid-stats">
        <Stat label="Calories" value={recipe.calories ?? null} unit="kcal" />
        <Stat label="Protein" value={recipe.protein_g ?? null} unit="g" />
        <Stat label="Carbs" value={recipe.carbs_g ?? null} unit="g" />
        <Stat label="Fat" value={recipe.fat_g ?? null} unit="g" />
      </div>
      {recipe.notes && <div className="caption" style={{ marginTop: 16 }}>{recipe.notes}</div>}
      <div style={{ marginTop: 16 }}><Button variant="secondary" onClick={onEdit}>Edit</Button></div>
    </Modal>
  )
}

function RecipeForm({ recipe, onClose, onDone }: { recipe: MealRecipe | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: recipe?.name ?? '', calories: recipe?.calories?.toString() ?? '', protein_g: recipe?.protein_g?.toString() ?? '',
    carbs_g: recipe?.carbs_g?.toString() ?? '', fat_g: recipe?.fat_g?.toString() ?? '', notes: recipe?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return
    setSaving(true)
    const payload = { name: f.name.trim(), calories: num(f.calories), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g), notes: f.notes || undefined }
    try {
      if (recipe) await api.updateMealRecipe(recipe.id, payload)
      else await api.createMealRecipe(payload)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal title={recipe ? 'Edit template' : 'New template'} onClose={onClose}>
      <div className="stack">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Chicken pulao" /></Field>
        <div className="row">
          <Field label="Calories"><Input type="number" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} /></Field>
          <Field label="Protein (g)"><Input type="number" value={f.protein_g} onChange={(e) => setF({ ...f, protein_g: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Carbs (g)"><Input type="number" value={f.carbs_g} onChange={(e) => setF({ ...f, carbs_g: e.target.value })} /></Field>
          <Field label="Fat (g)"><Input type="number" value={f.fat_g} onChange={(e) => setF({ ...f, fat_g: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Button variant="primary" onClick={save} loading={saving} disabled={!f.name.trim()}>Save template</Button>
      </div>
    </Modal>
  )
}

function LookupTab({ show }: { show: (m: string) => void }) {
  const [barcode, setBarcode] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodProduct[]>([])
  const [product, setProduct] = useState<FoodProduct | null>(null)
  const [grams, setGrams] = useState('100')
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [mealType, setMealType] = useState(guessMealType())
  const [logging, setLogging] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanControlsRef = useRef<IScannerControls | null>(null)

  const stopScan = () => {
    scanControlsRef.current?.stop()
    scanControlsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setScanning(false)
  }
  useEffect(() => () => stopScan(), [])

  const lookupCode = async (code: string) => {
    if (!code.trim()) return
    setLoading(true); setNotFound(false); setProduct(null)
    try {
      const p = await api.lookupBarcode(code.trim())
      if (p) setProduct(p); else setNotFound(true)
    } finally { setLoading(false) }
  }
  const lookup = () => lookupCode(barcode)

  const handleScannedCode = async (code: string) => {
    setBarcode(code)
    stopScan()
    await lookupCode(code)
    show(`Scanned barcode ${code}`)
  }

  const startZxingScan = async (constraints: MediaStreamConstraints) => {
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.UPC_EAN_EXTENSION,
      BarcodeFormat.CODE_128,
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
    let handled = false
    const controls = await reader.decodeFromConstraints(constraints, videoRef.current ?? undefined, async (result) => {
      const code = result?.getText()
      if (!code || handled) return
      handled = true
      await handleScannedCode(code)
    })
    scanControlsRef.current = controls
    setScanMsg('Point the camera at a barcode. Hold it steady and fill the frame with the bars.')
  }

  const startNativeBarcodeScan = async (constraints: MediaStreamConstraints) => {
    if (!window.BarcodeDetector) throw new Error('native barcode detector unavailable')
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    }
    const tick = async () => {
      if (!streamRef.current || !videoRef.current) return
      try {
        const found = await detector.detect(videoRef.current)
        const code = found[0]?.rawValue
        if (code) {
          await handleScannedCode(code)
          return
        }
      } catch {
        // Native detection can fail per-frame; keep trying while the stream is alive.
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  const startScan = async () => {
    if (!window.isSecureContext) {
      setScanMsg('Camera requires a secure connection (HTTPS or localhost). This page is loaded insecurely — enter the code manually.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanMsg('Camera access is not available in this browser. Enter the code manually.')
      return
    }
    stopScan()
    setScanMsg('Point the camera at a barcode.')
    setScanning(true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    }
    try {
      try {
        // Food barcodes are usually 1D EAN/UPC codes. Chrome may expose the
        // native BarcodeDetector but fail to detect those formats on some
        // devices, leaving the camera preview alive with no result. Use ZXing as
        // the primary scanner because it handles EAN/UPC reliably in-browser.
        await startZxingScan(constraints)
      } catch {
        stopScan()
        setScanning(true)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        await startNativeBarcodeScan(constraints)
        setScanMsg('Point the camera at a barcode. Using native scanner for this browser.')
      }
    } catch {
      stopScan()
      setScanMsg('Camera permission denied or unavailable. Enter the barcode manually.')
    }
  }

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setNotFound(false)
    try {
      const found = await api.searchFood(query.trim())
      setResults(found)
      if (!found.length) setNotFound(true)
    } finally { setLoading(false) }
  }

  const grams_ = Number(grams) || 0
  const scale = (v: number | null) => (v == null ? null : Math.round(((v * grams_) / 100) * 10) / 10)
  const macros = product ? {
    calories: scale(product.per100g.calories), protein_g: scale(product.per100g.protein_g),
    carbs_g: scale(product.per100g.carbs_g), fat_g: scale(product.per100g.fat_g),
  } : null

  const addToLog = async () => {
    if (!product || !macros) return
    setLogging(true)
    try {
      await api.createMeal({ name: product.name || `Barcode ${product.barcode}`, meal_type: mealType, eaten_at: new Date().toISOString(), ...macros })
      show(`Logged "${product.name ?? 'item'}"`)
      setProduct(null)
      setBarcode('')
    } finally { setLogging(false) }
  }

  return (
    <div>
      <div className="caption" style={{ marginTop: 16 }}>Scan a barcode, enter one manually, or search common foods/OpenFoodFacts by name.</div>
      <div className="row-wrap" style={{ marginTop: 12 }}>
        <Button variant="secondary" onClick={scanning ? stopScan : startScan}>{scanning ? 'Stop scan' : 'Scan barcode'}</Button>
        <Input placeholder="Barcode, e.g. 5000112637922" value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        <Button variant="secondary" onClick={lookup} loading={loading}>Look up</Button>
      </div>
      {scanMsg && <div className="caption" style={{ marginTop: 8 }}>{scanMsg}</div>}
      {scanning && <video ref={videoRef} muted playsInline style={{ width: '100%', marginTop: 12, borderRadius: 16, background: '#111' }} />}

      <div className="row" style={{ marginTop: 14 }}>
        <Input placeholder="Search food, e.g. oats, milk, chicken, rice" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button variant="secondary" onClick={search} loading={loading}>Search foods</Button>
      </div>

      {notFound && <div style={{ marginTop: 16 }}><Empty>No matching food found.</Empty></div>}
      {results.length > 0 && (
        <div className="stack" style={{ marginTop: 16 }}>
          {results.map((r, i) => (
            <div key={`${r.barcode ?? r.name}-${i}`} className="card card-tight" role="button" tabIndex={0}
              onClick={() => setProduct(r)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProduct(r) } }}
              style={{ cursor: 'pointer' }} aria-label={`${r.name ?? 'food'} nutrition details`}>
              <strong>{r.name ?? 'Unknown food'}</strong>
              <div className="caption">{[r.brand ?? 'Food', `${r.per100g.calories ?? '—'} kcal/100g`, macroLine(r.per100g.protein_g, r.per100g.carbs_g, r.per100g.fat_g)].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}

      {product && macros && (
        <Modal title={product.name ?? 'Nutrition'} onClose={() => setProduct(null)}>
          <div className="row-wrap" style={{ marginBottom: 16 }}>
            {product.brand && <span className="tag">{product.brand}</span>}
            {product.servingSize && <span className="tag">Serving: {product.servingSize}</span>}
            {product.barcode && <span className="tag">#{product.barcode}</span>}
          </div>
          <div className="stat-label">Per 100 g</div>
          <div className="grid grid-stats" style={{ marginTop: 8 }}>
            <Stat label="Calories" value={product.per100g.calories ?? null} unit="kcal" />
            <Stat label="Protein" value={product.per100g.protein_g ?? null} unit="g" />
            <Stat label="Carbs" value={product.per100g.carbs_g ?? null} unit="g" />
            <Stat label="Fat" value={product.per100g.fat_g ?? null} unit="g" />
          </div>
          <div className="row-wrap" style={{ marginTop: 16 }}>
            <Field label="Grams"><Input type="number" value={grams} onChange={(e) => setGrams(e.target.value)} /></Field>
            <Field label="Meal"><Select value={mealType} onChange={(e) => setMealType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          </div>
          <div className="caption" style={{ marginTop: 12 }}>
            For {Number(grams) || 0} g: {[`${macros.calories ?? '—'} kcal`, macroLine(macros.protein_g, macros.carbs_g, macros.fat_g)].filter(Boolean).join(' · ')}
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={addToLog} loading={logging}>Add to log</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
