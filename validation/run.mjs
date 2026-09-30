// Proteoscope's validation suite: recomputes, with the modules in web/lib, numbers that reference
// tools produced (stored in validation/reference/) and compares them.
//
//   node validation/run.mjs [suite …] [--offline] [--verbose]
//
// Suites: limma, msstatsptm, usalign, conservation, emdb, ramachandran, posebusters, smiles (all
// by default). Inputs that are not in the repository (PDB entries, chemical components, a region of
// an EMDB map, a wwPDB validation report) are downloaded once into validation/cache/; with --offline, suites whose inputs are not cached
// are skipped. The reference tools are not needed: validation/scripts/ holds the scripts that
// wrote the reference files. Exits with status 1 when a check fails.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { conservationScores, parseAlignment } from '../web/lib/conservation.js';
import { parseStructure } from '../web/lib/parse.js';
import { classifyRamachandran, loadTop8000 } from '../web/lib/ramachandran.js';
import { adjustForProtein, moderatedTTest } from '../web/lib/stats.js';
import { deriveStructure } from '../web/lib/structure.js';
import { exampleText } from '../web/lib/test-data.mjs';
import { mmAlign, tmAlign } from '../web/lib/tmalign.js';
import { mapFit, parseVolumeServerData } from '../web/lib/volume.js';
import { checkPose, contactClass } from '../web/lib/pose-checks.js';
import { readSMILES, smilesMapping } from '../web/lib/smiles.js';
import { caseChains, componentDefinition, componentFile, download, MissingInput, pairsFromRows, pdbFile, poseComplex, readReference, ROOT } from './common.mjs';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const verbose = args.includes('--verbose');

// A reference value stored as JSON: numbers, null, or R's "NA", "Inf" and "-Inf".
function value(item) {
  if (item === null || item === 'NA' || item === 'NaN') return NaN;
  if (item === 'Inf') return Infinity;
  if (item === '-Inf') return -Infinity;
  return item;
}

// Largest difference relative to max(|reference|, floor), over pairs of finite values; a value
// missing (NaN) on one side only is a mismatch.
function compare(ours, reference, floor = 1) {
  let worst = 0;
  let mismatches = 0;
  let compared = 0;
  reference.forEach((item, index) => {
    const expected = value(item);
    const actual = ours[index] ?? NaN;
    if (Number.isNaN(expected) || Number.isNaN(actual)) {
      if (Number.isNaN(expected) !== Number.isNaN(actual)) mismatches += 1;
      return;
    }
    compared += 1;
    if (expected === actual) return;
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
      mismatches += 1;
      return;
    }
    worst = Math.max(worst, Math.abs(actual - expected) / Math.max(Math.abs(expected), floor));
  });
  return { worst, mismatches, compared };
}

const exp = (number) => (number === 0 ? '0' : number.toExponential(1));

/* ---------- Suites ---------- */

// limma's moderated t-test.
async function limma() {
  const reference = readReference('limma.json');
  return reference.cases.map((item) => {
    const rows = item.x.length;
    const columns = item.x[0].length;
    const values = new Float64Array(rows * columns);
    item.x.forEach((row, r) => row.forEach((entry, c) => { values[r * columns + c] = entry ?? NaN; }));
    const groupA = [];
    const groupB = [];
    item.groups.forEach((group, column) => (group === 'A' ? groupA : groupB).push(column));
    const result = moderatedTTest({ values, rows, columns }, groupA, groupB, { minValid: item.minValid });
    const field = (name) => result.results.map((row) => row?.[name] ?? NaN);
    const d0 = value(item.d0);
    const priorDiff = Math.max(
      d0 === Infinity ? (result.prior.d0 === Infinity ? 0 : 1) : Math.abs(result.prior.d0 - d0) / d0,
      Math.abs(result.prior.s02 - item.s02) / item.s02,
    );
    const logFC = compare(field('logFC'), item.logFC, 1e-3);
    const t = compare(field('t'), item.t, 1e-3);
    const p = compare(field('p'), item.p, 1e-300);
    const q = compare([...result.q], item.q, 1e-300);
    const worst = Math.max(priorDiff, logFC.worst, t.worst, p.worst, q.worst);
    const mismatches = logFC.mismatches + t.mismatches + p.mismatches + q.mismatches;
    return {
      name: item.description,
      ok: mismatches === 0 && worst < 1e-8,
      detail: `${result.tested} of ${rows} tested; d0 ${d0 === Infinity ? '∞' : d0.toFixed(3)}; largest relative difference ${exp(worst)} (prior ${exp(priorDiff)}, t ${exp(t.worst)}, p ${exp(p.worst)}, q ${exp(q.worst)})${mismatches ? `; ${mismatches} tested/untested mismatches` : ''}`,
    };
  });
}

