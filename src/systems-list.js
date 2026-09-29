// The gameplay systems, in update order. One line per system, so two merges conflict on one line at most:
//   () => import('./crimes.js'),
// Each module exports `create(game)` returning { name, init?(), update(dt), onCityChange?(id), dispose?() }.
export default [
  () => import('./combat.js'),
  () => import('./bars.js'), // bars: music from the supreme bars
  () => import('./crimes.js'), // crimes:
  () => import('./police.js'), // police:
];
