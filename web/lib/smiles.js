// SMILES as structure predictors take ligands (OpenSMILES; Weininger, J Chem Inf Comput Sci
// 1988), read into what the pose checks and the chemistry need: heavy atoms with their elements
// and charges, bonds with Kekulé orders (aromatic ones kekulized as RDKit does before it
// perceives aromaticity), and the configuration the string states for tetrahedral centers
// (@, @@) and double bonds (/ and \). Hydrogens written as atoms ([H]) are folded into their
// neighbors. readSMILES() gives the molecule; smilesMapping() pairs its atoms with a model's.

import { elementRecord } from './perception.js';

const ORGANIC = ['Cl', 'Br', 'B', 'C', 'N', 'O', 'P', 'S', 'F', 'I'];
const AROMATIC_ORGANIC = ['b', 'c', 'n', 'o', 'p', 's'];
const AROMATIC_BRACKET = ['se', 'as', 'te', 'b', 'c', 'n', 'o', 'p', 's'];
const BOND_ORDERS = { '-': 1, '/': 1, '\\': 1, '=': 2, '#': 3, $: 4, ':': 1.5 };
// Default valences of the organic subset, for its implicit hydrogens.
const VALENCES = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], CL: [1], BR: [1], I: [1] };

export class SMILESError extends Error {}

// { atoms: [{ element, charge, hydrogens, aromatic, isotope }], bonds: [{ a, b, order,
// aromatic }] with orders 1–3 after kekulization, stereo: { centers: [{ center, order (four
// atom indices in the string's order, null for a hydrogen), parity ('@' anticlockwise, '@@'
// clockwise, seen from the first) }], doubleBonds: [{ a, b, sa, sb, cis }] } }, heavy atoms only.
export function readSMILES(text) {
  const source = String(text ?? '').trim().split(/\s+/)[0];
  if (!source) throw new SMILESError('The SMILES is empty.');
  const parsed = parse(source);
  kekulize(parsed);
  return heavyMolecule(parsed);
}

function parse(source) {
  const atoms = [];
  const bonds = [];
  // For each atom, its neighbors in the order the string meets them: the atom before it, its
  // own hydrogen, then ring closures and later atoms (a ring bond keeps the place of its digit).
  const order = [];
  const branches = [];
  const rings = new Map();
  let previous = null;
  let pending = null;
  let index = 0;
  const fail = (message) => new SMILESError(`${message} (at character ${index + 1} of the SMILES).`);

  const bond = (a, b, symbol, from = a) => {
    const aromatic = symbol === ':' || (!symbol && atoms[a].aromatic && atoms[b].aromatic);
    const item = { a, b, order: aromatic ? 1.5 : BOND_ORDERS[symbol] ?? 1, aromatic, direction: symbol === '/' || symbol === '\\' ? symbol : null, from };
    bonds.push(item);
    return item;
  };
  const addAtom = (atom) => {
    const at = atoms.length;
    atoms.push(atom);
    order.push([]);
    if (previous !== null) {
      bond(previous, at, pending);
      order[previous].push(at);
      order[at].push(previous);
    }
    if (atom.bracketHydrogens === 1) order[at].push(null);
    previous = at;
    pending = null;
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '(') {
      if (previous === null) throw fail('A branch opens before any atom');
      branches.push(previous);
      index += 1;
    } else if (char === ')') {
      if (!branches.length) throw fail('A branch closes that was not opened');
      previous = branches.pop();
      pending = null;
      index += 1;
    } else if (char in BOND_ORDERS) {
      pending = char;
      index += 1;
    } else if (char === '.') {
      previous = null;
      pending = null;
      index += 1;
    } else if (char === '%' || (char >= '0' && char <= '9')) {
      const digits = char === '%' ? source.slice(index + 1, index + 3) : char;
      if (!/^\d+$/.test(digits) || (char === '%' && digits.length !== 2)) throw fail('A ring number after % needs two digits');
      if (previous === null) throw fail('A ring number comes before any atom');
      index += char === '%' ? 3 : 1;
      const open = rings.get(digits);
      if (open) {
        rings.delete(digits);
        if (open.atom === previous) throw fail('A ring closes on the atom that opened it');
        const symbol = pending ?? open.symbol;
        bond(open.atom, previous, symbol, pending ? previous : open.atom);
        order[open.atom][open.slot] = previous;
        order[previous].push(open.atom);
      } else {
        rings.set(digits, { atom: previous, symbol: pending, slot: order[previous].length });
        order[previous].push(undefined);
      }
      pending = null;
    } else if (char === '[') {
      const end = source.indexOf(']', index);
      if (end < 0) throw fail('A bracket atom is not closed');
      addAtom(bracketAtom(source.slice(index + 1, end), fail));
      index = end + 1;
    } else {
      const aromatic = AROMATIC_ORGANIC.find((symbol) => source.startsWith(symbol, index));
      const organic = aromatic ? null : ORGANIC.find((symbol) => source.startsWith(symbol, index));
      if (!aromatic && !organic) throw fail(char === '*' ? 'Wildcard atoms (*) are not molecules' : `"${char}" is not a SMILES atom`);
      const symbol = aromatic ?? organic;
      addAtom({ element: symbol.toUpperCase(), aromatic: Boolean(aromatic), charge: 0, bracketHydrogens: null, isotope: null, chirality: null });
      index += symbol.length;
    }
  }
  if (branches.length) throw new SMILESError('A branch of the SMILES is not closed.');
  if (rings.size) throw new SMILESError(`Ring ${[...rings.keys()][0]} of the SMILES is not closed.`);
  if (pending) throw new SMILESError('The SMILES ends with a bond.');
  return { atoms, bonds, order };
}

