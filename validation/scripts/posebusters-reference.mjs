// Writes validation/reference/posebusters.json: PoseBusters' verdicts on the ligand poses of the
// cases in validation/common.mjs, each crystal pose and copies broken on purpose (moved into the
// protein or a neighboring cofactor, a bond stretched, an aromatic ring puckered, a saturated ring
// flattened, an acyclic double bond flipped or twisted, mirrored, compressed, and moved away),
// with the poses' coordinates and the dictionary bonds, so the suite reruns Proteoscope's checks
// on the same atoms.
//
//   PYTHON=/path/to/python node validation/scripts/posebusters-reference.mjs
//
// PYTHON must have PoseBusters and RDKit (pip install posebusters); they are not part of
// Proteoscope. Each pose runs through PoseBusters' "redock" configuration, whose checks are the
// "dock" ones plus the stereochemistry comparison with a true ligand, here the dictionary's ideal
// coordinates of the same atoms.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { perceiveMolecule } from '../../web/lib/perception.js';
import { symmetricEigen3 } from '../../web/lib/math3d.js';
import { componentDefinition, componentFile, ligandTopology, pdbFile, POSE_CASES, poseComplex, writeReference } from '../common.mjs';

const python = process.env.PYTHON;
if (!python) {
  console.error('Set PYTHON to a Python with PoseBusters installed (pip install posebusters).');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'posebusters-'));

const round = (value) => Number(value.toFixed(3));
const symbol = (element) => element[0] + element.slice(1).toLowerCase();

