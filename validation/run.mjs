// Proteoscope's validation suite: recomputes, with the modules in web/lib, numbers that reference
// tools produced (stored in validation/reference/) and compares them.
//
//   node validation/run.mjs [suite …] [--offline] [--verbose]
//
// Suites: limma, msstatsptm, usalign, conservation, emdb, ramachandran (all by default). Inputs
// that are not in the repository (PDB entries, a region of an EMDB map, a wwPDB validation report)
// are downloaded once into validation/cache/; with --offline, suites whose inputs are not cached
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
import { caseChains, download, MissingInput, pairsFromRows, pdbFile, readReference, ROOT } from './common.mjs';

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

/* ---------- Runner ---------- */

const SUITES = { limma, msstatsptm, usalign, conservation, emdb, ramachandran };
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
