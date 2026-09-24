import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  accessionOf,
  braceProbabilities,
  createFeatureCollector,
  peptideFeatureKey,
  bracketProbabilities,
  detectReport,
  modificationLabel,
  mzTabModifications,
  parenthesizedProbabilities,
  ptmRSProbabilities,
  quantValue,
  readReport,
  splitCells,
  splitRow,
  summarizeReport,
  toNumber,
} from './reports.js';

const TESTDATA = new URL('./testdata/', import.meta.url);

function blob(text, name) {
  const file = new Blob([text]);
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

const table = (header, rows, delimiter = '\t') => [header.join(delimiter), ...rows.map((row) => row.join(delimiter))].join('\n');

test('localization strings of each search engine are read per residue', () => {
  assert.deepEqual([...parenthesizedProbabilities('GLGPSPAGDGPS(0.327)GS(0.673)GK')], [[11, 0.327], [13, 0.673]]);
  assert.deepEqual([...braceProbabilities('AAAS(UniMod:21){0.789000}PPT{0.211000}PIR2')], [[3, 0.789], [6, 0.211]]);
  assert.deepEqual([...braceProbabilities('(UniMod:1){1.000000}M{0.000000}APG2')], [[-1, 1], [0, 0]]);
  assert.deepEqual(bracketProbabilities('_MLIS[Phospho (STY): 0.4%]AVS[Phospho (STY): 99.6%]PEIR_').get(6), { Phospho: 0.996 });
  assert.deepEqual(ptmRSProbabilities('T7(Phospho): 100; Y9(Phospho): 99.48').get(8), { label: 'Phospho', probability: 0.9948 });
  assert.deepEqual(mzTabModifications('3[MS,MS:1001876, modification probability, 0.8]|4[MS,MS:1001876, modification probability, 0.2]-UNIMOD:21,8-UNIMOD:4', 10), [
    { position: 2, label: 'Phospho', probability: 0.8 },
    { position: 7, label: 'Carbamidomethyl', probability: NaN },
  ]);
  assert.deepEqual(mzTabModifications('9[MS, MS:1002380, false localization rate, 0.1]-UNIMOD:21, 0-UNIMOD:214', 12).map((mod) => [mod.position, mod.label, Number(mod.probability.toFixed(2))]), [[8, 'Phospho', 0.9], [-1, 'UniMod:214', NaN]]);
  assert.deepEqual(['Phospho (STY)', 'UniMod:21', '79.9663', 'GlyGly (K)', 'Oxidation (M)', 'Acetyl (Protein N-term)'].map(modificationLabel), ['Phospho', 'Phospho', 'Phospho', 'GlyGly', 'Oxidation', 'Acetyl']);
  assert.deepEqual(['sp|P04637|P53_HUMAN', 'rev_sp|P04637|P53_HUMAN', 'P04637', 'contam_sp|P02768|ALBU_HUMAN'].map(accessionOf), ['P04637', 'REV__P04637', 'P04637', 'CON__P02768']);
  assert.deepEqual(splitRow('"a, b",c,"say ""hi"""', ','), ['a, b', 'c', 'say "hi"']);
});

test('formats are recognized from their header columns', () => {
  const cases = {
    'maxquant-evidence': ['Sequence', 'Modified sequence', 'Proteins', 'Raw file', 'Experiment', 'Intensity'],
    'maxquant-peptides': ['Sequence', 'Proteins', 'Start position', 'Intensity SampleA'],
    'maxquant-sites': ['Proteins', 'Positions within proteins', 'Localization prob', 'Amino acid'],
    diann: ['Run', 'Protein.Group', 'Stripped.Sequence', 'Modified.Sequence', 'Q.Value'],
    'diann-sites': ['Protein', 'Protein.Names', 'Gene.Names', 'Residue', 'Site', 'Sequence', 'run1.d'],
    spectronaut: ['R.FileName', 'PG.ProteinGroups', 'PEP.StrippedSequence', 'EG.ModifiedSequence', 'FG.Quantity'],
    'spectronaut-sites': ['R.FileName', 'PTM.ProteinId', 'PTM.SiteLocation', 'PTM.SiteAA', 'PTM.CollapseKey'],
    'fragpipe-psm': ['Spectrum', 'Spectrum File', 'Peptide', 'Modified Peptide', 'Assigned Modifications', 'Protein ID'],
    'fragpipe-peptides': ['Peptide Sequence', 'Protein ID', 'Gene', 'A Intensity', 'B Intensity'],
    'fragpipe-sites': ['Index', 'Gene', 'Protein ID', 'Peptide', 'Best Localization Probability'],
    'pd-peptides': ['Annotated Sequence', 'Modifications', 'Master Protein Accessions', 'Abundance: F1: Sample'],
  };
  for (const [format, header] of Object.entries(cases)) assert.equal(detectReport(header), format, format);
  assert.equal(detectReport(['chain', 'residue', 'value']), null);
});

test('MaxQuant evidence: rows of the structure protein, sites with their localization', async () => {
  const header = ['Sequence', 'Modifications', 'Modified sequence', 'Phospho (STY) Probabilities', 'Proteins', 'Gene names', 'Raw file', 'Experiment', 'Charge', 'PEP', 'Intensity', 'Reverse', 'Potential contaminant'];
  const text = table(header, [
    ['MEEPQSDPSVEPPLSQETFSDLWK', 'Phospho (STY)', '_MEEPQSDPSVEPPLS(Phospho (STY))QETFSDLWK_', 'MEEPQSDPSVEPPLS(0.95)QET(0.05)FSDLWK', 'P04637', 'TP53', 'r1', 'ctrl', '3', '0.001', '100000', '', ''],
    ['MEEPQSDPSVEPPLSQETFSDLWK', 'Phospho (STY)', '_MEEPQSDPSVEPPLS(Phospho (STY))QETFSDLWK_', 'MEEPQSDPSVEPPLS(0.55)QET(0.45)FSDLWK', 'P04637', 'TP53', 'r2', 'treat', '3', '0.001', '400000', '', ''],
    ['ELNEALELK', 'Unmodified', '_ELNEALELK_', '', 'P04637;CON__P02768', 'TP53', 'r1', 'ctrl', '2', '0.001', '50000', '', ''],
    ['LVVVGAGGVGK', 'Unmodified', '_LVVVGAGGVGK_', '', 'P01116', 'KRAS', 'r1', 'ctrl', '2', '0.001', '900000', '', ''],
    ['KLEWSDLFSTEQPPSVEPDSPQEEM', 'Unmodified', '_KLEWSDLFSTEQPPSVEPDSPQEEM_', '', 'REV__P04637', '', 'r1', 'ctrl', '2', '0.5', '1000', '+', ''],
    ['DQSTSK', 'Unmodified', '_DQSTSK_', '', 'P04637', '', 'r1', 'ctrl', '2', '0.5', '1000', '+', ''],
  ]);
  const report = await readReport(blob(text, 'evidence.txt'), { accessions: ['P04637'] });
  assert.equal(report.format, 'maxquant-evidence');
  assert.equal(report.total, 6);
  assert.equal(report.rows.length, 4, 'KRAS and the REV__ decoy are left out; the flagged decoy is read, then filtered');
  const summary = summarizeReport(report, { localization: 0.75 });
  assert.equal(summary.filtered, 1);
  assert.deepEqual(summary.samples, ['ctrl', 'treat']);
  const phospho = summary.peptides.find((peptide) => peptide.sequence.startsWith('MEEPQ'));
  assert.equal(phospho.count, 2);
  assert.deepEqual(phospho.quantities, { ctrl: 100000, treat: 400000 });
  assert.equal(phospho.sites.length, 1);
  assert.deepEqual([phospho.sites[0].position, phospho.sites[0].label, phospho.sites[0].probability, phospho.sites[0].localized], [14, 'Phospho', 0.95, 1]);
  assert.equal(quantValue(phospho, 'ratio', ['ctrl'], ['treat']), 2);
  assert.equal(quantValue(phospho, 'intensity', ['ctrl'], []), 5);
  assert.equal(quantValue(phospho, 'count'), 2);
});

test('DIA-NN reports from Parquet (ZSTD) and TSV give the same peptides and sites', async () => {
  const parquet = new Blob([readFileSync(new URL('diann-report.parquet', TESTDATA))]);
  const fromParquet = await readReport(parquet, { accessions: ['P04637'] });
  assert.equal(fromParquet.format, 'diann');
  assert.equal(fromParquet.total, 10);
  assert.equal(fromParquet.rows.length, 8);
  const summary = summarizeReport(fromParquet, { qValue: 0.01, localization: 0.75 });
  assert.equal(summary.filtered, 1, 'the q = 0.03 precursor is dropped');
  assert.deepEqual(summary.samples, ['ctrl_1', 'treat_1']);
  const nTerminal = summary.peptides.find((peptide) => peptide.sequence.startsWith('MEEPQ'));
  assert.deepEqual(nTerminal.sites.map((site) => `${site.position}:${site.label}:${site.probability}`).sort(), ['-1:Acetyl:1', '14:Phospho:0.98']);
  const tail = summary.peptides.find((peptide) => peptide.sequence === 'TEGPDSD');
  assert.deepEqual(tail.sites.map((site) => `${site.position}:${site.probability}`), ['5:0.9']);

  const header = ['File.Name', 'Run', 'Protein.Group', 'Protein.Ids', 'Genes', 'Modified.Sequence', 'Stripped.Sequence', 'Precursor.Id', 'Precursor.Charge', 'Q.Value', 'PTM.Site.Confidence', 'Precursor.Quantity', 'Precursor.Normalised'];
  const tsv = table(header, [
    ['C:\\raw\\ctrl_1.raw', 'ctrl_1', 'P04637', 'P04637', 'TP53', 'TEGPDS(UniMod:21)D', 'TEGPDSD', 'TEGPDS(UniMod:21)D2', '2', '0.004', '0.9', '30000', '31000'],
    ['C:\\raw\\ctrl_1.raw', 'ctrl_1', 'P04637', 'P04637', 'TP53', 'TEGPDS(UniMod:21)D', 'TEGPDSD', 'TEGPDS(UniMod:21)D2', '2', '0.004', '0.4', '30000', '0'],
  ]);
  const fromText = summarizeReport(await readReport(blob(tsv, 'report.tsv'), { accessions: ['P04637'] }));
  const site = fromText.peptides[0].sites[0];
  assert.deepEqual([site.position, site.probability, site.localized, site.count], [5, 0.9, 1, 2]);
  assert.deepEqual(fromText.peptides[0].quantities, { ctrl_1: 61000 }, 'Precursor.Normalised, or Precursor.Quantity where it is 0');
});

test('site tables map sites by protein position (MaxQuant, Spectronaut, FragPipe, DIA-NN)', async () => {
  const maxquant = table(['Proteins', 'Positions within proteins', 'Localization prob', 'Amino acid', 'Phospho (STY) Probabilities', 'Intensity', 'Intensity ctrl', 'Intensity treat', 'Reverse', 'Potential contaminant'], [
    ['P04637;P04637-2', '15;15', '0.99', 'S', 'MEEPQSDPSVEPPLS(0.99)QETFSDLWK', '3', '1', '2', '', ''],
    ['P04637', '392', '0.6', 'S', 'TEGPDS(0.6)D', '5', '5', '', '', ''],
  ]);
  const mq = summarizeReport(await readReport(blob(maxquant, 'Phospho (STY)Sites.txt'), { accessions: ['P04637'] }));
  assert.deepEqual(mq.sites.map((site) => `${site.protein}:${site.residue}${site.position}:${site.label}`), ['P04637:S15:Phospho', 'P04637-2:S15:Phospho']);
  assert.deepEqual(mq.samples, ['ctrl', 'treat']);

  const spectronaut = table(['R.FileName', 'R.Condition', 'PTM.ProteinId', 'PTM.SiteLocation', 'PTM.SiteAA', 'PTM.SiteProbability', 'PTM.ModificationTitle', 'PTM.Quantity'], [
    ['run1', 'A', 'P04637', '46', 'S', '0.97', 'Phospho (STY)', '1200'],
    ['run1', 'A', 'P04637', '47', 'C', '1', 'Carbamidomethyl (C)', '900'],
  ]);
  const sn = summarizeReport(await readReport(blob(spectronaut, 'sites.tsv'), { accessions: ['P04637'] }));
  assert.deepEqual(sn.sites.map((site) => `${site.residue}${site.position}:${site.label}`), ['S46:Phospho'], 'fixed modifications are left out');
  assert.deepEqual(sn.conditions.get('run1'), 'A');

  const fragpipe = table(['Index', 'Gene', 'Protein', 'Protein ID', 'Peptide', 'Best Localization Probability', 'x Intensity'], [['P04637_S315', 'TP53', 'sp|P04637|P53_HUMAN', 'P04637', 'SSs', '0.88', '10']]);
  const fp = summarizeReport(await readReport(blob(fragpipe, 'combined_site_STY_79.9663.tsv'), { accessions: ['P04637'] }));
  assert.deepEqual(fp.sites.map((site) => `${site.residue}${site.position}:${site.label}:${site.probability}`), ['S315:Phospho:0.88']);
});

test('mzTab, Spectronaut, FragPipe and Proteome Discoverer peptide rows', async () => {
  const mztab = [
    'MTD\tmzTab-version\t1.0.0',
    'MTD\tms_run[1]-location\tfile:///data/ctrl_1.raw',
    'PSH\tsequence\tPSM_ID\taccession\tmodifications\tcharge\tspectra_ref',
    'PSM\tTEGPDSD\t1\tsp|P04637|P53_HUMAN\t6[MS,MS:1001876, modification probability, 0.8]|1[MS,MS:1001876, modification probability, 0.2]-UNIMOD:21\t2\tms_run[1]:scan=10',
    'PSM\tLVVVGAGGVGK\t2\tP01116\tnull\t2\tms_run[1]:scan=11',
  ].join('\n');
  const mz = summarizeReport(await readReport(blob(mztab, 'out.mzTab'), { accessions: ['P04637'] }));
  assert.deepEqual(mz.samples, ['ctrl_1']);
  assert.deepEqual(mz.peptides.map((peptide) => [peptide.sequence, peptide.sites.map((site) => `${site.position}:${site.probability}`)]), [['TEGPDSD', ['5:0.8']]]);

  const spectronaut = table(['R.Condition', 'R.FileName', 'PG.ProteinAccessions', 'PG.Genes', 'PEP.StrippedSequence', 'EG.ModifiedSequence', 'EG.PTMLocalizationProbabilities', 'EG.Qvalue', 'FG.Quantity'], [
    ['A', 'r1', 'P04637', 'TP53', 'TEGPDSD', '_TEGPDS[Phospho (STY)]D_', '_T[Phospho (STY): 2%]EGPDS[Phospho (STY): 98%]D_', '0.001', 'Filtered'],
  ]);
  const sn = summarizeReport(await readReport(blob(spectronaut, 'report.tsv'), { accessions: ['P04637'] }));
  assert.deepEqual(sn.peptides[0].sites.map((site) => `${site.position}:${site.probability}`), ['5:0.98']);
  assert.deepEqual(sn.peptides[0].quantities, {}, '"Filtered" quantities are missing, not zero');

  const psm = table(['Spectrum', 'Spectrum File', 'Peptide', 'Modified Peptide', 'Charge', 'Intensity', 'Assigned Modifications', 'STY:79.9663', 'Protein', 'Protein ID', 'Gene', 'Mapped Proteins'], [
    ['x.1.1.2', '/work/ctrl_1/interact.pep.xml', 'TEGPDSD', 'TEGPDS[167]D', '2', '5000', '6S(79.9663)', 'TEGPDS(0.91)D', 'sp|P04637|P53_HUMAN', 'P04637', 'TP53', ''],
  ]);
  const fp = summarizeReport(await readReport(blob(psm, 'psm.tsv'), { accessions: ['P04637'] }));
  assert.deepEqual(fp.samples, ['ctrl_1']);
  assert.deepEqual(fp.peptides[0].sites.map((site) => `${site.position}:${site.label}:${site.probability}`), ['5:Phospho:0.91']);

  const pd = table(['Annotated Sequence', 'Modifications', 'Master Protein Accessions', 'ptmRS: Best Site Probabilities', 'Abundance: F1: Sample, Control', 'Abundance: F2: Sample, Treated'], [
    ['[K].TEGPDsD.[-]', 'S6(Phospho)', 'P04637', 'S6(Phospho): 97.5', '100', '300'],
  ].map((row) => row.map((cell) => `"${cell}"`)), '\t');
  const pdSummary = summarizeReport(await readReport(blob(pd, 'PeptideGroups.txt'), { accessions: ['P04637'] }));
  assert.deepEqual(pdSummary.peptides[0].sites.map((site) => `${site.position}:${site.probability}`), ['5:0.975']);
  assert.deepEqual(pdSummary.samples, ['F1: Sample, Control', 'F2: Sample, Treated']);
});

test('reports without UniProt accessions are filtered by the chain sequences', async () => {
  const text = table(['Run', 'Protein.Group', 'Stripped.Sequence', 'Modified.Sequence', 'Q.Value', 'Precursor.Quantity'], [
    ['r1', 'unknown', 'ELNEALELK', 'ELNEALELK', '0.001', '5'],
    ['r1', 'unknown', 'LVVVGAGGVGK', 'LVVVGAGGVGK', '0.001', '5'],
  ]);
  const report = await readReport(blob(text, 'report.tsv'), { sequences: ['RFEMFRELNEALELKDAQAGKEPGGSR'] });
  assert.deepEqual(report.rows.map((row) => row.sequence), ['ELNEALELK']);
  await assert.rejects(readReport(blob('chain,residue,value\nA,1,2', 'data.csv'), {}), /not a recognized report/);
});

test('numbers with thousands separators or decimal commas, and quotes inside cells', () => {
  assert.deepEqual(['1,234', '1,234,567.8', '0,050', '2,51', '-1,5', '1,2,3', '1e5', 'NaN'].map(toNumber), [1234, 1234567.8, 0.05, 2.51, -1.5, NaN, 1e5, NaN]);
  assert.deepEqual(splitCells('P1;1,234;0,5;x,y', ';'), ['P1', '1.234', '0.5', 'x,y'], 'semicolon files write the comma as the decimal mark');
  assert.deepEqual(splitRow('P1\t5" nucleotidase\t0.01', '\t'), ['P1', '5" nucleotidase', '0.01'], 'a quote inside a cell is text');
  assert.deepEqual(splitRow('"a, b",c,"say ""hi"""', ','), ['a, b', 'c', 'say "hi"']);
});

test('DIA-NN precursor matrices, Spectronaut fragment rows and single-experiment MaxQuant sites', async () => {
  const matrix = await readReport(blob(table(
    ['Protein.Group', 'Protein.Ids', 'Genes', 'Stripped.Sequence', 'Modified.Sequence', 'Precursor.Charge', 'Precursor.Id', 'D:\\data\\run1.raw', 'D:\\data\\run2.raw'],
    [['P04637', 'P04637', 'TP53', 'SSCMGGMNR', 'SSCMGGMNR', '2', 'SSCMGGMNR2', '1000', ''], ['P04637', 'P04637', 'TP53', 'ALPNNTSSSPQPK', 'ALPNNTS(UniMod:21)SSPQPK', '2', 'x', '200', '300']],
  ), 'pr_matrix.tsv'), { accessions: ['P04637'] });
  assert.deepEqual(matrix.rows.map((row) => [row.sequence, row.sample, row.quantity]), [['SSCMGGMNR', 'run1.raw', 1000], ['ALPNNTSSSPQPK', 'run1.raw', 200], ['ALPNNTSSSPQPK', 'run2.raw', 300]]);
  assert.deepEqual(summarizeReport(matrix, { qValue: 0.01, localization: 0 }).samples, ['run1.raw', 'run2.raw']);

  const fragmentRow = (file, fragment) => ['P04637', 'TP53', 'SSCMGGMNR', '_SSCMGGMNR_', '2', file, 'A', '1', '1000', '0.001', fragment];
  const spectronaut = await readReport(blob(table(
    ['PG.ProteinAccessions', 'PG.Genes', 'PEP.StrippedSequence', 'EG.ModifiedSequence', 'FG.Charge', 'R.FileName', 'R.Condition', 'R.Replicate', 'FG.Quantity', 'EG.Qvalue', 'F.FrgIon'],
    [fragmentRow('r1', 'y3'), fragmentRow('r1', 'y4'), fragmentRow('r1', 'b2'), fragmentRow('r2', 'y3'), fragmentRow('r2', 'y4')],
  ), 'Report.tsv'), { accessions: ['P04637'] });
  const [peptide] = summarizeReport(spectronaut, { qValue: 0.01, localization: 0 }).peptides;
  assert.deepEqual([peptide.count, peptide.quantities.r1, peptide.quantities.r2], [2, 1000, 1000], 'one precursor per run, not one per fragment');

  const sites = await readReport(blob(table(
    ['Proteins', 'Positions within proteins', 'Amino acid', 'Localization prob', 'Phospho (STY) Probabilities', 'Reverse', 'Potential contaminant', 'Intensity', 'Intensity___1'],
    [['P04637', '15', 'S', '0.98', 'S(0.98)', '', '', '5000', '5000']],
  ), 'Phospho (STY)Sites.txt'), { accessions: ['P04637'] });
  const [site] = summarizeReport(sites, { qValue: 0.01, localization: 0.75 }).sites;
  assert.equal(quantValue(site, 'intensity'), Math.log10(5000), 'the total intensity stands for the one experiment');

  // FragPipe psm.tsv: several PSMs of one precursor in a run count once, at their largest intensity.
  const psm = (file, charge, intensity) => [`${file}.00001.00001.${charge}`, `/data/${file}/${file}.mzML`, 'PEPTIDEK', '', '', 'sp|P04637|P53_HUMAN', 'P04637', String(charge), intensity, '0.99'];
  const fragpipe = await readReport(blob(table(
    ['Spectrum', 'Spectrum File', 'Peptide', 'Modified Peptide', 'Assigned Modifications', 'Protein', 'Protein ID', 'Charge', 'Intensity', 'Probability'],
    [psm('exp1', 2, '100'), psm('exp1', 2, '300'), psm('exp1', 2, '200'), psm('exp1', 3, '50'), psm('exp2', 2, '80')],
  ), 'psm.tsv'), { accessions: ['P04637'], collect: { qValue: 0.01, localization: 0.75 } });
  assert.equal(fragpipe.rows.length, 5, 'every PSM is still evidence');
  assert.deepEqual(fragpipe.features.samples, ['exp1', 'exp2']);
  assert.deepEqual([...fragpipe.features.values], [350, 80], 'the largest PSM per precursor, charge states summed');
});

test('statistics read every protein of a report as features: modified peptides and sites', async () => {
  assert.equal(peptideFeatureKey('PEPSTIDEK', [{ position: 4, label: 'Phospho', probability: 0.99 }, { position: 1, label: 'Oxidation', probability: NaN }]), 'pep|PEPSTIDEK|1Oxidation,4Phospho');
  assert.equal(peptideFeatureKey('PEPSTIDEK', [{ position: 4, label: 'Phospho', probability: 0.4 }, { position: 0, label: 'Carbamidomethyl' }]), 'pep|PEPSTIDEK|?Phospho', 'unlocalized modifications lose their position; fixed ones are left out');

  const collector = createFeatureCollector({ qValue: 0.01, localization: 0.75 });
  collector.add({ sequence: 'AAAK', mods: [], sample: 'r1', quantity: 100, q: 0.001 }, 'diann');
  collector.add({ sequence: 'AAAK', mods: [], sample: 'r1', quantity: 50, q: 0.001 }, 'diann');
  collector.add({ sequence: 'AAAK', mods: [], sample: 'r2', quantity: 80, q: 0.001 }, 'diann');
  collector.add({ sequence: 'AAAK', mods: [], sample: 'r2', quantity: 70, q: 0.2 }, 'diann');
  collector.add({ sequence: 'BBBK', mods: [], sample: 'r2', quantity: 5, q: 0.001, decoy: true }, 'diann');
  collector.add({ site: true, protein: 'P1', position: 15, label: 'Phospho', probability: 0.9, quantities: { r1: 10, r2: 0, r3: 12 } }, 'maxquant-sites');
  const features = collector.finish();
  assert.deepEqual(features.keys, ['pep|AAAK|', 'site|P1|15|Phospho']);
  assert.deepEqual(features.samples, ['r1', 'r2', 'r3']);
  assert.deepEqual([...features.values], [150, 80, NaN, 10, NaN, 12], 'charge states sum per sample; failed q-values, decoys and zeros drop out');

  // Localization is judged per feature, since engines report it per run: a peptidoform localized
  // in some runs stays one feature; peptidoforms never localized merge; a site table's site
  // whose best probability is below the threshold is left out.
  const perRun = createFeatureCollector({ qValue: 0.01, localization: 0.75 });
  for (const [sample, probability] of [['a1', 0.6], ['a2', 0.7], ['b1', 0.95], ['b2', 0.99]]) {
    perRun.add({ sequence: 'PEPSIDEK', proteins: ['P1'], mods: [{ position: 3, label: 'Phospho', probability }], sample, quantity: 100, q: 0.001 }, 'diann');
  }
  perRun.add({ sequence: 'SSAK', proteins: ['P2'], mods: [{ position: 0, label: 'Phospho', probability: 0.5 }], sample: 'a1', quantity: 10, q: 0.001 }, 'diann');
  perRun.add({ sequence: 'SSAK', proteins: ['P2'], mods: [{ position: 1, label: 'Phospho', probability: 0.5 }], sample: 'a1', quantity: 20, q: 0.001 }, 'diann');
  perRun.add({ site: true, protein: 'P3', position: 7, label: 'Phospho', probability: 0.5, quantities: { a1: 5 } }, 'maxquant-sites');
  const merged = perRun.finish();
  assert.deepEqual(merged.keys, ['pep|PEPSIDEK|3Phospho', 'pep|SSAK|?Phospho']);
  assert.deepEqual(merged.proteins, ['P1', 'P2']);
  assert.deepEqual(merged.samples, ['a1', 'a2', 'b1', 'b2']);
  assert.deepEqual([...merged.values], [100, 100, 100, 100, 30, NaN, NaN, NaN]);

  // readReport with `collect` keeps the structure's rows and collects all of them.
  const header = ['Run', 'Protein.Ids', 'Protein.Group', 'Stripped.Sequence', 'Modified.Sequence', 'Precursor.Charge', 'Q.Value', 'Precursor.Normalised'];
  const text = table(header, [
    ['a1', 'P04637', 'P04637', 'PEPTIDEK', 'PEPTIDEK', '2', '0.001', '1000'],
    ['a2', 'P04637', 'P04637', 'PEPTIDEK', 'PEPTIDEK', '2', '0.001', '1100'],
    ['a1', 'Q99999', 'Q99999', 'OTHERPEPK', 'OTHERPEPK', '2', '0.001', '500'],
    ['a2', 'Q99999', 'Q99999', 'OTHERPEPK', 'OTHERPEPK', '2', '0.001', '520'],
  ]);
  const report = await readReport(blob(text, 'report.tsv'), { accessions: ['P04637'], collect: { qValue: 0.01, localization: 0.75 } });
  assert.equal(report.rows.length, 2, 'only the structure’s protein is kept');
  assert.deepEqual(report.features.keys, ['pep|PEPTIDEK|', 'pep|OTHERPEPK|']);
  assert.deepEqual([...report.features.values], [1000, 1100, 500, 520]);
});
