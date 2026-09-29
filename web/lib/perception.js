// Chemical perception of a small molecule as RDKit's sanitization does it (release 2026.03; Landrum
// et al., https://www.rdkit.org): nitro and similar groups rewritten in charge-separated form,
// implicit hydrogens from RDKit's valence model, the symmetrized smallest set of smallest rings,
// aromaticity under RDKit's default model, conjugation and hybridization. PoseBusters takes its
// geometry limits from RDKit (see dg-bounds.js), so the pose checks must see a molecule the way
// RDKit sees it: which rings are aromatic decides which rings have to be flat, and hybridization
// decides the bond angles.
//
// Input: { atoms: [{ element, charge }], bonds: [{ a, b, order }] } with heavy atoms only and bond
// orders 1, 2 or 3 (a Kekulé structure; aromatic bonds, order 1.5, are kekulized first). Metals
// are left to the caller: RDKit's rewriting of bonds to metals as dative bonds is not done, and
// checkPose() removes metal atoms first. The
// result keeps atom and bond order and adds, per atom: z, hydrogens (implicit), degree, valence
// (total), aromatic, hybridization ('S', 'SP', 'SP2', 'SP3', 'SP3D', 'SP3D2' or ''), ringCount
// and minRing (the smallest ring, 0 outside rings); per bond: order (1.5 once aromatic),
// aromatic, conjugated, ringCount; and rings (atom lists), bondRings, neighbors (bond indices per
// atom, in input order) and distances (bonds between atoms). `problem` is set when RDKit would
// reject the molecule (an atom over its allowed valence, or aromatic bonds that cannot be
// kekulized); the other fields are then unreliable.

// Symbol, covalent radius, van der Waals radius, outer-shell electrons and allowed valences (-1:
// any) of elements 1–103, as in RDKit's periodic table.
const ELEMENT_DATA = 'H 0.31 1.2 1 1|He 0.28 1.4 2 0|Li 1.28 2.2 1 1,-1|Be 0.96 1.9 2 2|B 0.84 1.8 3 3|C 0.76 1.7 4 4|N 0.71 1.6 5 3|O 0.66 1.55 6 2|F 0.57 1.5 7 1|Ne 0.58 1.54 8 0|Na 1.66 2.4 1 1,-1|Mg 1.41 2.2 2 2,-1|Al 1.21 2.1 3 3|Si 1.11 2.1 4 4|P 1.07 1.95 5 3,5|S 1.05 1.8 6 2,4,6|Cl 1.02 1.8 7 1|Ar 1.06 1.88 8 0|K 2.03 2.8 1 1,-1|Ca 1.76 2.4 2 2,-1|Sc 1.7 2.3 3 -1|Ti 1.6 2.15 4 -1|V 1.52 2.05 5 -1|Cr 1.39 2.05 6 -1|Mn 1.39 2.05 7 -1|Fe 1.32 2.05 8 -1|Co 1.26 2 9 -1|Ni 1.24 2 10 -1|Cu 1.32 2 11 -1|Zn 1.22 2.1 2 -1|Ga 1.22 2.1 3 3|Ge 1.2 2.1 4 4|As 1.19 2.05 5 3,5|Se 1.2 1.9 6 2,4,6|Br 1.2 1.9 7 1|Kr 1.16 2.02 8 0|Rb 2.2 2.9 1 1,-1|Sr 1.95 2.55 2 2,-1|Y 1.9 2.4 3 -1|Zr 1.75 2.3 4 -1|Nb 1.64 2.15 5 -1|Mo 1.54 2.1 6 -1|Tc 1.47 2.05 7 -1|Ru 1.46 2.05 8 -1|Rh 1.42 2 9 -1|Pd 1.39 2.05 10 -1|Ag 1.45 2.1 11 -1|Cd 1.44 2.2 2 -1|In 1.42 2.2 3 3|Sn 1.39 2.25 4 2,4|Sb 1.39 2.2 5 3,5|Te 1.38 2.1 6 2,4,6|I 1.39 2.1 7 1,3,5|Xe 1.4 2.16 8 0,2,4,6|Cs 2.44 3 1 1|Ba 2.15 2.7 2 2|La 2.07 2.5 3 -1|Ce 2.04 2.48 4 -1|Pr 2.03 2.47 3 -1|Nd 2.01 2.45 4 -1|Pm 1.99 2.43 3 -1|Sm 1.98 2.42 4 -1|Eu 1.98 2.4 3 -1|Gd 1.96 2.38 4 -1|Tb 1.94 2.37 3 -1|Dy 1.92 2.35 4 -1|Ho 1.92 2.33 3 -1|Er 1.89 2.32 4 -1|Tm 1.9 2.3 3 -1|Yb 1.87 2.28 4 -1|Lu 1.87 2.27 3 -1|Hf 1.75 2.25 4 -1|Ta 1.7 2.2 5 -1|W 1.62 2.1 6 -1|Re 1.51 2.05 7 -1|Os 1.44 2 8 -1|Ir 1.41 2 9 -1|Pt 1.36 2.05 10 -1|Au 1.36 2.1 11 -1|Hg 1.32 2.05 2 -1|Tl 1.45 2.2 3 -1|Pb 1.46 2.3 4 2,4|Bi 1.48 2.3 5 3,5|Po 1.4 2 6 2,4,6|At 1.5 2 7 1,3,5|Rn 1.5 2 8 0|Fr 2.6 2 1 1|Ra 2.21 2 2 2|Ac 2.15 2 3 -1|Th 2.06 2.4 4 -1|Pa 2 2 3 -1|U 1.96 2.3 4 -1|Np 1.9 2 3 -1|Pu 1.87 2 4 -1|Am 1.8 2 3 -1|Cm 1.69 2 4 -1|Bk 1.6 2 3 -1|Cf 1.6 2 4 -1|Es 1.6 2 3 -1|Fm 1.6 2 4 -1|Md 1.6 2 3 -1|No 1.6 2 4 -1|Lr 1.6 2 3 -1';