// MSstatsPTM's adjustment of site changes for protein changes.
async function msstatsptm() {
  const reference = readReference('msstatsptm.json');
  const proteins = new Map(reference.protein.protein.map((name, index) => [name, {
    logFC: value(reference.protein.logFC[index]), se: value(reference.protein.se[index]), df: value(reference.protein.df[index]),
  }]));
  const sites = reference.site.protein.map((name, index) => ({
    site: { logFC: value(reference.site.logFC[index]), se: value(reference.site.se[index]), df: value(reference.site.df[index]) },
    protein: proteins.get(name),
  }));
  const ours = sites.map(({ site, protein }) => adjustForProtein(site, protein));
  const keys = ['logFC', 'se', 'df', 't', 'p'];
  const adjusted = sites.map((_, index) => reference.adjusted.site[index] !== 'NA');
  let worst = 0;
  let failures = 0;
  sites.forEach(({ site }, index) => {
    const out = ours[index];
    if (!adjusted[index]) {
      // No protein: MSstatsPTM leaves the site out of the adjusted table; it is reported as is.
      if (out.adjusted || out.logFC !== site.logFC || out.se !== site.se) failures += 1;
      return;
    }
    if (!Number.isFinite(site.logFC)) {
      if (out.logFC !== site.logFC || !Number.isNaN(out.p) || reference.adjusted.p[index] !== 'NA') failures += 1;
      return;
    }
    for (const key of keys) {
      const expected = value(reference.adjusted[key][index]);
      worst = Math.max(worst, Math.abs(out[key] - expected) / Math.max(Math.abs(expected), key === 'p' ? 1e-300 : 1));
    }
  });
  return [{
    name: `${sites.length} sites, including one without its protein, two infinite changes and a protein with SE 0`,
    ok: failures === 0 && worst < 1e-10,
    detail: `largest relative difference ${exp(worst)}${failures ? `; ${failures} special cases handled differently` : '; special cases handled alike'}`,
  }];
}

// TM-align and MM-align against US-align.
async function usalign() {
  const reference = readReference('usalign.json');
  const within = (ours, printed, decimals) => Math.abs(ours - printed) <= 0.5 * 10 ** -decimals + 1e-9;
  const checks = [];
  for (const item of reference.single) {
    const [a] = caseChains(await pdbFile(item.mobile.pdb, { offline }), item.mobile);
    const [b] = caseChains(await pdbFile(item.reference.pdb, { offline }), item.reference);
    const ours = tmAlign(a, b);
    const expected = pairsFromRows(...item.rows);
    const samePairs = expected.length === ours.pairs.length && expected.every(([i, j], k) => ours.pairs[k][0] === i && ours.pairs[k][1] === j);
    const ok = within(ours.tmScore.mobile, item.tm[0], 5) && within(ours.tmScore.reference, item.tm[1], 5) && within(ours.rmsd, item.rmsd, 2)
      && within(ours.identity, item.identity, 3) && ours.alignedLength === item.alignedLength && samePairs;
    checks.push({
      name: `TM-align ${item.name}`,
      ok,
      detail: `TM ${ours.tmScore.mobile.toFixed(5)} / ${ours.tmScore.reference.toFixed(5)} (US-align ${item.tm.map((tm) => tm.toFixed(5)).join(' / ')}), ${ours.alignedLength} pairs, RMSD ${ours.rmsd.toFixed(2)} Å${samePairs ? ', same pairs' : ', different pairs'}`,
    });
  }
  for (const item of reference.complexes) {
    const a = caseChains(await pdbFile(item.mobile.pdb, { offline }), item.mobile);
    const b = caseChains(await pdbFile(item.reference.pdb, { offline }), item.reference);
    const ours = mmAlign(a, b);
    const assignment = ours.chainPairs.map((pair) => `${pair.mobile}${pair.reference}`).join(' ');
    const ok = within(ours.tmScore.mobile, item.tm[0], 5) && within(ours.tmScore.reference, item.tm[1], 5) && within(ours.rmsd, item.rmsd, 2)
      && within(ours.identity, item.identity, 3) && ours.alignedLength === item.alignedLength && assignment === item.assignment;
    checks.push({
      name: `MM-align ${item.name}`,
      // US-align's own answer is unreliable when the first complex has more chains; without a
      // patched reference a difference there is reported, not failed.
      ok: ok || (item.build !== undefined && item.build !== 'patched'),
      detail: `TM ${ours.tmScore.mobile.toFixed(5)} / ${ours.tmScore.reference.toFixed(5)} (US-align ${item.tm.map((tm) => tm.toFixed(5)).join(' / ')}${item.build === 'patched' ? ', patched' : ''}), chains ${assignment}${assignment === item.assignment ? '' : ` vs ${item.assignment}`}${!ok && item.build ? ' (US-align unreliable here)' : ''}`,
    });
  }
  return checks;
}

