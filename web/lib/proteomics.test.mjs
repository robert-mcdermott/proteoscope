import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CROSSLINKERS,
  ENZYMES,
  MODIFICATIONS,
  digest,
  formatFormula,
  isoelectricPoint,
  mapPeptides,
  mz,
  netCharge,
  parseCrosslinks,
  parsePeptideNotation,
  parsePeptides,
  parseResidueData,
  parseSites,
  peptideMass,
  sequenceProperties,
} from './proteomics.js';

const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';

function modificationSummary(modifications) {
  return modifications.map(({ position, label }) => `${position}:${label}`);
}

test('sequenceProperties reproduces ExPASy ProtParam for human ubiquitin', () => {
  const properties = sequenceProperties(UBIQUITIN);
  assert.equal(properties.length, 76);
  assert.equal(properties.averageMass.toFixed(2), '8564.84');
  assert.equal(properties.monoisotopicMass.toFixed(4), '8559.6167');
  assert.equal(properties.isoelectricPoint.toFixed(2), '6.56');
  assert.deepEqual(properties.extinction, { cystines: 1490, reduced: 1490 });
  assert.equal(properties.absorbance01.cystines.toFixed(3), '0.174');
  assert.equal(properties.absorbance01.reduced.toFixed(3), '0.174');
  assert.equal(properties.instabilityIndex.toFixed(2), '36.06');
  assert.equal(properties.stable, true);
  assert.equal(properties.aliphaticIndex.toFixed(2), '100.00');
  assert.equal(properties.gravy.toFixed(3), '-0.489');
  assert.equal(formatFormula(properties.formula), 'C378H629N105O118S1');
  assert.equal(properties.composition.L, 9);
  assert.equal(properties.composition.W, 0);
  assert.equal(properties.aromaticity.toFixed(4), (3 / 76).toFixed(4));
  assert.ok(properties.netChargeAtPH7 < 0 && properties.netChargeAtPH7 > -2);
  assert.deepEqual(properties.warnings, ['No Trp: extinction coefficient may have >10% error']);
});

test('sequenceProperties accepts lowercase, whitespace, digits and FASTA headers', () => {
  const messy = `>sp|P0CG48|UBC_HUMAN\n${UBIQUITIN.toLowerCase().replace(/(.{10})/g, '$1 12\n')}`;
  const properties = sequenceProperties(messy);
  assert.equal(properties.length, 76);
  assert.equal(properties.averageMass.toFixed(2), '8564.84');
});

test('cystine extinction adds 125 per Cys pair and absorbance is epsilon over MW', () => {
  for (const [sequence, cysteines] of [['MCWCYCACK', 4], ['MCWCYCAK', 3], ['MCWYK', 1]]) {
    const properties = sequenceProperties(sequence);
    assert.equal(properties.extinction.reduced, 5500 + 1490);
    assert.equal(properties.extinction.cystines - properties.extinction.reduced, 125 * Math.floor(cysteines / 2));
    assert.equal(properties.absorbance01.cystines, properties.extinction.cystines / properties.averageMass);
    assert.deepEqual(properties.warnings, []);
  }
  assert.deepEqual(sequenceProperties('GASPGASP').warnings, ['No Trp, Tyr or Cys: protein is not visible at 280 nm']);
});

test('isoelectric point and net charge follow the Bjellqvist pK set', () => {
  assert.ok(isoelectricPoint('DDDDDDDDDD') < 4);
  assert.ok(isoelectricPoint('KKKKKKKKKK') > 10);
  assert.ok(netCharge('DDDDDDDDDD', 7) < -9);
  assert.ok(netCharge('KKKKKKKKKK', 7) > 8);
  const pI = isoelectricPoint(UBIQUITIN);
  assert.ok(Math.abs(netCharge(UBIQUITIN, pI)) < 1e-3);
  assert.equal(isoelectricPoint(''), null);
});

