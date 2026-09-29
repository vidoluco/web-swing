// The gameplay systems, in update order. One line per system, so two merges conflict on one line at most:
//   () => import('./crimes.js'),
// Each module exports `create(game)` returning { name, init?(), update(dt), onCityChange?(id), dispose?() }.
export default [
  () => import('./pedestrians.js'), // living:
  () => import('./trams.js'), // living:
];