// The inside of [...]: isotope, element, chirality, hydrogens, charge and atom class.
function bracketAtom(body, fail) {
  const match = body.match(/^(\d+)?([A-Za-z][a-z]?)(@@|@(?:TH[12])?)?(?:@(?:AL|SP|TB|OH)\d+)?(H\d?)?((?:\+\d*|-\d*)(?:\+|-)*)?(?::\d+)?$/);
  if (!match) throw fail(`[${body}] is not a SMILES atom`);
  const [, isotope, written, chirality, hydrogens, charge] = match;
  let symbol = written;
  // [Sc] is scandium, [sc]… is not an atom; two letters are one element when they name one.
  if (symbol.length === 2 && !AROMATIC_BRACKET.includes(symbol) && !validElement(symbol)) throw fail(`[${body}] names no element`);
  const aromatic = symbol === symbol.toLowerCase();
  if (aromatic && !AROMATIC_BRACKET.includes(symbol)) throw fail(`[${body}] cannot be aromatic`);
  if (!aromatic && !validElement(symbol)) throw fail(`[${body}] names no element`);
  let value = 0;
  if (charge) {
    const sign = charge[0] === '+' ? 1 : -1;
    const digits = charge.match(/^[+-](\d+)/);
    value = sign * (digits ? Number(digits[1]) : charge.length);
  }
  const stereo = chirality === '@' || chirality === '@TH1' ? '@' : chirality === '@@' || chirality === '@TH2' ? '@@' : null;
  return {
    element: symbol.toUpperCase(),
    aromatic,
    charge: value,
    bracketHydrogens: hydrogens ? Number(hydrogens.slice(1) || 1) : 0,
    isotope: isotope ? Number(isotope) : null,
    chirality: stereo,
  };
}

function validElement(symbol) {
  return elementRecord(symbol).z > 0 && elementRecord(symbol).symbol.toUpperCase() === symbol.toUpperCase();
}

/* ---------- Kekulé structure ---------- */