test('ambiguous residues are excluded from mass with warnings while U and O have masses', () => {
  const withAmbiguous = sequenceProperties('ACDBZXK');
  assert.equal(withAmbiguous.averageMass, sequenceProperties('ACDK').averageMass);
  assert.equal(withAmbiguous.length, 7);
  for (const code of ['B', 'Z', 'X']) {
    assert.ok(withAmbiguous.warnings.some((warning) => warning.startsWith(`Contains 1 ${code} residue`)));
  }
  const selenocysteine = sequenceProperties('GUG');
  assert.equal(selenocysteine.monoisotopicMass.toFixed(6), (2 * 57.021464 + 150.953636 + 18.010565).toFixed(6));
  assert.equal(selenocysteine.formula.Se, 1);
  assert.equal(sequenceProperties('GOG').averageMass.toFixed(4), (2 * 57.0519 + 237.3018 + 18.01524).toFixed(4));
});

test('peptideMass and mz use monoisotopic residues, modifications and the proton mass', () => {
  assert.equal(peptideMass('PEPTIDE').toFixed(4), '799.3600');
  assert.equal(peptideMass('peptide', { monoisotopic: false }).toFixed(2), '799.83');
  assert.equal(peptideMass('PEPT[Phospho]IDE').toFixed(4), (799.359965 + 79.966331).toFixed(4));
  assert.equal(peptideMass('PEPTIDE', { modifications: [{ label: 'Phospho' }] }).toFixed(4), '879.3263');
  assert.equal(peptideMass('PEPTIDE', { modifications: [79.966331] }).toFixed(4), '879.3263');
  assert.equal(peptideMass('PEPTIDE', { monoisotopic: false, modifications: [{ unimod: 21 }] }).toFixed(2), '879.81');
  assert.ok(Number.isNaN(peptideMass('PEPXIDE')));
  assert.equal(mz(799.359965, 1).toFixed(4), '800.3672');
  assert.equal(mz(799.359965, 2).toFixed(4), '400.6873');
  assert.equal(mz(799.359965, -1).toFixed(4), '798.3527');
});

test('parsePeptideNotation understands the common search-engine notations', () => {
  const cases = [
    ['_(Acetyl (Protein N-term))M(Oxidation (M))PEPS(Phospho (STY))IDEK_', 'MPEPSIDEK', ['-1:Acetyl', '0:Oxidation', '4:Phospho']],
    ['_PEPS(ph)IDEM(ox)K_', 'PEPSIDEMK', ['3:Phospho', '7:Oxidation']],
    ['_(ac)PEPTIDEK_', 'PEPTIDEK', ['-1:Acetyl']],
    ['_PEPS[Phospho (STY)]IDEK_.2', 'PEPSIDEK', ['3:Phospho']],
    ['(UniMod:1)PEPS(UniMod:21)IDEM(UniMod:35)K', 'PEPSIDEMK', ['-1:Acetyl', '3:Phospho', '7:Oxidation']],
    ['PEPS[Phospho]IDEK', 'PEPSIDEK', ['3:Phospho']],
    ['PEPS[+79.966]IDEK', 'PEPSIDEK', ['3:Phospho']],
    ['PEPS[UNIMOD:21]IDEK/2', 'PEPSIDEK', ['3:Phospho']],
    ['[Acetyl]-PEPTIDEK', 'PEPTIDEK', ['-1:Acetyl']],
    ['PEPTIDEK-[Amidated]', 'PEPTIDEK', ['8:Amidated']],
    ['EM[U:Oxidation]EVEES[Phospho#g1]PEK', 'EMEVEESPEK', ['1:Oxidation', '6:Phospho']],
    ['K.PEPS[79.9663]IDEK.R', 'PEPSIDEK', ['3:Phospho']],
    ['-.C[57.0215]PEPTIDEK.A', 'CPEPTIDEK', ['0:Carbamidomethyl']],
    ['n[43]PEPM[147]TIDEK', 'PEPMTIDEK', ['-1:Acetyl', '3:Oxidation']],
    ['C[160]PEPS[167]K[242]', 'CPEPSK', ['0:Carbamidomethyl', '4:Phospho', '5:GlyGly']],
    ['M[147.0354]PEPTIDEK', 'MPEPTIDEK', ['0:Oxidation']],
    ['K.PEPS*IDEM#K@.R', 'PEPSIDEMK', ['3:mod*', '7:mod#', '8:mod@']],
    ['PEPsIDEmK', 'PEPSIDEMK', ['3:lowercase', '7:lowercase']],
    ['peptidek', 'PEPTIDEK', []],
    ['PEPK[+8.0142]', 'PEPK', ['3:+8.0142']],
    ['AGGK(GlyGly (K))DEK2', 'AGGKDEK', ['3:GlyGly']],
    ['PEPTIDEK(Amidated (Protein C-term))', 'PEPTIDEK', ['8:Amidated']],
  ];
  for (const [input, sequence, modifications] of cases) {
    const parsed = parsePeptideNotation(input);
    assert.ok(parsed, input);
    assert.equal(parsed.sequence, sequence, input);
    assert.deepEqual(modificationSummary(parsed.modifications), modifications, input);
  }
});

