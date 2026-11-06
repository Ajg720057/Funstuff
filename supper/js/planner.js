// Pure planning logic: filtering, pricing, shopping list and plan generation.
import { INGREDIENTS, RECIPES, REGIONS, AISLES } from './data.js';

const DIET_ALLOWS = {
  any: ['m', 'f', 'd', 'v', 'p'],
  pescatarian: ['f', 'd', 'v', 'p'],
  vegetarian: ['d', 'v', 'p'],
  vegan: ['v', 'p'],
};

export const DEFAULT_SETTINGS = {
  budget: 80,
  people: 2,
  nights: 7,
  region: 'chicago',
  store: 'jewel',
  taxRate: 1,
  diet: 'any',
  allergies: [],
  cuisines: [],
  maxKcal: 0,
  lunches: false,
  likes: ['quick'],
  dislikes: [],
  appliances: ['stove', 'oven', 'microwave'],
  maxTime: 60,
};

const round2 = (n) => Math.round(n * 100) / 100;

export function regionOf(settings) {
  return REGIONS[settings.region] || REGIONS.chicago;
}

export function storeOf(settings) {
  const { stores } = regionOf(settings);
  return stores[settings.store] || Object.values(stores)[0];
}

export function storeMult(settings) {
  return regionOf(settings).mult * storeOf(settings).mult;
}

// Portions cooked per dinner: one per person, doubled when cooking extra for lunch.
export function servings(settings) {
  return settings.people * (settings.lunches ? 2 : 1);
}

// Words the user does not want to see, matched against ingredient keys and names.
export function parseDislikes(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function ingredientMatches(key, word) {
  const ing = INGREDIENTS[key];
  const hay = `${key.replace(/_/g, ' ')} ${ing.name}`.toLowerCase();
  const w = word.replace(/s$/, '');
  return hay.includes(w);
}

export function recipeAllowed(recipe, settings, blocked = []) {
  if (blocked.includes(recipe.id)) return false;
  const allowedKinds = DIET_ALLOWS[settings.diet] || DIET_ALLOWS.any;
  for (const [key] of recipe.ing) {
    if (!allowedKinds.includes(INGREDIENTS[key].kind)) return false;
    if (settings.dislikes.some((w) => ingredientMatches(key, w))) return false;
  }
  const allergies = settings.allergies || [];
  if (allergies.length && recipe.ing.some(([k]) => allergies.some((a) => INGREDIENTS[k].allergens.includes(a)))) return false;
  if (settings.cuisines?.length && !settings.cuisines.includes(recipe.cuisine)) return false;
  if (settings.maxKcal && recipe.macros[0] > settings.maxKcal) return false;
  if (!recipe.needs.every((a) => settings.appliances.includes(a))) return false;
  // Slow-cooker recipes are mostly hands-off, so they ignore the time limit.
  if (!recipe.needs.includes('slowcooker') && recipe.time > settings.maxTime) return false;
  return true;
}

export function candidates(settings, blocked = []) {
  return RECIPES.filter((r) => recipeAllowed(r, settings, blocked));
}

// What one meal costs if you only count the share of each pack it uses.
export function mealCost(recipe, settings) {
  const scale = servings(settings) / 2;
  let total = 0;
  for (const [key, qty] of recipe.ing) {
    const ing = INGREDIENTS[key];
    total += (qty * scale / ing.pack) * ing.price;
  }
  return round2(total * storeMult(settings));
}

export function perServing(recipe, settings) {
  return round2(mealCost(recipe, settings) / servings(settings));
}

// Combine every meal's ingredients into whole packs to buy, grouped by aisle.
// Items in `have` are listed but not counted in the total.
export function shoppingList(recipes, settings, have = []) {
  const scale = servings(settings) / 2;
  const mult = storeMult(settings);
  const byKey = new Map();
  for (const r of recipes) {
    for (const [key, qty] of r.ing) {
      const entry = byKey.get(key) || { key, qty: 0, meals: [] };
      entry.qty += qty * scale;
      if (!entry.meals.includes(r.name)) entry.meals.push(r.name);
      byKey.set(key, entry);
    }
  }
  const items = [];
  let total = 0;
  for (const e of byKey.values()) {
    const ing = INGREDIENTS[e.key];
    const pantry = ing.kind === 'p';
    const packs = pantry ? 0 : Math.ceil(e.qty / ing.pack - 1e-9);
    const cost = pantry ? 0 : round2(packs * ing.price * mult);
    const owned = have.includes(e.key);
    if (!owned) total += cost;
    items.push({
      key: e.key, name: ing.name, aisle: ing.aisle, unit: ing.unit, pack: ing.pack,
      qty: round2(e.qty), packs, cost, pantry, have: owned, meals: e.meals,
    });
  }
  items.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
  const subtotal = round2(total);
  const tax = round2(subtotal * (Number(settings.taxRate) || 0) / 100);
  return { items, subtotal, tax, total: round2(subtotal + tax) };
}

export function weekTotal(recipes, settings, have = []) {
  return shoppingList(recipes, settings, have).total;
}

export function score(recipe, settings) {
  let s = 1;
  for (const t of recipe.tags) if (settings.likes.includes(t)) s += 2;
  return s;
}

// A tiny seeded RNG so plans can be reproduced in tests.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(list, weights, rand) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = rand() * sum;
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return list.length - 1;
}