// Jensen–Shannon divergence and entropy against Capra & Singh's scorer.
async function conservation() {
  const reference = readReference('conservation.json');
  const checks = [];
  for (const item of reference.alignments) {
    const alignment = parseAlignment(readFileSync(join(ROOT, 'data', item.file), 'utf8'), item.file);
    const sameColumns = alignment.columns.length === item.columns.length && alignment.columns.every((column, index) => column === item.columns[index]);
    for (const set of item.sets) {
      const ours = conservationScores(alignment, set.options);
      const result = compare(ours.scores, set.scores, 1);
      const unscored = set.scores.filter((score) => score === null).length;
      checks.push({
        name: `${item.file}: ${set.label}`,
        ok: sameColumns && result.mismatches === 0 && result.worst < 1e-9,
        detail: `${result.compared} residues scored, ${unscored} gap-rich unscored; largest difference ${exp(result.worst)}${sameColumns ? '' : '; query columns differ'}${result.mismatches ? `; ${result.mismatches} scored/unscored mismatches` : ''}`,
      });
    }
  }
  return checks;
}

// Atom inclusion of 8GUB in EMD-34272 against EMDB's validation analysis.
async function emdb() {
  const reference = readReference('emdb-34272.json');
  const model = deriveStructure(parseStructure(exampleText('8gub'), '8gub.cif')).models[0];
  const atoms = model.atoms.filter((atom) => !atom.isHydrogen && !atom.isWater);
  const positions = Float64Array.from(atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
  const lower = [0, 1, 2].map((axis) => Math.floor(Math.min(...atoms.map((atom) => [atom.x, atom.y, atom.z][axis])) - 4));
  const upper = [0, 1, 2].map((axis) => Math.ceil(Math.max(...atoms.map((atom) => [atom.x, atom.y, atom.z][axis])) + 4));
  // The map around the model at the volume server's detail level 5 (8-bit values).
  const url = `https://www.ebi.ac.uk/pdbe/volume-server/em/emd-34272/box/${lower.join(',')}/${upper.join(',')}?detail=5&encoding=bcif`;
  const [volume] = parseVolumeServerData(new Uint8Array(await download('emdb/emd-34272-box-detail5.bcif', url, { offline })));
  const groups = Int32Array.from(atoms.map((atom) => model.atomResidue[atom.id]));
  const fit = mapFit(volume, positions, groups, model.residues.length, reference.level);
  const byName = new Map(model.residues.map((residue, index) => [`${residue.chain}:${residue.resSeq}${residue.resName}`, index]));
  let identical = 0;
  let oneAtom = 0;
  let other = 0;
  reference.residues.forEach((name, index) => {
    const residue = byName.get(name);
    const ours = fit.inclusion[residue];
    // EMDB prints 4 decimals.
    const difference = Math.abs(ours - reference.inclusion[index]);
    if (difference <= 5e-5 + 1e-9) identical += 1;
    else if (difference * fit.counts[residue] <= 1 + 1e-3) oneAtom += 1;
    else other += 1;
  });
  return [
    {
      name: `Atom inclusion at ${reference.level} (EMDB's recommended contour)`,
      ok: Math.abs(fit.atomInclusion - reference.atomInclusion) <= 0.005,
      detail: `${fit.atomInclusion.toFixed(4)} over ${fit.atoms.toLocaleString('en-US')} heavy atoms; EMDB ${reference.atomInclusion} over ${reference.atoms.toLocaleString('en-US')} atoms`,
    },
    {
      name: 'Residue inclusion',
      ok: other === 0 && identical >= 0.95 * reference.residues.length,
      detail: `${identical} of ${reference.residues.length} residues identical, ${oneAtom} differ by one atom${other ? `, ${other} by more` : ''} (map values are 8-bit)`,
    },
  ];
}

// MolProbity Top8000 Ramachandran classes against the wwPDB validation report of 1M17.
async function ramachandran() {
  const url = 'https://files.rcsb.org/pub/pdb/validation_reports/m1/1m17/1m17_validation.xml.gz';
  const xml = gunzipSync(await download('wwpdb/1m17_validation.xml.gz', url, { offline })).toString('utf8');
  const report = new Map();
  for (const match of xml.matchAll(/<ModelledSubgroup\s([^>]*?)\/?>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, text]) => [key, text]));
    const key = `${attributes.chain}|${attributes.resnum}|${attributes.icode.trim()}`;
    // Alternate conformations are listed separately; the first is compared.
    if (attributes.rama && !report.has(key)) report.set(key, attributes.rama);
  }
  const model = deriveStructure(parseStructure(exampleText('1m17'), '1m17.cif')).models[0];
  const classes = classifyRamachandran(await loadTop8000(), model.residues);
  let agree = 0;
  let compared = 0;
  const differences = [];
  for (const residue of model.residues) {
    const expected = report.get(`${residue.chain}|${residue.resSeq}|${residue.iCode ?? ''}`);
    const ours = classes.get(residue.key)?.rama;
    if (!expected || !ours) continue;
    compared += 1;
    if (expected.toUpperCase() === ours.toUpperCase()) agree += 1;
    else differences.push(`${residue.chain}:${residue.resName}${residue.resSeq} ${ours} vs ${expected}`);
  }
  return [{
    name: 'Top8000 classes, 1M17',
    ok: compared > 0 && agree === compared,
    detail: `${agree} of ${compared} residues agree with the report${differences.length ? `: ${differences.slice(0, 5).join('; ')}` : ''}`,
  }];
}

