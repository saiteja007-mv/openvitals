// OpenFoodFacts lookup (manual barcode input) + grams/serving macro calculator. No API key required.
const BASE = 'https://world.openfoodfacts.org'

function normalizeProduct(p) {
  const n = p.nutriments || {}
  return {
    barcode: p.code || null,
    name: p.product_name || p.generic_name || null,
    brand: p.brands || null,
    per100g: {
      calories: n['energy-kcal_100g'] ?? null,
      protein_g: n.proteins_100g ?? null,
      carbs_g: n.carbohydrates_100g ?? null,
      fat_g: n.fat_100g ?? null,
    },
    servingSize: p.serving_size || null,
  }
}

async function lookupBarcode(code, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE}/api/v2/product/${encodeURIComponent(code)}.json`)
  if (!r.ok) throw new Error('OpenFoodFacts request failed: ' + r.status)
  const data = await r.json()
  if (data.status !== 1 || !data.product) return null
  return normalizeProduct(data.product)
}

function macrosForGrams(per100g, grams) {
  const f = (v) => (v == null ? null : Math.round(((v * grams) / 100) * 10) / 10)
  return { calories: f(per100g.calories), protein_g: f(per100g.protein_g), carbs_g: f(per100g.carbs_g), fat_g: f(per100g.fat_g) }
}

// Curated per-100g macros for staples so name-search covers common foods even offline / when
// OpenFoodFacts is unreachable or returns junk. Values are standard reference figures.
const COMMON_FOODS = [
  { name: 'Oats (rolled, dry)', calories: 389, protein_g: 16.9, carbs_g: 66, fat_g: 6.9 },
  { name: 'Milk (whole)', calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 },
  { name: 'Milk (skimmed)', calories: 34, protein_g: 3.4, carbs_g: 5, fat_g: 0.1 },
  { name: 'Chicken breast (cooked)', calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  { name: 'Egg (whole)', calories: 143, protein_g: 13, carbs_g: 1.1, fat_g: 9.5 },
  { name: 'White rice (cooked)', calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 },
  { name: 'Brown rice (cooked)', calories: 123, protein_g: 2.7, carbs_g: 26, fat_g: 1 },
  { name: 'Roti / Chapati', calories: 297, protein_g: 11, carbs_g: 46, fat_g: 7 },
  { name: 'Idli', calories: 130, protein_g: 4, carbs_g: 26, fat_g: 0.5 },
  { name: 'Dosa', calories: 168, protein_g: 3.9, carbs_g: 30, fat_g: 3.7 },
  { name: 'Whole wheat bread', calories: 247, protein_g: 13, carbs_g: 41, fat_g: 3.4 },
  { name: 'Banana', calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3 },
  { name: 'Apple', calories: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2 },
  { name: 'Orange', calories: 47, protein_g: 0.9, carbs_g: 12, fat_g: 0.1 },
  { name: 'Avocado', calories: 160, protein_g: 2, carbs_g: 9, fat_g: 15 },
  { name: 'Peanut butter', calories: 588, protein_g: 25, carbs_g: 20, fat_g: 50 },
  { name: 'Almonds', calories: 579, protein_g: 21, carbs_g: 22, fat_g: 50 },
  { name: 'Greek yogurt (plain, nonfat)', calories: 59, protein_g: 10, carbs_g: 3.6, fat_g: 0.4 },
  { name: 'Paneer', calories: 265, protein_g: 18, carbs_g: 1.2, fat_g: 21 },
  { name: 'Tofu', calories: 76, protein_g: 8, carbs_g: 1.9, fat_g: 4.8 },
  { name: 'Lentils / Dal (cooked)', calories: 116, protein_g: 9, carbs_g: 20, fat_g: 0.4 },
  { name: 'Chickpeas (cooked)', calories: 164, protein_g: 8.9, carbs_g: 27, fat_g: 2.6 },
  { name: 'Kidney beans (cooked)', calories: 127, protein_g: 8.7, carbs_g: 23, fat_g: 0.5 },
  { name: 'Potato (boiled)', calories: 87, protein_g: 1.9, carbs_g: 20, fat_g: 0.1 },
  { name: 'Sweet potato (cooked)', calories: 90, protein_g: 2, carbs_g: 21, fat_g: 0.1 },
  { name: 'Broccoli', calories: 34, protein_g: 2.8, carbs_g: 7, fat_g: 0.4 },
  { name: 'Spinach', calories: 23, protein_g: 2.9, carbs_g: 3.6, fat_g: 0.4 },
  { name: 'Salmon (cooked)', calories: 208, protein_g: 20, carbs_g: 0, fat_g: 13 },
  { name: 'Tuna (canned in water)', calories: 116, protein_g: 26, carbs_g: 0, fat_g: 1 },
  { name: 'Beef (lean, cooked)', calories: 250, protein_g: 26, carbs_g: 0, fat_g: 15 },
  { name: 'Cheddar cheese', calories: 402, protein_g: 25, carbs_g: 1.3, fat_g: 33 },
  { name: 'Butter', calories: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81 },
  { name: 'Olive oil', calories: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
  { name: 'Honey', calories: 304, protein_g: 0.3, carbs_g: 82, fat_g: 0 },
  { name: 'Sugar (white)', calories: 387, protein_g: 0, carbs_g: 100, fat_g: 0 },
  { name: 'Pasta (cooked)', calories: 131, protein_g: 5, carbs_g: 25, fat_g: 1.1 },
  { name: 'Quinoa (cooked)', calories: 120, protein_g: 4.4, carbs_g: 21, fat_g: 1.9 },
  { name: 'Whey protein (powder)', calories: 400, protein_g: 80, carbs_g: 8, fat_g: 6 },
]

function commonFood(f) {
  return {
    barcode: null, name: f.name, brand: 'Common food',
    per100g: { calories: f.calories, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g },
    servingSize: null,
  }
}

function searchCommonFoods(query) {
  const q = query.toLowerCase()
  return COMMON_FOODS.filter((f) => f.name.toLowerCase().includes(q)).map(commonFood)
}

// Search foods by name: curated staples first (always reliable), then live OpenFoodFacts hits.
// Network/JSON failures degrade to the local list rather than throwing.
async function searchFood(query, fetchImpl = fetch) {
  const q = (query || '').trim()
  if (!q) return []
  const local = searchCommonFoods(q)
  let remote = []
  try {
    const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,brands,nutriments,serving_size`
    const r = await fetchImpl(url)
    if (r.ok) {
      const data = await r.json()
      remote = (data.products || []).map(normalizeProduct).filter((p) => p.name && p.per100g.calories != null)
    }
  } catch { /* offline / bad JSON — curated results still returned */ }
  const seen = new Set()
  const out = []
  for (const p of [...local, ...remote]) {
    const key = (p.name || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.slice(0, 25)
}

module.exports = { lookupBarcode, macrosForGrams, normalizeProduct, searchFood, searchCommonFoods, COMMON_FOODS }
