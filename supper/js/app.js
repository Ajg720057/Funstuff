import { STORES, APPLIANCES, TAGS, INGREDIENTS } from './data.js';
import {
  DEFAULT_SETTINGS, makePlan, shoppingList, mealCost, perServing, swapOptions,
  recipeById, parseDislikes, candidates, formatQty,
} from './planner.js';

const KEY = 'supper-state-v1';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings) return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
  } catch { /* storage unavailable */ }
  return { settings: { ...DEFAULT_SETTINGS }, plan: null, checked: [], blocked: [], view: 'prefs' };
}

let state = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const money = (n) => `$${n.toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 2200);
}

function planRecipes() {
  return (state.plan?.ids || []).map(recipeById).filter(Boolean);
}

function newPlan() {
  const avoid = state.plan?.ids || [];
  const plan = makePlan(state.settings, { avoid, blocked: state.blocked });
  if (!plan.ids.length) {
    toast('No recipes match those settings. Try loosening them.');
    return false;
  }
  state.plan = { ids: plan.ids, made: Date.now() };
  state.checked = [];
  save();
  const unique = new Set(plan.ids).size;
  if (unique < plan.ids.length) toast(`Only ${unique} recipes fit your settings, so some nights repeat.`);
  else if (!plan.underBudget) toast(`Couldn't get under ${money(state.settings.budget)}. This is the cheapest week found.`);
  return true;
}

function go(view) {
  state.view = view;
  save();
  render();
  window.scrollTo(0, 0);
}

// ---------- Views ----------

function render() {
  if (!state.plan && state.view !== 'prefs') state.view = 'prefs';
  const view = { week: renderWeek, list: renderList, prefs: renderPrefs }[state.view] || renderPrefs;
  $app.innerHTML = `
    <header class="top">
      <div class="brand"><span class="logo">🥕</span> Supper</div>
    </header>
    <section class="view">${view()}</section>
    ${state.plan ? `
    <nav class="tabs">
      ${tab('week', '📅', 'Week')}
      ${tab('list', '🛒', 'List')}
      ${tab('prefs', '⚙️', 'Preferences')}
    </nav>` : ''}`;
}

function tab(id, icon, label) {
  return `<button class="tab ${state.view === id ? 'on' : ''}" data-go="${id}"><span>${icon}</span>${label}</button>`;
}

function renderWeek() {
  const s = state.settings;
  const recipes = planRecipes();
  const { total } = shoppingList(recipes, s);
  const pct = Math.min(100, (total / s.budget) * 100);
  const over = total > s.budget;
  const avg = (i) => Math.round(recipes.reduce((a, r) => a + r.macros[i], 0) / recipes.length);
  return `
    <div class="summary card">
      <div class="row between">
        <div>
          <div class="muted small">Estimated shop at ${esc(STORES[s.store].name)}</div>
          <div class="big">${money(total)} <span class="muted small">of ${money(s.budget)}</span></div>
        </div>
        <button class="btn ghost" data-act="regen">↻ New week</button>
      </div>
      <div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
      <div class="stats">
        <div><b>${recipes.length}</b><span>dinners</span></div>
        <div><b>${s.people}</b><span>${s.people === 1 ? 'person' : 'people'}</span></div>
        <div><b>${avg(0)}</b><span>avg kcal</span></div>
        <div><b>${avg(1)}g</b><span>avg protein</span></div>
      </div>
    </div>
    <div class="meals">
      ${recipes.map((r, i) => `
        <article class="meal card" data-open="${i}">
          <div class="emoji">${r.emoji}</div>
          <div class="meal-body">
            <div class="muted small">${DAYS[i % 7]}</div>
            <h3>${esc(r.name)}</h3>
            <div class="chips">
              <span>⏱ ${fmtTime(r.time)}</span><span>🔥 ${r.macros[0]} kcal</span><span>💲${perServing(r, s).toFixed(2)}/serving</span>
            </div>
          </div>
          <button class="swap" data-swap="${i}" aria-label="Swap ${esc(r.name)}">⇄</button>
        </article>`).join('')}
    </div>
    <button class="btn primary wide" data-go="list">See shopping list →</button>`;
}

