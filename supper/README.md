# Supper

A weekly dinner planner that runs in the browser. Nothing to install, no account.

1. Set a weekly budget, the number of people and dinners, your area and store, your diet, allergies, cuisines, what you like, which appliances you have, a time limit, a calorie limit and any ingredients you never want. You can also cook extra portions for the next day's lunch.
2. Supper picks a week of dinners from 100 recipes, trying to stay under budget and to reuse ingredients so less goes to waste.
3. The **List** tab merges every ingredient into whole packs, sorted by aisle, with an estimated total including grocery tax. Tick items off as you shop, mark anything you already have at home to drop it from the total, or copy the list.

Tap a dinner to see the recipe with its ingredients scaled to the number of people and its calories and macros. Tap ⇄ to swap a dinner and see what that does to the total. Choose "Never suggest" to hide a recipe. Settings, the plan and ticked items are saved in the browser.

Prices are rough estimates, not live store prices. A US baseline is adjusted by area (the Chicago area is set about 5% above the national average) and then by store (Aldi cheapest, then Walmart, Meijer, Pete's, Tony's, Trader Joe's, Target, Jewel-Osco, Mariano's, with Whole Foods highest). The grocery tax rate defaults to 1% for the Chicago area and can be changed in Preferences. Allergy filters go by typical ingredients, so always check labels. Salt, pepper, oil and other basics are listed under "Check you have" and not counted in the total.

## Development

Everything is static: `index.html`, `css/`, and `js/` (`data.js` holds the ingredients and recipes, `planner.js` the planning logic, `app.js` the UI).

```sh
npm test   # Node 18+, no dependencies
```
