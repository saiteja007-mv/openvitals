const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')

let db = null

function initDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id TEXT,
      name TEXT NOT NULL,
      performed_at TEXT NOT NULL,
      sets INTEGER, reps INTEGER, weight_kg REAL, duration_min REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      meal_type TEXT,
      eaten_at TEXT NOT NULL,
      calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_performed ON workouts(performed_at);
    CREATE INDEX IF NOT EXISTS idx_meals_eaten ON meals(eaten_at);
  `)
  return db
}

const COLS = {
  workouts: ['exercise_id', 'name', 'performed_at', 'sets', 'reps', 'weight_kg', 'duration_min', 'notes'],
  meals: ['name', 'meal_type', 'eaten_at', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'notes'],
}

function insert(table, obj) {
  const c = COLS[table].filter((k) => obj[k] !== undefined)
  const info = db
    .prepare(`INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map((k) => '@' + k).join(', ')})`)
    .run(Object.fromEntries(c.map((k) => [k, obj[k]])))
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(info.lastInsertRowid))
}

function list(table, field, opts) {
  const { from, to } = opts || {}
  let sql = `SELECT * FROM ${table}`
  const params = []
  if (from) { sql += ` WHERE ${field} >= ?`; params.push(from) }
  if (to) { sql += (from ? ' AND ' : ' WHERE ') + `${field} < ?`; params.push(to) }
  sql += ` ORDER BY ${field} DESC`
  return db.prepare(sql).all(...params)
}

function update(table, id, patch) {
  const c = COLS[table].filter((k) => patch[k] !== undefined)
  if (c.length) {
    db.prepare(`UPDATE ${table} SET ${c.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
      .run({ ...Object.fromEntries(c.map((k) => [k, patch[k]])), id })
  }
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
}

function remove(table, id) {
  return { deleted: db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0 }
}

module.exports = {
  initDb,
  createWorkout: (w) => insert('workouts', w),
  listWorkouts: (f) => list('workouts', 'performed_at', f),
  updateWorkout: (id, p) => update('workouts', id, p),
  deleteWorkout: (id) => remove('workouts', id),
  createMeal: (m) => insert('meals', m),
  listMeals: (f) => list('meals', 'eaten_at', f),
  updateMeal: (id, p) => update('meals', id, p),
  deleteMeal: (id) => remove('meals', id),
}
