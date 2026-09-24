// Writes validation/reference/emdb-34272.json: atom inclusion of model 8GUB in map EMD-34272 at
// the recommended contour level, from EMDB's validation analysis, which mapFit in
// web/lib/volume.js must reproduce.
//
//   node validation/scripts/emdb-reference.mjs
import { download, writeReference } from '../common.mjs';

const ENTRY = '34272';
const url = `https://www.ebi.ac.uk/emdb/api/analysis/${ENTRY}`;
const analysis = JSON.parse((await download(`emdb/analysis-${ENTRY}.json`, url)).toString('utf8'))[ENTRY][ENTRY];
const level = analysis.recommended_contour_level.recl;
const byLevel = analysis.atom_inclusion_by_level['0'];
const index = byLevel.level.findIndex((value) => Math.abs(value - level) < 1e-6);
if (index < 0) throw new Error(`No atom inclusion at the recommended level ${level}`);
const residues = analysis.residue_inclusion['0'][String(level)];

writeReference(`emdb-${ENTRY}.json`, {
  source: `EMDB validation analysis ${analysis.version} (${url})`,
  map: `EMD-${ENTRY}`,
  model: byLevel.name,
  level,
  atomInclusion: byLevel.all_atom[index],
  backboneInclusion: byLevel.backbone[index],
  atoms: byLevel.totalNumberOfAtoms,
  chains: Object.fromEntries(Object.entries(byLevel.chainaiscore).map(([chain, item]) => [chain, { inclusion: item.value, atoms: item.numberOfAtoms }])),
  residues: residues.residue,
  inclusion: residues.inclusion,
});
console.error(`EMD-${ENTRY} at ${level}: atom inclusion ${byLevel.all_atom[index]}, ${residues.residue.length} residues`);
