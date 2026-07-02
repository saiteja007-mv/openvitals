export interface Exercise {
  id: string
  name: string
  category: string
  body_part: string
  equipment: string
  target: string
  muscle_group?: string
  secondary_muscles?: string[]
  instructions?: Record<string, string>
  instruction_steps?: Record<string, string[]> | string[]
  image?: string
  image_url?: string | null
  gif_url?: string
  media_id?: string
}

export interface ExerciseSearch { total: number; items: Exercise[] }
export interface Facets { bodyParts: string[]; equipment: string[]; targets: string[] }

export interface Workout {
  id: number
  exercise_id?: string | null
  name: string
  performed_at: string
  sets?: number | null
  reps?: number | null
  weight_kg?: number | null
  duration_min?: number | null
  notes?: string | null
  created_at?: string
}

export interface Meal {
  id: number
  name: string
  meal_type?: string | null
  eaten_at: string
  calories?: number | null
  protein_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
  notes?: string | null
  created_at?: string
}

export interface HealthMetrics {
  steps: number | null
  caloriesOut: number | null
  restingHr: number | null
  sleepMin: number | null
  sleepEfficiency: number | null
  hrv: number | null
  spo2: number | null
  breathingRate: number | null
  distanceKm: number | null
  activeMinutes: number | null
  zoneMinutes: number | null
  skinTemperature: number | null
  cardioScore: number | null
  weightKg: number | null
  asOf: string | null
}

export interface DaySummary {
  date: string
  health: HealthMetrics
  workouts: Workout[]
  meals: Meal[]
  nutrition: { calIn: number; protein: number; carbs: number; fat: number }
  balance: { in: number; out: number; net: number }
}

export interface HealthResponse { stale: boolean; data: any }
