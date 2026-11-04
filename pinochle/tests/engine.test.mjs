// Run with: node --test pinochle/tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, legalPlays, trickWinnerIndex, cardPoints } from '../js/engine.js';
import { computeMeld } from '../js/meld.js';
import { DEFAULT_RULES } from '../js/rules.js';

function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function newTable(rules) {
  let s = createGame('TEST', 'a', 'Alex', rules);
  s = apply(s, 'b', { type: 'join', name: 'Bea' }).state;
  s = apply(s, 'c', { type: 'join', name: 'Cal' }).state;
  return s;
}
const ids = ['a', 'b', 'c'];
const ok = (r) => {
  assert.equal(r.error, undefined, r.error);
  return r.state;
};

test('deal gives 15 cards each and a 3-card kitty', () => {
  const s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(1)));
  assert.equal(s.phase, 'bidding');
  assert.deepEqual(s.hands.map((h) => h.length), [15, 15, 15]);
  assert.equal(s.kitty.length, 3);
  assert.equal(new Set([...s.hands.flat(), ...s.kitty]).size, 48);
});

test('fourth player cannot join', () => {
  const r = apply(newTable(), 'd', { type: 'join', name: 'Dee' });
  assert.match(r.error, /full/);
});

test('meld counting', () => {
  const r = DEFAULT_RULES;
  // run in spades + extra K/Q spades (royal marriage) + pinochle + 9S dix
  const hand = ['AS0', 'TS0', 'KS0', 'QS0', 'JS0', 'KS1', 'QS1', 'JD0', '9S0'];
  const m = computeMeld(hand, 'S', r);
  const names = m.items.map((i) => i.name).sort();
  assert.deepEqual(names, ['Dix', 'Pinochle', 'Royal marriage', 'Run'].sort());
  assert.equal(m.total, 15 + 4 + 4 + 1);

  const around = ['AS0', 'AH0', 'AD0', 'AC0', 'AS1', 'AH1', 'AD1', 'AC1'];
  assert.equal(computeMeld(around, 'H', r).total, 20);
  const run2 = ['AH0', 'TH0', 'KH0', 'QH0', 'JH0', 'AH1', 'TH1', 'KH1', 'QH1', 'JH1'];
  assert.equal(computeMeld(run2, 'H', r).total, 30);
  assert.equal(computeMeld(['AS0', 'AH0', 'AD0', 'AC0'], 'H', r).total, 10);
  assert.equal(computeMeld(['KS0', 'KH0', 'KD0', 'KC0'], 'D', r).total, 8);
  assert.equal(computeMeld(['JS0', 'JH0', 'JD0', 'JC0'], 'D', r).total, 4);
  assert.equal(computeMeld(['KH0', 'QH0', 'KC0', 'QC0'], 'H', r).total, 4 + 2);
  assert.equal(computeMeld(['QS0', 'QS1', 'JD0', 'JD1'], 'H', r).total, 30);
});

test('trick winner: trump beats led suit, first of equal cards wins', () => {
  assert.equal(trickWinnerIndex([{ card: 'AH0' }, { card: '9S0' }, { card: 'TH0' }], 'S'), 1);
  assert.equal(trickWinnerIndex([{ card: 'AH0' }, { card: 'AH1' }, { card: 'KD0' }], 'S'), 0);
  assert.equal(trickWinnerIndex([{ card: 'JH0' }, { card: 'AD0' }, { card: 'QH0' }], 'S'), 2);
});

test('must follow suit and head the trick; must trump when void', () => {
  const s = {
    phase: 'play',
    turn: 1,
    trump: 'S',
    rules: DEFAULT_RULES,
    trick: { cards: [{ seat: 0, card: 'KH0' }] },
    hands: [[], ['AH0', 'QH0', 'AS0', '9C0'], []],
  };
  assert.deepEqual(legalPlays(s, 1), ['AH0']);
  s.hands[1] = ['QH0', 'JH0', 'AS0'];
  assert.deepEqual(legalPlays(s, 1).sort(), ['JH0', 'QH0']);
  s.hands[1] = ['AS0', '9S0', 'AC0'];
  assert.deepEqual(legalPlays(s, 1).sort(), ['9S0', 'AS0']);
  // over-trump required
  s.trick.cards.push({ seat: 1, card: 'KS0' });
  s.turn = 2;
  s.hands[2] = ['AS1', '9S1', 'TC0'];
  assert.deepEqual(legalPlays(s, 2), ['AS1']);
});

test('bidding: two passes ends the auction', () => {
  let s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(2)));
  const first = s.bidding.turn;
  s = ok(apply(s, ids[first], { type: 'bid', amount: 25 }));
  assert.match(apply(s, ids[s.bidding.turn], { type: 'bid', amount: 25 }).error, /at least 26/);
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  assert.equal(s.phase, 'kitty');
  assert.equal(s.bidder, first);
  assert.equal(s.bid, 25);
});

test('all pass: dealer stuck at minimum', () => {
  let s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(3)));
  for (let i = 0; i < 3; i++) s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  assert.equal(s.phase, 'kitty');
  assert.equal(s.bidder, s.dealer);
  assert.equal(s.bid, 15);
});

