// Writes validation/reference/usalign.json: US-align's results for the structure-alignment cases
// in validation/common.mjs, computed on the same Cα/C3′ atoms Proteoscope's tmAlign and mmAlign
// receive.
//
//   USALIGN=/path/to/USalign node validation/scripts/usalign-reference.mjs
//
// US-align (https://zhanggroup.org/US-align/) is not part of Proteoscope; build it locally. When
// the first complex has more chains than the second, US-align 20260920 passes its chain-score
// matrix untransposed to hetero_refined_greedy_search (USalign.cpp) and reads past the end of its
// rows, so its results for those cases change from run to run. Set USALIGN_PATCHED to a build
// that passes the transposed matrix, and those cases are recorded from it (marked "patched").
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseChains, MM_CASES, pdbFile, TM_CASES, writeReference } from '../common.mjs';

const official = process.env.USALIGN;
const patched = process.env.USALIGN_PATCHED;
if (!official) {
  console.error('Set USALIGN to the path of a US-align binary.');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'usalign-'));

function writeChains(name, chains) {
  const path = join(work, name);
  writeFileSync(path, `${chains.flatMap((chain) => [...chain.lines, 'TER']).join('\n')}\nEND\n`);
  return path;
}

function run(binary, args) {
  const output = execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = output.split('\n');
  const result = {};
  lines.forEach((line, index) => {
    let match = line.match(/^Aligned length=\s*(\d+), RMSD=\s*([\d.]+), Seq_ID=n_identical\/n_aligned=\s*([\d.]+)/);
    if (match) Object.assign(result, { alignedLength: Number(match[1]), rmsd: Number(match[2]), identity: Number(match[3]) });
    match = line.match(/^TM-score=\s*([\d.]+) \(normalized by length of Structure_(\d)/);
    if (match) (result.tm ??= [])[Number(match[2]) - 1] = Number(match[1]);
    match = line.match(/^Name of Structure_(\d): (\S+)/);
    if (match) (result.chainIds ??= [])[Number(match[1]) - 1] = match[2].slice(match[2].indexOf('.pdb') + 4).split(':').slice(1);
    if (line.startsWith('(":" denotes')) result.rows = [lines[index + 1], lines[index + 3]];
  });
  return result;
}

// Chain assignment ("CA DB": mobile C on reference A …) from the rows, which list the aligned
// chains in order separated by '*'.
function assignment(result) {
  const [mobileIds, referenceIds] = result.chainIds;
  const segments = result.rows.map((row) => row.split('*'));
  const pairs = [];
  mobileIds.forEach((id, k) => {
    if (id && referenceIds[k] && segments[0][k] !== undefined) pairs.push(`${id}${referenceIds[k]}`);
  });
  return pairs.join(' ');
}

const single = [];
for (const [name, mobile, reference] of TM_CASES) {
  const a = caseChains(await pdbFile(mobile.pdb), mobile);
  const b = caseChains(await pdbFile(reference.pdb), reference);
  const result = run(official, [writeChains('mobile.pdb', a), writeChains('reference.pdb', b)]);
  single.push({ name, mobile, reference, tm: result.tm, rmsd: result.rmsd, alignedLength: result.alignedLength, identity: result.identity, rows: result.rows });
  console.error(`${name}: TM ${result.tm.join(' / ')}`);
}

const complexes = [];
for (const [name, mobile, reference] of MM_CASES) {
  const a = caseChains(await pdbFile(mobile.pdb), mobile);
  const b = caseChains(await pdbFile(reference.pdb), reference);
  const args = [writeChains('mobile.pdb', a), writeChains('reference.pdb', b), '-mm', '1', '-ter', '1'];
  const affected = a.length > b.length;
  const result = run(affected && patched ? patched : official, args);
  const entry = { name, mobile, reference, tm: result.tm, rmsd: result.rmsd, alignedLength: result.alignedLength, identity: result.identity, assignment: assignment(result) };
  if (affected) entry.build = patched ? 'patched' : 'official (unreliable: reads out of bounds)';
  complexes.push(entry);
  console.error(`${name}: TM ${result.tm.join(' / ')} [${entry.assignment}]${entry.build ? ` (${entry.build})` : ''}`);
}
rmSync(work, { recursive: true, force: true });

// -v prints the banner and exits with status 1.
const version = spawnSync(official, ['-v'], { encoding: 'utf8' }).stdout.match(/Version (\d+)/)?.[1] ?? 'unknown';
writeReference('usalign.json', {
  source: `US-align ${version}${patched ? '; complexes marked "patched" come from the same source passing the transposed chain-score matrix' : ''}`,
  note: 'TM-scores are printed to 5 decimals, RMSD to 2 and identity to 3; tm lists the scores normalized by the first and by the second structure.',
  single,
  complexes,
});
