// Pure game logic. No DOM, no network. Every change to a game goes through
// apply(state, playerId, action), which returns { state } or { error }.
import { newDeck, shuffle, sortHand, rank, suit, rankValue, label, SUIT_NAME } from './cards.js';
import { computeMeld } from './meld.js';
import { mergeRules } from './rules.js';

export const NUM_PLAYERS = 3;
export const HAND_SIZE = 15;
const next = (seat) => (seat + 1) % NUM_PLAYERS;

export function createGame(code, playerId, name, ruleOverrides = {}) {
  return {
    v: 1,
    code,
    rules: mergeRules(ruleOverrides),
    players: [{ id: playerId, name: cleanName(name) }],
    phase: 'lobby',
    scores: [0, 0, 0],
    handNo: 0,
    dealer: -1,
    history: [],
    log: [],
  };
}

function cleanName(name) {
  return String(name || 'Player').trim().slice(0, 16) || 'Player';
}

export function seatOf(state, playerId) {
  return state.players.findIndex((p) => p.id === playerId);
}

export const nameOf = (state, seat) => state.players[seat]?.name ?? `Seat ${seat + 1}`;

function log(state, msg) {
  state.log.push(msg);
  if (state.log.length > 30) state.log = state.log.slice(-30);
}

// ---------------------------------------------------------------------------
// Rules helpers used by both the engine and the UI
// ---------------------------------------------------------------------------

export function minNextBid(state) {
  const b = state.bidding;
  return b.high == null ? state.rules.minBid : b.high + state.rules.bidIncrement;
}

// Index of the card currently winning a trick (array of { seat, card }).
export function trickWinnerIndex(cards, trump) {
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    if (beats(cards[i].card, cards[best].card, suit(cards[0].card), trump)) best = i;
  }
  return best;
}

// Does card a beat card b? Equal cards: the first one played wins.
function beats(a, b, led, trump) {
  const at = suit(a) === trump;
  const bt = suit(b) === trump;
  if (at !== bt) return at;
  if (suit(a) !== suit(b)) return false; // a is off-suit, cannot win
  return rankValue(a) > rankValue(b);
}

export function legalPlays(state, seat) {
  if (state.phase !== 'play' || state.turn !== seat) return [];
  const hand = state.hands[seat];
  const trick = state.trick.cards;
  const r = state.rules;
  const trump = state.trump;
  if (trick.length === 0) {
    if (r.trumpMustBeBroken && !state.trumpBroken) {
      const nonTrump = hand.filter((c) => suit(c) !== trump);
      if (nonTrump.length) return nonTrump;
    }
    return hand.slice();
  }
  const led = suit(trick[0].card);
  const winning = trick[trickWinnerIndex(trick, trump)].card;
  const wouldWin = (c) => beats(c, winning, led, trump);

  const follow = hand.filter((c) => suit(c) === led);
  if (follow.length) {
    if (!r.mustHead) return follow;
    const higher = follow.filter(wouldWin);
    return higher.length ? higher : follow;
  }
  const trumps = hand.filter((c) => suit(c) === trump);
  if (trumps.length && r.mustTrump) {
    if (!r.mustOvertrump) return trumps;
    const higher = trumps.filter(wouldWin);
    return higher.length ? higher : trumps;
  }
  return hand.slice();
}