// Aromatic bonds become single and double bonds: each aromatic atom that needs a double bond
// (its valence one short, counting written hydrogens) gets exactly one, by a matching over the
// aromatic bonds, as RDKit's sanitization does. [nH] never takes one; bare n does when it has
// two neighbors, as in pyridine.
function kekulize(molecule) {
  const { atoms, bonds } = molecule;
  const aromaticBonds = bonds.filter((bond) => bond.aromatic);
  if (!aromaticBonds.length) return;
  const sigma = atoms.map(() => 0);
  const extra = atoms.map(() => 0);
  for (const bond of bonds) {
    sigma[bond.a] += 1;
    sigma[bond.b] += 1;
    if (!bond.aromatic && bond.order > 1) {
      extra[bond.a] += bond.order - 1;
      extra[bond.b] += bond.order - 1;
    }
  }
  const needs = atoms.map((atom, index) => {
    if (!atom.aromatic) return false;
    const used = sigma[index] + extra[index];
    if (atom.bracketHydrogens !== null) return targetValence(atom) - used - atom.bracketHydrogens === 1;
    // Organic subset: hydrogens come after the Kekulé structure.
    if (atom.element === 'C') return used < 4;
    if (atom.element === 'N' || atom.element === 'P' || atom.element === 'B') return used === 2;
    return false;
  });
  const partner = atoms.map(() => null);
  const adjacency = atoms.map(() => []);
  for (const bond of aromaticBonds) {
    if (!needs[bond.a] || !needs[bond.b]) continue;
    adjacency[bond.a].push(bond);
    adjacency[bond.b].push(bond);
  }
  // Augmenting paths (Kuhn's algorithm) over the atoms that need a double bond.
  const augment = (atom, seen) => {
    for (const bond of adjacency[atom]) {
      const other = bond.a === atom ? bond.b : bond.a;
      if (seen.has(other)) continue;
      seen.add(other);
      if (partner[other] === null || augment(partner[other], seen)) {
        partner[atom] = other;
        partner[other] = atom;
        return true;
      }
    }
    return false;
  };
  for (let atom = 0; atom < atoms.length; atom += 1) {
    if (needs[atom] && partner[atom] === null && !augment(atom, new Set([atom]))) {
      throw new SMILESError('The aromatic rings of the SMILES cannot be kekulized.');
    }
  }
  for (const bond of aromaticBonds) bond.order = partner[bond.a] === bond.b ? 2 : 1;
}

// The valence an aromatic atom of a bracket reaches with its charge (RDKit's isoelectronic rule
// for the common cases).
function targetValence(atom) {
  const base = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, SE: 2, AS: 3, TE: 2 }[atom.element] ?? 4;
  if (atom.element === 'B') return base + atom.charge * -1;
  if (atom.element === 'C') return base - Math.abs(atom.charge);
  return base + atom.charge;
}

/* ---------- Heavy atoms and stereochemistry ---------- */

