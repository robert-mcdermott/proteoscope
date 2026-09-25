import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INTERACTION_TYPES } from './interactions.js';
import { ligandDiagram } from './ligand-diagram.js';

const fixtures = JSON.parse(readFileSync(new URL('./testdata/ligands.json', import.meta.url), 'utf8'));
const ligand = (id) => ({
  atoms: fixtures[id].atoms.map(([name, element, charge, aromatic, x, y, z]) => ({ name, element, charge, aromatic: Boolean(aromatic), x, y, z })),
  bonds: fixtures[id].bonds.map(([a, b, order, aromatic]) => ({ a, b, order, aromatic: Boolean(aromatic) })),
});

test('an erlotinib diagram: residues clear of the ligand and of each other, lines, distances and a legend', () => {
  const { atoms, bonds } = ligand('AQ4');
  const index = (name) => atoms.findIndex((atom) => atom.name === name);
  const at = (name, dx, dy) => [atoms[index(name)].x + dx, atoms[index(name)].y + dy];
  const contacts = [
    { type: 'hydrogen-bond', atoms: [index('N1')], point: at('N1', 2.5, 1), distance: 2.7, residue: { key: 'A:769', label: 'Met769' } },
    { type: 'hydrophobic', atoms: [index('C21')], point: at('C21', -3, 1), distance: 3.6, residue: { key: 'A:764', label: 'Leu764' } },
    { type: 'hydrophobic', atoms: [index('C22')], point: at('C22', -3, -1), distance: 3.7, residue: { key: 'A:764', label: 'Leu764' } },
    { type: 'water-bridge', atoms: [index('N3')], point: at('N3', 4, 2), distance: 3.1, residue: { key: 'A:766', label: 'Thr766' }, water: { key: 'W:1', label: 'HOH 1', point: at('N3', 2, 1) } },
    { type: 'hydrophobic', atoms: [index('C2')], point: at('C2', 0, 0), distance: 3.9, residue: { key: 'A:<b>', label: '<Leu&694>' } },
  ];
  // The reference view: the atoms' x and y, as if seen down z.
  const diagram = ligandDiagram({ title: 'Erlotinib (AQ4)', subtitle: '1M17', atoms, bonds, reference: atoms.map((atom) => [atom.x, atom.y]), contacts, types: INTERACTION_TYPES });
  assert.equal(diagram.method, 'layout');
  assert.equal(diagram.residues, 4, 'one label per residue; Leu764 has two contacts');
  const { points, labels } = diagram.placement;
  assert.equal(labels.length, 5, 'four residues and a water');
  for (const label of labels) {
    for (const point of points) {
      const inside = Math.abs(point[0] - label.position[0]) < label.half[0] && Math.abs(point[1] - label.position[1]) < label.half[1];
      assert.ok(!inside, `${label.label} covers an atom`);
    }
    for (const other of labels) {
      if (other === label) continue;
      const overlap = Math.abs(label.position[0] - other.position[0]) < label.half[0] + other.half[0] && Math.abs(label.position[1] - other.position[1]) < label.half[1] + other.half[1];
      assert.ok(!overlap, `${label.label} overlaps ${other.label}`);
    }
  }
  assert.match(diagram.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(diagram.svg, />Met769</);
  assert.match(diagram.svg, />2\.70</);
  assert.match(diagram.svg, />Hydrogen bond</);
  assert.match(diagram.svg, />Water bridge</);
  assert.match(diagram.svg, />Hydrophobic</);
  // Text from files is escaped.
  assert.ok(!diagram.svg.includes('<Leu&694>') && diagram.svg.includes('&lt;Leu&amp;694&gt;'));
  // The aniline nitrogen carries its hydrogen.
  assert.match(diagram.svg, /<tspan>N<\/tspan><tspan>H<\/tspan>|<tspan>H<\/tspan><tspan>N<\/tspan>/);
});

test('ligands without contacts are drawn alone; heme gets its coordination bonds; overlaps are flagged', () => {
  const heme = ligand('HEM');
  const iron = heme.atoms.findIndex((atom) => atom.element === 'FE');
  const bonds = heme.bonds.map((bond) => ({ ...bond, coordination: bond.a === iron || bond.b === iron }));
  const drawn = ligandDiagram({ atoms: heme.atoms, bonds, contacts: [], types: INTERACTION_TYPES });
  assert.equal(drawn.residues, 0);
  assert.equal((drawn.svg.match(/stroke-dasharray="3 2"/g) ?? []).length, 4, 'four dashed Fe–N bonds');
  assert.match(drawn.svg, />Fe</);
  const camphor = ligandDiagram({ ...ligand('CAM'), contacts: [], types: INTERACTION_TYPES });
  assert.equal(camphor.approximate, /Approximate layout/.test(camphor.svg));
});