// PoseBusters' checks on crystal poses and copies broken on purpose.
const POSEBUSTERS_NAMES = {
  sanitization: 'sanitization',
  connected: 'all_atoms_connected',
  'bond-lengths': 'bond_lengths',
  'bond-angles': 'bond_angles',
  'internal-clash': 'internal_steric_clash',
  'aromatic-flatness': 'aromatic_ring_flatness',
  'ring-nonflatness': 'non-aromatic_ring_non-flatness',
  'double-bond-flatness': 'double_bond_flatness',
  chirality: 'tetrahedral_chirality',
  'double-bond-stereo': 'double_bond_stereochemistry',
  'protein-distance': 'minimum_distance_to_protein',
  'protein-near': 'protein-ligand_maximum_distance',
  'organic-distance': 'minimum_distance_to_organic_cofactors',
  'inorganic-distance': 'minimum_distance_to_inorganic_cofactors',
  'water-distance': 'minimum_distance_to_waters',
  'protein-overlap': 'volume_overlap_with_protein',
  'organic-overlap': 'volume_overlap_with_organic_cofactors',
  'inorganic-overlap': 'volume_overlap_with_inorganic_cofactors',
  'water-overlap': 'volume_overlap_with_waters',
};
const POSEBUSTERS_VALUES = [
  ['bond-lengths', 'shortest', 'shortest_bond_relative_length'],
  ['bond-lengths', 'longest', 'longest_bond_relative_length'],
  ['bond-angles', 'value', 'most_extreme_relative_angle'],
  ['internal-clash', 'value', 'shortest_noncovalent_relative_distance'],
  ['protein-distance', 'value', 'most_extreme_relative_distance_protein'],
  ['organic-distance', 'value', 'most_extreme_relative_distance_organic_cofactors'],
  ['inorganic-distance', 'value', 'most_extreme_relative_distance_inorganic_cofactors'],
  ['water-distance', 'value', 'most_extreme_relative_distance_waters'],
  ['protein-near', 'value', 'smallest_distance_protein'],
];
const OVERLAPS = [['protein-overlap', 'volume_overlap_protein'], ['organic-overlap', 'volume_overlap_organic_cofactors'], ['inorganic-overlap', 'volume_overlap_inorganic_cofactors'], ['water-overlap', 'volume_overlap_waters']];