function packLabel(it) {
  return it.pack === 1 ? `buy ${it.packs}` : `buy ${it.packs} × ${formatQty(it.pack, it.unit)} pack`;
}

function fmtTime(min) {
  return min >= 120 ? `${Math.round(min / 60)}h` : `${min}m`;
}

function renderList() {
  const s = state.settings;
  const { items, total } = shoppingList(planRecipes(), s);
  const bought = items.filter((i) => !i.pantry);
  const pantry = items.filter((i) => i.pantry);
  const done = bought.filter((i) => state.checked.includes(i.key)).length;
  const groups = {};
  for (const it of bought) (groups[it.aisle] ||= []).push(it);
  return `
    <div class="summary card">
      <div class="row between">
        <div>
          <div class="muted small">${bought.length} items · ${done} in the cart</div>
          <div class="big">${money(total)}</div>
        </div>
        <button class="btn ghost" data-act="copy">Copy list</button>
      </div>
      <div class="muted small">Estimated ${esc(STORES[s.store].name)} prices. Shelf prices vary, so treat this as a guide.</div>
    </div>
    ${Object.entries(groups).map(([aisle, list]) => `
      <h4 class="aisle">${esc(aisle)}</h4>
      <div class="card list">
        ${list.map((it) => `
          <label class="item ${state.checked.includes(it.key) ? 'done' : ''}">
            <input type="checkbox" data-check="${it.key}" ${state.checked.includes(it.key) ? 'checked' : ''} />
            <div class="item-body">
              <div>${esc(it.name)}</div>
              <div class="muted small">Need ${formatQty(it.qty, it.unit)} · ${packLabel(it)}</div>
            </div>
            <div class="price">${money(it.cost)}</div>
          </label>`).join('')}
      </div>`).join('')}
    ${pantry.length ? `
      <h4 class="aisle">Check you have</h4>
      <div class="card list pantry">
        ${pantry.map((it) => `<div class="item"><div class="item-body">${esc(it.name)}</div></div>`).join('')}
      </div>` : ''}
    <p class="muted small center">Also used throughout: salt, pepper and cooking oil.</p>`;
}

