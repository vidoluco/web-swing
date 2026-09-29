// The checkpoint races of each city (src/challenges.js). Game metres, x east, z south. A race is a
// list of gates in order, the first is the start. The gates lie every 100 to 550 m between two real
// places, on open ground beside a street or footway: the straight line between the two places
// (cities.js spots, docs/brasov-landmarks.md) cut into equal legs, each gate moved to the nearest
// free point next to a street with tools/city-data.mjs. The Poiana race follows the real road
// (the shortest route over the road pieces of the built city).
//
// pace: the average speed in metres per second that earns gold, silver and bronze. The times are
// worked out from the length of the gates' path: gold = length / pace + 6 s, silver + 8 s, bronze + 10 s.
// Flat Bucharest boulevards take a good swinger about 22 m/s (a plain autopilot that swings toward the next gate manages 22 on the Unirii boulevard and 14 in the streets of Calea Victoriei), the old town of Brasov is tighter and
// the two climbs go on foot and by wall.

const p = (x, z) => ({ x, z });

export const RACES = {
  bucharest: [
    {
      id: 'bd-unirii',
      title: 'Bulevardul Unirii',
      from: 'Piața Unirii',
      to: 'Palatul Parlamentului',
      pace: [22, 16, 11],
      points: [p(24.2, -14), p(-336.7, -8.3), p(-673.3, -16.7), p(-1010, -25)],
    },
    {
      id: 'calea-victoriei',
      title: 'Calea Victoriei',
      from: 'Ateneul Român',
      to: 'Piața Victoriei',
      pace: [22, 16, 11],
      points: [p(-440, -1606), p(-612.2, -1851.4), p(-806.1, -2095.8), p(-994.6, -2338.7), p(-1185.3, -2589.6), p(-1381, -2833)],
    },
    {
      id: 'kiseleff',
      title: 'Șoseaua Kiseleff',
      from: 'Piața Victoriei',
      to: 'Arcul de Triumf',
      pace: [22, 16, 11],
      points: [p(-1381, -2833), p(-1483.7, -3164.6), p(-1603.8, -3486.2), p(-1715.2, -3812.8), p(-1826.6, -4139.4), p(-1938, -4466)],
    },
    {
      id: 'herastrau',
      title: 'Giro di Herăstrău',
      from: 'Arcul de Triumf',
      to: 'Sky Tower',
      pace: [22, 16, 11],
      points: [p(-1938, -4466), p(-1640.7, -4697.9), p(-1345.3, -4933.3), p(-1049, -5167), p(-742.5, -5289.7), p(-400, -5474.9), p(-129.5, -5535.2), p(157.7, -5652.8)],
    },
    {
      id: 'gara-ateneu',
      title: 'Dalla stazione',
      from: 'Gara de Nord',
      to: 'Ateneul Român',
      pace: [22, 16, 11],
      points: [p(-2164, -2128), p(-1872.8, -2042.4), p(-1582.7, -1956.7), p(-1292, -1869), p(-1019.3, -1750.2), p(-710.7, -1709.7), p(-440, -1606)],
    },
  ],

  brasov: [
    {
      id: 'centrul-vechi',
      title: 'Centrul Vechi',
      from: 'Piața Sfatului',
      to: 'Bastionul Țesătorilor',
      pace: [16, 12, 8],
      // Biserica Neagră, Poarta Șchei, Strada Sforii.
      points: [p(30.9, 60.1), p(-46.4, 171.4), p(-117.9, 288), p(-175.1, 388.2), p(-19.5, 338.1), p(8.6, 497.8), p(9.8, 623.3)],
    },
    {
      id: 'zidurile',
      title: 'Zidurile',
      from: 'Turnul Alb',
      to: 'Bastionul Țesătorilor',
      pace: [16, 12, 8],
      points: [p(-168.7, -13.9), p(-160.3, 98.6), p(-96.8, 243.6), p(-74.3, 360.1), p(-10.3, 517.3), p(9.8, 623.3)],
    },
    {
      id: 'spre-gara',
      title: 'Spre gară',
      from: 'Piața Sfatului',
      to: 'Gara Brașov',
      pace: [24, 17, 12],
      // Through Parcul Central.
      points: [p(30.9, 60.1), p(253.1, -374.9), p(497.8, -617.6), p(734, -867.9), p(977.6, -1078.8), p(1212.4, -1338.5), p(1459.5, -1574.3), p(1686.9, -1790.2), p(1939.5, -2055.9)],
    },
    {
      id: 'telecabina',
      title: 'Telecabina',
      from: 'Telecabina Tâmpa, giù',
      to: 'Telecabina Tâmpa, su',
      pace: [9, 6, 4],
      points: [p(345.1, 421.1), p(454.9, 498.1), p(487.8, 626.6), p(568, 692.3), p(648, 792.1)],
    },
    {
      id: 'tampa',
      title: 'Vârful Tâmpa',
      from: 'Bastionul Țesătorilor',
      to: 'Vârful Tâmpa',
      pace: [7, 5, 3.5],
      points: [p(9.8, 623.3), p(96.8, 716.3), p(203.4, 821.6), p(215.4, 832.3), p(327.7, 943.3)],
    },
    {
      id: 'poiana',
      title: 'Da Poiana al centro',
      from: 'Poiana Brașov',
      to: 'Piața Sfatului',
      pace: [30, 22, 15],
      // The road down, gate by gate: 438 m of drop in 7 km.
      points: [p(-2491.2, 5084.7), p(-2516.1, 4592.2), p(-2633, 4052.1), p(-2564.3, 3578.1), p(-2608.6, 3188.1), p(-2639, 2960), p(-2450, 2544.6), p(-2030, 2202.2), p(-1687.8, 1776), p(-1329.8, 1393.1), p(-922.2, 1052.7), p(-560.6, 595.5), p(-271.6, 285.9), p(-13.6, 38.5)],
    },
  ],
};

// Length of the path through the gates.
export function raceLength(race) {
  let L = 0;
  for (let i = 1; i < race.points.length; i++) L += Math.hypot(race.points[i].x - race.points[i - 1].x, race.points[i].z - race.points[i - 1].z);
  return L;
}

// { gold, silver, bronze } in seconds.
export function raceTimes(race) {
  const L = raceLength(race);
  const [g, s, b] = race.pace;
  return { gold: Math.round(L / g + 6), silver: Math.round(L / s + 8), bronze: Math.round(L / b + 10) };
}

export const MEDAL_RESPECT = { bronze: 20, silver: 40, gold: 70 };
const TIERS = ['bronze', 'silver', 'gold'];

// The medal for a time, or null when slower than bronze.
export function medalFor(race, seconds) {
  const t = raceTimes(race);
  return seconds <= t.gold ? 'gold' : seconds <= t.silver ? 'silver' : seconds <= t.bronze ? 'bronze' : null;
}

// Respect for a medal, only for what it adds over the best one already won: [respect owed].
export function respectFor(medal, previous) {
  if (!medal) return 0;
  const had = previous ? MEDAL_RESPECT[previous] : 0;
  return Math.max(0, MEDAL_RESPECT[medal] - had);
}

export const betterMedal = (a, b) => TIERS.indexOf(a) > TIERS.indexOf(b);