function playFullHand(s, rng) {
  const first = s.bidding.turn;
  s = ok(apply(s, ids[first], { type: 'bid', amount: 25 }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  const b = ids[s.bidder];
  s = ok(apply(s, b, { type: 'takeKitty' }));
  assert.equal(s.hands[s.bidder].length, 18);
  s = ok(apply(s, b, { type: 'trump', suit: 'H' }));
  s = ok(apply(s, b, { type: 'bury', cards: s.hands[s.bidder].filter((c) => c[1] !== s.trump).slice(-3) }));
  s = ok(apply(s, b, { type: 'playHand' }));
  let guard = 0;
  while (s.phase === 'play' && guard++ < 100) {
    const legal = legalPlays(s, s.turn);
    assert.ok(legal.length > 0);
    s = ok(apply(s, ids[s.turn], { type: 'play', card: legal[Math.floor(rng() * legal.length)] }));
  }
  return s;
}

test('full hand plays out and card points add up to 25', () => {
  const rng = seeded(7);
  let s = ok(apply(newTable(), 'a', { type: 'start' }, rng));
  s = playFullHand(s, rng);
  assert.ok(['handOver', 'gameOver'].includes(s.phase));
  const h = s.lastHand;
  assert.equal(h.trickPts.reduce((a, b) => a + b, 0), 25);
  assert.equal(s.tricksWon.reduce((a, b) => a + b, 0), 15);
  assert.equal(cardPoints([...s.taken.flat(), ...s.buried], s.rules), 24);
});

test('game plays to a winner', () => {
  const rng = seeded(11);
  let s = ok(apply(newTable({ targetScore: 60 }), 'a', { type: 'start' }, rng));
  let hands = 0;
  while (s.phase !== 'gameOver' && hands++ < 60) {
    s = playFullHand(s, rng);
    if (s.phase === 'handOver') s = ok(apply(s, 'a', { type: 'nextHand' }, rng));
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(s.scores[s.winner] >= 60);
});

test('concede: bidder loses the bid, others keep meld', () => {
  let s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(5)));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'bid', amount: 30 }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  const b = s.bidder;
  s = ok(apply(s, ids[b], { type: 'takeKitty' }));
  s = ok(apply(s, ids[b], { type: 'trump', suit: 'S' }));
  s = ok(apply(s, ids[b], { type: 'bury', cards: s.hands[b].filter((c) => c[1] !== 'S').slice(0, 3) }));
  s = ok(apply(s, ids[b], { type: 'concede' }));
  assert.equal(s.scores[b], -30);
  for (let o = 0; o < 3; o++) if (o !== b) assert.equal(s.scores[o], s.melds[o].total);
});

test('trump cannot be led until broken, unless only trump is left', () => {
  const s = {
    phase: 'play',
    turn: 0,
    trump: 'S',
    trumpBroken: false,
    rules: DEFAULT_RULES,
    trick: { cards: [] },
    hands: [['AS0', 'KS0', '9H0', 'JC0'], [], []],
  };
  assert.deepEqual(legalPlays(s, 0).sort(), ['9H0', 'JC0']);
  s.hands[0] = ['AS0', 'KS0'];
  assert.deepEqual(legalPlays(s, 0).sort(), ['AS0', 'KS0']);
  s.hands[0] = ['AS0', '9H0'];
  s.trumpBroken = true;
  assert.deepEqual(legalPlays(s, 0).sort(), ['9H0', 'AS0']);
});

test('trumping in on an off-suit lead breaks trump', () => {
  let s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(9)));
  // Rig hands: bidder seat 0 leads hearts, seat 1 is void in hearts and trumps
  s = { ...s, phase: 'play', trump: 'S', bidder: 0, turn: 0, trick: { leader: 0, cards: [] }, trumpBroken: false,
        hands: [['AH0', 'KS0'], ['9S0', 'TC0'], ['KH0', 'QD0']] };
  s = ok(apply(s, 'a', { type: 'play', card: 'AH0' }));
  s = ok(apply(s, 'b', { type: 'play', card: '9S0' }));
  assert.equal(s.trumpBroken, true);
});

test('bidder cannot bury trump; buried points count for bidder', () => {
  let s = ok(apply(newTable(), 'a', { type: 'start' }, seeded(4)));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'bid', amount: 25 }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  s = ok(apply(s, ids[s.bidding.turn], { type: 'pass' }));
  const b = s.bidder;
  s = ok(apply(s, ids[b], { type: 'takeKitty' }));
  s = ok(apply(s, ids[b], { type: 'trump', suit: 'H' }));
  const trumps = s.hands[b].filter((c) => c[1] === 'H');
  const others = s.hands[b].filter((c) => c[1] !== 'H');
  if (trumps.length) assert.match(apply(s, ids[b], { type: 'bury', cards: [trumps[0], ...others.slice(0, 2)] }).error, /trump/);
  ok(apply(s, ids[b], { type: 'bury', cards: others.slice(0, 3) }));
});
