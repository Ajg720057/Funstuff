import { SUITS, face, SUIT_NAME } from './cards.js';

// Count meld in a hand for the given trump suit.
// Returns { total, items: [{ name, points, cards: ['AS', 'TS', ...] }] }
export function computeMeld(hand, trump, rules) {
  const m = rules.meld;
  const count = {};
  for (const c of hand) count[face(c)] = (count[face(c)] || 0) + 1;
  const n = (f) => count[f] || 0;
  const items = [];
  const add = (name, points, cards) => items.push({ name, points, cards });

  if (trump) {
    // Runs
    const runCards = ['A', 'T', 'K', 'Q', 'J'].map((r) => r + trump);
    const runs = Math.min(...runCards.map(n));
    if (runs === 2) add('Double run', m.doubleRun, [...runCards, ...runCards]);
    else if (runs === 1) add('Run', m.run, runCards);

    // Royal marriages not already part of a run
    const royal = Math.min(n('K' + trump), n('Q' + trump)) - runs;
    for (let i = 0; i < royal; i++) add('Royal marriage', m.royalMarriage, ['K' + trump, 'Q' + trump]);

    // Dix
    for (let i = 0; i < n('9' + trump); i++) add('Dix', m.dix, ['9' + trump]);
  }

  // Plain marriages
  for (const s of SUITS) {
    if (s === trump) continue;
    const k = Math.min(n('K' + s), n('Q' + s));
    for (let i = 0; i < k; i++) add(`Marriage (${SUIT_NAME[s]})`, m.marriage, ['K' + s, 'Q' + s]);
  }

  // Arounds
  const arounds = [
    ['A', 'Aces', m.acesAround, m.doubleAces],
    ['K', 'Kings', m.kingsAround, m.doubleKings],
    ['Q', 'Queens', m.queensAround, m.doubleQueens],
    ['J', 'Jacks', m.jacksAround, m.doubleJacks],
  ];
  for (const [r, name, single, dbl] of arounds) {
    const k = Math.min(...SUITS.map((s) => n(r + s)));
    const cards = SUITS.map((s) => r + s);
    if (k === 2) add(`Double ${name.toLowerCase()}`, dbl, [...cards, ...cards]);
    else if (k === 1) add(`${name} around`, single, cards);
  }

  // Pinochle
  const p = Math.min(n('QS'), n('JD'));
  if (p === 2) add('Double pinochle', m.doublePinochle, ['QS', 'JD', 'QS', 'JD']);
  else if (p === 1) add('Pinochle', m.pinochle, ['QS', 'JD']);

  return { total: items.reduce((t, i) => t + i.points, 0), items };
}
