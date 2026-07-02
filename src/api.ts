import type { Exercise, ExerciseSearch, Facets, Workout, Meal, DaySummary, HealthResponse } from './types'

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error('request failed: ' + r.status)
  return r.json() as Promise<T>
}
const post = (url: string, body?: unknown) =>
  ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
const patch = (body: unknown) =>
  ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  getSummary: (date: string) => j<DaySummary>(`/api/summary?date=${date}`),
  getHealth: () => j<HealthResponse>('/api/health'),
  postSync: () => j<any>('/api/sync', post('/api/sync')),
  getStatus: () => j<any>('/api/status'),

  searchExercises: (p: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams()
    Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
    return j<ExerciseSearch>(`/api/exercises?${q.toString()}`)
  },
  getFacets: () => j<Facets>('/api/exercises/facets'),
  getExercise: (id: string) => j<Exercise>(`/api/exercises/${id}`),

  listWorkouts: (range?: { from?: string; to?: string }) => {
    const q = new URLSearchParams()
    if (range?.from) q.set('from', range.from)
    if (range?.to) q.set('to', range.to)
    return j<Workout[]>(`/api/workouts?${q.toString()}`)
  },
  createWorkout: (w: Partial<Workout>) => j<Workout>('/api/workouts', post('/api/workouts', w)),
  updateWorkout: (id: number, p: Partial<Workout>) => j<Workout>(`/api/workouts/${id}`, patch(p)),
  deleteWorkout: (id: number) => j<{ deleted: boolean }>(`/api/workouts/${id}`, { method: 'DELETE' }),

  listMeals: (range?: { from?: string; to?: string }) => {
    const q = new URLSearchParams()
    if (range?.from) q.set('from', range.from)
    if (range?.to) q.set('to', range.to)
    return j<Meal[]>(`/api/meals?${q.toString()}`)
  },
  createMeal: (m: Partial<Meal>) => j<Meal>('/api/meals', post('/api/meals', m)),
  updateMeal: (id: number, p: Partial<Meal>) => j<Meal>(`/api/meals/${id}`, patch(p)),
  deleteMeal: (id: number) => j<{ deleted: boolean }>(`/api/meals/${id}`, { method: 'DELETE' }),
}

// helpers
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const nowLocalInput = () => {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
