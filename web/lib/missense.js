// AlphaMissense (Cheng et al., Science 2023) pathogenicity for every single amino-acid substitution
// of human proteins, as published per UniProt entry by AlphaFold DB (protein_variant,
// am_pathogenicity, am_class). Scores run from 0 to 1; the authors call < 0.34 likely benign and
// > 0.564 likely pathogenic.

export const MISSENSE_THRESHOLDS = { benign: 0.34, pathogenic: 0.564 };

export function missenseClass(score) {
  if (!Number.isFinite(score)) return '';
  if (score > MISSENSE_THRESHOLDS.pathogenic) return 'likely pathogenic';
  if (score < MISSENSE_THRESHOLDS.benign) return 'likely benign';
  return 'ambiguous';
}

// Returns { positions: Map(UniProt position → { wt, mean, max, count, scores: Map(aa → score) }),
// variants } or null when the text is not an AlphaMissense table.
export function parseAlphaMissense(text) {
  const lines = String(text || '').split(/\r?\n/);
  const header = lines[0]?.toLowerCase().split(/[,\t]/).map((cell) => cell.trim());
  const variantColumn = header?.findIndex((cell) => cell === 'protein_variant' || cell === 'variant');
  const scoreColumn = header?.findIndex((cell) => cell === 'am_pathogenicity' || cell === 'pathogenicity' || cell === 'score');
  if (!header || variantColumn < 0 || scoreColumn < 0) return null;
  const positions = new Map();
  let variants = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(/[,\t]/);
    const match = cells[variantColumn]?.trim().match(/^([A-Z])(\d+)([A-Z])$/);
    const score = Number(cells[scoreColumn]);
    if (!match || !Number.isFinite(score)) continue;
    const position = Number(match[2]);
    let item = positions.get(position);
    if (!item) {
      item = { wt: match[1], mean: 0, max: -Infinity, count: 0, scores: new Map() };
      positions.set(position, item);
    }
    item.scores.set(match[3], score);
    item.count += 1;
    item.mean += (score - item.mean) / item.count;
    if (score > item.max) item.max = score;
    variants += 1;
  }
  return positions.size ? { positions, variants } : null;
}

// The substitutions at one position, most pathogenic first.
export function rankedSubstitutions(item, limit = 19) {
  if (!item) return [];
  return [...item.scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([aa, score]) => ({ aa, score, label: missenseClass(score) }));
}