function heavyMolecule(parsed) {
  const { atoms, bonds, order } = parsed;
  const isHydrogen = atoms.map((atom) => atom.element === 'H');
  const heavyIndex = new Map();
  atoms.forEach((atom, index) => {
    if (!isHydrogen[index]) heavyIndex.set(index, heavyIndex.size);
  });
  const hydrogens = atoms.map((atom) => atom.bracketHydrogens ?? 0);
  for (const bond of bonds) {
    if (isHydrogen[bond.a] && !isHydrogen[bond.b]) hydrogens[bond.b] += 1;
    if (isHydrogen[bond.b] && !isHydrogen[bond.a]) hydrogens[bond.a] += 1;
  }
  const heavyBonds = bonds.filter((bond) => !isHydrogen[bond.a] && !isHydrogen[bond.b]);
  // Implicit hydrogens of the organic subset, from its default valences.
  const valence = atoms.map(() => 0);
  for (const bond of heavyBonds) {
    valence[bond.a] += bond.order;
    valence[bond.b] += bond.order;
  }
  const result = {
    atoms: [],
    bonds: heavyBonds.map((bond) => ({ a: heavyIndex.get(bond.a), b: heavyIndex.get(bond.b), order: bond.order, aromatic: bond.aromatic })),
    stereo: { centers: [], doubleBonds: [] },
  };
  atoms.forEach((atom, index) => {
    if (isHydrogen[index]) return;
    let count = hydrogens[index];
    if (atom.bracketHydrogens === null) {
      const total = valence[index] + hydrogens[index];
      const allowed = (VALENCES[atom.element] ?? []).find((value) => value >= total);
      count += allowed === undefined ? 0 : allowed - total;
    }
    result.atoms.push({ element: atom.element, charge: atom.charge, hydrogens: count, aromatic: atom.aromatic, isotope: atom.isotope });
  });
  // Tetrahedral centers with four neighbors (a hydrogen among them at most), or three and a lone
  // pair (sulfoxides, sulfonium), which RDKit counts after the neighbors.
  atoms.forEach((atom, index) => {
    if (!atom.chirality || isHydrogen[index]) return;
    const slots = order[index].map((neighbor) => (neighbor === null || isHydrogen[neighbor] ? null : heavyIndex.get(neighbor)));
    if (slots.length === 3 && !slots.includes(null)) slots.push(null);
    if (slots.length !== 4 || slots.filter((slot) => slot === null).length > 1) return;
    result.stereo.centers.push({ center: heavyIndex.get(index), order: slots, parity: atom.chirality });
  });
  // Double bonds with a marked single bond on each end: the marks, read outward from the double
  // bond's atoms, are alike for cis and differ for trans (F/C=C/F is trans).
  const marked = (atom, exclude) => {
    for (const bond of bonds) {
      if (!bond.direction || (bond.a !== atom && bond.b !== atom)) continue;
      const other = bond.a === atom ? bond.b : bond.a;
      if (other === exclude) continue;
      const outward = bond.from === atom ? bond.direction : bond.direction === '/' ? '\\' : '/';
      return { other, outward };
    }
    return null;
  };
  for (const bond of bonds) {
    if (bond.aromatic || bond.order !== 2) continue;
    const first = marked(bond.a, bond.b);
    const second = marked(bond.b, bond.a);
    if (!first || !second || isHydrogen[first.other] || isHydrogen[second.other]) continue;
    result.stereo.doubleBonds.push({
      a: heavyIndex.get(bond.a),
      b: heavyIndex.get(bond.b),
      sa: heavyIndex.get(first.other),
      sb: heavyIndex.get(second.other),
      cis: first.outward === second.outward,
    });
  }
  return keepStereogenic(result);
}

/* ---------- Which stereo marks count ---------- */

// Graph-symmetry classes of the heavy atoms, as canonical ranking starts them: element, charge,
// isotope, hydrogens and degree, refined by the neighbors' classes and bond types until stable.
function symmetryClasses(molecule) {
  const { atoms, bonds } = molecule;
  const neighbors = atoms.map(() => []);
  for (const bond of bonds) {
    const type = bond.aromatic ? 'a' : bond.order;
    neighbors[bond.a].push([bond.b, type]);
    neighbors[bond.b].push([bond.a, type]);
  }
  const relabel = (keys) => {
    const index = new Map([...new Set(keys)].sort().map((key, position) => [key, position]));
    return keys.map((key) => index.get(key));
  };
  let classes = relabel(atoms.map((atom, index) => `${atom.element}|${atom.charge}|${atom.isotope ?? ''}|${atom.hydrogens}|${neighbors[index].length}`));
  for (let round = 0; round < atoms.length; round += 1) {
    const next = relabel(classes.map((own, index) => `${own}|${neighbors[index].map(([other, type]) => `${classes[other]}:${type}`).sort().join(',')}`));
    const stable = new Set(next).size === new Set(classes).size;
    classes = next;
    if (stable) break;
  }
  return { classes, neighbors };
}

