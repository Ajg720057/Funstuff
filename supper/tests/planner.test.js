import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, RECIPES, REGIONS, CUISINES } from '../js/data.js';
import {
  DEFAULT_SETTINGS, candidates, servings, makePlan, shoppingList, mealCost, swapOptions, formatQty, recipeById,
} from '../js/planner.js';

const S = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

test('every recipe uses known ingredients, appliances and has steps', () => {
  const ids = new Set();
  for (const r of RECIPES) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    for (const [k, q] of r.ing) {
      assert.ok(INGREDIENTS[k], `${r.id}: unknown ingredient ${k}`);
      assert.ok(q > 0);
    }
    assert.ok(r.steps.length >= 2);
    assert.equal(r.macros.length, 4);
    assert.ok(CUISINES[r.cuisine], `${r.id}: cuisine ${r.cuisine}`);
  }
});

test('vegan plans contain no animal products', () => {
  for (const r of candidates(S({ diet: 'vegan' }))) {
    for (const [k] of r.ing) assert.ok(['v', 'p'].includes(INGREDIENTS[k].kind), `${r.id} has ${k}`);
  }
});

test('dislikes remove recipes containing that ingredient', () => {
  const list = candidates(S({ dislikes: ['cilantro', 'mushrooms'] }));
  for (const r of list) {
    assert.ok(!r.ing.some(([k]) => k === 'cilantro' || k === 'mushrooms'), r.id);
  }
});

test('appliances limit recipes', () => {
  const list = candidates(S({ appliances: ['microwave'] }));
  assert.ok(list.length >= 2);
  for (const r of list) assert.ok(r.needs.every((a) => a === 'microwave'), r.id);
});

test('plan has the requested number of distinct nights and fits a normal budget', () => {
  const settings = S({ budget: 90, nights: 7 });
  const plan = makePlan(settings, { seed: 42 });
  assert.equal(plan.ids.length, 7);
  assert.equal(new Set(plan.ids).size, 7);
  assert.ok(plan.underBudget, `total ${plan.total}`);
  assert.equal(plan.total, shoppingList(plan.ids.map(recipeById), settings).total);
});

test('a small recipe pool rotates instead of repeating one meal', () => {
  const plan = makePlan(S({ diet: 'vegan', appliances: ['microwave'] }), { seed: 1 });
  assert.equal(plan.ids.length, 7);
  for (let i = 1; i < plan.ids.length; i++) assert.notEqual(plan.ids[i], plan.ids[i - 1]);
});

test('a tight budget picks a cheaper week than a loose one', () => {
  const cheap = makePlan(S({ budget: 40 }), { seed: 7 });
  const loose = makePlan(S({ budget: 300, likes: ['high-protein'] }), { seed: 7 });
  assert.ok(cheap.total < loose.total, `${cheap.total} vs ${loose.total}`);
});

test('shopping list buys whole packs and skips pantry staples in the total', () => {
  const r = recipeById('pesto-pasta');
  const { items, total } = shoppingList([r, recipeById('bolognese')], S({ region: 'us', store: 'kroger', taxRate: 0 }));
  const pasta = items.find((i) => i.key === 'pasta');
  assert.equal(pasta.qty, 16);
  assert.equal(pasta.packs, 1);
  assert.ok(items.every((i) => i.pantry ? i.cost === 0 : i.packs >= 1));
  assert.equal(total, Math.round(items.reduce((a, i) => a + i.cost, 0) * 100) / 100);
});

test('more people cost more', () => {
  const r = recipeById('tikka');
  assert.ok(mealCost(r, S({ people: 4 })) > mealCost(r, S({ people: 2 })));
});

test('swap options exclude meals already in the plan', () => {
  const settings = S();
  const plan = makePlan(settings, { seed: 3 });
  const opts = swapOptions(settings, plan.ids, 0);
  assert.ok(opts.length > 0);
  for (const o of opts) assert.ok(!plan.ids.includes(o.recipe.id));
});

test('quantities read naturally', () => {
  assert.equal(formatQty(2, 'bunch'), '2 bunches');
  assert.equal(formatQty(1, 'onion'), '1 onion');
  assert.equal(formatQty(1.5, 'lb'), '1.5 lb');
  assert.equal(formatQty(0.75, 'cup'), '0.75 cup');
});

test('there are at least 100 recipes and every region store resolves', () => {
  assert.ok(RECIPES.length >= 100);
  for (const [region, { stores }] of Object.entries(REGIONS)) {
    for (const store of Object.keys(stores)) {
      const plan = makePlan(S({ region, store }), { seed: 5 });
      assert.equal(plan.ids.length, 7);
    }
  }
});

test('Chicago costs more than the US average at the same store', () => {
  const r = recipeById('tikka');
  assert.ok(mealCost(r, S({ region: 'chicago', store: 'walmart' })) > mealCost(r, S({ region: 'us', store: 'walmart' })));
});

test('grocery tax is added on top of the subtotal', () => {
  const rs = [recipeById('tikka'), recipeById('dhal')];
  const l = shoppingList(rs, S({ taxRate: 1 }));
  assert.equal(l.tax, Math.round(l.subtotal * 0.01 * 100) / 100);
  assert.equal(l.total, Math.round((l.subtotal + l.tax) * 100) / 100);
  assert.equal(shoppingList(rs, S({ taxRate: 0 })).tax, 0);
});

test('items already at home are not counted', () => {
  const rs = [recipeById('tikka')];
  const full = shoppingList(rs, S({ taxRate: 0 }));
  const less = shoppingList(rs, S({ taxRate: 0 }), ['chicken_thigh']);
  const chicken = full.items.find((i) => i.key === 'chicken_thigh');
  assert.equal(Math.round((full.total - less.total) * 100), Math.round(chicken.cost * 100));
  assert.ok(less.items.find((i) => i.key === 'chicken_thigh').have);
});

test('allergy filters remove recipes with those allergens', () => {
  const settings = S({ allergies: ['g', 'n', 's'] });
  const list = candidates(settings);
  assert.ok(list.length >= 10, `${list.length}`);
  for (const r of list) {
    for (const [k] of r.ing) assert.ok(!/[gns]/.test(INGREDIENTS[k].allergens), `${r.id} has ${k}`);
  }
  assert.ok(!list.some((r) => r.id === 'peanut-noodles' || r.id === 'pesto-pasta'));
});

test('cuisine and calorie filters apply', () => {
  for (const r of candidates(S({ cuisines: ['indian', 'mexican'] }))) assert.ok(['indian', 'mexican'].includes(r.cuisine));
  for (const r of candidates(S({ maxKcal: 600 }))) assert.ok(r.macros[0] <= 600);
});

test('cooking extra for lunch doubles portions and cost', () => {
  const r = recipeById('dhal');
  assert.equal(servings(S({ people: 2, lunches: true })), 4);
  assert.equal(mealCost(r, S({ lunches: true })), mealCost(r, S({ people: 4 })));
});
