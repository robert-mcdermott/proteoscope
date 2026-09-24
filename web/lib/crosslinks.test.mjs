import assert from 'node:assert/strict';
import test from 'node:test';
import { crosslinkProtein, detectCrosslinkReport, distanceHistogram, parseCrosslinkReport, surfaceDistances } from './crosslinks.js';

const csv = (header, rows, delimiter = ',') => [header.join(delimiter), ...rows.map((row) => row.join(delimiter))].join('\n');

test('cross-link exports of each tool become unique residue pairs', () => {
  const xifdr = parseCrosslinkReport(csv(['LinkID', 'Protein1', 'Decoy1', 'Protein2', 'Decoy2', 'fromSite', 'ToSite', 'Score', 'isDecoy', 'count PSMs', 'fdr'], [
    ['1', 'Cas9', 'false', 'Cas9', 'false', '1226', '753', '40.2', 'false', '3', '0'],
    ['2', 'Cas9', 'false', 'Cas9', 'false', '753', '1226', '38.1', 'false', '1', '0'],
    ['3', 'decoy:Cas9', 'true', 'Cas9', 'false', '10', '20', '5', 'true', '1', '0.3'],
  ]), 'Links.csv');
  assert.equal(xifdr.format, 'xifdr-links');
  assert.equal(xifdr.decoys, 1);
  assert.deepEqual(xifdr.links.map((link) => [link.proteinA, link.residueA, link.proteinB, link.residueB, link.count, link.score]), [['Cas9', 1226, 'Cas9', 753, 4, 40.2]], 'both orientations are one pair');

  const xiview = parseCrosslinkReport(csv(['Protein1', 'Decoy1', 'Protein2', 'Decoy2', 'PepSeq1', 'PepSeq2', 'PepPos1', 'PepPos2', 'LinkPos1', 'LinkPos2', 'Score'], [
    ['P04050', 'false', 'P38902', 'false', 'GPQVCcmAKLFGNIQK', 'LKIDPDTKAPNAVVITFEK', '638', '19', '7', '8', '24.1'],
  ]));
  assert.deepEqual([xiview.format, xiview.links[0].residueA, xiview.links[0].residueB], ['xiview', 644, 26], 'PepPos + LinkPos − 1');

  const plink = parseCrosslinkReport([
    'Peptide_Order,Peptide,Peptide_Mass,Modifications,Proteins,Protein_Type',
    ',Spectrum_Order,Title,Charge,Precursor_Mass,Evalue,Score',
    '1,YDENDKLIR(6)-FDNLTKAER(6),2396.2,null,sp|Q99ZW2|CAS9_STRP1(952)-sp|Q99ZW2|CAS9_STRP1(906)/,Intra-Protein',
    ',1,title.dta,3,2396.2,1,5.5e-09',
  ].join('\n'));
  assert.deepEqual([plink.format, plink.links[0].proteinA, plink.links[0].residueA, plink.links[0].residueB], ['plink', 'Q99ZW2', 906, 952]);

  const merox = parseCrosslinkReport(csv(['Score', 'Peptide 1', 'Protein 1', 'From', 'To', 'Peptide2', 'Protein 2', 'From', 'To', 'best linkage position peptide 1', 'best linkage position peptide 2'], [
    ['97', '[GKSDNVPSEEVVK]', '>Cas9(>Cas10/>Cas11)', '869', '881', '[VKYVTEGmR]', '>Cas9', '531', '539', 'K2', 'K2'],
  ], ';'));
  assert.deepEqual([merox.format, merox.links[0].proteinA, merox.links[0].residueA, merox.links[0].residueB], ['merox', 'Cas9', 532, 870], 'From + link index − 1 on each peptide');

  const xlinkx = parseCrosslinkReport(csv(['Checked', 'Crosslinker', '# CSMs', 'Accession A', 'Position A', 'Accession B', 'Position B', 'Is Decoy', 'Q-value', 'Max. XlinkX Score'], [
    ['"False"', 'DSSO', '8', 'Cas9', '49', 'Cas9', '152', 'False', '0.000', '445.6'],
  ].map((row) => row.map((cell) => cell)), '\t'));
  assert.deepEqual([xlinkx.format, xlinkx.links[0].count, xlinkx.links[0].score], ['xlinkx', 8, 445.6]);

  const maxlynx = parseCrosslinkReport(csv(['Raw file', 'Decoy', 'Score', 'Crosslink product type', 'Proteins1', 'Proteins2', 'Protein index of Crosslink 1', 'Protein index of Crosslink 2'], [
    ['r1', '', '46.6', 'Intra-protein link', 'Cas9', 'Cas9', '779', '866'],
    ['r1', '', '12', 'Mono-linked', 'Cas9', '-', '100', '-'],
    ['r1', '+', '10', 'Intra-protein link', 'REV__Cas9', 'REV__Cas9', '5', '9'],
  ], '\t'));
  assert.deepEqual([maxlynx.format, maxlynx.links.length, maxlynx.decoys], ['maxlynx', 1, 1]);

  assert.equal(detectCrosslinkReport(['In protein A', 'In protein B', 'Accession A', 'Accession B']), 'msannika');
  assert.equal(parseCrosslinkReport('chain,residue,value\nA,1,2'), null);
  assert.deepEqual(['sp|P04637|P53_HUMAN', '>Cas9', 'Cas9(>Cas10/>Cas11)', 'P04050;P08518'].map(crosslinkProtein), ['P04637', 'Cas9', 'Cas9', 'P04050']);
});

