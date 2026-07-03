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
  plan_id?: number | null
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

export interface MealRecipe {
  id: number
  name: string
  calories?: number | null
  protein_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
  notes?: string | null
  created_at?: string
  updated_at?: string
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

export interface Settings {
  calorie_goal: number | null
  protein_goal: number | null
  steps_goal: number | null
  sleep_goal_min: number | null
  weight_goal_kg: number | null
  height_cm: number | null
  updated_at?: string
}

export type HabitsMap = Record<string, boolean>
export interface HabitDay { date: string; done: boolean }
export interface HabitStatus { name: string; done: boolean; streak: number; history?: HabitDay[] }

export interface BodyMetric {
  id: number
  date: string
  weight_kg?: number | null
  body_fat_pct?: number | null
  waist_cm?: number | null
  chest_cm?: number | null
  arm_cm?: number | null
  notes?: string | null
  photo_ref?: string | null
  created_at?: string
  updated_at?: string
}

export interface WorkoutPlanItem {
  name: string
  exercise_id?: string | null
  target_sets?: number | null
  target_reps?: number | null
  target_weight_kg?: number | null
}
export interface WorkoutPlan {
  id: number
  name: string
  kind?: string | null
  items: WorkoutPlanItem[]
  created_at?: string
  updated_at?: string
}
export interface PlanCompare {
  plan: WorkoutPlan
  date: string
  planned: WorkoutPlanItem[]
  logged: Workout[]
}

export interface ProgressEntry {
  name: string
  maxWeight: number
  lastPerformed: string
  lastSessionVolume: number
  isPR: boolean
  deltaFromLastMonth: number | null
}

export interface Recommendation {
  direction: 'lose' | 'gain' | 'maintain'
  weeklyDeltaKg: number | null
  impliedDeficit: number | null
  targetCalories: number | null
  proteinRangeG: [number, number] | null
  flags: string[]
  message: string
  disclaimer: string
}

export interface WeeklySummary {
  from: string
  to: string
  days: number
  avgCalories: number | null
  avgProtein: number | null
  workoutCount: number
  avgSteps: number | null
  avgSleepMin: number | null
  weightChange: number | null
  bestDay: string | null
  worstDay: string | null
  insights: string[]
}

export interface FoodProduct {
  barcode: string | null
  name: string | null
  brand: string | null
  per100g: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
  servingSize: string | null
}

export interface Reminder {
  id: number
  kind: string
  channel: 'slack' | 'telegram'
  enabled: number
  time_of_day: string
  target?: string | null
  created_at?: string
  updated_at?: string
}
export interface ReminderCheckResult {
  checked: number
  due: number
  results: { reminderId: number; kind: string; status: string; detail: string | null }[]
}