function molBlock(name, atoms, bonds, positions) {
  const lines = [name, `  Proteosc${' '.repeat(10)}3D`, '', `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`];
  atoms.forEach((atom, index) => {
    const [x, y, z] = positions[index];
    lines.push(`${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${z.toFixed(4).padStart(10)} ${symbol(atom.element).padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  for (const bond of bonds) lines.push(`${String(bond.a + 1).padStart(3)}${String(bond.b + 1).padStart(3)}${String(bond.order === 1.5 ? 4 : bond.order).padStart(3)}  0`);
  const charged = atoms.map((atom, index) => [index + 1, atom.charge]).filter(([, charge]) => charge);
  for (let start = 0; start < charged.length; start += 8) {
    const chunk = charged.slice(start, start + 8);
    lines.push(`M  CHG${String(chunk.length).padStart(3)}${chunk.map(([index, charge]) => `${String(index).padStart(4)}${String(charge).padStart(4)}`).join('')}`);
  }
  lines.push('M  END', '$$$$', '');
  return lines.join('\n');
}

const mean = (points) => points.reduce((sum, p) => sum.map((value, k) => value + p[k] / points.length), [0, 0, 0]);

// The broken copies; each is skipped when the ligand has nothing to break that way.
function variants(topology, environment) {
  const base = topology.atoms.map((atom) => [atom.x, atom.y, atom.z]);
  const center = mean(base);
  const molecule = perceiveMolecule(topology);
  const list = [['crystal', base]];
  const near = environment.filter((atom) => !atom.hetero && base.some((p) => Math.hypot(p[0] - atom.x, p[1] - atom.y, p[2] - atom.z) <= 6));
  if (near.length) {
    const target = mean(near.map((atom) => [atom.x, atom.y, atom.z]));
    const direction = target.map((value, k) => value - center[k]);
    const length = Math.hypot(...direction);
    list.push(['moved into the protein', base.map((p) => p.map((value, k) => value + (1.5 * direction[k]) / length))]);
  }
  const terminal = molecule.bonds.find((bond) => molecule.neighbors[bond.a].length === 1 || molecule.neighbors[bond.b].length === 1);
  if (terminal) {
    const [end, anchor] = molecule.neighbors[terminal.a].length === 1 ? [terminal.a, terminal.b] : [terminal.b, terminal.a];
    const axis = base[end].map((value, k) => value - base[anchor][k]);
    const length = Math.hypot(...axis);
    list.push(['bond stretched', base.map((p, index) => (index === end ? p.map((value, k) => value + (0.7 * axis[k]) / length) : p))]);
  }
  const aromatic = molecule.rings.find((ring) => ring.length === 6 && ring.every((index) => molecule.atoms[index].aromatic));
  if (aromatic) {
    const normal = ringNormal(aromatic.map((index) => base[index]));
    list.push(['aromatic ring puckered', base.map((p, index) => (index === aromatic[0] ? p.map((value, k) => value + 0.8 * normal[k]) : p))]);
  }
  const saturated = molecule.rings.find((ring) => ring.length === 6 && ring.every((index) => !molecule.atoms[index].aromatic && molecule.atoms[index].ringCount === 1));
  if (saturated) {
    const points = saturated.map((index) => base[index]);
    const normal = ringNormal(points);
    const middle = mean(points);
    list.push(['saturated ring flattened', base.map((p, index) => {
      if (!saturated.includes(index)) return p;
      const offset = (p[0] - middle[0]) * normal[0] + (p[1] - middle[1]) * normal[1] + (p[2] - middle[2]) * normal[2];
      return p.map((value, k) => value - offset * normal[k]);
    })]);
  }
  // One side of an acyclic double bond turned 180° about it: E becomes Z.
  const flip = molecule.bonds.find((bond) => bond.order === 2 && !bond.ringCount && molecule.neighbors[bond.a].length > 1 && molecule.neighbors[bond.b].length > 1);
  if (flip) {
    const side = new Set([flip.b]);
    const stack = [flip.b];
    while (stack.length) {
      const atom = stack.pop();
      for (const bondIndex of molecule.neighbors[atom]) {
        if (bondIndex === flip.index) continue;
        const bond = molecule.bonds[bondIndex];
        const other = bond.a === atom ? bond.b : bond.a;
        if (!side.has(other)) {
          side.add(other);
          stack.push(other);
        }
      }
    }
    if (!side.has(flip.a)) {
      const pivot = base[flip.b];
      const axis = pivot.map((value, k) => value - base[flip.a][k]);
      const length = Math.hypot(...axis);
      const u = axis.map((value) => value / length);
      // Rodrigues' rotation of that side about the bond.
      const rotate = (angle) => base.map((p, index) => {
        if (!side.has(index)) return p;
        const v = p.map((value, k) => value - pivot[k]);
        const along = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        return v.map((value, k) => pivot[k] + value * Math.cos(angle) + cross[k] * Math.sin(angle) + u[k] * along * (1 - Math.cos(angle)));
      });
      list.push(['double bond flipped', rotate(Math.PI)]);
      list.push(['double bond twisted', rotate(Math.PI / 2)]);
    }
  }
  // Pushed into a cofactor (another hetero group within 8 Å), as into the protein.
  const cofactor = environment.filter((atom) => atom.hetero && !atom.water && atom.element !== 'H' && base.some((p) => Math.hypot(p[0] - atom.x, p[1] - atom.y, p[2] - atom.z) <= 8));
  const groups = new Map();
  for (const atom of cofactor) {
    const key = atom.label.split(' ')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(atom);
  }
  const largest = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (largest && largest.length >= 6) {
    const target = mean(largest.map((atom) => [atom.x, atom.y, atom.z]));
    const direction = target.map((value, k) => value - center[k]);
    const length = Math.hypot(...direction);
    list.push(['moved into a cofactor', base.map((p) => p.map((value, k) => value + (Math.min(2, length) * direction[k]) / length))]);
  }
  list.push(['mirrored', base.map((p) => [2 * center[0] - p[0], p[1], p[2]])]);
  list.push(['compressed', base.map((p) => p.map((value, k) => center[k] + 0.72 * (value - center[k])))]);
  list.push(['moved away', base.map((p) => [p[0] + 25, p[1], p[2]])]);
  return list.map(([name, positions]) => [name, positions.map((p) => p.map(round))]);
}

// The ring's plane normal: the direction of least spread.
function ringNormal(points) {
  const center = mean(points);
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = p.map((value, k) => value - center[k]);
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) m[r][c] += d[r] * d[c];
  }
  return symmetricEigen3(m).vectors[2];
}

const PYTHON_SCRIPT = String.raw`
import json, math, sys
from posebusters import PoseBusters
jobs = json.load(open(sys.argv[1]))
buster = PoseBusters(config="redock")
out = []
def plain(value):
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (bool, int, float, str)) or value is None:
        return value
    return str(value)
for job in jobs:
    frame = buster.bust(mol_pred=job["pred"], mol_true=job["true"], mol_cond=job["cond"], full_report=True)
    row = frame.iloc[0].to_dict()
    out.append({key: plain(value) for key, value in row.items()})
json.dump(out, open(sys.argv[2], "w"))
`;

const cases = [];
const jobs = [];
for (const [pdb, code, description] of POSE_CASES) {
  const complex = poseComplex(await pdbFile(pdb), code);
  const component = await componentDefinition(await componentFile(code));
  const topology = ligandTopology(complex.ligand, component);
  const cond = join(work, `${pdb}_protein.pdb`);
  writeFileSync(cond, `${complex.lines.join('\n')}\nEND\n`);
  const idealPositions = topology.atoms.map((atom) => {
    const ideal = component.atoms.get(atom.name.toUpperCase());
    return [ideal.x, ideal.y, ideal.z];
  });
  const truePath = join(work, `${pdb}_true.sdf`);
  writeFileSync(truePath, molBlock(code, topology.atoms, topology.bonds, idealPositions));
  const poses = variants(topology, complex.environment);
  const entry = {
    pdb,
    code,
    description,
    atoms: topology.atoms.map((atom) => atom.name),
    elements: topology.atoms.map((atom) => atom.element),
    charges: topology.atoms.map((atom) => atom.charge),
    // Triples: first atom, second atom, order.
    bonds: topology.bonds.flatMap((bond) => [bond.a, bond.b, bond.order]),
    poses: [],
  };
  poses.forEach(([name, positions], index) => {
    const pred = join(work, `${pdb}_${index}.sdf`);
    writeFileSync(pred, molBlock(code, topology.atoms, topology.bonds, positions));
    jobs.push({ pred, cond, true: truePath });
    entry.poses.push({ name, coordinates: positions.flat() });
  });
  cases.push(entry);
  console.log(`${pdb} ${code}: ${topology.atoms.length} atoms, ${poses.length} poses`);
}

const jobsPath = join(work, 'jobs.json');
const resultsPath = join(work, 'results.json');
const scriptPath = join(work, 'bust.py');
writeFileSync(jobsPath, JSON.stringify(jobs));
writeFileSync(scriptPath, PYTHON_SCRIPT);
const run = spawnSync(python, [scriptPath, jobsPath, resultsPath], { encoding: 'utf8', maxBuffer: 256 << 20 });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(1);
}
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const version = spawnSync(python, ['-c', 'import posebusters, rdkit; print(posebusters.__version__, rdkit.__version__)'], { encoding: 'utf8' }).stdout.trim().split(' ');

// The verdicts and the numbers behind them.
const KEEP = [
  'sanitization', 'all_atoms_connected', 'bond_lengths', 'bond_angles', 'internal_steric_clash', 'aromatic_ring_flatness',
  'non-aromatic_ring_non-flatness', 'double_bond_flatness', 'protein-ligand_maximum_distance',
  'minimum_distance_to_protein', 'minimum_distance_to_organic_cofactors', 'minimum_distance_to_inorganic_cofactors',
  'minimum_distance_to_waters', 'volume_overlap_with_protein', 'volume_overlap_with_organic_cofactors',
  'volume_overlap_with_inorganic_cofactors', 'volume_overlap_with_waters', 'tetrahedral_chirality', 'double_bond_stereochemistry',
  'shortest_bond_relative_length', 'longest_bond_relative_length', 'most_extreme_relative_angle', 'shortest_noncovalent_relative_distance',
  'aromatic_ring_maximum_distance_from_plane', 'non-aromatic_ring_maximum_distance_from_plane', 'double_bond_maximum_distance_from_plane',
  'smallest_distance_protein', 'most_extreme_relative_distance_protein', 'most_extreme_relative_distance_organic_cofactors',
  'most_extreme_relative_distance_inorganic_cofactors', 'most_extreme_relative_distance_waters', 'volume_overlap_protein',
  'volume_overlap_organic_cofactors', 'volume_overlap_inorganic_cofactors', 'volume_overlap_waters',
];
let next = 0;
for (const entry of cases) {
  for (const pose of entry.poses) {
    const row = results[next++];
    // In the order of `fields`; null where PoseBusters reports nothing.
    pose.posebusters = KEEP.map((key) => (typeof row[key] === 'number' ? Number(row[key].toPrecision(6)) : row[key] ?? null));
  }
}
writeReference('posebusters.json', {
  tool: `PoseBusters ${version[0]}, RDKit ${version[1]}; redock configuration, the true ligand being the dictionary's ideal coordinates`,
  fields: KEEP,
  cases,
});
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${cases.reduce((sum, entry) => sum + entry.poses.length, 0)} poses.`);