function renderPrefs() {
  const s = state.settings;
  const first = !state.plan;
  const count = candidates(s, state.blocked).length;
  return `
    ${first ? `
      <div class="hero">
        <h1>Dinner for the week, sorted.</h1>
        <p class="muted">Set your budget, store and tastes. You'll get a week of dinners and one shopping list with the total.</p>
      </div>` : '<h2>Preferences</h2>'}
    <form id="prefs" class="card form">
      <label class="field">
        <span>Weekly budget</span>
        <div class="row"><b class="prefix">$</b><input type="number" name="budget" min="10" max="1000" step="5" value="${s.budget}" /></div>
      </label>
      <div class="two">
        <label class="field"><span>People</span>
          <select name="people">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === s.people ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Dinners</span>
          <select name="nights">${[3, 4, 5, 6, 7].map((n) => `<option ${n === s.nights ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
      </div>
      <label class="field"><span>Where you shop</span>
        <select name="store">${Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${k === s.store ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
      </label>
      <div class="field"><span>Diet</span>
        <div class="pills">${['any', 'pescatarian', 'vegetarian', 'vegan'].map((d) => `
          <label class="pill"><input type="radio" name="diet" value="${d}" ${d === s.diet ? 'checked' : ''} /><span>${d === 'any' ? 'Anything' : d[0].toUpperCase() + d.slice(1)}</span></label>`).join('')}
        </div>
      </div>
      <div class="field"><span>What you're into</span>
        <div class="pills">${Object.entries(TAGS).map(([k, v]) => `
          <label class="pill"><input type="checkbox" name="likes" value="${k}" ${s.likes.includes(k) ? 'checked' : ''} /><span>${v}</span></label>`).join('')}
        </div>
      </div>
      <div class="field"><span>Your kitchen</span>
        <div class="pills">${Object.entries(APPLIANCES).map(([k, v]) => `
          <label class="pill"><input type="checkbox" name="appliances" value="${k}" ${s.appliances.includes(k) ? 'checked' : ''} /><span>${v}</span></label>`).join('')}
        </div>
      </div>
      <label class="field"><span>Max cooking time</span>
        <select name="maxTime">${[20, 30, 45, 60].map((n) => `<option value="${n}" ${n === s.maxTime ? 'selected' : ''}>${n === 60 ? 'Up to an hour' : `${n} minutes`}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Never give me (comma separated)</span>
        <input type="text" name="dislikes" placeholder="e.g. cilantro, mushrooms" value="${esc(s.dislikes.join(', '))}" />
      </label>
      ${state.blocked.length ? `
        <div class="field"><span>Hidden recipes</span>
          <div class="pills">${state.blocked.map((id) => `<button type="button" class="pill-btn" data-unblock="${id}">${esc(recipeById(id)?.name || id)} ✕</button>`).join('')}</div>
        </div>` : ''}
      <div class="muted small" id="match">${count} recipes match</div>
      <button class="btn primary wide" type="submit">${first ? 'Plan my week' : 'Save & re-plan'}</button>
    </form>`;
}

function readPrefs(form) {
  const fd = new FormData(form);
  return {
    budget: Math.max(10, Number(fd.get('budget')) || DEFAULT_SETTINGS.budget),
    people: Number(fd.get('people')),
    nights: Number(fd.get('nights')),
    store: fd.get('store'),
    diet: fd.get('diet'),
    likes: fd.getAll('likes'),
    appliances: fd.getAll('appliances'),
    maxTime: Number(fd.get('maxTime')),
    dislikes: parseDislikes(fd.get('dislikes')),
  };
}

// ---------- Sheets ----------

function openSheet(html) {
  $sheet.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-panel">${html}</div>`;
  $sheet.hidden = false;
  document.body.classList.add('locked');
}

function closeSheet() {
  $sheet.hidden = true;
  $sheet.innerHTML = '';
  document.body.classList.remove('locked');
}

function showRecipe(i) {
  const s = state.settings;
  const r = planRecipes()[i];
  const scale = s.people / 2;
  const [kcal, p, c, f] = r.macros;
  openSheet(`
    <button class="close" data-close aria-label="Close">✕</button>
    <div class="sheet-emoji">${r.emoji}</div>
    <div class="muted small center">${DAYS[i % 7]}</div>
    <h2 class="center">${esc(r.name)}</h2>
    <div class="chips center">
      <span>⏱ ${fmtTime(r.time)}</span><span>🍽 ${s.people} serving${s.people > 1 ? 's' : ''}</span><span>💲${mealCost(r, s).toFixed(2)}</span>
    </div>
    <div class="macros">
      <div><b>${kcal}</b><span>kcal</span></div><div><b>${p}g</b><span>protein</span></div>
      <div><b>${c}g</b><span>carbs</span></div><div><b>${f}g</b><span>fat</span></div>
    </div>
    <div class="muted small center">per serving</div>
    <h4>Ingredients</h4>
    <ul class="ing">${r.ing.map(([k, q]) => `<li><span>${esc(INGREDIENTS[k].name)}</span><span class="muted">${formatQty(q * scale, INGREDIENTS[k].unit)}</span></li>`).join('')}</ul>
    <h4>Method</h4>
    <ol class="steps">${r.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
    <div class="row gap">
      <button class="btn ghost grow" data-swap="${i}">⇄ Swap</button>
      <button class="btn ghost grow" data-block="${i}">🚫 Never suggest</button>
    </div>`);
}

function showSwap(i) {
  const s = state.settings;
  const ids = state.plan.ids;
  const current = shoppingList(planRecipes(), s).total;
  const opts = swapOptions(s, ids, i, state.blocked);
  const r = recipeById(ids[i]);
  openSheet(`
    <button class="close" data-close aria-label="Close">✕</button>
    <h2>Swap ${esc(r.name)}</h2>
    <p class="muted small">The week's total updates with each choice.</p>
    ${opts.length ? `<div class="list card">${opts.map(({ recipe: o, total }) => {
      const d = total - current;
      return `<button class="opt" data-pick="${i}:${o.id}">
        <span class="emoji sm">${o.emoji}</span>
        <span class="item-body"><span>${esc(o.name)}</span><span class="muted small">⏱ ${fmtTime(o.time)} · ${o.macros[0]} kcal</span></span>
        <span class="delta ${d > 0.004 ? 'up' : 'down'}">${d > 0.004 ? '+' : d < -0.004 ? '−' : '±'}${money(Math.abs(d))}</span>
      </button>`;
    }).join('')}</div>` : '<p>No other recipes fit your preferences.</p>'}`);
}

// ---------- Events ----------

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-go],[data-act],[data-open],[data-swap],[data-pick],[data-block],[data-unblock],[data-close]');
  if (!t) return;
  const d = t.dataset;
  if ('close' in d) return closeSheet();
  if (d.go) return go(d.go);
  if (d.swap !== undefined) { e.stopPropagation(); return showSwap(Number(d.swap)); }
  if (d.open !== undefined) return showRecipe(Number(d.open));
  if (d.pick) {
    const [i, id] = d.pick.split(':');
    state.plan.ids[Number(i)] = id;
    save(); closeSheet(); render();
    return toast(`Swapped in ${recipeById(id).name}`);
  }
  if (d.block !== undefined) {
    const i = Number(d.block);
    const id = state.plan.ids[i];
    state.blocked.push(id);
    const opts = swapOptions(state.settings, state.plan.ids, i, state.blocked);
    if (opts.length) state.plan.ids[i] = opts[0].recipe.id;
    else state.plan.ids.splice(i, 1);
    save(); closeSheet(); render();
    return toast(`Won't suggest ${recipeById(id).name} again`);
  }
  if (d.unblock) {
    state.blocked = state.blocked.filter((x) => x !== d.unblock);
    save(); return render();
  }
  if (d.act === 'regen') {
    if (newPlan()) { render(); toast('Fresh week planned'); }
    return;
  }
  if (d.act === 'copy') {
    const { items, total } = shoppingList(planRecipes(), state.settings);
    const text = items.filter((i) => !i.pantry)
      .map((i) => `${state.checked.includes(i.key) ? '[x]' : '[ ]'} ${i.name} (${packLabel(i)}) ${money(i.cost)}`)
      .join('\n') + `\n\nEstimated total: ${money(total)}`;
    try { await navigator.clipboard.writeText(text); toast('List copied'); } catch { toast('Copy not available here'); }
  }
});

document.addEventListener('change', (e) => {
  const key = e.target.dataset?.check;
  if (key) {
    state.checked = e.target.checked ? [...state.checked, key] : state.checked.filter((k) => k !== key);
    save();
    e.target.closest('.item').classList.toggle('done', e.target.checked);
    return;
  }
  const form = e.target.closest('#prefs');
  if (form) {
    const n = candidates(readPrefs(form), state.blocked).length;
    document.getElementById('match').textContent = `${n} recipes match`;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'prefs') return;
  e.preventDefault();
  const settings = readPrefs(e.target);
  if (!settings.appliances.length) return toast('Pick at least one way to cook');
  if (!candidates(settings, state.blocked).length) return toast('No recipes match. Try loosening something.');
  state.settings = settings;
  if (newPlan()) go('week');
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
