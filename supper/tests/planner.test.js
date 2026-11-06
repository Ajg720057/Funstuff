import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, RECIPES } from '../js/data.js';
import {
  DEFAULT_SETTINGS, candidates, makePlan, shoppingList, mealCost, swapOptions, formatQty, recipeById,
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
  for (const r of list) assert.deepEqual(r.needs, ['microwave']);
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
  const { items, total } = shoppingList([r, recipeById('bolognese')], S({ store: 'kroger' }));
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
