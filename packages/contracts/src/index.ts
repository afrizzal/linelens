// Self-referencing package-specifier re-exports, NOT plain relative
// `./x.js` imports (03-02-PLAN.md deviation, Rule 3 - blocking: Turbopack
// cannot resolve a `.js`-suffixed relative import to a sibling `.ts` file
// except through a package.json `exports` subpath — the exact same class
// of failure 03-01-SUMMARY.md documents for @linelens/db/src/client.ts,
// hitting @linelens/contracts here on its first CLIENT-side import
// (apps/web/src/components/andon/tile.tsx). Each submodule below has a
// matching subpath in package.json; Node's ESM resolver (tsx, apps/worker,
// apps/simulator) and Turbopack both resolve exports-map subpaths
// correctly — it's specifically the relative .js->.ts hop that Turbopack
// can't chase.
export * from '@linelens/contracts/states';
export * from '@linelens/contracts/losses';
export * from '@linelens/contracts/reasons';
export * from '@linelens/contracts/events';
export * from '@linelens/contracts/topics';
export * from '@linelens/contracts/sim-clock';
export * from '@linelens/contracts/calendar';
export * from '@linelens/contracts/plant-config';