// Build a plan: `nights` distinct recipes (repeats only if there are not enough),
// favouring liked tags, aiming to stay at or under budget.
// Returns { ids, total, underBudget }.
export function makePlan(settings, { seed = Date.now(), avoid = [], blocked = [] } = {}) {
  const pool = candidates(settings, blocked);
  if (pool.length === 0) return { ids: [], total: 0, underBudget: true };
  const rand = rng(seed);
  let best = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    // Mostly avoid last week's meals so weeks differ, but keep them as a fallback.
    let fresh = pool.filter((r) => !avoid.includes(r.id));
    if (fresh.length < settings.nights) fresh = pool.slice();
    let remaining = fresh.slice();
    const chosen = [];
    while (chosen.length < settings.nights) {
      // Not enough matching recipes: start another round so repeats rotate.
      if (!remaining.length) remaining = pool.filter((r) => r !== chosen[chosen.length - 1]);
      if (!remaining.length) remaining = pool.slice();
      const source = remaining;
      const weights = source.map((r) => {
        let w = score(r, settings);
        // Later attempts lean harder towards cheap meals.
        w /= Math.pow(1 + mealCost(r, settings), attempt / 100);
        // Reward sharing ingredients with what is already chosen (less waste).
        const shared = r.ing.filter(([k]) => chosen.some((c) => c.ing.some(([k2]) => k2 === k))).length;
        return w * (1 + shared * 0.15);
      });
      const i = weightedPick(source, weights, rand);
      chosen.push(source[i]);
      remaining.splice(i, 1);
    }
    const total = weekTotal(chosen, settings);
    const under = total <= settings.budget;
    const value = chosen.reduce((a, r) => a + score(r, settings), 0);
    const better = !best
      || (under && !best.underBudget)
      || (under === best.underBudget && (under ? value > best.value : total < best.total));
    if (better) best = { ids: chosen.map((r) => r.id), total, underBudget: under, value };
    if (under && attempt > 40) break;
  }
  return { ids: best.ids, total: best.total, underBudget: best.underBudget };
}

// Options to replace the meal on one night, cheapest effect on the total first.
export function swapOptions(settings, ids, index, blocked = [], have = []) {
  const byId = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  const others = ids.filter((_, i) => i !== index).map((id) => byId[id]);
  return candidates(settings, blocked)
    .filter((r) => !ids.includes(r.id))
    .map((r) => ({ recipe: r, total: weekTotal([...others, r], settings, have) }))
    .sort((a, b) => a.total - b.total);
}

export function recipeById(id) {
  return RECIPES.find((r) => r.id === id);
}

export function formatQty(qty, unit) {
  const n = Math.round(qty * 100) / 100;
  const pretty = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
  const fixed = { lb: 'lb', oz: 'oz', tbsp: 'tbsp', tsp: 'tsp', inch: 'in', zucchini: 'zucchini' };
  const irregular = { bunch: 'bunches', potato: 'potatoes' };
  let label = fixed[unit];
  if (!label) label = n <= 1 ? unit : irregular[unit] || `${unit}s`;
  return `${pretty} ${label}`;
}