export function cardPoints(cards, rules) {
  return cards.reduce((t, c) => t + (rules.cardPoints[rank(c)] || 0), 0);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function apply(prev, playerId, action, rng = Math.random) {
  const state = structuredClone(prev);
  const seat = seatOf(state, playerId);
  const err = (error) => ({ error });
  const t = action.type;

  if (t === 'join') {
    if (seat >= 0) {
      if (action.name) state.players[seat].name = cleanName(action.name);
      return { state };
    }
    if (state.phase !== 'lobby') return err('This game has already started.');
    if (state.players.length >= NUM_PLAYERS) return err('This table is full.');
    state.players.push({ id: playerId, name: cleanName(action.name) });
    log(state, `${cleanName(action.name)} joined.`);
    return { state };
  }

  if (seat < 0) return err('You are not seated at this table.');
  const me = nameOf(state, seat);

  switch (t) {
    case 'start': {
      if (state.phase !== 'lobby') return err('Game already started.');
      if (state.players.length !== NUM_PLAYERS) return err('Need 3 players to start.');
      state.dealer = Math.floor(rng() * NUM_PLAYERS);
      deal(state, rng);
      return { state };
    }

    case 'bid':
    case 'pass': {
      if (state.phase !== 'bidding') return err('Not bidding right now.');
      const b = state.bidding;
      if (b.turn !== seat) return err('Not your turn to bid.');
      if (t === 'bid') {
        const amt = Number(action.amount);
        if (!Number.isFinite(amt) || amt < minNextBid(state)) return err(`Bid must be at least ${minNextBid(state)}.`);
        if ((amt - state.rules.minBid) % state.rules.bidIncrement !== 0)
          return err(`Bids go up in steps of ${state.rules.bidIncrement}.`);
        b.high = amt;
        b.highBidder = seat;
        b.history.push({ seat, bid: amt });
        log(state, `${me} bid ${amt}.`);
      } else {
        b.passed[seat] = true;
        b.history.push({ seat, bid: null });
        log(state, `${me} passed.`);
      }
      const active = [0, 1, 2].filter((s) => !b.passed[s]);
      if (active.length === 0) {
        if (state.rules.allPassAction === 'redeal') {
          log(state, 'Everyone passed. Redealing.');
          state.dealer = next(state.dealer);
          deal(state, rng);
        } else {
          log(state, `Everyone passed. ${nameOf(state, state.dealer)} (dealer) takes it at ${state.rules.minBid}.`);
          winBid(state, state.dealer, state.rules.minBid);
        }
        return { state };
      }
      if (active.length === 1 && b.highBidder === active[0]) {
        winBid(state, active[0], b.high);
        return { state };
      }
      let n = next(seat);
      while (b.passed[n]) n = next(n);
      b.turn = n;
      return { state };
    }

    case 'takeKitty': {
      if (state.phase !== 'kitty') return err('No kitty to take.');
      if (seat !== state.bidder) return err('Only the bidder takes the kitty.');
      state.hands[seat] = sortHand(state.hands[seat].concat(state.kitty));
      state.phase = 'trump';
      log(state, `${me} picked up the kitty.`);
      return { state };
    }

    case 'trump': {
      if (state.phase !== 'trump') return err('Not choosing trump now.');
      if (seat !== state.bidder) return err('Only the bidder chooses trump.');
      if (!['S', 'H', 'D', 'C'].includes(action.suit)) return err('Pick a suit.');
      state.trump = action.suit;
      for (let s = 0; s < NUM_PLAYERS; s++) state.hands[s] = sortHand(state.hands[s], state.trump);
      state.phase = 'bury';
      log(state, `${me} named ${SUIT_NAME[state.trump]} as trump.`);
      return { state };
    }

    case 'bury': {
      if (state.phase !== 'bury') return err('Not burying now.');
      if (seat !== state.bidder) return err('Only the bidder buries.');
      const cards = action.cards || [];
      const hand = state.hands[seat];
      if (cards.length !== 3 || new Set(cards).size !== 3 || !cards.every((c) => hand.includes(c)))
        return err('Pick exactly 3 cards from your hand to bury.');
      if (!state.rules.buryTrumpAllowed && cards.some((c) => suit(c) === state.trump))
        return err("You can't bury trump.");
      state.hands[seat] = hand.filter((c) => !cards.includes(c));
      state.buried = cards;
      state.melds = state.hands.map((h) => computeMeld(h, state.trump, state.rules));
      state.phase = 'meld';
      log(state, `${me} buried 3 cards.`);
      return { state };
    }

    case 'playHand': {
      if (state.phase !== 'meld') return err('Not in meld.');
      if (seat !== state.bidder) return err('Only the bidder decides.');
      state.phase = 'play';
      state.turn = state.bidder;
      state.trick = { leader: state.bidder, cards: [] };
      log(state, `${me} will play it out.`);
      return { state };
    }

    case 'concede': {
      if (state.phase !== 'meld') return err('Not in meld.');
      if (seat !== state.bidder) return err('Only the bidder can throw in.');
      if (!state.rules.allowConcede) return err('Throwing in is not allowed.');
      const delta = [0, 0, 0];
      delta[seat] = -penalty(state);
      if (state.rules.concedeOpponentsGetMeld)
        for (let s = 0; s < NUM_PLAYERS; s++) if (s !== seat) delta[s] = state.melds[s].total;
      log(state, `${me} threw in the hand.`);
      finishHand(state, delta, { conceded: true, made: false });
      return { state };
    }

    case 'play': {
      if (state.phase !== 'play') return err('Not playing tricks now.');
      if (state.turn !== seat) return err('Not your turn.');
      const card = action.card;
      if (!state.hands[seat].includes(card)) return err('That card is not in your hand.');
      if (!legalPlays(state, seat).includes(card)) return err(illegalReason(state, seat));
      state.hands[seat] = state.hands[seat].filter((c) => c !== card);
      state.trick.cards.push({ seat, card });
      if (suit(card) === state.trump && !state.trumpBroken) {
        state.trumpBroken = true;
        if (state.trick.cards.length > 1) log(state, `${me} broke trump.`);
      }
      if (state.trick.cards.length < NUM_PLAYERS) {
        state.turn = next(seat);
        return { state };
      }
      // Trick complete
      const cards = state.trick.cards;
      const winner = cards[trickWinnerIndex(cards, state.trump)].seat;
      state.taken[winner].push(...cards.map((x) => x.card));
      state.tricksWon[winner]++;
      state.trickNo++;
      state.lastTrick = { cards, winner, trickNo: state.trickNo };
      state.trick = { leader: winner, cards: [] };
      state.turn = winner;
      if (state.hands.every((h) => h.length === 0)) {
        state.lastTrickWinner = winner;
        scoreHand(state);
      }
      return { state };
    }

    case 'nextHand': {
      if (state.phase !== 'handOver') return err('Hand is not over.');
      state.dealer = next(state.dealer);
      deal(state, rng);
      return { state };
    }

    case 'newGame': {
      if (state.phase !== 'gameOver') return err('Game is not over.');
      state.scores = [0, 0, 0];
      state.history = [];
      state.handNo = 0;
      state.dealer = Math.floor(rng() * NUM_PLAYERS);
      state.winner = null;
      log(state, 'New game started.');
      deal(state, rng);
      return { state };
    }

    default:
      return err(`Unknown action ${t}`);
  }
}

function illegalReason(state, seat) {
  if (state.trick.cards.length === 0) return `You can't lead trump until it has been broken.`;
  const led = suit(state.trick.cards[0].card);
  const hand = state.hands[seat];
  if (hand.some((c) => suit(c) === led)) {
    return state.rules.mustHead ? `You must follow ${SUIT_NAME[led]}, and beat the winning card if you can.` : `You must follow ${SUIT_NAME[led]}.`;
  }
  return state.rules.mustOvertrump ? 'You must play trump, and beat any trump already played if you can.' : 'You must play trump.';
}

function deal(state, rng) {
  const deck = shuffle(newDeck(), rng);
  state.handNo++;
  state.hands = [0, 1, 2].map((i) => sortHand(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)));
  state.kitty = deck.slice(HAND_SIZE * NUM_PLAYERS);
  state.phase = 'bidding';
  state.bidding = { turn: next(state.dealer), high: null, highBidder: null, passed: [false, false, false], history: [] };
  state.bidder = null;
  state.bid = null;
  state.trump = null;
  state.buried = [];
  state.melds = null;
  state.trick = null;
  state.lastTrick = null;
  state.taken = [[], [], []];
  state.tricksWon = [0, 0, 0];
  state.trickNo = 0;
  state.trumpBroken = false;
  state.lastHand = null;
  log(state, `Hand ${state.handNo}: ${nameOf(state, state.dealer)} deals.`);
}

