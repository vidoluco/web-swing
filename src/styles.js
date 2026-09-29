// The three looks. Numbers only: env.js applies them to the lights, the grade shader, the bloom, the
// ambient occlusion, the shadows and the water. ?style=a|b|c, the key B and the pause menu switch them.
//   idx        shader style: 0 realistic, 1 Pixar, 2 cartoon
//   sunK       strength of the direct sun; envK image based light; hemiK fill light; exposure before tone mapping
//   haze       aerial perspective density; hazeSun how much the haze glows toward the sun
//   bloom      null for none; threshold in linear units, above what glows
//   ao         [intensity, radius] of the ambient occlusion pass
//   shadow     softness of the shadow edge (PCF radius)
//   deep, shallow  water colours (sRGB); water: 0 realistic, 1 stylised, 2 cartoon; waterEnv how much sky it mirrors
//   lamp       strength of the warm pools under the street lamps at night
//   glare      veil of light around the sun when it is in view
export const STYLES = {
  a: {
    id: 'a', label: 'Realistico', idx: 0,
    sunK: 1.0, envK: 1.0, hemiK: 1.0, exposure: 1.0, sat: 1.06, contrast: 1.06,
    lift: [0.0, 0.002, 0.008], gain: [1.03, 1.0, 0.965], vig: 0.34, dither: 0.03,
    haze: 1.0, hazeSun: 0.5, bloom: { intensity: 0.4, threshold: 2.4, radius: 0.72 }, ao: [2.2, 2.5], shadow: 1.8,
    aces: 0.5, water: 0, waterEnv: 1, waterGlow: 0.35, deep: '#173f47', shallow: '#4a8c8a', rim: 0, bands: 4, lamp: 2.4, glare: 0.22,
  },
  b: {
    id: 'b', label: 'Pixar', idx: 1,
    sunK: 0.95, envK: 1.4, hemiK: 1.5, exposure: 1.06, sat: 1.4, contrast: 1.04,
    lift: [0.03, 0.016, 0.055], gain: [1.08, 1.0, 0.92], vig: 0.28, dither: 0.025,
    haze: 0.55, hazeSun: 0.9, bloom: { intensity: 0.62, threshold: 1.5, radius: 0.85 }, ao: [2.6, 4.0], shadow: 2.8,
    aces: 0.2, water: 1, waterEnv: 0.35, waterGlow: 0.1, deep: '#0f4c63', shallow: '#3fb3b0', rim: 1, bands: 4, lamp: 3.2, glare: 0.3,
  },
  c: {
    id: 'c', label: 'Cartoon', idx: 2,
    sunK: 1.0, envK: 1.6, hemiK: 1.4, exposure: 1.05, sat: 1.28, contrast: 1.0,
    lift: [0.02, 0.015, 0.04], gain: [1.04, 1.0, 0.96], vig: 0.14, dither: 0.0,
    haze: 0.3, hazeSun: 0.3, bloom: null, ao: [1.8, 1.6], shadow: 0.6,
    aces: 0, water: 2, waterEnv: 0.14, waterGlow: 0.35, deep: '#2aa6d2', shallow: '#5fdce6', rim: 0, bands: 4, lamp: 2.2, glare: 0,
  },
};
export const STYLE_IDS = ['a', 'b', 'c'];
