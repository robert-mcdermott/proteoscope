// Ramachandran validation with MolProbity's Top8000 distributions: each residue is assigned one
// of six categories (glycine, cis- or trans-proline, pre-proline, Ile/Val, general), its (φ, ψ) is
// looked up in that category's density table with bilinear interpolation, and it is favored at
// density ≥ 0.02, allowed at ≥ 0.0005 (general), 0.002 (cis-Pro) or 0.001 (others), otherwise an
// outlier — the criteria of MolProbity's ramalyze.

export const RAMA_CATEGORIES = [
  { id: 'general', label: 'General', allowed: 0.0005 },
  { id: 'glycine', label: 'Glycine', allowed: 0.001 },
  { id: 'cisPro', label: 'cis-Proline', allowed: 0.002 },
  { id: 'transPro', label: 'trans-Proline', allowed: 0.001 },
  { id: 'prePro', label: 'Pre-proline', allowed: 0.001 },
  { id: 'ileVal', label: 'Ile / Val', allowed: 0.001 },
];
export const RAMA_FAVORED = 0.02;
const ALLOWED = Object.fromEntries(RAMA_CATEGORIES.map((category) => [category.id, category.allowed]));

let loading = null;

// Decodes the embedded tables once: { category: Float32Array(180 × 180) }.
export function loadTop8000() {
  loading ??= (async () => {
    // The 75 KB table module loads on first use.
    const { TOP8000_GZIP_BASE64, TOP8000_TABLES } = await import('./rama-top8000.js');
    const binary = atob(TOP8000_GZIP_BASE64);
    const packed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const tables = {};
    TOP8000_TABLES.forEach((name, index) => {
      const values = new Float32Array(180 * 180);
      for (let cell = 0; cell < values.length; cell += 1) {
        const byte = bytes[index * 32400 + cell];
        values[cell] = byte ? 10 ** ((7 * (byte - 1)) / 254 - 7) : 0;
      }
      tables[name] = values;
    });
    return tables;
  })();
  return loading;
}

// MolProbity's order: Gly, then Pro (cis when |ω| < 30°), then pre-Pro, then Ile/Val.
export function ramaCategory(residue) {
  const name = residue.parent ?? residue.resName;
  if (name === 'GLY') return 'glycine';
  if (name === 'PRO') return Number.isFinite(residue.omega) && Math.abs(residue.omega) < 30 ? 'cisPro' : 'transPro';
  if (residue.beforeProline) return 'prePro';
  if (name === 'ILE' || name === 'VAL') return 'ileVal';
  return 'general';
}

// Density at (φ, ψ), interpolated between the 2° bin centres (−179, −177, …, 179) with wrapping.
export function ramaDensity(table, phi, psi) {
  const x = (wrap(phi) + 179) / 2;
  const y = (wrap(psi) + 179) / 2;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (i, j) => table[(((i % 180) + 180) % 180) * 180 + (((j % 180) + 180) % 180)];
  return (1 - fx) * (1 - fy) * at(x0, y0) + fx * (1 - fy) * at(x0 + 1, y0) + (1 - fx) * fy * at(x0, y0 + 1) + fx * fy * at(x0 + 1, y0 + 1);
}

function wrap(angle) {
  let value = angle;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

export function ramaClass(density, category) {
  if (density >= RAMA_FAVORED) return 'Favored';
  if (density >= (ALLOWED[category] ?? 0.001)) return 'Allowed';
  return 'OUTLIER';
}

// Classifies every protein residue with both dihedrals: Map(residue key → { category, density, rama }).
export function classifyRamachandran(tables, residues) {
  const result = new Map();
  for (const residue of residues) {
    if (residue.kind !== 'protein' || !Number.isFinite(residue.phi) || !Number.isFinite(residue.psi)) continue;
    const category = ramaCategory(residue);
    const density = ramaDensity(tables[category], residue.phi, residue.psi);
    result.set(residue.key, { category, density, rama: ramaClass(density, category) });
  }
  return result;
}
