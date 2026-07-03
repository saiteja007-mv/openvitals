import type {
  Exercise, ExerciseSearch, Facets, Workout, Meal, MealRecipe, DaySummary, HealthResponse,
  Settings, HabitsMap, HabitStatus, BodyMetric, WorkoutPlan, WorkoutPlanItem, PlanCompare, ProgressEntry,
  Recommendation, WeeklySummary, FoodProduct, Reminder, ReminderCheckResult,
} from './types'

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts)
  if (r.status === 401) { window.dispatchEvent(new Event('consied:unauthorized')); throw new Error('unauthorized') }
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

  listMealRecipes: () => j<MealRecipe[]>('/api/meal-recipes'),
  createMealRecipe: (r: Partial<MealRecipe>) => j<MealRecipe>('/api/meal-recipes', post('/api/meal-recipes', r)),
  updateMealRecipe: (id: number, p: Partial<MealRecipe>) => j<MealRecipe>(`/api/meal-recipes/${id}`, patch(p)),
  deleteMealRecipe: (id: number) => j<{ deleted: boolean }>(`/api/meal-recipes/${id}`, { method: 'DELETE' }),
  duplicateMeals: (from: string, to: string) => j<Meal[]>('/api/meals/duplicate', post('/api/meals/duplicate', { from, to })),
  lastMealOfType: (mealType: string) => j<Meal[]>(`/api/meals?meal_type=${mealType}&limit=1`).then((r) => r[0] ?? null),

  // auth
  login: async (password: string) => {
    const r = await fetch('/api/login', post('/api/login', { password }))
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || 'login failed')
    return data as { ok: true }
  },
  logout: () => j<{ ok: boolean }>('/api/logout', post('/api/logout')),
  me: () => j<{ ok: boolean }>('/api/me'),

  // goals / targets
  getSettings: () => j<Settings>('/api/settings'),
  updateSettings: (p: Partial<Settings>) => j<Settings>('/api/settings', patch(p)),

  // habit tracker (custom habits + streaks)
  getHabits: (date: string) => j<HabitsMap>(`/api/habits?date=${date}`),
  listHabitStatus: (date: string) => j<HabitStatus[]>(`/api/habits/status?date=${date}`),
  setHabit: (date: string, habit: string, done: boolean) => j<HabitsMap>('/api/habits', post('/api/habits', { date, habit, done })),
  createHabit: (name: string) => j<{ name: string }>('/api/habits/new', post('/api/habits/new', { name })),
  deleteHabit: (name: string) => j<{ deleted: boolean }>(`/api/habits/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // body metrics
  listBodyMetrics: (range?: { from?: string; to?: string }) => {
    const q = new URLSearchParams()
    if (range?.from) q.set('from', range.from)
    if (range?.to) q.set('to', range.to)
    return j<BodyMetric[]>(`/api/body?${q.toString()}`)
  },
  upsertBodyMetric: (date: string, p: Partial<BodyMetric>) => j<BodyMetric>('/api/body', post('/api/body', { date, ...p })),
  deleteBodyMetric: (id: number) => j<{ deleted: boolean }>(`/api/body/${id}`, { method: 'DELETE' }),
  uploadBodyPhoto: (date: string, dataUrl: string) => j<BodyMetric>('/api/body/photo', post('/api/body/photo', { date, dataUrl })),
  bodyPhotoUrl: (ref: string) => `/api/body/photo/${ref}`,

  // workout plans
  listWorkoutPlans: () => j<WorkoutPlan[]>('/api/workout-plans'),
  createWorkoutPlan: (p: { name: string; kind?: string; items: WorkoutPlanItem[] }) => j<WorkoutPlan>('/api/workout-plans', post('/api/workout-plans', p)),
  updateWorkoutPlan: (id: number, p: Partial<{ name: string; kind: string; items: WorkoutPlanItem[] }>) => j<WorkoutPlan>(`/api/workout-plans/${id}`, patch(p)),
  deleteWorkoutPlan: (id: number) => j<{ deleted: boolean }>(`/api/workout-plans/${id}`, { method: 'DELETE' }),
  comparePlan: (id: number, date: string) => j<PlanCompare>(`/api/workout-plans/${id}/compare?date=${date}`),

  // progressive overload
  getProgress: () => j<ProgressEntry[]>('/api/progress'),

  // smart recommendation (advisory only)
  getRecommendation: () => j<Recommendation>('/api/recommendation'),

  // weekly summary
  getWeekly: (from: string, to: string) => j<WeeklySummary>(`/api/weekly?from=${from}&to=${to}`),

  // food lookup
  lookupBarcode: (code: string) => j<FoodProduct | null>(`/api/food/barcode/${encodeURIComponent(code)}`).catch(() => null),
  searchFood: (query: string) => j<FoodProduct[]>(`/api/food/search?q=${encodeURIComponent(query)}`).catch(() => []),

  // reminders
  listReminders: () => j<Reminder[]>('/api/reminders'),
  createReminder: (r: Partial<Reminder>) => j<Reminder>('/api/reminders', post('/api/reminders', r)),
  updateReminder: (id: number, p: Partial<Reminder>) => j<Reminder>(`/api/reminders/${id}`, patch(p)),
  deleteReminder: (id: number) => j<{ deleted: boolean }>(`/api/reminders/${id}`, { method: 'DELETE' }),
  checkDueReminders: () => j<ReminderCheckResult>('/api/reminders/due'),

  // export / backup
  exportJson: () => j<any>('/api/export/json'),
  exportCsvUrl: (table: string) => `/api/export/csv/${table}`,
  importJson: (data: unknown) => j<{ restored: string[] }>('/api/import/json', post('/api/import/json', data)),
}

// helpers
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const nowLocalInput = () => {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
export const downloadJson = (filename: string, data: unknown) =>
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
