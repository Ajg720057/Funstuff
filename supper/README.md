# Supper

A weekly dinner planner that runs in the browser. Nothing to install, no account.

1. Set a weekly budget, the number of people and dinners, your store, your diet, what you like, which appliances you have, a time limit and any ingredients you never want.
2. Supper picks a week of dinners from 30 recipes, trying to stay under budget and to reuse ingredients so less goes to waste.
3. The **List** tab merges every ingredient into whole packs, sorted by aisle, with an estimated total. Tick items off as you shop, or copy the list.

Tap a dinner to see the recipe with its ingredients scaled to the number of people and its calories and macros. Tap ⇄ to swap a dinner and see what that does to the total. Choose "Never suggest" to hide a recipe. Settings, the plan and ticked items are saved in the browser.

Prices are rough US shelf prices with a multiplier for each store. They're a guide, not a receipt. Salt, pepper, oil and other basics are listed under "Check you have" and not counted in the total.

## Development

Everything is static: `index.html`, `css/`, and `js/` (`data.js` holds the ingredients and recipes, `planner.js` the planning logic, `app.js` the UI).

```sh
npm test   # Node 18+, no dependencies
```