const atom = (x, y, z, residueKey, name = 'CA', element = 'C') => ({ x, y, z, residueKey, name, element });

test('surface distances go around obstacles and never below the straight line', () => {
  const a = atom(0, 0, 0, 'A');
  const b = atom(10, 0, 0, 'B');
  const pair = { a: { key: 'A', ca: a }, b: { key: 'B', ca: b } };
  const [free] = surfaceDistances([a, b], [pair]);
  assert.deepEqual(free, { sasd: 10, status: 'ok' });

  const wall = [];
  for (let y = -8; y <= 8; y += 1.5) for (let z = -8; z <= 8; z += 1.5) wall.push(atom(5, y, z, `W${y},${z}`, 'CB'));
  const [around] = surfaceDistances([a, b, ...wall], [pair]);
  assert.equal(around.status, 'ok');
  assert.ok(around.sasd > 2 * Math.hypot(5, 10) && around.sasd < 28, `around the wall: ${around.sasd}`);

  // The side chains of the linked residues are not obstacles; other side chains are.
  const plug = [atom(3, 0, 0, 'A', 'NZ', 'N'), atom(5, 0, 0, 'A', 'CE'), atom(7, 0, 0, 'B', 'NZ', 'N')];
  assert.equal(surfaceDistances([a, b, ...plug], [pair])[0].sasd, 10);
  const blocked = surfaceDistances([a, b, ...plug.map((item) => ({ ...item, residueKey: 'C' }))], [pair])[0];
  assert.ok(blocked.sasd > 10);

  // Buried: a Cα inside a closed shell of atoms.
  const shell = [];
  for (let theta = 0; theta < Math.PI; theta += Math.PI / 10) {
    for (let phi = 0; phi < 2 * Math.PI; phi += Math.PI / 10) shell.push(atom(20 + 6 * Math.sin(theta) * Math.cos(phi), 6 * Math.sin(theta) * Math.sin(phi), 6 * Math.cos(theta), 'S', 'CB'));
  }
  shell.push(atom(20, 0, -6, 'S', 'CB'));
  const inside = atom(20, 0, 0, 'I');
  assert.equal(surfaceDistances([a, inside, ...shell], [{ a: { key: 'A', ca: a }, b: { key: 'I', ca: inside } }])[0].status, 'buried');
  assert.equal(surfaceDistances([a, atom(90, 0, 0, 'F')], [{ a: { key: 'A', ca: a }, b: { key: 'F', ca: atom(90, 0, 0, 'F') } }])[0].status, 'far');
});

test('distance histograms put values in fixed bins with an overflow bin', () => {
  const { bins, binWidth } = distanceHistogram([1, 1.9, 2, 35, 99, NaN], { binWidth: 2, max: 60 });
  assert.equal(binWidth, 2);
  assert.equal(bins[0], 2);
  assert.equal(bins[1], 1);
  assert.equal(bins[17], 1);
  assert.equal(bins.at(-1), 1);
});
