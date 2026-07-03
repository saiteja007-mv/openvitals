const { test } = require('node:test')
const assert = require('node:assert')
const { lookupBarcode, macrosForGrams, searchFood, searchCommonFoods } = require('../server/food.cjs')

test('lookupBarcode: normalizes a found OpenFoodFacts product', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /world\.openfoodfacts\.org\/api\/v2\/product\/5000112637922\.json/)
    return {
      ok: true,
      json: async () => ({
        status: 1,
        product: {
          code: '5000112637922', product_name: 'Coca-Cola', brands: 'Coca-Cola',
          nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
          serving_size: '330ml',
        },
      }),
    }
  }
  const p = await lookupBarcode('5000112637922', fakeFetch)
  assert.equal(p.name, 'Coca-Cola')
  assert.equal(p.per100g.calories, 42)
  assert.equal(p.servingSize, '330ml')
})

test('lookupBarcode: returns null for an unknown barcode instead of throwing', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ status: 0 }) })
  assert.equal(await lookupBarcode('0000000000000', fakeFetch), null)
})

test('lookupBarcode: throws on a non-ok HTTP response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 })
  await assert.rejects(() => lookupBarcode('123', fakeFetch))
})

test('macrosForGrams: scales per-100g values to the requested grams', () => {
  const per100g = { calories: 42, protein_g: 0, carbs_g: 10.6, fat_g: 0 }
  assert.deepEqual(macrosForGrams(per100g, 330), { calories: 138.6, protein_g: 0, carbs_g: 35, fat_g: 0 })
})

test('macrosForGrams: passes through nulls for missing fields', () => {
  assert.equal(macrosForGrams({ calories: null }, 100).calories, null)
})

test('searchCommonFoods: returns common staple foods offline', () => {
  const foods = searchCommonFoods('chicken')
  assert.ok(foods.some((f) => f.name.includes('Chicken')))
  assert.equal(foods[0].brand, 'Common food')
})

test('searchFood: combines local staples and OpenFoodFacts hits', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /cgi\/search\.pl/)
    return { ok: true, json: async () => ({ products: [{ code: 'abc', product_name: 'Remote oats', brands: 'Brand', nutriments: { 'energy-kcal_100g': 360, proteins_100g: 12, carbohydrates_100g: 60, fat_100g: 7 } }] }) }
  }
  const results = await searchFood('oats', fakeFetch)
  assert.ok(results.some((f) => f.name.includes('Oats')))
  assert.ok(results.some((f) => f.name === 'Remote oats'))
})

test('searchFood: falls back to local foods when remote lookup fails', async () => {
  const results = await searchFood('rice', async () => { throw new Error('offline') })
  assert.ok(results.some((f) => f.name.includes('rice')))
})