// The shortest ring through a bond (Infinity when it is in none), by a search that leaves the
// bond out.
function smallestRing(neighbors, a, b) {
  const distance = new Map([[a, 0]]);
  const queue = [a];
  while (queue.length) {
    const atom = queue.shift();
    for (const [other] of neighbors[atom]) {
      if ((atom === a && other === b) || distance.has(other)) continue;
      distance.set(other, distance.get(atom) + 1);
      if (other === b) return distance.get(other) + 1;
      queue.push(other);
    }
  }
  return Infinity;
}

// Marks RDKit (and so the predictors, which read SMILES with it) drops as not stereogenic: a
// center with two neighbors of one symmetry class, unless they are its ring neighbors and
// another marked center shares the ring system (decalin's junctions, 1,4-cyclohexanediol, whose
// relative configuration is real); a nitrogen with three neighbors outside a three-membered ring
// and not a bridgehead; and a double bond in a ring of fewer than eight atoms or with two alike
// substituents on one end. Their geometry in a model is arbitrary.
function keepStereogenic(molecule) {
  const { classes, neighbors } = symmetryClasses(molecule);
  const inRing = (a, b) => Number.isFinite(smallestRing(neighbors, a, b));
  // Ring systems: atoms joined through ring bonds.
  const system = molecule.atoms.map((_, index) => index);
  const find = (index) => (system[index] === index ? index : (system[index] = find(system[index])));
  for (const bond of molecule.bonds) if (inRing(bond.a, bond.b)) system[find(bond.a)] = find(bond.b);
  const marked = molecule.stereo.centers.map((center) => center.center);
  const centers = molecule.stereo.centers.filter((center) => {
    const heavy = center.order.filter((slot) => slot !== null);
    const alike = heavy.filter((slot, k) => heavy.some((other, m) => m !== k && classes[other] === classes[slot]));
    if (alike.length) {
      const ringPair = alike.every((slot) => inRing(center.center, slot));
      const partner = marked.some((other) => other !== center.center && find(other) === find(center.center));
      if (!ringPair || !partner) return false;
    }
    const atom = molecule.atoms[center.center];
    if (atom.element === 'N' && heavy.length + atom.hydrogens < 4) {
      const rings = neighbors[center.center].map(([other]) => smallestRing(neighbors, center.center, other));
      if (!rings.some((size) => size === 3) && rings.filter(Number.isFinite).length < 3) return false;
    }
    return true;
  });
  const doubleBonds = molecule.stereo.doubleBonds.filter((bond) => {
    if (smallestRing(neighbors, bond.a, bond.b) < 8) return false;
    for (const [end, other] of [[bond.a, bond.b], [bond.b, bond.a]]) {
      const substituents = neighbors[end].map(([atom]) => atom).filter((atom) => atom !== other);
      if (substituents.length === 2 && classes[substituents[0]] === classes[substituents[1]]) return false;
    }
    return true;
  });
  return { ...molecule, stereo: { centers, doubleBonds } };
}

/* ---------- Pairing with a model's atoms ---------- */

// The model atom (index into `atoms`) for each SMILES heavy atom, or null. Predictors write a
// SMILES ligand's atoms in the string's order, so that order is tried first; otherwise the
// SMILES graph is matched to the model's own bonds (`bonds`: [{ a, b }] between model atom
// indices).
export function smilesMapping(molecule, atoms, bonds = []) {
  const n = molecule.atoms.length;
  if (atoms.length !== n) return null;
  const same = (i, j) => molecule.atoms[i].element === String(atoms[j].element).toUpperCase();
  const identity = molecule.atoms.map((_, index) => index);
  const inOrder = identity.every((index) => same(index, index));
  const share = !molecule.bonds.length ? 1 : inOrder ? molecule.bonds.filter((bond) => bondLike(atoms[bond.a], atoms[bond.b])).length / molecule.bonds.length : 0;
  // The string's order is taken when every bond of the SMILES joins atoms a bond apart (a
  // carbon skeleton written in another order can come close: reversed decalin keeps 10 of its
  // 11). Otherwise the model's bonds decide; a pose broken badly enough to lose bonds, which
  // they cannot match, keeps the string's order while half its bonds hold, so it is still
  // checked (and fails) rather than left untyped.
  const mapping = inOrder && share === 1 ? identity : graphMapping(molecule, atoms, bonds, same) ?? (inOrder && share >= 0.5 ? identity : null);
  return mapping && bestForStereo(molecule, mapping, atoms);
}