test('peptide modifications carry UniMod ids and mass deltas', () => {
  const [acetyl, oxidation, phospho] = parsePeptideNotation('n[43]PEPM[147]S[+79.97]K').modifications;
  assert.deepEqual(acetyl, { position: -1, label: 'Acetyl', unimod: 1, massDelta: 42.010565 });
  assert.equal(oxidation.unimod, 35);
  assert.equal(phospho.massDelta, 79.966331);
  const unknown = parsePeptideNotation('PEPK[136]').modifications[0];
  assert.equal(unknown.label, '+7.905');
  assert.equal(unknown.unimod, undefined);
  assert.equal(parsePeptideNotation('PEPS(UniMod:999)K').modifications[0].label, 'UniMod:999');
  assert.equal(parsePeptideNotation('PEPTMDK[TMTpro]').modifications[0].massDelta, 304.207146);
  for (const [label, unimod] of [['Methyl', 34], ['Dimethyl', 36], ['Trimethyl', 37], ['Deamidated', 7], ['TMT6plex', 737]]) {
    const entry = MODIFICATIONS.find((modification) => modification.label === label);
    assert.equal(entry.unimod, unimod);
    assert.equal(parsePeptideNotation(`PEPK[+${entry.monoisotopic.toFixed(3)}]`).modifications[0].label, label);
  }
});

test('non-peptide text is rejected', () => {
  for (const text of ['Sequence', 'Intensity', 'P04637', 'HLA-A', 'PEP TIDE', '12345', '', 'PEP(Phospho']) {
    assert.equal(parsePeptideNotation(text), null, text);
  }
});

test('parsePeptides reads lists and tables, skipping comments and headers', () => {
  const peptides = parsePeptides([
    '# exported peptides',
    'Sequence\tProteins\tIntensity',
    'AAAPEPTIDEK\tP12345\t1000',
    'LLGGK\tP12345\t',
    'NA\tP99999\t50',
  ].join('\n'));
  assert.deepEqual(peptides.map(({ sequence, value, count }) => [sequence, value, count]), [
    ['AAAPEPTIDEK', 1000, 1],
    ['LLGGK', null, 1],
  ]);
  assert.equal(peptides[0].raw, 'AAAPEPTIDEK');

  const list = parsePeptides('PEPTIDEK 12.5\nK.VLSPADKTNVK.A,3\nIGGAPK;1,5\nQIFVK');
  assert.deepEqual(list.map(({ sequence, value }) => [sequence, value]), [
    ['PEPTIDEK', 12.5],
    ['VLSPADKTNVK', 3],
    ['IGGAPK', 1.5],
    ['QIFVK', null],
  ]);

  const headed = parsePeptides('Gene,Peptide,Charge,Score\nKRAS,LVVVGAGGVGK,2,88\nTP53,MEEPQSDPSVEPPLSQETFSDLWK,3,40');
  assert.deepEqual(headed.map(({ sequence, value }) => [sequence, value]), [['LVVVGAGGVGK', 2], ['MEEPQSDPSVEPPLSQETFSDLWK', 3]]);
});