const BY_SYMBOL = new Map();
const BY_NUMBER = [null];
ELEMENT_DATA.split('|').forEach((row, index) => {
  const [symbol, covalent, vdw, outer, valences] = row.split(' ');
  const record = { z: index + 1, symbol, covalent: Number(covalent), vdw: Number(vdw), outer: Number(outer), valences: valences.split(',').map(Number) };
  BY_SYMBOL.set(symbol.toUpperCase(), record);
  BY_NUMBER.push(record);
});
const MAX_Z = BY_NUMBER.length - 1;
const UNKNOWN = { z: 0, symbol: '*', covalent: 0, vdw: 0, outer: 0, valences: [-1] };

export function elementRecord(element) {
  const key = String(element ?? '').toUpperCase();
  return BY_SYMBOL.get(key === 'D' ? 'H' : key) ?? UNKNOWN;
}

export function elementByNumber(z) {
  return BY_NUMBER[z] ?? UNKNOWN;
}

// RDKit's electronegativity proxy: more outer-shell electrons, then the lighter element.
function moreElectronegative(z1, z2) {
  const a = elementByNumber(z1).outer;
  const b = elementByNumber(z2).outer;
  return a > b || (a === b && z1 < z2);
}

const defaultValence = (z) => elementByNumber(z).valences[0];

/* ---------- Molecule ---------- */

export function perceiveMolecule(input) {
  const atoms = input.atoms.map((atom, index) => {
    const record = elementRecord(atom.element);
    return { index, z: record.z, symbol: record.symbol, charge: Math.trunc(Number(atom.charge) || 0), hydrogens: 0, valence: 0, explicitValence: 0, degree: 0, aromatic: false, hybridization: '', ringCount: 0, minRing: 0 };
  });
  const bonds = input.bonds.map((bond, index) => ({ index, a: bond.a, b: bond.b, order: Number(bond.order) || 1, aromatic: false, conjugated: false, ringCount: 0 }));
  const neighbors = atoms.map(() => []);
  for (const bond of bonds) {
    neighbors[bond.a].push(bond.index);
    neighbors[bond.b].push(bond.index);
  }
  const molecule = { atoms, bonds, neighbors, rings: [], bondRings: [], problem: null };
  for (const atom of atoms) atom.degree = neighbors[atom.index].length;
  if (bonds.some((bond) => bond.order === 1.5) && !kekulize(molecule)) molecule.problem = 'Its aromatic bonds cannot be kekulized.';
  cleanUp(molecule);
  assignValences(molecule);
  molecule.distances = topologicalDistances(molecule);
  findRings(molecule);
  if (!molecule.problem) {
    setAromaticity(molecule);
    setConjugation(molecule);
    setHybridization(molecule);
  }
  return molecule;
}

export function otherAtom(bond, atom) {
  return bond.a === atom ? bond.b : bond.a;
}

export function bondBetween(molecule, a, b) {
  for (const index of molecule.neighbors[a]) {
    const bond = molecule.bonds[index];
    if (bond.a === b || bond.b === b) return bond;
  }
  return null;
}

/* ---------- Kekulé structure ---------- */

// Aromatic bonds (order 1.5, as MOL2 files write them) become single and double bonds by a
// matching over the aromatic bonds. Atoms with room for another bond must take a double bond,
// except neutral nitrogen and phosphorus with two ring neighbors, which may instead carry a
// hydrogen (pyrrole against pyridine); neutral oxygen, sulfur and selenium never do.
function kekulize(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  const aromaticBonds = bonds.filter((bond) => bond.order === 1.5);
  const required = new Set();
  const optional = new Set();
  for (const bond of aromaticBonds) {
    for (const index of [bond.a, bond.b]) {
      if (required.has(index) || optional.has(index)) continue;
      const atom = atoms[index];
      let used = 0;
      for (const bondIndex of neighbors[index]) used += bonds[bondIndex].order === 1.5 ? 1 : bonds[bondIndex].order;
      const valences = elementByNumber(effectiveNumber(atom)).valences;
      const room = (valences.find((value) => value >= used) ?? -1) - used;
      if (room < 1) continue;
      if ((atom.z === 8 || atom.z === 16 || atom.z === 34) && !atom.charge) continue;
      if ((atom.z === 7 || atom.z === 15) && !atom.charge && neighbors[index].length === 2) optional.add(index);
      else required.add(index);
    }
  }
  // Backtracking: aromatic systems of ligands are small, and rings of odd size rule out a simple
  // bipartite matching.
  const partner = new Map();
  const order = [...required];
  let steps = 0;
  const assign = (position) => {
    while (position < order.length && partner.has(order[position])) position += 1;
    if (position === order.length) return true;
    if (++steps > 100000) return false;
    const index = order[position];
    for (const bondIndex of neighbors[index]) {
      const bond = bonds[bondIndex];
      if (bond.order !== 1.5) continue;
      const other = otherAtom(bond, index);
      if (partner.has(other) || (!required.has(other) && !optional.has(other))) continue;
      partner.set(index, other);
      partner.set(other, index);
      if (assign(position + 1)) return true;
      partner.delete(index);
      partner.delete(other);
    }
    return false;
  };
  if (!assign(0)) return false;
  for (const bond of aromaticBonds) bond.order = partner.get(bond.a) === bond.b ? 2 : 1;
  return true;
}

