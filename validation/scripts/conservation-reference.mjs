// Writes validation/reference/conservation.json: the scores of Capra & Singh's
// score_conservation.py (Bioinformatics 2007) for the Pfam seed alignments in validation/data/,
// which web/lib/conservation.js must reproduce.
//
//   python3 validation/scripts/port-score-conservation.py /path/to/conservation_code
//   SCORE_CONSERVATION=/path/to/conservation_code node validation/scripts/conservation-reference.mjs
//
// The scorer (https://compbio.cs.princeton.edu/conservation/) is Python 2 code under the GPL and
// is not part of Proteoscope; the first command makes a Python 3 copy of it. The scorer reads
// FASTA, so the Stockholm files are converted here with a reader independent of Proteoscope's.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, writeReference } from '../common.mjs';

const ALIGNMENTS = ['PF00240.seed.sto', 'PF00870.seed.sto'];

// Option sets: Proteoscope's options and the scorer's arguments for the same analysis.
const OPTION_SETS = [
  { label: 'JSD, window 3 (defaults)', options: {}, args: [] },
  { label: 'JSD, no window', options: { window: 0 }, args: ['-w', '0'] },
  { label: 'JSD, unweighted sequences', options: { weighting: false }, args: ['-l', 'false'] },
  { label: 'JSD, no gap penalty', options: { gapPenalty: false }, args: ['-p', 'false'] },
  { label: 'JSD, gap cutoff 0.5, window 1, λ 0.25', options: { gapCutoff: 0.5, window: 1, windowLambda: 0.25 }, args: ['-g', '0.5', '-w', '1', '-b', '0.25'] },
  { label: 'Shannon entropy, window 3', options: { method: 'entropy' }, args: ['-s', 'shannon_entropy'] },
  { label: 'Shannon entropy, no window', options: { method: 'entropy', window: 0 }, args: ['-s', 'shannon_entropy', '-w', '0'] },
];

const folder = process.env.SCORE_CONSERVATION;
if (!folder) {
  console.error('Set SCORE_CONSERVATION to the folder of score_conservation_py3.py.');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'conservation-'));

// Rows of a non-interleaved Stockholm file, in order.
function stockholmRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('//')) break;
    if (!line.trim() || line.startsWith('#')) continue;
    const [name, sequence] = line.trim().split(/\s+/);
    rows.push({ name, sequence });
  }
  return rows;
}

const alignments = [];
for (const file of ALIGNMENTS) {
  const rows = stockholmRows(readFileSync(join(ROOT, 'data', file), 'utf8'));
  // The scorer reads B as D, Z as Q and X as a gap, and fails on U, O, J and '*' (Proteoscope reads
  // them as C, K, L and a gap), so those are mapped before it sees them.
  const fasta = join(work, 'alignment.fasta');
  writeFileSync(fasta, rows.map((row, index) => `>s${index}\n${row.sequence.toUpperCase().replace(/\./g, '-').replace(/U/g, 'C').replace(/O/g, 'K').replace(/J/g, 'L').replace(/\*/g, '-')}\n`).join(''));
  const sets = OPTION_SETS.map((set) => {
    const output = execFileSync('python3', ['score_conservation_py3.py', ...set.args, '-a', 's0', fasta], { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 26 });
    const columns = [];
    const scores = [];
    for (const line of output.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [column, , score] = line.split('\t');
      columns.push(Number(column));
      // -1000 marks columns with too many gaps to score.
      scores.push(Number(score) === -1000 ? null : Number(score));
    }
    return { label: set.label, options: set.options, args: set.args, columns, scores };
  });
  // The residues of the first sequence are the same columns whatever the options.
  const columns = sets[0].columns;
  if (sets.some((set) => set.columns.join() !== columns.join())) throw new Error(`${file}: the scored columns differ between option sets`);
  alignments.push({ file, query: rows[0].name, sequences: rows.length, columns, sets: sets.map(({ columns: _, ...set }) => set) });
  console.error(`${file}: ${rows.length} sequences, ${columns.length} query residues`);
}
rmSync(work, { recursive: true, force: true });

writeReference('conservation.json', {
  source: "score_conservation.py (Capra & Singh 2007) under Python 3, 12 decimals; scores per residue of each alignment's first sequence (-a), null where the column has too many gaps",
  alignments,
});
