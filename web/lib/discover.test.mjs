import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyQuery, coverageDepth, groupStructures, modelConfidence, modelRequest, shortMethod, sortStructures } from './discover.js';

const KRAS = 'MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHHYREQIKRVKDSEDVPMVLVGNKCDLPSRTVDTKQAQDLARSYGIPFIETSAKTRQGVDDAFYTLVREIRKHKEKMSKDGKKKKKKSKTKCVIM';

test('queries are told apart: accessions, PDB IDs, sequences and text', () => {
  assert.deepEqual(classifyQuery(' p01116 '), { kind: 'accession', value: 'P01116' });
  assert.deepEqual(classifyQuery('P04637-2'), { kind: 'accession', value: 'P04637-2' });
  assert.deepEqual(classifyQuery('AF-P04637-F1'), { kind: 'accession', value: 'P04637' });
  assert.deepEqual(classifyQuery('6oim'), { kind: 'pdb', value: '6OIM' });
  assert.deepEqual(classifyQuery('pdb_00006oim'), { kind: 'pdb', value: 'pdb_00006oim' });
  assert.equal(classifyQuery(KRAS).kind, 'sequence');
  assert.equal(classifyQuery(`>sp|P01116|RASK_HUMAN GTPase KRas\n${KRAS.slice(0, 60)}\n${KRAS.slice(60)}`).value, KRAS);
  assert.equal(classifyQuery('        1 mteyklvvvg agvgksaltiq liqnhfvdey dptiedsyrk qvvidge').kind, 'sequence');
  assert.equal(classifyQuery('>short\nMTEYKLVVVGAGGVGKSALT').kind, 'sequence', 'a FASTA header makes 20 residues enough');
  // A FASTA record pasted into a one-line field loses its line breaks.
  assert.equal(classifyQuery(`>sp|P01116|RASK_HUMAN GTPase KRas OS=Homo sapiens GN=KRAS ${KRAS}`).value, KRAS);
  assert.equal(classifyQuery(`>KRAS fragment ${KRAS.slice(0, 30)} ${KRAS.slice(30, 60)}`).value, KRAS.slice(0, 60));
  assert.equal(classifyQuery('>header only').kind, 'text');
  for (const text of ['KRAS', 'TP53', 'sotorasib', 'KRAS G12C inhibitor', 'hemoglobin', 'acetylcholinesterase inhibitor', 'MTEYKLVVVGAGGVGK', 'PD-1 PD-L1 checkpoint']) {
    assert.equal(classifyQuery(text).kind, 'text', text);
  }
  assert.equal(classifyQuery('   ').kind, 'empty');
});

test('PDBe chains group into entries in rank order, and sort by resolution, coverage or date', () => {
  const chains = [
    { pdb: '9r2q', chain: 'K', method: 'Electron Microscopy', resolution: 3.2, coverage: 1, unpStart: 1, unpEnd: 393 },
    { pdb: '1tup', chain: 'B', method: 'X-ray diffraction', resolution: 2.2, coverage: 0.557, unpStart: 94, unpEnd: 312 },
    { pdb: '9r2q', chain: 'L', method: 'Electron Microscopy', resolution: 3.2, coverage: 1, unpStart: 1, unpEnd: 393 },
    { pdb: '1tup', chain: 'A', method: 'X-ray diffraction', resolution: 2.2, coverage: 0.5, unpStart: 90, unpEnd: 300 },
    { pdb: '2ocj', chain: 'A', method: 'X-ray diffraction', resolution: 2.05, coverage: 0.5, unpStart: 94, unpEnd: 293 },
  ];
  const groups = groupStructures(chains, { '1TUP': { id: '1TUP', title: 'p53 core domain with DNA', released: '1995-07-11' }, '2OCJ': { released: '2007-01-30' } });
  assert.deepEqual(groups.map((group) => group.pdb), ['9R2Q', '1TUP', '2OCJ']);
  assert.deepEqual(groups[0].chains, ['K', 'L']);
  assert.deepEqual([groups[1].unpStart, groups[1].unpEnd, groups[1].coverage], [90, 312, 0.557]);
  assert.equal(groups[1].summary.title, 'p53 core domain with DNA');
  assert.deepEqual(sortStructures(groups, 'resolution').map((group) => group.pdb), ['2OCJ', '1TUP', '9R2Q']);
  assert.deepEqual(sortStructures(groups, 'coverage').map((group) => group.pdb), ['9R2Q', '1TUP', '2OCJ']);
  assert.deepEqual(sortStructures(groups, 'newest').map((group) => group.pdb), ['2OCJ', '1TUP', '9R2Q']);
  assert.deepEqual(sortStructures(groups, 'unknown').map((group) => group.pdb), ['9R2Q', '1TUP', '2OCJ']);
  const depth = coverageDepth(groups, 393);
  assert.equal(depth.length, 394);
  assert.deepEqual([depth[1], depth[89], depth[90], depth[94], depth[293], depth[300], depth[313], depth[393]], [1, 1, 2, 3, 3, 2, 1, 1]);
});

test('methods, confidences and model requests are described for the list', () => {
  assert.deepEqual(['X-ray diffraction', 'ELECTRON MICROSCOPY', 'SOLUTION NMR', 'NEUTRON DIFFRACTION', ''].map(shortMethod), ['X-ray', 'EM', 'NMR', 'Neutron', '']);
  assert.equal(modelConfidence({ provider: 'AlphaFold DB', confidence: 75.06 }), 'pLDDT 75.1');
  assert.equal(modelConfidence({ provider: 'SWISS-MODEL', confidenceType: 'QMEANDisCo', confidence: 0.739 }), 'QMEANDisCo 0.74');
  assert.equal(modelConfidence({ provider: 'AlphaFill' }), '');
  assert.deepEqual(modelRequest({ provider: 'AlphaFold DB', id: 'AF-P04637-F1', url: 'https://x/AF.cif' }, 'P04637'), { kind: 'fetch', id: 'P04637' });
  assert.deepEqual(modelRequest({ provider: 'AlphaFold DB', id: 'AF-0000000210539554', url: 'https://x/other.cif', fetchable: true }, 'P04637'), { kind: 'model', url: 'https://x/other.cif' });
  assert.equal(modelRequest({ provider: 'isoform.io', url: 'https://elsewhere/x.pdb', fetchable: false }, 'P04637'), null);
});

test('names that look like sequences stay text; FASTA takes its first record and rare residues', () => {
  assert.equal(classifyQuery('arginine methyltransferase').kind, 'text', 'words of different lengths');
  assert.equal(classifyQuery('histidine methyltransferase').kind, 'text');
  assert.equal(classifyQuery('MTEYKLVVVG AGGVGKSALT IQLIQNHFVD EYDPT').kind, 'sequence', 'blocks of ten, the last shorter');
  const heavy = 'EVQLVESGGGLVQPGGSLRLSCAASGFTFS';
  const light = 'DIQMTQSPSSLSASVGDRVTITCRASQDVN';
  assert.equal(classifyQuery(`>heavy\n${heavy}\n>light\n${light}`).value, heavy, 'only the first record');
  const selenoprotein = 'MCAARLAAAAAAAQSVYAFSARPLAGGEPVSLGSLRGKVLLIENVASLUGTTVRDYTQ';
  assert.deepEqual(classifyQuery(`>GPX1\n${selenoprotein}`), { kind: 'sequence', value: selenoprotein });
});
