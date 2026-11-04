// Cards are strings: rank + suit + copy, e.g. "AS0", "TS1" (T = ten), "9D0".
export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['A', 'T', 'K', 'Q', 'J', '9']; // high to low
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const RANK_LABEL = { A: 'A', T: '10', K: 'K', Q: 'Q', J: 'J', 9: '9' };

export const rank = (c) => c[0];
export const suit = (c) => c[1];
export const face = (c) => c.slice(0, 2);
export const isRed = (c) => suit(c) === 'H' || suit(c) === 'D';
export const rankValue = (c) => RANKS.length - RANKS.indexOf(rank(c)); // A=6 ... 9=1
export const label = (c) => RANK_LABEL[rank(c)] + SUIT_SYMBOL[suit(c)];

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) for (const n of [0, 1]) deck.push(r + s + n);
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sort a hand by suit (trump first, colours alternating), then rank high to low.
export function sortHand(cards, trump = null) {
  let order = SUITS.slice();
  if (trump) {
    // keep alternating colours with trump first
    const idx = order.indexOf(trump);
    order = order.slice(idx).concat(order.slice(0, idx));
  }
  return cards
    .slice()
    .sort(
      (a, b) =>
        order.indexOf(suit(a)) - order.indexOf(suit(b)) ||
        RANKS.indexOf(rank(a)) - RANKS.indexOf(rank(b)) ||
        a.localeCompare(b),
    );
}
