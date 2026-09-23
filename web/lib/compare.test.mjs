import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePDB } from './parse.js';
import { deriveStructure, prepareAssemblyEstimates } from './structure.js';
import { compareStructures, pairChains, polymerChainResidues, principalAtom, superposeEnsemble } from './compare.js';
import { invertTransform, transformPoint } from './superpose.js';

const DATA_DIR = new URL('../../data/', import.meta.url);

async function loadPDB(name, edit = null) {
  let text = await readFile(new URL(name, DATA_DIR), 'utf8');
  if (edit) text = editPDB(text, edit);
  const structure = parsePDB(text, name);
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  deriveStructure(structure);
  return { structure, model: structure.models[0] };
}

// Rewrites coordinate records: optional rigid transform, chain relabeling, renumbering, and a
// per-chain extra shift.
function editPDB(text, { transform = null, chains = null, renumber = 0, only = null, shift = null } = {}) {
  return text.split('\n').filter((line) => {
    if (!only || !/^(ATOM|HETATM|ANISOU|TER)/.test(line)) return true;
    return only.includes(line[21]);
  }).map((line) => {
    if (!/^(ATOM|HETATM)/.test(line)) return line;
    let x = Number(line.slice(30, 38));
    let y = Number(line.slice(38, 46));
    let z = Number(line.slice(46, 54));
    if (shift?.[line[21]]) {
      x += shift[line[21]][0];
      y += shift[line[21]][1];
      z += shift[line[21]][2];
    }
    if (transform) [x, y, z] = transformPoint(transform, x, y, z);
    let chain = line[21];
    if (chains?.[chain]) chain = chains[chain];
    const resSeq = Number(line.slice(22, 26)) + renumber;
    return `${line.slice(0, 21)}${chain}${String(resSeq).padStart(4)}${line.slice(26, 30)}${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}${line.slice(54)}`;
  }).join('\n');
}