/* ---------- Cleanup ---------- */

// RDKit's cleanUp(): neutral pentavalent nitrogen with a double bond to oxygen (N(=O)=O) or a
// triple bond to nitrogen, phosphorus with double bonds to O and to C or N, and halogens with
// double bonds to oxygen are written in charge-separated form.
function cleanUp(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  const sum = (index) => neighbors[index].reduce((total, bondIndex) => total + bonds[bondIndex].order, 0);
  const nitrogens = [];
  for (const atom of atoms) {
    if (atom.z !== 7 || atom.charge || sum(atom.index) !== 5) continue;
    nitrogens.push(atom.index);
    for (const bondIndex of neighbors[atom.index]) {
      const bond = bonds[bondIndex];
      const other = atoms[otherAtom(bond, atom.index)];
      if (other.z === 8 && !other.charge && bond.order === 2) {
        bond.order = 1;
        atom.charge = 1;
        other.charge = -1;
        break;
      }
    }
  }
  for (const index of nitrogens) {
    const atom = atoms[index];
    for (const bondIndex of neighbors[index]) {
      const bond = bonds[bondIndex];
      const other = atoms[otherAtom(bond, index)];
      if (other.z === 7 && !other.charge && bond.order === 3) {
        bond.order = 2;
        atom.charge = 1;
        other.charge = -1;
        break;
      }
    }
  }
  for (const atom of atoms) {
    if (atom.z === 15 && !atom.charge && sum(atom.index) === 5 && neighbors[atom.index].length === 3) {
      let toOxygen = null;
      let toCarbon = false;
      for (const bondIndex of neighbors[atom.index]) {
        const bond = bonds[bondIndex];
        const other = atoms[otherAtom(bond, atom.index)];
        if (other.z === 8 && !other.charge && bond.order === 2) toOxygen = bond;
        else if ((other.z === 6 || other.z === 7) && other.degree >= 2 && bond.order === 2) toCarbon = true;
      }
      if (toCarbon && toOxygen) {
        atoms[otherAtom(toOxygen, atom.index)].charge = -1;
        toOxygen.order = 1;
        atom.charge = 1;
      }
    } else if ((atom.z === 17 || atom.z === 35 || atom.z === 53) && !atom.charge) {
      const valence = sum(atom.index);
      const wanted = valence === 7 ? 3 : valence === 5 ? 2 : valence === 3 ? 1 : 0;
      if (!wanted || neighbors[atom.index].length !== wanted + 1) continue;
      const doubles = neighbors[atom.index].map((bondIndex) => bonds[bondIndex]).filter((bond) => bond.order === 2 && atoms[otherAtom(bond, atom.index)].z === 8 && !atoms[otherAtom(bond, atom.index)].charge);
      if (doubles.length !== wanted) continue;
      for (const bond of doubles) {
        bond.order = 1;
        atoms[otherAtom(bond, atom.index)].charge = -1;
      }
      atom.charge = wanted;
    }
  }
}

/* ---------- Valences and hydrogens ---------- */

function effectiveNumber(atom) {
  const valences = elementByNumber(atom.z).valences;
  if (valences.length === 1 && valences[0] === -1) return atom.z;
  return Math.min(MAX_Z, Math.max(0, atom.z - atom.charge));
}

const canBeHypervalent = (atom, effective) => (effective > 16 && (atom.z === 15 || atom.z === 16)) || (effective > 34 && (atom.z === 33 || atom.z === 34));

// Explicit valence from the Kekulé bonds, then RDKit's implicit valence: the smallest allowed
// valence of the isoelectronic element (N+ as C, O- as F) at or above it. An atom above every
// allowed valence fails RDKit's sanitization.
function assignValences(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  for (const atom of atoms) {
    let explicit = 0;
    for (const bondIndex of neighbors[atom.index]) explicit += bonds[bondIndex].order;
    explicit = Math.round(explicit + 0.1);
    atom.explicitValence = explicit;
    const original = elementByNumber(atom.z).valences;
    let effective = effectiveNumber(atom);
    let valences = elementByNumber(effective).valences;
    // The explicit-valence check of calculateExplicitValence().
    let maximum = valences[valences.length - 1];
    let offset = 0;
    if (canBeHypervalent(atom, effective)) {
      maximum = original[original.length - 1];
      offset = -atom.charge;
    }
    if (maximum >= 0 && original[original.length - 1] >= 0 && explicit + offset > maximum && !molecule.problem) {
      molecule.problem = `Atom ${atom.index + 1} (${atom.symbol}) has a valence of ${explicit}, more than RDKit allows.`;
    }
    let hydrogens = 0;
    if (atom.z && effective && defaultValence(effective) !== -1) {
      let wanted = explicit;
      if (canBeHypervalent(atom, effective)) {
        effective = atom.z;
        wanted -= atom.charge;
        valences = original;
      }
      hydrogens = -1;
      for (const value of valences) {
        if (value < 0) break;
        if (wanted <= value) {
          hydrogens = value - wanted;
          break;
        }
      }
      if (hydrogens < 0) hydrogens = 0;
    }
    atom.hydrogens = hydrogens;
    atom.valence = explicit + hydrogens;
  }
}

