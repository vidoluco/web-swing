// City grid. Avenues run north-south (along z, north is -z), streets east-west.
export const CITY = {
  aveSpacing: 90,
  streetSpacing: 40,
  aveRoad: 16,
  streetRoad: 10,
  nx: 8,
  nz: 36,
  sidewalk: 3,
  edge: 25, // esplanade between the last avenue and the seawall
};
CITY.halfX = (CITY.nx * CITY.aveSpacing) / 2; // 360
CITY.halfZ = (CITY.nz * CITY.streetSpacing) / 2; // 720
CITY.islandX = CITY.halfX + CITY.edge; // 385
CITY.islandZ = CITY.halfZ + CITY.edge; // 745
CITY.shoreX = 600; // where the far shores start

export const aveX = (i) => -CITY.halfX + i * CITY.aveSpacing;
export const streetZ = (j) => -CITY.halfZ + j * CITY.streetSpacing;

// Central Park covers these blocks (inclusive), Times Square sits on this crossing.
export const PARK = { i0: 2, i1: 5, j0: 0, j1: 5 };
PARK.x0 = aveX(PARK.i0);
PARK.x1 = aveX(PARK.i1 + 1);
PARK.z0 = streetZ(PARK.j0);
PARK.z1 = streetZ(PARK.j1 + 1);

export const TIMES = { i: 4, j: 14 }; // avenue line x = 0, street line z = -160
TIMES.x = aveX(TIMES.i);
TIMES.z = streetZ(TIMES.j);
TIMES.plazaW = 12; // extra setback of the buildings along the avenue
TIMES.z0 = streetZ(TIMES.j - 2) + CITY.streetRoad / 2;
TIMES.z1 = streetZ(TIMES.j + 2) - CITY.streetRoad / 2;

export const SMALL_PARK = { i: 5, j: 20 };

export const PHYS = {
  gravity: 30,
  runSpeed: 12,
  jumpSpeed: 15,
  airAccel: 9,
  maxSpeed: 68,
  radius: 0.4,
  height: 1.8,
  climbSpeed: 9,
  zipSpeed: 55,
};

// Deterministic RNG so the city is the same on every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
