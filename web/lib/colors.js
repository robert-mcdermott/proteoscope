export const CHAIN_PALETTES = {
  vivid: {
    label: 'Vivid',
    colors: [
      [0.26, 0.78, 0.95],
      [0.98, 0.29, 0.55],
      [1.0, 0.77, 0.27],
      [0.35, 0.91, 0.61],
      [0.72, 0.55, 1.0],
      [1.0, 0.54, 0.33],
      [0.63, 0.95, 0.4],
      [0.39, 0.61, 1.0],
      [0.98, 0.47, 0.92],
      [0.79, 0.9, 1.0],
    ],
  },
  colorblind: {
    label: 'Colorblind safe (Okabe-Ito)',
    colors: hexColors(['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999']),
  },
  muted: {
    label: 'Muted (Tol)',
    colors: hexColors(['#88CCEE', '#CC6677', '#DDCC77', '#117733', '#332288', '#AA4499', '#44AA99', '#999933', '#882255']),
  },
  pastel: {
    label: 'Pastel',
    colors: hexColors(['#8ECAE6', '#FFB4A2', '#B5E48C', '#CDB4DB', '#FFD166', '#90DBF4', '#F4ACB7', '#A0C4FF', '#CAFFBF']),
  },
};

export const COLORMAPS = {
  bwr: { label: 'Blue-white-red', stops: [[0.1, 0.42, 1.0], [0.92, 0.96, 1.0], [1.0, 0.25, 0.18]] },
  viridis: {
    label: 'Viridis',
    stops: hexColors(['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725']),
  },
  magma: {
    label: 'Magma',
    stops: hexColors(['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf']),
  },
  rainbow: {
    label: 'Rainbow',
    stops: [[0.24, 0.35, 1.0], [0.2, 0.75, 1.0], [0.25, 0.9, 0.45], [1.0, 0.9, 0.25], [1.0, 0.55, 0.15], [0.95, 0.22, 0.2]],
  },
  hydrophobicity: { label: 'Hydrophilic → hydrophobic', stops: [[0.0, 0.55, 0.62], [0.95, 0.95, 0.95], [0.8, 0.55, 0.05]] },
  electrostatic: { label: 'Negative → positive', stops: [[0.86, 0.16, 0.16], [0.97, 0.97, 0.97], [0.16, 0.32, 0.92]] },
  heat: { label: 'Heat', stops: [[1.0, 0.95, 0.65], [1.0, 0.62, 0.2], [0.86, 0.16, 0.1]] },
  depth: { label: 'Shallow → deep', stops: hexColors(['#c62828', '#ef6c00', '#f9d648', '#7cc46a', '#2e9e6a', '#2b6cb0']) },
  // Stops every 0.1: blue below the AlphaMissense benign cutoff (0.34), gray in the ambiguous band,
  // red above the pathogenic cutoff (0.564).
  alphamissense: {
    label: 'AlphaMissense (benign → pathogenic)',
    stops: hexColors(['#2a4a9c', '#3a63b8', '#5b83cc', '#8fa9d9', '#b4b8c2', '#a9a9a9', '#e79a8f', '#dd6a5b', '#cf3f33', '#b3211b', '#8c0d0d']),
  },
};

export const PLDDT_BANDS = [
  { min: 90, label: 'Very high (pLDDT > 90)', color: hexColor('#0053D6') },
  { min: 70, label: 'Confident (70-90)', color: hexColor('#65CBF3') },
  { min: 50, label: 'Low (50-70)', color: hexColor('#FFDB13') },
  { min: -Infinity, label: 'Very low (< 50)', color: hexColor('#FF7D45') },
];

export const SECONDARY_COLORS = {
  helix: [0.95, 0.32, 0.42],
  sheet: [0.98, 0.78, 0.24],
  turn: [0.32, 0.74, 0.95],
  coil: [0.72, 0.78, 0.82],
};

export const RESIDUE_CLASS_COLORS = {
  hydrophobic: [0.92, 0.8, 0.35],
  polar: [0.35, 0.92, 0.72],
  positive: [0.28, 0.55, 1.0],
  negative: [1.0, 0.27, 0.3],
  nucleic: [0.74, 0.48, 1.0],
  ligand: [1.0, 0.58, 0.22],
  ion: [0.66, 0.5, 1.0],
  water: [0.55, 0.75, 1.0],
  other: [0.76, 0.82, 0.86],
};

export const MOLECULE_KIND_COLORS = {
  protein: [0.45, 0.72, 0.98],
  nucleic: [0.98, 0.55, 0.36],
  ligand: [0.35, 0.9, 0.55],
  ion: [0.75, 0.55, 1.0],
  water: [0.55, 0.75, 1.0],
};

export const NUCLEOBASE_COLORS = {
  A: [0.36, 0.84, 0.44],
  C: [0.35, 0.62, 1.0],
  G: [1.0, 0.72, 0.25],
  T: [1.0, 0.36, 0.36],
  U: [1.0, 0.36, 0.36],
  I: [0.7, 0.7, 0.7],
  N: [0.7, 0.7, 0.7],
};

export const BACKGROUNDS = {
  dark: { label: 'Dark', top: [0.028, 0.037, 0.04], bottom: [0.012, 0.016, 0.018] },
  black: { label: 'Black', top: [0, 0, 0], bottom: [0, 0, 0] },
  gray: { label: 'Gray', top: [0.3, 0.32, 0.34], bottom: [0.18, 0.19, 0.2] },
  white: { label: 'White', top: [1, 1, 1], bottom: [1, 1, 1] },
};

export function hexColor(hex) {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255);
}

export function hexColors(list) {
  return list.map(hexColor);
}

export function colorToHex(color) {
  return `#${color.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function sampleColormap(name, t) {
  const stops = (COLORMAPS[name] ?? COLORMAPS.viridis).stops;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local];
}

export function colormapGradientCSS(name) {
  const stops = (COLORMAPS[name] ?? COLORMAPS.viridis).stops;
  return `linear-gradient(90deg, ${stops.map((stop, index) => `${colorToHex(stop)} ${Math.round((index / (stops.length - 1)) * 100)}%`).join(', ')})`;
}

export function plddtColor(value) {
  for (const band of PLDDT_BANDS) {
    if (value > band.min) return [...band.color];
  }
  return [...PLDDT_BANDS[PLDDT_BANDS.length - 1].color];
}

export function chainPaletteColor(index, paletteName = 'vivid') {
  const colors = (CHAIN_PALETTES[paletteName] ?? CHAIN_PALETTES.vivid).colors;
  const base = colors[index % colors.length];
  const cycle = Math.floor(index / colors.length);
  if (cycle === 0) return [...base];
  const shift = cycle % 2 === 1 ? 0.28 : -0.22;
  return base.map((value) => Math.min(1, Math.max(0, shift > 0 ? value + (1 - value) * shift : value * (1 + shift))));
}

export function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function relativeLuminance(color) {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}
