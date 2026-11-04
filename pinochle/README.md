# Pinochle (three-handed)

A web app for three friends to play three-handed pinochle, each on their own
phone. It runs in the phone's browser and can be added to the home screen so
it opens like a normal app (Samsung Internet or Chrome on Android, and iPhone too).

## How a game goes

1. One person taps **Start a new table** and gets a 4-letter code.
2. They tap the code chip or **Share invite link** to send it; the others tap the link (or type the code) and **Join**.
3. When all three are seated, anyone taps **Deal the first hand**.
4. **Bidding** starts left of the dealer. Once you pass you're out. If everyone passes, the dealer takes it at the minimum.
5. The high bidder sees the **kitty** (everyone sees it), picks it up, chooses **trump** (the app shows the meld each suit would give), then **buries 3 cards**.
6. Everyone's **meld** is counted automatically and shown to all. The bidder plays it out or throws it in.
7. **Tricks**: you can only tap legal cards (follow suit, beat the winning card if you can, trump if you're void). Tap a greyed-out card to see why it's not allowed.
8. The **hand summary** shows meld, trick points and the score change. Play continues to the target score.

**Test mode** on the home screen lets one person play all three seats on one
device, with no setup needed. Use it to try the app and check the rules.

## House rules

All rules and point values are in [`js/rules.js`](js/rules.js): minimum bid,
bid steps, card points, meld values, set penalty, target score and so on.
Each new table saves a copy of the rules, so a game already in progress keeps
the rules it started with.

The game logic is in [`js/engine.js`](js/engine.js) (bidding, trick play,
scoring) and [`js/meld.js`](js/meld.js) (meld counting). Tests:

```
node --test pinochle/tests/*.test.mjs
```

## Online setup (one time, about 10 minutes, free)

The three phones keep the game in sync through a free Firebase Realtime Database.

1. Go to <https://console.firebase.google.com>, **Add project** (any name, Analytics can be off).
2. **Build → Realtime Database → Create database**. Pick a location, start in **locked mode**.
3. On the database's **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json) and **Publish**.
4. **Project settings (gear) → General → Your apps → Web (`</>`)**: register an app (no hosting needed). Copy the `firebaseConfig` object it shows.
5. Paste it into [`js/firebase-config.js`](js/firebase-config.js), replacing `null`. Make sure it includes `databaseURL`.

Firebase web config values are not secret; they only identify your project.
The database rules let anyone who knows a table code read and write that table,
which is fine for a private game among friends.

## Putting it on your phones

The app needs to be served over HTTPS. This repo publishes itself to GitHub
Pages from the `main` branch (`.github/workflows/pages.yml`), so the app is at
<https://ajg720057.github.io/Funstuff/pinochle/>.

On each Samsung phone: open that link in Samsung Internet or Chrome, then use
the menu → **Add page to → Home screen** (Samsung Internet) or **Install app /
Add to Home screen** (Chrome).

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page and styling |
| `js/app.js` | Screens and taps |
| `js/engine.js` | Game rules and scoring |
| `js/meld.js` | Meld counting |
| `js/rules.js` | **House rules / point values** |
| `js/cards.js` | Deck, shuffling, sorting |
| `js/net.js` | Syncing between phones (Firebase) and Test mode storage |
| `js/firebase-config.js` | Your Firebase project settings |
| `manifest.webmanifest`, `sw.js`, `icons/` | Home-screen install support |