// Among the pairings the molecule's symmetry allows (its automorphisms composed with the
// pairing found), the one whose geometry agrees best with the SMILES's stereo: a meso compound,
// or a symmetric one paired through its bonds, is not then called inverted. A chiral molecule's
// inversion has no such rescue.
function bestForStereo(molecule, mapping, atoms) {
  const { centers, doubleBonds } = molecule.stereo;
  if (!centers.length && !doubleBonds.length) return mapping;
  const mismatches = (candidate) => {
    const position = (index) => {
      const atom = atoms[candidate[index]];
      return [atom.x, atom.y, atom.z];
    };
    let count = 0;
    for (const center of centers) {
      const { partners, sign } = centerTarget(center.order, center.parity);
      if (Math.sign(signedVolume(position(center.center), ...partners.map(position))) !== sign) count += 1;
    }
    for (const bond of doubleBonds) if (cisIn(position, bond.a, bond.b, bond.sa, bond.sb) !== bond.cis) count += 1;
    return count;
  };
  let best = mapping;
  let fewest = mismatches(mapping);
  for (const automorphism of automorphisms(molecule)) {
    if (!fewest) break;
    const candidate = automorphism.map((image) => mapping[image]);
    const count = mismatches(candidate);
    if (count < fewest) {
      best = candidate;
      fewest = count;
    }
  }
  return best;
}

// The molecule's automorphisms: atoms onto atoms of the same symmetry class, each bond onto a
// bond of the same type; a backtracking search that stops at `limit`.
function automorphisms(molecule, limit = 256) {
  const { classes, neighbors } = symmetryClasses(molecule);
  const n = molecule.atoms.length;
  const typeOf = neighbors.map((list) => new Map(list));
  const visit = [];
  const seen = new Set();
  for (let start = 0; start < n; start += 1) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    while (queue.length) {
      const atom = queue.shift();
      visit.push(atom);
      for (const [other] of neighbors[atom]) {
        if (seen.has(other)) continue;
        seen.add(other);
        queue.push(other);
      }
    }
  }
  const image = new Array(n).fill(null);
  const used = new Set();
  const found = [];
  let steps = 0;
  const search = (depth) => {
    if (found.length >= limit || (steps += 1) > 100000) return;
    if (depth === n) {
      found.push([...image]);
      return;
    }
    const atom = visit[depth];
    const anchor = neighbors[atom].find(([other]) => image[other] !== null)?.[0];
    const candidates = anchor === undefined ? classes.map((_, index) => index) : [...typeOf[image[anchor]].keys()];
    for (const candidate of candidates) {
      if (used.has(candidate) || classes[candidate] !== classes[atom]) continue;
      if (!neighbors[atom].every(([other, type]) => image[other] === null || typeOf[candidate].get(image[other]) === type)) continue;
      image[atom] = candidate;
      used.add(candidate);
      search(depth + 1);
      image[atom] = null;
      used.delete(candidate);
    }
  };
  search(0);
  return found;
}

/* ---------- Stereo geometry ---------- */

// The volume of three vectors from a center, over the product of their lengths: its sign is
// the handedness of the three partners.
export function signedVolume(center, a, b, c) {
  const u = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const v = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
  const w = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
  const volume = u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
  const scale = Math.hypot(...u) * Math.hypot(...v) * Math.hypot(...w);
  return scale > 0 ? volume / scale : 0;
}