function winBid(state, seat, amount) {
  state.bidder = seat;
  state.bid = amount;
  state.phase = 'kitty';
  log(state, `${nameOf(state, seat)} wins the bid at ${amount}.`);
}

function penalty(state) {
  return state.rules.setPenalty === 'doubleBid' ? state.bid * 2 : state.bid;
}

function scoreHand(state) {
  const r = state.rules;
  const trickPts = [0, 1, 2].map((s) => cardPoints(state.taken[s], r));
  trickPts[state.lastTrickWinner] += r.lastTrickBonus;
  if (r.buriedPointsToBidder) trickPts[state.bidder] += cardPoints(state.buried, r);
  const meldPts = [0, 1, 2].map((s) => (r.meldRequiresTrick && state.tricksWon[s] === 0 ? 0 : state.melds[s].total));
  const totals = [0, 1, 2].map((s) => meldPts[s] + trickPts[s]);
  const b = state.bidder;
  const made = totals[b] >= state.bid;
  const delta = totals.slice();
  delta[b] = made ? (r.bidderMadeScores === 'bid' ? state.bid : totals[b]) : -penalty(state);
  log(state, made ? `${nameOf(state, b)} made the bid with ${totals[b]}.` : `${nameOf(state, b)} went set (${totals[b]} of ${state.bid}).`);
  finishHand(state, delta, { made, trickPts, meldPts, totals });
}

function finishHand(state, delta, detail) {
  for (let s = 0; s < NUM_PLAYERS; s++) state.scores[s] += delta[s];
  const entry = {
    handNo: state.handNo,
    dealer: state.dealer,
    bidder: state.bidder,
    bid: state.bid,
    trump: state.trump,
    meld: state.melds.map((m) => m.total),
    delta,
    scores: state.scores.slice(),
    ...detail,
  };
  state.history.push(entry);
  state.lastHand = entry;
  state.phase = 'handOver';
  const target = state.rules.targetScore;
  const best = Math.max(...state.scores);
  const leaders = [0, 1, 2].filter((s) => state.scores[s] === best);
  if (best >= target && leaders.length === 1) {
    state.phase = 'gameOver';
    state.winner = leaders[0];
    log(state, `${nameOf(state, leaders[0])} wins the game with ${best}!`);
  }
}

export function describeCard(c) {
  return label(c);
}