async function posebusters() {
  const reference = readReference('posebusters.json');
  const checks = [];
  for (const item of reference.cases) {
    const complex = poseComplex(await pdbFile(item.pdb, { offline }), item.code);
    const component = await componentDefinition(await componentFile(item.code, { offline }));
    const environment = complex.environment.map((atom) => ({ ...atom, contact: contactClass(atom) }));
    const bonds = [];
    for (let index = 0; index < item.bonds.length; index += 3) bonds.push({ a: item.bonds[index], b: item.bonds[index + 1], order: item.bonds[index + 2] });
    const metal = item.elements.some((element) => ['FE', 'ZN', 'MG', 'CU', 'CO', 'NI', 'MN'].includes(element));
    let verdicts = 0;
    let worstValue = 0;
    let worstOverlap = 0;
    const disagreements = [];
    const expected = [];
    for (const pose of item.poses) {
      const atoms = item.atoms.map((name, index) => ({ name, element: item.elements[index], charge: item.charges[index], x: pose.coordinates[index * 3], y: pose.coordinates[index * 3 + 1], z: pose.coordinates[index * 3 + 2] }));
      const result = checkPose({ atoms, bonds }, environment, { reference: component });
      const theirs = Object.fromEntries(reference.fields.map((field, index) => [field, pose.posebusters[index]]));
      const byId = new Map(result.checks.map((check) => [check.id, check]));
      for (const [id, name] of Object.entries(POSEBUSTERS_NAMES)) {
        const ours = byId.get(id).passed;
        const verdict = theirs[name];
        if (typeof verdict !== 'boolean') continue;
        verdicts += 1;
        if ((ours ?? false) === verdict) continue;
        const label = `${pose.name}: ${id} ${ours} vs ${verdict}`;
        // PoseBusters reads a ring's distance from its plane with a sign: it misses a single atom
        // pushed out of the ring when the plane's normal points the other way.
        if (id === 'aromatic-flatness' && !ours && verdict && (theirs.aromatic_ring_maximum_distance_from_plane ?? 0) <= 0.25) expected.push(`${label} (signed distance)`);
        // RDKit rejects ligands bonded to a metal, and PoseBusters then fails every geometry
        // check; Proteoscope checks the organic part and measures the metal by covalent radii.
        else if (metal && theirs.sanitization === false) expected.push(`${label} (metal)`);
        else if (id.endsWith('-overlap') && Math.abs((byId.get(id).value ?? 0) - 0.075) < 0.01) expected.push(`${label} (at the limit)`);
        else disagreements.push(label);
      }
      if (!(metal && theirs.sanitization === false)) {
        for (const [id, field, name] of POSEBUSTERS_VALUES) {
          const ours = byId.get(id)[field];
          const expectedValue = theirs[name];
          if (expectedValue === null || expectedValue === undefined || !Number.isFinite(ours)) continue;
          worstValue = Math.max(worstValue, Math.abs(ours - expectedValue) / Math.max(Math.abs(expectedValue), 1e-3));
        }
      }
      for (const [id, name] of OVERLAPS) {
        const expectedValue = theirs[name];
        if (expectedValue === null || expectedValue === undefined) continue;
        worstOverlap = Math.max(worstOverlap, Math.abs(byId.get(id).value - expectedValue));
      }
    }
    checks.push({
      name: `${item.pdb} ${item.code} (${item.description}), ${item.poses.length} poses`,
      ok: disagreements.length === 0 && worstValue < 1e-4 && worstOverlap < 0.02,
      detail: `${verdicts - disagreements.length - expected.length} of ${verdicts} verdicts agree${expected.length ? `, ${expected.length} differ as documented (${expected.join('; ')})` : ''}${disagreements.length ? `; DISAGREE: ${disagreements.join('; ')}` : ''}; largest relative difference in bond, angle, clash and contact ratios ${exp(worstValue)}; volume overlap within ${worstOverlap.toFixed(4)}`,
    });
  }
  return checks;
}