// Whether two substituents of a double bond a=b lie on the same side, from their projections
// across the bond's axis; p(index) gives an atom's position.
export function cisIn(p, a, b, sa, sb) {
  const axis = [p(b)[0] - p(a)[0], p(b)[1] - p(a)[1], p(b)[2] - p(a)[2]];
  const u = [p(sa)[0] - p(a)[0], p(sa)[1] - p(a)[1], p(sa)[2] - p(a)[2]];
  const v = [p(sb)[0] - p(b)[0], p(sb)[1] - p(b)[1], p(sb)[2] - p(b)[2]];
  const length2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  const project = (w) => {
    const t = (w[0] * axis[0] + w[1] * axis[1] + w[2] * axis[2]) / length2;
    return [w[0] - t * axis[0], w[1] - t * axis[1], w[2] - t * axis[2]];
  };
  const pu = project(u);
  const pv = project(v);
  return pu[0] * pv[0] + pu[1] * pv[1] + pu[2] * pv[2] > 0;
}

// A SMILES center as three partners and the sign of their signedVolume(): seen from the first
// neighbor, @ lists the other three anticlockwise; a hydrogen or lone pair (null) moved to the
// front takes one swap per place.
export function centerTarget(order, parity) {
  let slots = [...order];
  let handedness = parity;
  const hydrogen = slots.indexOf(null);
  if (hydrogen > 0) {
    slots = [null, ...slots.filter((_, k) => k !== hydrogen)];
    if (hydrogen % 2 === 1) handedness = handedness === '@' ? '@@' : '@';
  }
  return { partners: slots.slice(1), sign: handedness === '@' ? -1 : 1 };
}

function bondLike(first, second) {
  const d = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
  return d <= elementRecord(first.element).covalent + elementRecord(second.element).covalent + 0.45;
}

// An isomorphism between the SMILES graph and the model's bonds that keeps elements: a
// backtracking search, from the rarest element outward.
function graphMapping(molecule, atoms, bonds, same) {
  const n = molecule.atoms.length;
  if (bonds.length !== molecule.bonds.length) return null;
  const smilesNeighbors = molecule.atoms.map(() => []);
  for (const bond of molecule.bonds) {
    smilesNeighbors[bond.a].push(bond.b);
    smilesNeighbors[bond.b].push(bond.a);
  }
  const modelNeighbors = atoms.map(() => new Set());
  for (const bond of bonds) {
    modelNeighbors[bond.a].add(bond.b);
    modelNeighbors[bond.b].add(bond.a);
  }
  const counts = new Map();
  for (const atom of molecule.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  // Visit order: each next atom bonded to one already placed where possible.
  const visit = [];
  const placed = new Set();
  while (visit.length < n) {
    let start = -1;
    for (let index = 0; index < n; index += 1) {
      if (placed.has(index)) continue;
      if (start < 0 || counts.get(molecule.atoms[index].element) < counts.get(molecule.atoms[start].element)) start = index;
    }
    const queue = [start];
    placed.add(start);
    while (queue.length) {
      const atom = queue.shift();
      visit.push(atom);
      for (const other of smilesNeighbors[atom]) {
        if (placed.has(other)) continue;
        placed.add(other);
        queue.push(other);
      }
    }
  }
  const mapping = new Array(n).fill(null);
  const used = new Set();
  let steps = 0;
  const search = (depth) => {
    if (depth === n) return true;
    if ((steps += 1) > 200000) return false;
    const atom = visit[depth];
    const anchor = smilesNeighbors[atom].find((other) => mapping[other] !== null);
    const candidates = anchor === undefined ? atoms.map((_, index) => index) : [...modelNeighbors[mapping[anchor]]];
    for (const candidate of candidates) {
      if (used.has(candidate) || !same(atom, candidate) || modelNeighbors[candidate].size !== smilesNeighbors[atom].length) continue;
      if (!smilesNeighbors[atom].every((other) => mapping[other] === null || modelNeighbors[candidate].has(mapping[other]))) continue;
      mapping[atom] = candidate;
      used.add(candidate);
      if (search(depth + 1)) return true;
      mapping[atom] = null;
      used.delete(candidate);
    }
    return false;
  };
  return search(0) ? mapping : null;
}