/* ---------- Topology ---------- */

function topologicalDistances(molecule) {
  const n = molecule.atoms.length;
  const distances = new Float64Array(n * n).fill(1e8);
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start += 1) {
    distances[start * n + start] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const atom = queue[head++];
      const next = distances[start * n + atom] + 1;
      for (const bondIndex of molecule.neighbors[atom]) {
        const other = otherAtom(molecule.bonds[bondIndex], atom);
        if (distances[start * n + other] > next) {
          distances[start * n + other] = next;
          queue[tail++] = other;
        }
      }
    }
  }
  return distances;
}

// The rings RDKit keeps after sanitization: its smallest set of smallest rings (findSSSR(), after
// Figueras 1996, J Chem Inf Comput Sci 36:986) symmetrized by symmetrizeSSSR(), where a ring found
// along the way joins the set when it could replace one of its rings (same size, sharing a bond
// and having every bond only that ring provides), so cubane has six rings. The search order is
// RDKit's, because the order of the rings decides some aromaticity: an oxadiazole whose oxygen
// lies on a macrocycle found first stays non-aromatic in RDKit.
function findRings(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  const n = atoms.length;
  const degrees = atoms.map((atom) => neighbors[atom.index].length);
  const active = new Uint8Array(bonds.length).fill(1);
  const invariants = new Set();
  const ringBonds = new Uint8Array(bonds.length);
  const ringAtoms = new Uint8Array(n);
  const extras = [];
  const invariant = (ring) => ring.reduce((sum, atom) => sum | (1n << BigInt(atom)), 0n);
  const mark = (ring) => {
    for (let index = 0; index < ring.length; index += 1) {
      ringAtoms[ring[index]] = 1;
      ringBonds[bondBetween(molecule, ring[index], ring[(index + 1) % ring.length]).index] = 1;
    }
  };
  const trim = (candidate, changed, degree, activeBonds) => {
    for (const bondIndex of neighbors[candidate]) {
      if (!activeBonds[bondIndex]) continue;
      const other = otherAtom(bonds[bondIndex], candidate);
      if (degree[other] <= 2) changed.push(other);
      activeBonds[bondIndex] = 0;
      degree[other] -= 1;
      degree[candidate] -= 1;
    }
  };
  // All smallest rings through root (breadth-first, Figueras), avoiding forbidden atoms.
  const smallest = (root, activeBonds, forbidden = []) => {
    const done = new Uint8Array(n);
    for (const atom of forbidden) done[atom] = 2;
    const parents = new Int32Array(n).fill(-1);
    const depths = new Int32Array(n);
    const queue = [root];
    const rings = [];
    let size = Infinity;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      done[current] = 2;
      const depth = depths[current] + 1;
      if (depth > size) break;
      for (const bondIndex of neighbors[current]) {
        if (!activeBonds[bondIndex]) continue;
        const next = otherAtom(bonds[bondIndex], current);
        if (done[next] === 2 || parents[current] === next) continue;
        if (done[next] === 0) {
          parents[next] = current;
          done[next] = 1;
          depths[next] = depth;
          queue.push(next);
          continue;
        }
        let ring = [next];
        let parent = parents[next];
        while (parent !== -1 && parent !== root) {
          ring.push(parent);
          parent = parents[parent];
        }
        ring.unshift(current);
        parent = parents[current];
        while (parent !== -1) {
          // The paths meet before the root: not a ring through it.
          if (ring.includes(parent)) {
            ring = [];
            break;
          }
          ring.unshift(parent);
          parent = parents[parent];
        }
        if (ring.length > 1) {
          if (ring.length > size) return rings;
          size = ring.length;
          rings.push(ring);
        }
      }
    }
    return rings;
  };
  const keep = (list, ring) => {
    const key = invariant(ring);
    if (invariants.has(key)) return false;
    list.push(ring);
    invariants.add(key);
    return true;
  };
  const d2Rings = (found, nodes) => {
    const duplicates = new Map();
    const partners = new Map();
    const push = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    for (const candidate of nodes) {
      const rings = smallest(candidate, active);
      for (const ring of rings) {
        const key = invariant(ring);
        if (!duplicates.has(key)) duplicates.set(key, []);
        const earlier = duplicates.get(key);
        if (!invariants.has(key)) {
          found.push(ring);
          invariants.add(key);
          mark(ring);
        } else {
          for (const other of earlier) {
            push(partners, candidate, other);
            push(partners, other, candidate);
          }
        }
        earlier.push(candidate);
      }
      // A chain that closes no ring can be trimmed away at once.
      if (!rings.length) {
        const changed = [candidate];
        while (changed.length) trim(changed.shift(), changed, degrees, active);
      }
    }
    // Nodes that found the same ring may each close another ring once the others are cut off.
    for (const key of [...duplicates.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const candidates = duplicates.get(key);
      if (candidates.length < 2) continue;
      const rings = [];
      let size = Infinity;
      for (const candidate of candidates) {
        const degree = degrees.slice();
        const activeBonds = active.slice();
        for (const other of partners.get(candidate) ?? []) trim(other, [], degree, activeBonds);
        for (const ring of smallest(candidate, activeBonds)) {
          size = Math.min(size, ring.length);
          rings.push(ring);
        }
      }
      for (const ring of rings) if (ring.length === size) keep(found, ring);
    }
  };
  const d3Rings = (found, candidate) => {
    const rings = smallest(candidate, active);
    for (const ring of rings) keep(found, ring);
    if (rings.length >= 3) return;
    const ringNeighbors = neighbors[candidate].filter((bondIndex) => active[bondIndex]).slice(0, 3).map((bondIndex) => otherAtom(bonds[bondIndex], candidate));
    if (ringNeighbors.length < 3) throw new Error('ring search: neighbor not found');
    if (rings.length === 2) {
      const shared = ringNeighbors.find((atom) => rings[0].includes(atom) && rings[1].includes(atom));
      if (shared === undefined) throw new Error('ring search: third ring not found');
      for (const ring of smallest(candidate, active, [shared])) keep(found, ring);
    } else if (rings.length === 1) {
      const outside = ringNeighbors.findIndex((atom) => !rings[0].includes(atom));
      const [first, second] = ringNeighbors.filter((_, index) => index !== (outside < 0 ? 0 : outside));
      for (const ring of smallest(candidate, active, [second])) keep(found, ring);
      for (const ring of smallest(candidate, active, [first])) keep(found, ring);
    }
  };
  // Rings beyond the expected count: the smallest that add new bonds are kept, preferring among
  // rings of one size those overlapping most with what is kept; the rest are extras.
  const removeExtra = (found) => {
    found.sort((a, b) => a.length - b.length);
    const masks = found.map((ring) => ring.reduce((mask, atom, index) => mask | (1n << BigInt(bondBetween(molecule, atom, ring[(index + 1) % ring.length]).index)), 0n));
    const available = found.map(() => true);
    const kept = found.map(() => false);
    const popcount = (value) => {
      let count = 0;
      for (let rest = value; rest; rest &= rest - 1n) count += 1;
      return count;
    };
    let union = 0n;
    for (let i = 0; i < found.length; i += 1) {
      if ((masks[i] & union) === masks[i]) available[i] = false;
      if (!available[i]) continue;
      union |= masks[i];
      kept[i] = true;
      const consider = new Set();
      for (let j = i + 1; j < found.length; j += 1) if (available[j] && found[j].length === found[i].length) consider.add(j);
      while (consider.size) {
        let best = i + 1;
        let overlap = -1;
        for (let j = i + 1; j < found.length && found[j].length === found[i].length; j += 1) {
          if (!consider.has(j) || !available[j]) continue;
          const count = popcount(masks[j] & union);
          if (count > overlap) {
            overlap = count;
            best = j;
          }
        }
        consider.delete(best);
        available[best] = false;
        if ((masks[best] & union) !== masks[best]) {
          kept[best] = true;
          union |= masks[best];
        }
      }
    }
    const result = found.filter((_, index) => kept[index]);
    extras.push(...found.filter((_, index) => !kept[index]));
    return result;
  };

  // Fragments, each with its atoms in index order.
  const fragmentOf = new Int32Array(n).fill(-1);
  const fragments = [];
  for (let start = 0; start < n; start += 1) {
    if (fragmentOf[start] >= 0) continue;
    const id = fragments.length;
    const stack = [start];
    fragmentOf[start] = id;
    while (stack.length) {
      const atom = stack.pop();
      for (const bondIndex of neighbors[atom]) {
        const other = otherAtom(bonds[bondIndex], atom);
        if (fragmentOf[other] < 0) {
          fragmentOf[other] = id;
          stack.push(other);
        }
      }
    }
    fragments.push([]);
  }
  for (let atom = 0; atom < n; atom += 1) fragments[fragmentOf[atom]].push(atom);

  const rings = [];
  for (const fragment of fragments) {
    if (fragment.length < 3) continue;
    const changed = [];
    let degreeSum = 0;
    for (const atom of fragment) {
      degreeSum += degrees[atom];
      if (degrees[atom] < 2) changed.push(atom);
    }
    const fragmentBonds = degreeSum / 2;
    const expected = fragmentBonds - fragment.length + 1;
    if (expected < 1) continue;
    const done = new Uint8Array(n);
    let doneCount = 0;
    let found = [];
    while (doneCount <= fragment.length - 3) {
      while (changed.length) {
        const candidate = changed.shift();
        if (done[candidate]) continue;
        done[candidate] = 1;
        doneCount += 1;
        trim(candidate, changed, degrees, active);
      }
      const d2 = [];
      const forbidden = new Uint8Array(n);
      const markChain = (root) => {
        for (const bondIndex of neighbors[root]) {
          if (!active[bondIndex]) continue;
          const other = otherAtom(bonds[bondIndex], root);
          if (!forbidden[other] && degrees[other] === 2) {
            forbidden[other] = 1;
            markChain(other);
          }
        }
      };
      for (;;) {
        const root = fragment.find((atom) => degrees[atom] === 2 && !forbidden[atom]);
        if (root === undefined) break;
        d2.push(root);
        forbidden[root] = 1;
        markChain(root);
      }
      if (d2.length) {
        d2Rings(found, d2);
        for (const atom of d2) {
          done[atom] = 1;
          doneCount += 1;
          trim(atom, changed, degrees, active);
        }
      } else if (doneCount <= fragment.length - 3) {
        const candidate = fragment.find((atom) => degrees[atom] === 3);
        if (candidate === undefined) break;
        d3Rings(found, candidate);
        done[candidate] = 1;
        doneCount += 1;
        trim(candidate, changed, degrees, active);
      }
    }
    // Highly fused systems can hide rings from the search: close them over non-ring bonds between
    // ring atoms.
    if (found.length < expected) {
      const dead = new Uint8Array(bonds.length);
      const nextBond = () => {
        for (let index = 0; index < fragmentBonds && index < bonds.length; index += 1) {
          const bond = bonds[index];
          if (!ringBonds[index] && !dead[index] && ringAtoms[bond.a] && ringAtoms[bond.b]) return bond;
        }
        return null;
      };
      for (let bond = nextBond(); bond; bond = nextBond()) {
        const ring = pathRing(molecule, bond.a, bond.b, ringAtoms, invariants, invariant);
        if (ring && keep(found, ring)) mark(ring);
        else dead[bond.index] = 1;
      }
    }
    if (found.length > expected) found = removeExtra(found);
    rings.push(...found);
  }

  // Symmetrization.
  const toBonds = (ring) => ring.map((atom, position) => bondBetween(molecule, atom, ring[(position + 1) % ring.length]).index);
  const bondRings = rings.map(toBonds);
  const counts = new Int32Array(bonds.length);
  for (const ring of bondRings) for (const bondIndex of ring) counts[bondIndex] += 1;
  const result = rings.slice();
  const resultBonds = bondRings.slice();
  for (const extra of extras) {
    const extraBonds = toBonds(extra);
    const members = new Set(extraBonds);
    for (const ring of bondRings) {
      if (ring.length !== extraBonds.length) continue;
      let share = false;
      let replaces = true;
      for (const bondIndex of ring) {
        if (counts[bondIndex] === 1 || !share) {
          if (members.has(bondIndex)) share = true;
          else if (counts[bondIndex] === 1) replaces = false;
        }
      }
      if (share && replaces) {
        result.push(extra);
        resultBonds.push(extraBonds);
        break;
      }
    }
  }
  molecule.rings = result;
  molecule.bondRings = resultBonds;
  for (const ring of result) {
    for (const atom of ring) {
      atoms[atom].ringCount += 1;
      if (!atoms[atom].minRing || ring.length < atoms[atom].minRing) atoms[atom].minRing = ring.length;
    }
  }
  for (const ring of resultBonds) for (const bondIndex of ring) bonds[bondIndex].ringCount += 1;
}