test('parsePeptides prefers modified-sequence and intensity columns from known headers', () => {
  const maxquant = parsePeptides([
    'Sequence\tLength\tModified sequence\tCharge\tPEP\tIntensity',
    'AAAPEPTIDEK\t11\t_AAAPEPT(Phospho (STY))IDEK_\t2\t0.001\t1.5E6',
    'AAAPEPTIDEK\t11\t_AAAPEPTIDEK_\t3\t0.01\t2.5E6',
  ].join('\n'));
  assert.equal(maxquant.length, 1);
  assert.equal(maxquant[0].value, 2e6);
  assert.deepEqual(modificationSummary(maxquant[0].modifications), ['6:Phospho']);

  const diann = parsePeptides([
    'Protein.Group\tPG.Quantity\tModified.Sequence\tStripped.Sequence\tPrecursor.Charge\tRT\tiRT\tPrecursor.Quantity',
    'P1\t9e9\tAAS(UniMod:21)PEPTIDEK\tAASPEPTIDEK\t2\t35.2\t12.1\t4e5',
  ].join('\n'));
  assert.deepEqual(diann.map(({ sequence, value }) => [sequence, value]), [['AASPEPTIDEK', 4e5]]);
  assert.deepEqual(modificationSummary(diann[0].modifications), ['2:Phospho']);
});

test('parsePeptides aggregates duplicates by stripped sequence', () => {
  const peptides = parsePeptides([
    '_PEPS(Phospho (STY))IDEK_\t100',
    'PEPSIDEK\t300',
    'PEPSIDEM(ox)K\t5',
    '_(Acetyl (Protein N-term))PEPSIDEK_\t',
    'PEPS[Phospho]IDEK\t200',
  ].join('\n'));
  assert.equal(peptides.length, 2);
  const [first, second] = peptides;
  assert.equal(first.sequence, 'PEPSIDEK');
  assert.equal(first.count, 4);
  assert.equal(first.value, 200);
  assert.deepEqual(modificationSummary(first.modifications), ['-1:Acetyl', '3:Phospho']);
  assert.equal(first.raw, '_PEPS(Phospho (STY))IDEK_');
  assert.equal(second.sequence, 'PEPSIDEMK');
  assert.equal(second.value, 5);
});

test('mapPeptides maps every occurrence in every chain with I/L equivalence', () => {
  const chainSequence = 'MKLLGGKAAIIGGKPEPSIDEKLLGGKCAR';
  const peptides = parsePeptides('LIGGK\t10\nPEPS(ph)IDEK\t2\nCAR\t4\nWWWWWK\t1\nAAIIGGK');
  const result = mapPeptides(peptides, [
    { id: 'A', sequence: chainSequence },
    { id: 'B', sequence: chainSequence },
    { id: 'C', sequence: 'GGGGG' },
  ]);

  const [chainA, chainB, chainC] = result.chains;
  assert.equal(chainA.id, 'A');
  assert.deepEqual(chainA.matches.filter((match) => match.peptide === 0), [
    { peptide: 0, start: 2, end: 6 },
    { peptide: 0, start: 9, end: 13 },
    { peptide: 0, start: 22, end: 26 },
  ]);
  assert.deepEqual(chainB.matches, chainA.matches);
  assert.equal(chainA.coverage[7], 1);
  assert.equal(chainA.coverage[9], 2);
  assert.equal(chainA.coverage[0], 0);
  assert.equal(chainA.values[2], 10);
  assert.equal(chainA.values[10], 10);
  assert.ok(Number.isNaN(chainA.values[0]));
  assert.ok(Number.isNaN(chainA.values[7]));
  assert.equal(chainA.coveredCount, 28);
  assert.equal(chainA.coverageFraction, 28 / 30);
  assert.equal(chainC.coveredCount, 0);
  assert.equal(chainC.coverageFraction, 0);
  assert.deepEqual(result.unmatched, [3]);
  assert.deepEqual(
    result.modifiedSites.map(({ chainId, position, residue, label, peptide }) => [chainId, position, residue, label, peptide]),
    [['A', 17, 'S', 'Phospho', 1], ['B', 17, 'S', 'Phospho', 1]],
  );
  assert.ok(chainA.coverage instanceof Uint16Array);
  assert.ok(chainA.values instanceof Float32Array);

  const strict = mapPeptides(peptides, [{ id: 'A', sequence: chainSequence }], { ilEquivalent: false });
  assert.deepEqual(strict.chains[0].matches.filter((match) => match.peptide === 0), []);
  assert.deepEqual(strict.unmatched, [0, 3]);
});

