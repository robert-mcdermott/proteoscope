import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findRings, layoutMolecule, moleculeGraph } from './depict.js';

// Heavy atoms and bonds of Chemical Component Dictionary entries (public domain), with the
// dictionary's ideal coordinates: [name, element, charge, aromatic, x, y, z] and [a, b, order, aromatic].
const fixtures = JSON.parse(readFileSync(new URL('./testdata/ligands.json', import.meta.url), 'utf8'));
const molecule = (id) => ({
  atoms: fixtures[id].atoms.map(([name, element, charge, aromatic, x, y, z]) => ({ name, element, charge, aromatic: Boolean(aromatic), x, y, z })),
  bonds: fixtures[id].bonds.map(([a, b, order, aromatic]) => ({ a, b, order, aromatic: Boolean(aromatic) })),
});
const bondLengths = (layout, bonds) => bonds.map(({ a, b }) => Math.hypot(layout.points[a][0] - layout.points[b][0], layout.points[a][1] - layout.points[b][1]));

test('rings: the smallest set, in order around each ring', () => {
  const sizes = (id) => findRings(moleculeGraph(fixtures[id].atoms.length, molecule(id).bonds)).map((ring) => ring.length).sort((a, b) => a - b);
  assert.deepEqual(sizes('STI'), [6, 6, 6, 6, 6]);
  assert.deepEqual(sizes('CLR'), [5, 6, 6, 6]);
  assert.deepEqual(sizes('ATP'), [5, 5, 6]);
  assert.deepEqual(sizes('CAM'), [5, 5], 'camphor: two five-membered rings share three atoms');
  assert.deepEqual(sizes('BEN'), [6]);
  // Each ring is a cycle: consecutive atoms are bonded.
  const { bonds } = molecule('FAD');
  const graph = moleculeGraph(fixtures.FAD.atoms.length, bonds);
  for (const ring of findRings(graph)) {
    ring.forEach((atom, index) => assert.notEqual(graph.edgeOf(atom, ring[(index + 1) % ring.length]), undefined));
  }
});

test('drug-like ligands lay out with unit bonds and no overlapping atoms', () => {
  for (const id of ['STI', 'AQ4', 'ATP', 'NAG', 'FAD', 'CLR', 'RIT', 'BEN', '1N1', 'SAM', '0WM']) {
    const input = molecule(id);
    const layout = layoutMolecule(input);
    assert.equal(layout.method, 'layout', id);
    assert.equal(layout.clashes, 0, `${id} overlaps`);
    for (const length of bondLengths(layout, input.bonds)) assert.ok(Math.abs(length - 1) < 0.02, `${id}: a bond of ${length.toFixed(3)}`);
  }
});

test('heme: the porphyrin as a macrocycle with the iron at the center of its four nitrogens', () => {
  const input = molecule('HEM');
  const layout = layoutMolecule(input);
  assert.equal(layout.clashes, 0);
  const iron = input.atoms.findIndex((atom) => atom.element === 'FE');
  const nitrogens = input.bonds.filter(({ a, b }) => a === iron || b === iron).map(({ a, b }) => (a === iron ? b : a));
  assert.equal(nitrogens.length, 4);
  const distances = nitrogens.map((atom) => Math.hypot(layout.points[atom][0] - layout.points[iron][0], layout.points[atom][1] - layout.points[iron][1]));
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.1, `Fe–N ${distances.map((value) => value.toFixed(2))}`);
});

test('cages and macrocycles: drawn without losing atoms, flagged when atoms overlap', () => {
  const camphor = layoutMolecule(molecule('CAM'));
  assert.equal(camphor.approximate, camphor.clashes > 0);
  const rapamycin = molecule('RAP');
  const layout = layoutMolecule(rapamycin);
  assert.equal(layout.points.length, rapamycin.atoms.length);
  assert.ok(layout.points.every((point) => point.every(Number.isFinite)));
  assert.equal(layout.clashes, 0);
});

test('the layout turns to match a reference view, and maps other points into its frame', () => {
  const input = molecule('AQ4');
  const free = layoutMolecule(input, { reference: null });
  // A reference: the layout itself, turned by 90° and scaled 20×, as a screen would show it.
  const reference = free.points.map(([x, y]) => [300 - 20 * y, 200 + 20 * x]);
  const turned = layoutMolecule(input, { reference });
  // Matching the reference, the layout's x runs along the screen's x.
  const center = (points) => points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  const c = center(turned.points);
  const r = center(reference);
  turned.points.forEach((point, index) => {
    assert.ok(Math.abs((point[0] - c[0]) * 20 - (reference[index][0] - r[0])) < 1e-6);
    assert.ok(Math.abs((point[1] - c[1]) * 20 - (reference[index][1] - r[1])) < 1e-6);
  });
  const mapped = turned.fromReference([r[0] + 40, r[1]]);
  assert.ok(Math.abs(mapped[0] - 2) < 1e-6 && Math.abs(mapped[1]) < 1e-6, 'a point 40 px right of the center is 2 bond lengths right');
});