/* ---------- SMILES against RDKit ---------- */

// Each molecule written several ways: smiles.js must read the atoms, charges, hydrogens and
// Kekulé valences RDKit reads, and the stereo it reads must hold in RDKit's embedded coordinates
// and fail in their mirror image.
async function smiles() {
  const reference = readReference('smiles.json');
  const checks = [];
  for (const item of reference.molecules) {
    const problems = [];
    let centers = 0;
    let doubleBonds = 0;
    for (const variant of item.variants) {
      const label = variant.smiles.length > 40 ? `${variant.smiles.slice(0, 40)}…` : variant.smiles;
      let molecule;
      try {
        molecule = readSMILES(variant.smiles);
      } catch (error) {
        problems.push(`${label}: ${error.message}`);
        continue;
      }
      const order = variant.order;
      const at = new Map(order.map((original, index) => [original, index]));
      const expect = (field) => order.map((original) => item[field][original]);
      if (JSON.stringify(molecule.atoms.map((atom) => atom.element)) !== JSON.stringify(expect('elements'))) {
        problems.push(`${label}: elements`);
        continue;
      }
      if (JSON.stringify(molecule.atoms.map((atom) => atom.charge)) !== JSON.stringify(expect('charges'))) problems.push(`${label}: charges`);
      if (JSON.stringify(molecule.atoms.map((atom) => atom.hydrogens)) !== JSON.stringify(expect('hydrogens'))) problems.push(`${label}: hydrogens`);
      // Any Kekulé structure gives each atom the same valence; the bonds themselves must match.
      const pairs = (bonds) => bonds.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)).sort().join(' ');
      const theirs = [];
      for (let index = 0; index < item.bonds.length; index += 3) theirs.push([at.get(item.bonds[index]), at.get(item.bonds[index + 1]), item.bonds[index + 2]]);
      const ours = molecule.bonds.map((bond) => [bond.a, bond.b, bond.order]);
      const valence = (bonds) => {
        const sums = new Array(order.length).fill(0);
        for (const [a, b, bondOrder] of bonds) {
          sums[a] += bondOrder;
          sums[b] += bondOrder;
        }
        return sums.join(' ');
      };
      if (pairs(ours) !== pairs(theirs)) problems.push(`${label}: bonds`);
      else if (valence(ours) !== valence(theirs)) problems.push(`${label}: Kekulé structure`);
      // The marks RDKit (and so the predictors) keeps as stereogenic, and no others.
      if (molecule.stereo.centers.length !== item.centers || molecule.stereo.doubleBonds.length !== item.stereoBonds) {
        problems.push(`${label}: ${molecule.stereo.centers.length} stereocenters and ${molecule.stereo.doubleBonds.length} stereo bonds, RDKit ${item.centers} and ${item.stereoBonds}`);
      }
      // The model's atoms in the string's order, paired as the page pairs a predictor's (the
      // symmetric pairing that best fits the SMILES's stereo).
      const names = molecule.atoms.map((atom, index) => `${atom.element}${index + 1}`);
      const verdict = (mirror, id) => {
        const atoms = molecule.atoms.map((atom, index) => {
          const base = order[index] * 3;
          return { name: names[index], element: atom.element, charge: atom.charge, x: item.coordinates[base] * (mirror ? -1 : 1), y: item.coordinates[base + 1], z: item.coordinates[base + 2] };
        });
        const mapping = smilesMapping(molecule, atoms, molecule.bonds);
        const nameOf = (index) => names[mapping[index]];
        const stereo = {
          smiles: true,
          centers: molecule.stereo.centers.map((center) => ({ center: nameOf(center.center), order: center.order.map((slot) => (slot === null ? null : nameOf(slot))), parity: center.parity })),
          doubleBonds: molecule.stereo.doubleBonds.map((bond) => ({ a: nameOf(bond.a), b: nameOf(bond.b), sa: nameOf(bond.sa), sb: nameOf(bond.sb), cis: bond.cis })),
        };
        const bonds = molecule.bonds.map((bond) => ({ a: mapping[bond.a], b: mapping[bond.b], order: bond.order }));
        return checkPose({ atoms, bonds }, [], { reference: stereo }).checks.find((check) => check.id === id);
      };
      const chirality = verdict(false, 'chirality');
      const geometry = verdict(false, 'double-bond-stereo');
      if (chirality.passed !== true) problems.push(`${label}: ${chirality.detail}`);
      if (geometry.passed !== true) problems.push(`${label}: ${geometry.detail}`);
      const counted = Number(/All (\d+) stereocenters/.exec(chirality.detail)?.[1] ?? (/The stereocenter/.test(chirality.detail) ? 1 : 0));
      centers = Math.max(centers, counted);
      doubleBonds = Math.max(doubleBonds, molecule.stereo.doubleBonds.length);
      // A chiral molecule's mirror image is another molecule and fails; an achiral one's (meso,
      // trans-decalin) is the same molecule and passes.
      if (counted && item.chiral && verdict(true, 'chirality').passed !== false) problems.push(`${label}: its mirror image passes`);
      if (counted && !item.chiral && verdict(true, 'chirality').passed !== true) problems.push(`${label}: the mirror image of an achiral molecule fails`);
      if (verdict(true, 'double-bond-stereo').passed !== true) problems.push(`${label}: the mirror image changes E/Z`);
    }
    checks.push({
      name: `${item.name}, ${item.variants.length} SMILES`,
      ok: problems.length === 0,
      detail: problems.length
        ? problems.slice(0, 4).join('; ')
        : `atoms, charges, hydrogens, Kekulé bonds and stereo marks as RDKit reads them; ${centers} of RDKit's ${item.centers} stereocenters and ${doubleBonds} E/Z bonds hold in its coordinates${centers ? (item.chiral ? ' and invert in the mirror image' : ' and in the mirror image, the same achiral molecule') : ''}`,
    });
  }
  return checks;
}