// Breadth-first search over ring atoms for a new ring closed by the bond start–end.
function pathRing(molecule, start, end, ringAtoms, invariants, invariant) {
  const queue = [[start]];
  for (let head = 0; head < queue.length; head += 1) {
    if (queue.length > 200000) return null;
    const path = queue[head];
    const current = path[path.length - 1];
    for (const bondIndex of molecule.neighbors[current]) {
      const next = otherAtom(molecule.bonds[bondIndex], current);
      if (next === end) {
        if (current !== start) {
          const ring = [...path, next];
          if (!invariants.has(invariant(ring))) return ring;
        }
      } else if (ringAtoms[next] && !path.includes(next)) {
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

export function atomInRingOfSize(molecule, atom, size) {
  return molecule.rings.some((ring) => ring.length === size && ring.includes(atom));
}

export function bondInRingOfSize(molecule, bond, size) {
  return molecule.bondRings.some((ring) => ring.length === size && ring.includes(bond));
}

/* ---------- Aromaticity (RDKit's default model) ---------- */

const VACANT = 0;
const ONE = 1;
const TWO = 2;
const ANY = 4;
const NONE = 5;

// Electrons an atom can give to a π system (RDKit's countAtomElec()): -1 for atoms that can take no
// part (univalent elements, more than three neighbors counting hydrogens).
function countAtomElectrons(molecule, atom) {
  const dv = defaultValence(atom.z);
  if (dv <= 1) return -1;
  const degree = atom.degree + atom.hydrogens;
  if (degree > 3) return -1;
  const lonePairs = Math.max(elementByNumber(atom.z).outer - dv - atom.charge, 0);
  let result = dv - degree + lonePairs;
  if (result > 1 && atom.explicitValence - atom.degree > 1) result = 1;
  return result;
}

function nonRingMultipleBond(molecule, atom) {
  for (const bondIndex of molecule.neighbors[atom.index]) {
    const bond = molecule.bonds[bondIndex];
    if (!bond.ringCount && bond.order >= 2) return otherAtom(bond, atom.index);
  }
  return -1;
}

function ringMultipleBond(molecule, atom) {
  return molecule.neighbors[atom.index].some((bondIndex) => molecule.bonds[bondIndex].ringCount && molecule.bonds[bondIndex].order >= 2);
}

function donorType(molecule, atom) {
  const electrons = countAtomElectrons(molecule, atom);
  if (electrons < 0) return NONE;
  const exocyclic = nonRingMultipleBond(molecule, atom);
  if (electrons === 0) {
    if (exocyclic >= 0) return VACANT;
    return ringMultipleBond(molecule, atom) ? ONE : NONE;
  }
  if (electrons === 1) {
    if (exocyclic >= 0) return moreElectronegative(molecule.atoms[exocyclic].z, atom.z) ? VACANT : ONE;
    if (atom.explicitValence !== atom.degree) return ONE;
    return atom.charge === 1 ? VACANT : NONE;
  }
  let count = electrons;
  if (exocyclic >= 0 && moreElectronegative(molecule.atoms[exocyclic].z, atom.z)) count -= 1;
  return count % 2 === 1 ? ONE : TWO;
}

function aromaticCandidate(molecule, atom, type) {
  if (atom.z > 18 && atom.z !== 34 && atom.z !== 52) return false;
  if (type === NONE) return false;
  const dv = defaultValence(atom.z);
  if (dv > 0 && atom.valence > defaultValence(Math.min(MAX_Z, Math.max(0, atom.z - atom.charge)))) return false;
  if (atom.explicitValence - atom.degree > 1) {
    let multiple = 0;
    for (const bondIndex of molecule.neighbors[atom.index]) if (molecule.bonds[bondIndex].order >= 2) multiple += 1;
    if (multiple > 1) return false;
  }
  return true;
}

const electronRange = (type) => (type === ANY || type === 3 ? [1, 2] : type === ONE ? [1, 1] : type === TWO ? [2, 2] : [0, 0]);

function huckel(atomsInSystem, types) {
  let low = 0;
  let high = 0;
  let any = 0;
  for (const atom of atomsInSystem) {
    if (types[atom] === ANY && ++any > 1) return false;
    const [a, b] = electronRange(types[atom]);
    low += a;
    high += b;
  }
  if (high >= 6) {
    for (let count = low; count <= high; count += 1) if ((count - 2) % 4 === 0) return true;
    return false;
  }
  return high === 2;
}

// Candidate rings are those whose atoms can all be aromatic; rings sharing one bond form fused
// systems, and every connected combination of up to six rings of a system is tested with Hückel's
// rule on the atoms in one or two of its rings. Bonds in exactly one ring of an aromatic
// combination become aromatic.
function setAromaticity(molecule) {
  const { atoms, bonds } = molecule;
  const types = new Int32Array(atoms.length).fill(NONE);
  const candidate = new Uint8Array(atoms.length);
  const seen = new Uint8Array(atoms.length);
  const candidateRings = [];
  for (const ring of molecule.rings) {
    let all = true;
    for (const index of ring) {
      const atom = atoms[index];
      if (seen[index]) {
        if (!candidate[index]) all = false;
        continue;
      }
      seen[index] = 1;
      let type = donorType(molecule, atom);
      // Ether oxygens and sulfurs of macrocycles are bridges, not π donors.
      if (type === TWO && ring.length >= 9 && (atom.z === 8 || atom.z === 16) && atom.degree === 2 && !atom.charge) {
        if (!molecule.neighbors[index].some((bondIndex) => bonds[bondIndex].order >= 2)) type = NONE;
      }
      types[index] = type;
      candidate[index] = aromaticCandidate(molecule, atom, type) ? 1 : 0;
      if (!candidate[index]) all = false;
    }
    if (all) candidateRings.push(ring);
  }
  if (!candidateRings.length) return;
  const ringBonds = candidateRings.map((ring) => ring.map((atom, position) => bondBetween(molecule, atom, ring[(position + 1) % ring.length]).index));
  const neighborsOf = candidateRings.map(() => []);
  for (let i = 0; i < candidateRings.length; i += 1) {
    if (ringBonds[i].length > 24) continue;
    const set = new Set(ringBonds[i]);
    for (let j = i + 1; j < candidateRings.length; j += 1) {
      if (ringBonds[j].length > 24) continue;
      const shared = ringBonds[j].filter((bondIndex) => set.has(bondIndex)).length;
      if (shared === 1) {
        neighborsOf[i].push(j);
        neighborsOf[j].push(i);
      }
    }
  }
  const done = new Uint8Array(candidateRings.length);
  const pick = (start, list, mark) => {
    mark[start] = 1;
    list.push(start);
    for (const next of neighborsOf[start]) if (!mark[next]) pick(next, list, mark);
  };
  for (let current = 0; current < candidateRings.length; current += 1) {
    if (done[current]) continue;
    const fused = [];
    pick(current, fused, done);
    huckelFused(molecule, candidateRings, ringBonds, fused, types, neighborsOf);
  }
}

function huckelFused(molecule, rings, ringBonds, fused, types, neighborsOf) {
  const { atoms, bonds } = molecule;
  const count = fused.length;
  const allBonds = new Set();
  for (const ring of fused) for (const bondIndex of ringBonds[ring]) allBonds.add(bondIndex);
  const doneBonds = new Set();
  const isFused = (subset) => {
    const allowed = new Set(subset);
    const mark = new Set();
    const stack = [subset[0]];
    mark.add(subset[0]);
    while (stack.length) {
      const ring = stack.pop();
      for (const next of neighborsOf[ring]) {
        if (allowed.has(next) && !mark.has(next)) {
          mark.add(next);
          stack.push(next);
        }
      }
    }
    return mark.size === subset.length;
  };
  for (let size = 1; size <= Math.min(count, 6); size += 1) {
    if (doneBonds.size >= allBonds.size) break;
    if (size === 3 && count > 300) break;
    const combination = Array.from({ length: size }, (_, index) => index);
    for (;;) {
      const subset = combination.map((index) => fused[index]);
      if (size === 1 || isFused(subset)) {
        const inSystem = new Int32Array(atoms.length);
        for (const ring of subset) for (const atom of rings[ring]) inSystem[atom] += 1;
        const members = [];
        for (let atom = 0; atom < atoms.length; atom += 1) if (inSystem[atom] === 1 || inSystem[atom] === 2) members.push(atom);
        if (huckel(members, types)) {
          const counter = new Map();
          for (const ring of subset) for (const bondIndex of ringBonds[ring]) counter.set(bondIndex, (counter.get(bondIndex) ?? 0) + 1);
          for (const [bondIndex, times] of counter) {
            if (times !== 1) continue;
            const bond = bonds[bondIndex];
            bond.aromatic = true;
            if (bond.order === 1 || bond.order === 2 || bond.order === 1.5) {
              bond.order = 1.5;
              atoms[bond.a].aromatic = true;
              atoms[bond.b].aromatic = true;
            }
            doneBonds.add(bondIndex);
          }
        }
      }
      // Next combination in lexicographic order.
      let position = size - 1;
      while (position >= 0 && combination[position] === count - size + position) position -= 1;
      if (position < 0) break;
      combination[position] += 1;
      for (let index = position + 1; index < size; index += 1) combination[index] = combination[index - 1] + 1;
    }
  }
}

/* ---------- Conjugation and hybridization ---------- */

function conjugationCandidate(molecule, atom) {
  const valences = elementByNumber(atom.z).valences;
  if (!atom.charge && valences[0] >= 0 && atom.valence > valences[0]) return false;
  const outer = elementByNumber(atom.z).outer;
  return (atom.z <= 10 || (outer !== 5 && outer !== 6) || (outer === 6 && atom.degree + atom.hydrogens < 2)) && countAtomElectrons(molecule, atom) > 0;
}

// RDKit's setConjugation(): aromatic bonds are conjugated; so are two bonds of an atom with two or
// three substituents when one of them is multiple and all three atoms could be conjugated.
function setConjugation(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  for (const bond of bonds) bond.conjugated = bond.aromatic;
  const candidate = atoms.map((atom) => conjugationCandidate(molecule, atom));
  const substituents = atoms.map((atom, index) => (candidate[index] ? atom.degree + atom.hydrogens : 0));
  for (const atom of atoms) {
    const index = atom.index;
    if (!candidate[index] || substituents[index] < 2 || substituents[index] > 3) continue;
    for (const first of neighbors[index]) {
      const bond1 = bonds[first];
      if (bond1.order < 1.5 || !candidate[otherAtom(bond1, index)]) continue;
      for (const second of neighbors[index]) {
        if (second === first) continue;
        const other = otherAtom(bonds[second], index);
        if (substituents[other] > 3) continue;
        if (candidate[other]) {
          bond1.conjugated = true;
          bonds[second].conjugated = true;
        }
      }
    }
  }
}

export function hasConjugatedBond(molecule, atom) {
  return molecule.neighbors[atom].some((bondIndex) => molecule.bonds[bondIndex].conjugated);
}

// RDKit's setHybridization(): neighbors (hydrogens included) plus lone pairs.
function setHybridization(molecule) {
  for (const atom of molecule.atoms) {
    if (!atom.z) {
      atom.hybridization = '';
      continue;
    }
    const degree = atom.degree + atom.hydrogens;
    let orbitals = degree;
    if (atom.z > 1 && atom.z < 89) {
      const outer = elementByNumber(atom.z).outer;
      const free = outer - (atom.valence + atom.charge);
      orbitals = degree + Math.trunc(free / 2);
    }
    switch (orbitals) {
      case 0:
      case 1:
        atom.hybridization = 'S';
        break;
      case 2:
        atom.hybridization = 'SP';
        break;
      case 3:
        atom.hybridization = 'SP2';
        break;
      case 4:
        atom.hybridization = degree > 3 || !hasConjugatedBond(molecule, atom.index) ? 'SP3' : 'SP2';
        break;
      case 5:
        atom.hybridization = 'SP3D';
        break;
      case 6:
        atom.hybridization = 'SP3D2';
        break;
      default:
        atom.hybridization = '';
    }
  }
}