test('mapPeptides handles initiator Met removal, fixed modifications and plain strings', () => {
  const chains = [{ id: 'A', sequence: 'MQIFVKTLTGK' }, { id: 'B', sequence: 'QIFVKTLTGK' }];
  const result = mapPeptides(['QIFVK', 'MQIFVK'], chains);
  assert.deepEqual(result.chains[0].matches, [{ peptide: 1, start: 0, end: 5 }, { peptide: 0, start: 1, end: 5 }]);
  assert.deepEqual(result.chains[1].matches, [{ peptide: 0, start: 0, end: 4 }, { peptide: 1, start: 0, end: 4 }]);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(mapPeptides(['MQIFVK'], [chains[1]], { allowInitiatorMetLoss: false }).unmatched, [0]);

  const labelled = parsePeptides('TLC[Carbamidomethyl]GK[GlyGly]');
  const chain = [{ id: 'X', sequence: 'AATLCGKAA' }];
  assert.deepEqual(mapPeptides(labelled, chain).modifiedSites.map(({ position, label }) => [position, label]), [[6, 'GlyGly']]);
  assert.deepEqual(
    mapPeptides(labelled, chain, { ignoreModifications: [] }).modifiedSites.map(({ position, label }) => [position, label]),
    [[4, 'Carbamidomethyl'], [6, 'GlyGly']],
  );

  const terminal = mapPeptides(parsePeptides('_(Acetyl (Protein N-term))TLCGK_'), chain).modifiedSites;
  assert.deepEqual(terminal.map(({ position, residue, label, terminal: end }) => [position, residue, label, end]), [[2, 'T', 'Acetyl', 'N']]);
});

test('parseSites understands variant and PTM site notations', () => {
  const cases = [
    ['R175H', null, 'R', 175, 'H', null, 'R175H'],
    ['p.R175H', null, 'R', 175, 'H', null, 'R175H'],
    ['p.Arg175His', null, 'R', 175, 'H', null, 'R175H'],
    ['Arg175His', null, 'R', 175, 'H', null, 'R175H'],
    ['ARG175HIS', null, 'R', 175, 'H', null, 'R175H'],
    ['p.(Arg175His)', null, 'R', 175, 'H', null, 'R175H'],
    ['R175*', null, 'R', 175, '*', null, 'R175*'],
    ['p.Arg175Ter', null, 'R', 175, '*', null, 'R175*'],
    ['R175fs', null, 'R', 175, 'fs', null, 'R175fs'],
    ['p.R175Hfs*12', null, 'R', 175, 'fs', null, 'R175fs'],
    ['S15', null, 'S', 15, null, null, 'S15'],
    ['Ser15', null, 'S', 15, null, null, 'S15'],
    ['S15ph', null, 'S', 15, null, 'Phospho', 'pS15'],
    ['S15-p', null, 'S', 15, null, 'Phospho', 'pS15'],
    ['pS15', null, 'S', 15, null, 'Phospho', 'pS15'],
    ['pSer15', null, 'S', 15, null, 'Phospho', 'pS15'],
    ['phospho-S15', null, 'S', 15, null, 'Phospho', 'pS15'],
    ['K120ac', null, 'K', 120, null, 'Acetyl', 'K120ac'],
    ['acK120', null, 'K', 120, null, 'Acetyl', 'K120ac'],
    ['K9me3', null, 'K', 9, null, 'Methyl', 'K9me3'],
    ['K48ub', null, 'K', 48, null, 'Ubiquitin', 'K48ub'],
    ['A:R175H', 'A', 'R', 175, 'H', null, 'R175H'],
    ['A/R175H', 'A', 'R', 175, 'H', null, 'R175H'],
    ['A_R175H', 'A', 'R', 175, 'H', null, 'R175H'],
    ['chain A R175H', 'A', 'R', 175, 'H', null, 'R175H'],
    ['A:175', 'A', null, 175, null, null, '175'],
    ['175', null, null, 175, null, null, '175'],
  ];
  for (const [input, chain, wt, position, mutant, modification, label] of cases) {
    const sites = parseSites(input);
    assert.equal(sites.length, 1, input);
    assert.deepEqual(
      sites[0],
      { raw: input, chain, wt, position, mutant, modification, label, value: null },
      input,
    );
  }
});

