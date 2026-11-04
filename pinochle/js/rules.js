// ---------------------------------------------------------------------------
// House rules. Everything about scoring and bidding lives here so it can be
// changed in one place. A copy of these settings is saved into each game when
// it is created, so all three phones always play by the same rules.
// ---------------------------------------------------------------------------

export const DEFAULT_RULES = {
  // First player to reach this total at the end of a hand wins.
  // If two or more pass it on the same hand, the highest total wins.
  targetScore: 100,

  // Bidding
  minBid: 15,
  bidIncrement: 1,
  // What happens if all three players pass:
  //   'dealerStuck' - the dealer is forced to take it at the minimum bid
  //   'redeal'      - throw the hand in and the next player deals
  allPassAction: 'dealerStuck',

  // Points for each card taken in tricks (9-A deck, two of each card).
  // A, 10 and K are 1 point each, plus 1 for the last trick: 25 per hand.
  cardPoints: { A: 1, T: 1, K: 1, Q: 0, J: 0, 9: 0 },
  lastTrickBonus: 1,

  // Meld values (house scoring)
  meld: {
    run: 15, // A-10-K-Q-J of trump
    doubleRun: 30, // doubles count as two of the single meld
    royalMarriage: 4, // K-Q of trump (only counted if not used in a run)
    marriage: 2, // K-Q of any other suit
    dix: 1, // 9 of trump, each
    pinochle: 4, // Q of spades + J of diamonds
    doublePinochle: 30, // both Q of spades + both J of diamonds
    acesAround: 10,
    doubleAces: 20,
    kingsAround: 8,
    doubleKings: 16,
    queensAround: 6,
    doubleQueens: 12,
    jacksAround: 4,
    doubleJacks: 8,
  },

  // The bidder may not bury trump; the 3 buried cards go in their trick pile.
  buryTrumpAllowed: false,

  // Trick play
  // Trump can't be led until it has been "broken": someone played trump
  // because they couldn't follow suit. A player holding nothing but trump
  // may always lead it.
  trumpMustBeBroken: true,
  mustHead: true, // must beat the winning card when following suit, if able
  mustTrump: true, // if void in the led suit, must play trump if able
  mustOvertrump: true, // when trumping, must beat a trump already played, if able

  // Scoring
  meldRequiresTrick: true, // a player's meld only counts if they win a trick
  buriedPointsToBidder: true, // points in the 3 buried cards count for bidder
  bidderMadeScores: 'total', // 'total' = meld + tricks, 'bid' = just the bid
  setPenalty: 'bid', // bidder who goes set loses this: 'bid' or 'doubleBid'

  // Throwing in the hand after seeing the kitty and meld
  allowConcede: true,
  concedeOpponentsGetMeld: true,
};

export function mergeRules(overrides = {}) {
  return {
    ...DEFAULT_RULES,
    ...overrides,
    cardPoints: { ...DEFAULT_RULES.cardPoints, ...(overrides.cardPoints || {}) },
    meld: { ...DEFAULT_RULES.meld, ...(overrides.meld || {}) },
  };
}