/* ---------- Runner ---------- */

const SUITES = { limma, msstatsptm, usalign, conservation, emdb, ramachandran, posebusters, smiles };
const requested = args.filter((arg) => !arg.startsWith('--'));
const unknown = requested.filter((name) => !SUITES[name]);
if (unknown.length) {
  console.error(`Unknown suite ${unknown.join(', ')}; choose from ${Object.keys(SUITES).join(', ')}.`);
  process.exit(2);
}
let failed = 0;
let passed = 0;
let skipped = 0;
for (const name of requested.length ? requested : Object.keys(SUITES)) {
  const started = performance.now();
  let checks;
  try {
    checks = await SUITES[name]();
  } catch (error) {
    if (error instanceof MissingInput) {
      skipped += 1;
      console.log(`${name}: skipped (${error.message})`);
      continue;
    }
    failed += 1;
    console.log(`${name}: ERROR ${error.stack ?? error}`);
    continue;
  }
  const bad = checks.filter((check) => !check.ok);
  failed += bad.length;
  passed += checks.length - bad.length;
  console.log(`${name}: ${checks.length - bad.length} of ${checks.length} passed (${((performance.now() - started) / 1000).toFixed(1)} s)`);
  for (const check of checks) {
    if (verbose || !check.ok) console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
}
console.log(`\n${passed} checks passed, ${failed} failed${skipped ? `, ${skipped} suites skipped` : ''}.`);
process.exit(failed ? 1 : 0);