test('parseSites splits lists and attaches values from the same line', () => {
  const sites = parseSites([
    '# hotspots',
    'R175H, R248Q; R273H',
    'site\tvalue',
    'G245S\t0.83',
    'Y220C,2',
    'R249S 1.5e2 R282W -1',
    '175\t3',
    '248, 249, 273',
    'K382ac\t7',
  ].join('\n'));
  assert.deepEqual(sites.map(({ label, value }) => [label, value]), [
    ['R175H', null],
    ['R248Q', null],
    ['R273H', null],
    ['G245S', 0.83],
    ['Y220C', 2],
    ['R249S', 150],
    ['R282W', -1],
    ['175', 3],
    ['248', null],
    ['249', null],
    ['273', null],
    ['K382ac', 7],
  ]);
  assert.deepEqual(parseSites('TP53 p53 H3K4me3 hello'), []);
});

test('parseCrosslinks reads free-text link notations', () => {
  const cases = [
    ['A:K123-B:K45', 'A', 123, 'B', 45, 'K', 'K'],
    ['A:123-B:45', 'A', 123, 'B', 45, undefined, undefined],
    ['K123-K45', null, 123, null, 45, 'K', 'K'],
    ['123-45', null, 123, null, 45, undefined, undefined],
    ['A 123 B 45', 'A', 123, 'B', 45, undefined, undefined],
    ['A:123 B:45', 'A', 123, 'B', 45, undefined, undefined],
    ['ProtA(123)-ProtB(45)', 'ProtA', 123, 'ProtB', 45, undefined, undefined],
    ['ProtA_123-ProtB_45', 'ProtA', 123, 'ProtB', 45, undefined, undefined],
    ['ProtA:123:ProtB:45', 'ProtA', 123, 'ProtB', 45, undefined, undefined],
    ['sp|P02769|ALBU_BOVIN(123)-sp|P02769|ALBU_BOVIN(456)', 'sp|P02769|ALBU_BOVIN', 123, 'sp|P02769|ALBU_BOVIN', 456, undefined, undefined],
    ['Q9Y6K9-2(12)-HLA-A(34)', 'Q9Y6K9-2', 12, 'HLA-A', 34, undefined, undefined],
    ['123|A|45|B', 'A', 123, 'B', 45, undefined, undefined],
  ];
  for (const [input, proteinA, residueA, proteinB, residueB, aminoA, aminoB] of cases) {
    const { links, skipped } = parseCrosslinks(input);
    assert.equal(skipped, 0, input);
    assert.equal(links.length, 1, input);
    const [link] = links;
    assert.deepEqual(
      [link.proteinA, link.residueA, link.proteinB, link.residueB, link.aminoA, link.aminoB, link.score],
      [proteinA, residueA, proteinB, residueB, aminoA, aminoB, null],
      input,
    );
  }

  const scored = parseCrosslinks('A:K123-B:K45\t12.5\nA 1 B 2 0.9\nA,3,B,4,0.5\nA:K5-B:K6; A:K7-A:K8');
  assert.deepEqual(scored.links.map(({ residueA, residueB, score }) => [residueA, residueB, score]), [
    [123, 45, 12.5],
    [1, 2, 0.9],
    [3, 4, 0.5],
    [5, 6, null],
    [7, 8, null],
  ]);
});