const ROTATION = (() => {
  const angle = 1.1;
  const axis = [0.3, -0.8, 0.52];
  const length = Math.hypot(...axis);
  const [x, y, z] = axis.map((value) => value / length);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return {
    rotation: [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    translation: [25, -12, 40],
  };
})();

test('a rotated copy of hemoglobin superposes exactly, chain for chain', async () => {
  const ref = await loadPDB('4hhb.pdb');
  const mob = await loadPDB('4hhb.pdb', { transform: ROTATION });
  const result = compareStructures(ref, mob);
  assert.deepEqual(result.chainPairs.map((pair) => `${pair.ref}${pair.mob}`), ['AA', 'BB', 'CC', 'DD']);
  assert.equal(result.stats.pairCount, 141 + 146 + 141 + 146);
  assert.ok(result.stats.rmsd < 0.01, `rmsd ${result.stats.rmsd}`);
  assert.equal(result.stats.keptCount, result.stats.pairCount);
  assert.ok(result.stats.tmScore > 0.999);
  assert.ok(result.stats.lddt > 0.999);
  assert.equal(result.stats.identity, 1);
  const inverse = invertTransform(ROTATION);
  result.transform.rotation.forEach((value, index) => assert.ok(Math.abs(value - inverse.rotation[index]) < 1e-4));
});

test('identical subunits under new chain names pair by position, not by name', async () => {
  const ref = await loadPDB('4hhb.pdb');
  const mob = await loadPDB('4hhb.pdb', { transform: ROTATION, chains: { A: 'W', B: 'X', C: 'Y', D: 'Z' } });
  const pairs = pairChains(ref.model, mob.model);
  assert.deepEqual(pairs.map((pair) => `${pair.ref.id}${pair.mob.id}`).sort(), ['AW', 'BX', 'CY', 'DZ']);
  assert.ok(compareStructures(ref, mob).stats.rmsd < 0.01);
});

test('alpha and beta globin align at about 43% identity with a close structural match', async () => {
  const hb = await loadPDB('4hhb.pdb');
  const result = compareStructures(hb, hb, { refChains: ['A'], mobChains: ['B'] });
  assert.ok(result.stats.identity > 0.38 && result.stats.identity < 0.5, `identity ${result.stats.identity}`);
  assert.ok(result.stats.pairCount > 135);
  assert.ok(result.stats.rmsd < 2, `rmsd ${result.stats.rmsd}`);
  assert.ok(result.stats.keptCount > 100);
  assert.ok(result.stats.tmScore > 0.75, `tm ${result.stats.tmScore}`);

  const alphas = compareStructures(hb, hb, { refChains: ['A'], mobChains: ['C'] });
  assert.equal(alphas.stats.identity, 1);
  assert.ok(alphas.stats.rmsd < 1, `α1/α2 rmsd ${alphas.stats.rmsd}`);
});

test('fitting on a selection leaves the rest free to deviate', async () => {
  const ref = await loadPDB('4hhb.pdb');
  const mob = await loadPDB('4hhb.pdb', { shift: { A: [5, 0, 0] } });
  const fitKeys = new Set(ref.model.residues.filter((residue) => residue.chain === 'B').map((residue) => residue.key));
  const result = compareStructures(ref, mob, { fitKeys });
  assert.ok(result.stats.rmsd < 0.01);
  const deviations = (chain) => result.pairs.filter((pair) => pair.ref.chain === chain).map((pair) => pair.distance);
  assert.ok(deviations('A').every((value) => Math.abs(value - 5) < 0.01));
  assert.ok(deviations('B').every((value) => value < 0.01));

  // lDDT needs no superposition: chain A residues with no other chain within 15 Å keep every
  // distance, while those at an interface lose the inter-chain ones.
  const others = ref.model.residues.filter((residue) => residue.chain !== 'A' && principalAtom(residue)).map(principalAtom);
  const isolated = (residue) => {
    const atom = principalAtom(residue);
    return others.every((other) => Math.hypot(other.x - atom.x, other.y - atom.y, other.z - atom.z) >= 15);
  };
  const chainA = result.pairs.filter((pair) => pair.ref.chain === 'A');
  const inside = chainA.filter((pair) => isolated(pair.ref));
  const interface_ = chainA.filter((pair) => !isolated(pair.ref));
  assert.ok(inside.length > 20 && interface_.length > 20);
  assert.ok(inside.every((pair) => pair.lddt > 0.999));
  assert.ok(interface_.filter((pair) => pair.lddt < 0.999).length > interface_.length * 0.8);
});

test('UniProt numbering pairs a PDB chain with an AlphaFold-style model', async () => {
  const pdb = await loadPDB('4hhb.pdb');
  // An AlphaFold DB model numbers residues by UniProt position: HBA_HUMAN 2-142 = PDB 1-141.
  const model = await loadPDB('4hhb.pdb', { only: ['A'], renumber: 1, transform: ROTATION });
  const result = compareStructures(pdb, model, { correspondence: 'uniprot', refChains: ['A'], accession: 'P69905' });
  assert.equal(result.stats.pairCount, 141);
  assert.ok(result.pairs.every((pair) => pair.mob.resSeq === pair.ref.resSeq + 1));
  assert.ok(result.stats.rmsd < 0.01);
});

test('polymer chains use Cα for protein and C4′ for nucleic acids', async () => {
  const p53 = await loadPDB('1tup.pdb');
  const chains = polymerChainResidues(p53.model);
  const kinds = new Set([...chains.values()].map((chain) => chain.kind));
  assert.ok(kinds.has('protein') && kinds.has('nucleic'));
  for (const chain of chains.values()) {
    for (const residue of chain.residues) {
      const atom = principalAtom(residue);
      assert.ok(atom.name === 'CA' || atom.name === "C4'" || atom.name === 'P', atom.name);
    }
  }
});

test('an NMR ensemble superposes onto its core and reports per-residue RMSF', async () => {
  const { structure } = await loadPDB('1jm7.pdb');
  assert.ok(structure.models.length > 5);
  const result = superposeEnsemble(structure.models, 0);
  assert.equal(result.transforms.length, structure.models.length);
  const values = [...result.rmsf.values()];
  assert.ok(values.every(Number.isFinite));
  const sorted = values.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median < 2.5, `median RMSF ${median}`);
  assert.ok(sorted.at(-1) > 3 * median, 'flexible termini fluctuate far more than the core');
});
