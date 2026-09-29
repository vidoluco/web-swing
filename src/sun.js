// Sun and moon for the game clock, and how night it is. Pure functions, no three.js.
// Axes as in the game: x east, y up, z south. The clock is local solar time in hours: noon at 12.5, so the
// sun is up between about 6:30 and 18:30 on 29 September.
const R = Math.PI / 180;
const NOON = 12.5;
export const DEC_SEPT = -2.6;

// Direction to a body at a given clock hour. lat and dec in degrees, haShift shifts the hour angle in degrees
// (the moon trails the sun by half a day and a little more). Writes x, y, z (unit) and elev (degrees) into out.
export function celestial(hours, lat, dec, haShift, out = {}) {
  const H = ((hours - NOON) * 15 + haShift) * R;
  const phi = lat * R;
  const d = dec * R;
  const sinE = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.cos(H) * Math.sin(phi);
  out.x = east;
  out.y = sinE;
  out.z = -north;
  out.elev = Math.asin(Math.max(-1, Math.min(1, sinE))) / R;
  return out;
}

export const sunAt = (hours, lat, out) => celestial(hours, lat, DEC_SEPT, 0, out);
export const moonAt = (hours, lat, out) => celestial(hours, lat, 14, 180 + 25, out);

export const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 0 by day, 1 at night: lamps and windows come on as the sun goes under the horizon.
export const nightAmount = (sunElevDeg) => smooth(4, -6, sunElevDeg);

// Wraps a clock value into [0, 24).
export const wrapHours = (h) => ((h % 24) + 24) % 24;

// "17.5", "17:30" or "17" to hours, or null when it does not parse.
export function parseHours(s) {
  if (s === null || s === undefined || s === '') return null;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (m) return wrapHours(+m[1] + (m[2] ? +m[2] / 60 : 0));
  const f = parseFloat(s);
  return Number.isFinite(f) ? wrapHours(f) : null;
}