test('parseCrosslinks skips and counts monolinks', () => {
  const { links, skipped } = parseCrosslinks('Crosslinks\nA:K123-B:K45\nA:K123\nK77-\nProtA(12)-\n# comment');
  assert.equal(links.length, 1);
  assert.equal(skipped, 3);
});

test('parseCrosslinks reads CSV and TSV tables with flexible headers', () => {
  const csv = parseCrosslinks('Protein1,Protein2,Residue1,Residue2,Score\nA,B,123,45,10.5\nA,,12,,3\nA,A,K12,K88,');
  assert.deepEqual(csv.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB, link.aminoA, link.score]), [
    ['A', 123, 'B', 45, undefined, 10.5],
    ['A', 12, 'A', 88, 'K', null],
  ]);
  assert.equal(csv.skipped, 1);

  const tsv = parseCrosslinks('Protein A\tProtein B\tAbsPos1\tAbsPos2\tld-Score\nP1\tP2\t10\t20\t33');
  assert.deepEqual(tsv.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB, link.score]), [['P1', 10, 'P2', 20, 33]]);

  const chains = parseCrosslinks('chain1;chain2;position1;position2\nA;B;5;6');
  assert.deepEqual(chains.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB]), [['A', 5, 'B', 6]]);

  const absolute = parseCrosslinks('LinkPos1\tLinkPos2\tProtein1\tProtein2\n11\t22\tQ\tR');
  assert.deepEqual(absolute.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB]), [['Q', 11, 'R', 22]]);

  const xinet = parseCrosslinks('Protein1,PepPos1,PepSeq1,LinkPos1,Protein2,PepPos2,PepSeq2,LinkPos2,Score\nP1,100,PEPKTIDE,4,P2,200,KPEP,1,5');
  assert.deepEqual(xinet.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB, link.score]), [['P1', 103, 'P2', 200, 5]]);

  const xifdr = parseCrosslinks('Protein1 Protein2 fromSite ToSite\nX Y 7 8');
  assert.deepEqual(xifdr.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB]), [['X', 7, 'Y', 8]]);
});

test('parseResidueData reads free-form rows and header tables', () => {
  const free = parseResidueData([
    'A,123,0.5',
    'A:124 0.6',
    'A:125A 0.7',
    '126\t0.8',
    'B 127 0.9',
    'R175 1.5',
    'A -5 2',
    'A:128 NaN',
    'garbage 12',
  ].join('\n'));
  assert.equal(free.name, 'Custom data');
  assert.deepEqual(free.rows, [
    { chain: 'A', resSeq: 123, iCode: '', value: 0.5 },
    { chain: 'A', resSeq: 124, iCode: '', value: 0.6 },
    { chain: 'A', resSeq: 125, iCode: 'A', value: 0.7 },
    { chain: null, resSeq: 126, iCode: '', value: 0.8 },
    { chain: 'B', resSeq: 127, iCode: '', value: 0.9 },
    { chain: null, resSeq: 175, iCode: '', value: 1.5 },
    { chain: 'A', resSeq: -5, iCode: '', value: 2 },
  ]);
  assert.equal(free.skipped, 2);

  const reordered = parseResidueData('Score\tResSeq\tChain\n0.5\t10\tA\n0.7\t11A\tB');
  assert.equal(reordered.name, 'Score');
  assert.deepEqual(reordered.rows, [
    { chain: 'A', resSeq: 10, iCode: '', value: 0.5 },
    { chain: 'B', resSeq: 11, iCode: 'A', value: 0.7 },
  ]);

  const named = parseResidueData('chain,resi,resn,conservation\nA,5,ALA,0.88');
  assert.equal(named.name, 'conservation');
  assert.deepEqual(named.rows, [{ chain: 'A', resSeq: 5, iCode: '', value: 0.88 }]);

  assert.deepEqual(parseResidueData('position;value\n12;1,5').rows, [{ chain: null, resSeq: 12, iCode: '', value: 1.5 }]);
  assert.equal(parseResidueData('Hydrophobicity\nA 12 0.5').name, 'Hydrophobicity');
});

test('digest applies enzyme rules, missed cleavages and length limits', () => {
  const sequence = 'AAAKPAAAKAAAAARAAAAAK';
  assert.deepEqual(digest(sequence, 'trypsin', { minLength: 1 }), [
    { start: 0, end: 8, sequence: 'AAAKPAAAK', missed: 0 },
    { start: 9, end: 14, sequence: 'AAAAAR', missed: 0 },
    { start: 15, end: 20, sequence: 'AAAAAK', missed: 0 },
  ]);
  assert.deepEqual(digest(sequence, 'trypsin-p', { minLength: 1 }).map((peptide) => peptide.sequence), ['AAAK', 'PAAAK', 'AAAAAR', 'AAAAAK']);
  assert.deepEqual(
    digest(sequence, 'trypsin', { missedCleavages: 1, minLength: 1 }).map(({ sequence: peptide, missed }) => `${peptide}:${missed}`),
    ['AAAKPAAAK:0', 'AAAKPAAAKAAAAAR:1', 'AAAAAR:0', 'AAAAARAAAAAK:1', 'AAAAAK:0'],
  );
  assert.deepEqual(digest(sequence).map((peptide) => peptide.sequence), ['AAAKPAAAK', 'AAAAAR', 'AAAAAK']);
  assert.deepEqual(digest(sequence, 'trypsin', { minLength: 7, maxLength: 9 }).map((peptide) => peptide.sequence), ['AAAKPAAAK']);

  const probe = 'AKADAEAFPAWARAK';
  const expected = {
    lysc: ['AK', 'ADAEAFPAWARAK'],
    lysn: ['A', 'KADAEAFPAWARA', 'K'],
    gluc: ['AKADAE', 'AFPAWARAK'],
    aspn: ['AKA', 'DAEAFPAWARAK'],
    chymotrypsin: ['AKADAEAFPAW', 'ARAK'],
    argc: ['AKADAEAFPAWAR', 'AK'],
  };
  for (const [enzyme, peptides] of Object.entries(expected)) {
    assert.deepEqual(digest(probe, enzyme, { minLength: 1 }).map((peptide) => peptide.sequence), peptides, enzyme);
  }
  assert.throws(() => digest(probe, 'pepsin'), /Unknown enzyme/);
  assert.deepEqual(ENZYMES.map((enzyme) => enzyme.id), ['trypsin', 'trypsin-p', 'lysc', 'lysn', 'gluc', 'aspn', 'chymotrypsin', 'argc']);
});

test('crosslinker presets carry the documented distance limits', () => {
  const byId = Object.fromEntries(CROSSLINKERS.map((linker) => [linker.id, linker]));
  assert.deepEqual([byId.dss.spacer, byId.dss.maxCaCa], [11.4, 30]);
  assert.deepEqual([byId.dsso.spacer, byId.dsso.maxCaCa], [10.1, 30]);
  assert.deepEqual([byId.dsbu.spacer, byId.dsbu.maxCaCa], [12.5, 30]);
  assert.deepEqual([byId.bs2g.spacer, byId.bs2g.maxCaCa], [7.7, 25]);
  assert.deepEqual([byId.edc.spacer, byId.edc.maxCaCa], [0, 20]);
  assert.deepEqual([byId.phox.spacer, byId.phox.maxCaCa], [5, 20]);
  assert.deepEqual([byId.sda.spacer, byId.sda.maxCaCa], [3.9, 25]);
  assert.ok(byId.custom);
  for (const linker of CROSSLINKERS) assert.ok(linker.label && linker.note, linker.id);
});
