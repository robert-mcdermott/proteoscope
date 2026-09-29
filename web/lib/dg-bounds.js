// Distance-geometry bounds for a small molecule as RDKit computes them (GetMoleculeBoundsMatrix
// in release 2026.03, with the settings PoseBusters uses: 1-5 bounds, scaled van der Waals lower
// bounds, triangle smoothing, trans amides). For every atom pair it gives the range of distances
// that the molecule's topology allows:
//
//   1-2 (bonded): the UFF rest length of the bond (Rappé et al. 1992, J Am Chem Soc 114:10024)
//     ± 0.01 Å, with 0.2 Å more around larger atoms in conjugated five-membered rings;
//   1-3: from the two bond lengths and an angle given by hybridization and ring size, ± 0.04 Å
//     (doubled for each larger sp2 ring atom);
//   1-4: from the cis and trans torsions (cis in small sp2 rings, amides and esters held trans),
//     ± 0.06 Å when the torsion is fixed;
//   1-5: from the 1-4 configurations, where both are known, ± 0.08 Å;
//   others: at least the sum of the van der Waals radii, scaled by 0.7 for atoms four bonds apart
//     and 0.85 for five;
//
// then tightened by triangle smoothing. PoseBusters (Buttenschoen et al. 2024, Chem Sci 15:3130,
// doi:10.1039/D3SC04185A) checks bond lengths, bond angles and internal clashes against these
// bounds. The molecule comes from perceiveMolecule() (perception.js); atom and bond order matter
// in a few places, as they do in RDKit.

import { bondBetween, elementByNumber, hasConjugatedBond, otherAtom } from './perception.js';

// UFF bond radius r1 and GMP electronegativity of each atom type (Rappé et al. 1992, as in RDKit).
const UFF_DATA = 'H_ 0.354 4.528|H_b 0.46 4.528|He4+4 0.849 9.66|Li 1.336 3.006|Be3+2 1.074 4.877|B_3 0.838 5.11|B_2 0.828 5.11|C_3 0.757 5.343|C_R 0.729 5.343|C_2 0.732 5.343|C_1 0.706 5.343|N_3 0.7 6.899|N_R 0.699 6.899|N_2 0.685 6.899|N_1 0.656 6.899|O_3 0.658 8.741|O_3_z 0.528 8.741|O_R 0.68 8.741|O_2 0.634 8.741|O_1 0.639 8.741|F_ 0.668 10.874|Ne4+4 0.92 11.04|Na 1.539 2.843|Mg3+2 1.421 3.951|Al3 1.244 4.06|Si3 1.117 4.168|P_3+3 1.101 5.463|P_3+5 1.056 5.463|P_3+q 1.056 5.463|S_3+2 1.064 6.928|S_3+4 1.049 6.928|S_3+6 1.027 6.928|S_R 1.077 6.928|S_2 0.854 6.928|Cl 1.044 8.564|Ar4+4 1.032 9.465|K_ 1.953 2.421|Ca6+2 1.761 3.231|Sc3+3 1.513 3.395|Ti3+4 1.412 3.47|Ti6+4 1.412 3.47|V_3+5 1.402 3.65|Cr6+3 1.345 3.415|Mn6+2 1.382 3.325|Fe3+2 1.27 3.76|Fe6+2 1.335 3.76|Co6+3 1.241 4.105|Ni4+2 1.164 4.465|Cu3+1 1.302 4.2|Zn3+2 1.193 5.106|Ga3+3 1.26 3.641|Ge3 1.197 4.051|As3+3 1.211 5.188|Se3+2 1.19 6.428|Br 1.192 7.79|Kr4+4 1.147 8.505|Rb 2.26 2.331|Sr6+2 2.052 3.024|Y_3+3 1.698 3.83|Zr3+4 1.564 3.4|Nb3+5 1.473 3.55|Mo6+6 1.467 3.465|Mo3+6 1.484 3.465|Tc6+5 1.322 3.29|Ru6+2 1.478 3.575|Rh6+3 1.332 3.975|Pd4+2 1.338 4.32|Ag1+1 1.386 4.436|Cd3+2 1.403 5.034|In3+3 1.459 3.506|Sn3 1.398 3.987|Sb3+3 1.407 4.899|Te3+2 1.386 5.816|I_ 1.382 6.822|Xe4+4 1.267 7.595|Cs 2.57 2.183|Ba6+2 2.277 2.814|La3+3 1.943 2.8355|Ce6+3 1.841 2.774|Pr6+3 1.823 2.858|Nd6+3 1.816 2.8685|Pm6+3 1.801 2.881|Sm6+3 1.78 2.9115|Eu6+3 1.771 2.8785|Gd6+3 1.735 3.1665|Tb6+3 1.732 3.018|Dy6+3 1.71 3.0555|Ho6+3 1.696 3.127|Er6+3 1.673 3.1865|Tm6+3 1.66 3.2514|Yb6+3 1.637 3.2889|Lu6+3 1.671 2.9629|Hf3+4 1.611 3.7|Ta3+5 1.511 5.1|W_6+6 1.392 4.63|W_3+4 1.526 4.63|W_3+6 1.38 4.63|Re6+5 1.372 3.96|Re3+7 1.314 3.96|Os6+6 1.372 5.14|Ir6+3 1.371 5|Pt4+2 1.364 4.79|Au4+3 1.262 4.894|Hg1+2 1.34 6.27|Tl3+3 1.518 3.2|Pb3 1.459 3.9|Bi3+3 1.512 4.69|Po3+2 1.5 4.21|At 1.545 4.75|Rn4+4 1.42 5.37|Fr 2.88 2|Ra6+2 2.512 2.843|Ac6+3 1.983 2.835|Th6+4 1.721 3.175|Pa6+4 1.711 2.985|U_6+4 1.684 3.341|Np6+4 1.666 3.549|Pu6+4 1.657 3.243|Am6+4 1.66 2.9895|Cm6+3 1.801 2.8315|Bk6+3 1.761 3.1935|Cf6+3 1.75 3.197|Es6+3 1.724 3.333|Fm6+3 1.712 3.4|Md6+3 1.689 3.47|No6+3 1.679 3.475|Lw6+3 1.698 3.5';
const UFF = new Map(UFF_DATA.split('|').map((row) => {
  const [label, r1, xi] = row.split(' ');
  return [label, { r1: Number(r1), xi: Number(xi) }];
}));

const DIST12_DELTA = 0.01;
const DIST13_TOL = 0.04;
const GEN_DIST_TOL = 0.06;
const DIST15_TOL = 0.08;
const VDW_SCALE_15 = 0.7;
const MAX_UPPER = 1000;
const DEG = Math.PI / 180;

/* ---------- UFF atom types ---------- */

// Charge suffixes of RDKit's addAtomChargeFlags(), tolerating mismatched charge states.
const FIXED_CHARGE = { 29: '+1', 47: '+1', 4: '+2', 20: '+2', 25: '+2', 26: '+2', 28: '+2', 46: '+2', 78: '+2', 21: '+3', 24: '+3', 27: '+3', 79: '+3', 2: '+4', 18: '+4', 22: '+4', 36: '+4', 54: '+4', 23: '+5', 41: '+5', 43: '+5', 73: '+5', 42: '+6' };
const BY_VALENCE = { 12: [[2, '+2']], 30: [[2, '+2']], 31: [[3, '+3']], 33: [[3, '+3']], 34: [[2, '+2']], 48: [[2, '+2']], 49: [[3, '+3']], 51: [[3, '+3']], 52: [[2, '+2']], 80: [[2, '+2']], 81: [[3, '+3']], 82: [[3, '+3']], 83: [[3, '+3']], 84: [[2, '+2']] };
for (let z = 89; z <= 103; z += 1) if (![90, 91, 92, 93, 94, 95].includes(z)) FIXED_CHARGE[z] = '+3';
for (const z of [90, 91, 92, 93, 94, 95]) FIXED_CHARGE[z] = '+4';

function uffLabel(molecule, atom) {
  const record = elementByNumber(atom.z);
  let label = record.symbol.length === 1 ? `${record.symbol}_` : record.symbol;
  const outer = record.outer;
  if (atom.z && (record.valences[0] === -1 || (outer !== 1 && outer !== 7))) {
    if ([12, 13, 14, 15, 50, 51, 52, 81, 82, 83, 84].includes(atom.z)) label += '3';
    else if (atom.z === 80) label += '1';
    else {
      switch (atom.hybridization) {
        case 'SP':
          label += '1';
          break;
        case 'SP2':
          label += (atom.aromatic || hasConjugatedBond(molecule, atom.index)) && [6, 7, 8, 16].includes(atom.z) ? 'R' : '2';
          break;
        case 'SP3':
          label += '3';
          break;
        case 'SP3D':
          label += '5';
          break;
        case 'SP3D2':
          label += '6';
          break;
        default:
          break;
      }
    }
  }
  const valence = atom.valence;
  if (FIXED_CHARGE[atom.z]) label += FIXED_CHARGE[atom.z];
  else if (BY_VALENCE[atom.z]) label += BY_VALENCE[atom.z][0][1];
  else if (atom.z === 15) label += valence === 3 ? '+3' : '+5';
  else if (atom.z === 16 && atom.hybridization !== 'SP2') label += valence === 2 ? '+2' : valence === 4 ? '+4' : '+6';
  else if (atom.z === 75) {
    if (label === 'Re6') label = 'Re6+5';
    else if (label === 'Re3') label = 'Re3+7';
  }
  if (atom.z >= 57 && atom.z <= 71) label += '+3';
  return label;
}

export function uffLabels(molecule) {
  return molecule.atoms.map((atom) => uffLabel(molecule, atom));
}

const bondOrder = (bond) => bond.order;

// UFF rest length: r_i + r_j with the Pauling bond-order correction and the O'Keefe–Breese
// electronegativity correction. Null when an atom type has no parameters.
export function bondRestLength(molecule, labels, bond) {
  const a = UFF.get(labels[bond.a]);
  const b = UFF.get(labels[bond.b]);
  const order = bondOrder(bond);
  if (!a || !b || !(order > 0)) return null;
  const pauling = -0.1332 * (a.r1 + b.r1) * Math.log(order);
  const electronegativity = (a.r1 * b.r1 * (Math.sqrt(a.xi) - Math.sqrt(b.xi)) ** 2) / (a.xi * a.r1 + b.xi * b.r1);
  return a.r1 + b.r1 + pauling - electronegativity;
}

/* ---------- Bounds matrix ---------- */

// Upper bounds above the diagonal, lower bounds below it (RDKit's layout).
class Bounds {
  constructor(n) {
    this.n = n;
    this.values = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i < j) this.values[i * n + j] = MAX_UPPER;
      }
    }
  }

  upper(i, j) {
    return i < j ? this.values[i * this.n + j] : this.values[j * this.n + i];
  }

  lower(i, j) {
    return i < j ? this.values[j * this.n + i] : this.values[i * this.n + j];
  }

  setUpper(i, j, value) {
    if (i < j) this.values[i * this.n + j] = value;
    else this.values[j * this.n + i] = value;
  }

  setLower(i, j, value) {
    if (i < j) this.values[j * this.n + i] = value;
    else this.values[i * this.n + j] = value;
  }
}

// RDKit's _checkAndSetBounds(): an unset bound takes the new value; a set one only widens.
function checkAndSet(bounds, i, j, lower, upper) {
  const currentLower = bounds.lower(i, j);
  const currentUpper = bounds.upper(i, j);
  if (!(upper > lower)) throw new Error('upper bound not greater than lower bound');
  if (!(lower > DIST12_DELTA || currentLower > DIST12_DELTA)) throw new Error('bad lower bound');
  if (currentLower <= DIST12_DELTA) bounds.setLower(i, j, lower);
  else if (lower < currentLower && lower > DIST12_DELTA) bounds.setLower(i, j, lower);
  if (currentUpper >= MAX_UPPER) bounds.setUpper(i, j, upper);
  else if (upper > currentUpper && upper < MAX_UPPER) bounds.setUpper(i, j, upper);
}

const compute13 = (d1, d2, angle) => Math.sqrt(d1 * d1 + d2 * d2 - 2 * d1 * d2 * Math.cos(angle));

function compute14Cis(d1, d2, d3, ang12, ang23) {
  const dx = d2 - d3 * Math.cos(ang23) - d1 * Math.cos(ang12);
  const dy = d3 * Math.sin(ang23) - d1 * Math.sin(ang12);
  return Math.sqrt(dx * dx + dy * dy);
}

function compute14Trans(d1, d2, d3, ang12, ang23) {
  const dx = d2 - d3 * Math.cos(ang23) - d1 * Math.cos(ang12);
  const dy = d3 * Math.sin(ang23) + d1 * Math.sin(ang12);
  return Math.sqrt(dx * dx + dy * dy);
}

function compute14Torsion(d1, d2, d3, ang12, ang23, torsion) {
  const x1 = d1 * Math.cos(ang12);
  const y1 = d1 * Math.sin(ang12);
  const x4 = d2 - d3 * Math.cos(ang23);
  const y4 = d3 * Math.sin(ang23);
  const ry = y4 * Math.cos(torsion);
  const rz = y4 * Math.sin(torsion);
  return Math.sqrt((x4 - x1) ** 2 + (ry - y1) ** 2 + rz * rz);
}

// 1-5 distances with the 1-4 part cis or trans and the fourth bond cis or trans to the path.
function compute15(d1, d2, d3, d4, ang12, ang23, ang34, first, second) {
  const dx14 = d2 - d3 * Math.cos(ang23) - d1 * Math.cos(ang12);
  const dy14 = first === 'cis' ? d3 * Math.sin(ang23) - d1 * Math.sin(ang12) : d3 * Math.sin(ang23) + d1 * Math.sin(ang12);
  const d14 = Math.sqrt(dx14 * dx14 + dy14 * dy14);
  const cval = Math.min(1, Math.max(-1, (d3 - d2 * Math.cos(ang23) + d1 * Math.cos(first === 'cis' ? ang12 + ang23 : ang12 - ang23)) / d14));
  const ang143 = Math.acos(cval);
  const cisCis = first === 'cis' && second === 'cis';
  const transCis = first === 'trans' && second === 'cis';
  const ang145 = cisCis || transCis ? ang34 - ang143 : ang34 + ang143;
  return compute13(d14, d4, ang145);
}

const RING_ANGLES = (atom, size) => {
  if ((atom.hybridization === 'SP2' && size <= 8) || size === 3 || size === 4) return Math.PI * (1 - 2 / size);
  if (atom.hybridization === 'SP3') return (size === 5 ? 104 : 109.5) * DEG;
  if (atom.hybridization === 'SP3D') return 105 * DEG;
  if (atom.hybridization === 'SP3D2') return 90 * DEG;
  return 120 * DEG;
};

// Options: smooth (default true). Returns { upper(i, j), lower(i, j), n, smoothed } or throws where
// RDKit's builder fails.
export function boundsMatrix(molecule, options = {}) {
  const { atoms, bonds, neighbors } = molecule;
  const n = atoms.length;
  const nb = bonds.length;
  const bounds = new Bounds(n);
  const distances = molecule.distances;
  const topo = (i, j) => distances[i * n + j];
  const labels = uffLabels(molecule);
  const bondLengths = new Float64Array(nb);
  const bondAngles = new Float64Array(nb * nb).fill(-1);
  const bondAdjacent = new Int32Array(nb * nb).fill(-1);
  const visited12 = new Uint8Array(n * n);
  const visited13 = new Uint8Array(n * n);
  const visited14 = new Uint8Array(n * n);
  const set15 = new Uint8Array(n * n);
  const pairId = (i, j) => (i < j ? i * n + j : j * n + i);
  const bondPair = (a, b) => (a < b ? a * nb + b : b * nb + a);
  const path3 = (a, b, c) => (a < c ? (a * nb + b) * nb + c : (c * nb + b) * nb + a);
  const visited = (pid, level) => visited12[pid] || (level >= 13 && visited13[pid]) || (level >= 14 && visited14[pid]);
  const setAngle = (b1, b2, angle, center) => {
    bondAngles[b1 * nb + b2] = angle;
    bondAngles[b2 * nb + b1] = angle;
    bondAdjacent[b1 * nb + b2] = center;
    bondAdjacent[b2 * nb + b1] = center;
  };
  const angleOf = (b1, b2) => bondAngles[b1 * nb + b2];
  const centerOf = (b1, b2) => bondAdjacent[b1 * nb + b2];
  const inRingOfSize = (atom, size) => molecule.rings.some((ring) => ring.length === size && ring.includes(atom));

  // 1-2: bond lengths.
  const squish = new Uint8Array(n);
  for (const bond of bonds) {
    const big = atoms[bond.a].z > 10 || atoms[bond.b].z > 10;
    if (bond.conjugated && big && molecule.bondRings.some((ring) => ring.length === 5 && ring.includes(bond.index))) {
      squish[bond.a] = 1;
      squish[bond.b] = 1;
    }
  }
  for (const bond of bonds) {
    let length = bondRestLength(molecule, labels, bond);
    if (length !== null) {
      const extra = squish[bond.a] || squish[bond.b] ? 0.2 : 0;
      bondLengths[bond.index] = length;
      bounds.setUpper(bond.a, bond.b, length + extra + DIST12_DELTA);
      bounds.setLower(bond.a, bond.b, length - extra - DIST12_DELTA);
    } else {
      length = elementByNumber(atoms[bond.a].z).covalent + elementByNumber(atoms[bond.b].z).covalent;
      length -= 0.1332 * Math.log(bondOrder(bond)) * length;
      bondLengths[bond.index] = length;
      bounds.setUpper(bond.a, bond.b, 1.1 * length);
      bounds.setLower(bond.a, bond.b, 0.9 * length);
    }
    visited12[pairId(bond.a, bond.b)] = 1;
  }

  // 1-3: bond angles, ring angles first (smaller rings first).
  const largerSp2 = (index) => atoms[index].z > 13 && atoms[index].hybridization === 'SP2' && atoms[index].ringCount > 0;
  const set13 = (a1, a2, a3, angle) => {
    const b1 = bondBetween(molecule, a1, a2).index;
    const b2 = bondBetween(molecule, a2, a3).index;
    let tolerance = DIST13_TOL;
    if (largerSp2(a1)) tolerance *= 2;
    if (largerSp2(a2)) tolerance *= 2;
    if (largerSp2(a3)) tolerance *= 2;
    const lower = compute13(bondLengths[b1], bondLengths[b2], angle) - tolerance;
    checkAndSet(bounds, a1, a3, lower, lower + 2 * tolerance);
  };
  const visitedCount = new Int32Array(n);
  const angleTaken = new Float64Array(n);
  const donePairs = new Set();
  const ringsBySize = molecule.rings.slice().sort((a, b) => a.length - b.length);
  for (const ring of ringsBySize) {
    const size = ring.length;
    let a1 = ring[size - 1];
    for (let i = 0; i < size; i += 1) {
      const a2 = ring[i];
      const a3 = ring[(i + 1) % size];
      const b1 = bondBetween(molecule, a1, a2).index;
      const b2 = bondBetween(molecule, a2, a3).index;
      const key = bondPair(b1, b2);
      if (!donePairs.has(key)) {
        const angle = RING_ANGLES(atoms[a2], size);
        const pid = pairId(a1, a3);
        if (!visited(pid, 12)) {
          set13(a1, a2, a3, angle);
          visited13[pid] = 1;
        }
        setAngle(b1, b2, angle, a2);
        visitedCount[a2] += 1;
        angleTaken[a2] += angle;
        donePairs.add(key);
      }
      a1 = a2;
    }
  }
  for (const atom of atoms) {
    const a2 = atom.index;
    const degree = neighbors[a2].length;
    const pairs = (degree * (degree - 1)) / 2;
    if (pairs === visitedCount[a2]) continue;
    // Ring atoms (angles already set by their rings) and chain atoms follow different rules.
    const inRing = visitedCount[a2] >= 1;
    const list = neighbors[a2];
    for (let p = 0; p < list.length; p += 1) {
      const b1 = list[p];
      const a1 = otherAtom(bonds[b1], a2);
      for (let q = 0; q < p; q += 1) {
        const b2 = list[q];
        const a3 = otherAtom(bonds[b2], a2);
        let angle;
        if (inRing) {
          if (angleOf(b1, b2) >= 0) continue;
          if (atom.hybridization === 'SP2') angle = (2 * Math.PI - angleTaken[a2]) / (pairs - visitedCount[a2]);
          else if (atom.hybridization === 'SP3') angle = (inRingOfSize(a2, 3) ? 116 : inRingOfSize(a2, 4) ? 112 : 109.5) * DEG;
          else angle = (degree === 5 ? 105 : degree === 6 ? 135 : 120) * DEG;
          const pid = pairId(a1, a3);
          if (!visited(pid, 12)) {
            set13(a1, a2, a3, angle);
            visited13[pid] = 1;
          }
        } else {
          const hybridization = atom.hybridization;
          angle = (hybridization === 'SP' ? 180 : hybridization === 'SP2' ? 120 : hybridization === 'SP3' ? 109.5 : hybridization === 'SP3D' ? 105 : hybridization === 'SP3D2' ? 135 : 120) * DEG;
          const pid = pairId(a1, a3);
          if (!visited(pid, 12)) {
            if (degree <= 4) set13(a1, a2, a3, angle);
            else checkAndSet(bounds, a1, a3, 1, (bondLengths[b1] + bondLengths[b2]) * 1.2);
            visited13[pid] = 1;
          }
        }
        setAngle(b1, b2, angle, a2);
        angleTaken[a2] += angle;
        visitedCount[a2] += 1;
      }
    }
  }

  // 1-4: torsions.
  const paths14 = [];
  const cisPaths = new Set();
  const transPaths = new Set();
  const collected = new Map();
  const totalHydrogens = (index) => atoms[index].hydrogens;
  const amideEster14 = (bond1, bond3, i2, i3, i4) => {
    const z2 = atoms[i2].z;
    return atoms[i3].z === 6 && bond3.order === 2 && (atoms[i4].z === 8 || atoms[i4].z === 7) && bond1.order === 1 && (z2 === 8 || (z2 === 7 && totalHydrogens(i2) === 1));
  };
  const carbonyl = (index) => atoms[index].z === 6 && neighbors[index].length > 2 && neighbors[index].some((bondIndex) => {
    const other = otherAtom(bonds[bondIndex], index);
    return (atoms[other].z === 8 || atoms[other].z === 7) && bonds[bondIndex].order === 2;
  });
  const amideEster15 = (bond1, bond3, i2, i3) => {
    const z2 = atoms[i2].z;
    return (z2 === 8 || (z2 === 7 && totalHydrogens(i2) === 1)) && bond1.order === 1 && atoms[i3].z === 6 && bond3.order === 1 && carbonyl(i3);
  };
  const bothSp2 = (i2, i3) => atoms[i2].hybridization === 'SP2' && atoms[i3].hybridization === 'SP2';
  const collect14 = (b1, b2, b3, kind, info = {}) => {
    const bond1 = bonds[b1];
    const bond2 = bonds[b2];
    const bond3 = bonds[b3];
    const i2 = centerOf(b1, b2);
    const i3 = centerOf(b2, b3);
    const i1 = otherAtom(bond1, i2);
    const i4 = otherAtom(bond3, i3);
    const pid = pairId(i1, i4);
    if (visited(pid, 13) || topo(Math.max(i1, i4), Math.min(i1, i4)) < 2.9) return;
    const d1 = bondLengths[b1];
    const d2 = bondLengths[b2];
    const d3 = bondLengths[b3];
    const ang12 = angleOf(b1, b2);
    const ang23 = angleOf(b2, b3);
    if (!(ang12 > 0) || !(ang23 > 0)) throw new Error('missing bond angle');
    let type;
    if (kind === 'ring') type = info.ringSize <= 8 && bothSp2(i2, i3) ? 'cis' : 'flexible';
    else if (kind === 'diff' || kind === 'share') type = bothSp2(i2, i3) ? 'cis' : 'flexible';
    else if (kind === 'same') {
      if (bondBetween(molecule, i1, i3) || bondBetween(molecule, i4, i2)) return;
      type = info.preferTrans && bothSp2(i2, i3) ? 'trans' : 'flexible';
    } else if (bond2.order === 2) {
      type = bond1.order === 2 || bond3.order === 2 ? 'cis' : 'flexible';
    } else if (bond2.order === 1) {
      if (atoms[i2].z === 16 && atoms[i3].z === 16 && neighbors[i2].length === 2 && neighbors[i3].length === 2) type = 'custom';
      else if (amideEster14(bond1, bond3, i2, i3, i4) || amideEster14(bond3, bond1, i3, i2, i1)) type = 'cis';
      else if (amideEster15(bond1, bond3, i2, i3) || amideEster15(bond3, bond1, i3, i2)) type = 'trans';
      else type = 'flexible';
    } else type = 'flexible';
    let lower;
    let upper;
    if (type === 'cis') {
      lower = compute14Cis(d1, d2, d3, ang12, ang23) - GEN_DIST_TOL;
      upper = lower + 2 * GEN_DIST_TOL;
      cisPaths.add(path3(b1, b2, b3));
    } else if (type === 'trans') {
      lower = compute14Trans(d1, d2, d3, ang12, ang23) - GEN_DIST_TOL;
      upper = lower + 2 * GEN_DIST_TOL;
      transPaths.add(path3(b1, b2, b3));
    } else if (type === 'flexible') {
      lower = compute14Cis(d1, d2, d3, ang12, ang23);
      upper = compute14Trans(d1, d2, d3, ang12, ang23);
      if (upper < lower) [lower, upper] = [upper, lower];
      if (Math.abs(upper - lower) < DIST12_DELTA) {
        lower -= GEN_DIST_TOL;
        upper += GEN_DIST_TOL;
      }
    } else {
      lower = compute14Torsion(d1, d2, d3, ang12, ang23, Math.PI / 2) - GEN_DIST_TOL;
      upper = lower + 2 * GEN_DIST_TOL;
    }
    paths14.push({ b1, b2, b3, type });
    visited14[pid] = 1;
    if (!collected.has(pid)) collected.set(pid, []);
    collected.get(pid).push({ lower, upper, a: i1, b: i4 });
  };
  const ringBondPairs = new Set();
  const donePaths = new Set();
  const cisRingPairs = new Map();
  const bondRingsBySize = molecule.bondRings.slice().sort((a, b) => b.length - a.length);
  for (const ring of bondRingsBySize) {
    const size = ring.length;
    if (size < 3) continue;
    let b1 = ring[size - 1];
    for (let i = 0; i < size; i += 1) {
      const b2 = ring[i];
      const b3 = ring[(i + 1) % size];
      const pid = bondPair(b1, b2);
      ringBondPairs.add(pid);
      donePaths.add(path3(b1, b2, b3));
      if (size > 5) {
        collect14(b1, b2, b3, 'ring', { ringSize: size });
        cisRingPairs.set(pid, size <= 8);
      } else {
        const i2 = centerOf(b1, b2);
        const i3 = centerOf(b2, b3);
        const type = bothSp2(i2, i3) ? 'cis' : 'flexible';
        paths14.push({ b1, b2, b3, type });
        if (type === 'cis') cisPaths.add(path3(b1, b2, b3));
        cisRingPairs.set(pid, true);
      }
      b1 = b2;
    }
  }
  for (const bond of bonds) {
    const b2 = bond.index;
    for (const b1 of neighbors[bond.a]) {
      if (b1 === b2) continue;
      for (const b3 of neighbors[bond.b]) {
        if (b3 === b2 || donePaths.has(path3(b1, b2, b3))) continue;
        const p1 = bondPair(b1, b2);
        const p2 = bondPair(b2, b3);
        if (ringBondPairs.has(p1) || ringBondPairs.has(p2)) collect14(b1, b2, b3, 'same', { preferTrans: Boolean(cisRingPairs.get(p1) || cisRingPairs.get(p2)) });
        else if ((bonds[b1].ringCount > 0 && bonds[b2].ringCount > 0) || (bonds[b2].ringCount > 0 && bonds[b3].ringCount > 0)) collect14(b1, b2, b3, 'diff');
        else if (bonds[b2].ringCount > 0) collect14(b1, b2, b3, 'share');
        else collect14(b1, b2, b3, 'chain');
      }
    }
  }
  for (const list of collected.values()) {
    const merged = mergeBounds(list);
    checkAndSet(bounds, merged.a, merged.b, merged.lower, merged.upper);
  }

  // 1-5.
  const helper15 = (b1, b2, b3, type) => {
    const i2 = centerOf(b1, b2);
    const i1 = otherAtom(bonds[b1], i2);
    const i3 = centerOf(b2, b3);
    const i4 = otherAtom(bonds[b3], i3);
    const d1 = bondLengths[b1];
    const d2 = bondLengths[b2];
    const d3 = bondLengths[b3];
    const ang12 = angleOf(b1, b2);
    const ang23 = angleOf(b2, b3);
    for (let i = 0; i < nb; i += 1) {
      if (centerOf(b3, i) !== i4) continue;
      const i5 = otherAtom(bonds[i], i4);
      const pid = pairId(i1, i5);
      if (visited(pid, 14)) return;
      if (topo(Math.max(i1, i5), Math.min(i1, i5)) < 3.9) continue;
      if (i1 === i5) continue;
      if (!(bounds.lower(i1, i5) < DIST12_DELTA || set15[pid])) continue;
      const d4 = bondLengths[i];
      const ang34 = angleOf(b3, i);
      const pathId = path3(b2, b3, i);
      let lower = 0;
      let upper = -1;
      if (type === 'cis' || type === 'trans') {
        if (cisPaths.has(pathId)) {
          lower = compute15(d1, d2, d3, d4, ang12, ang23, ang34, type, 'cis');
          upper = lower + DIST15_TOL;
          lower -= DIST15_TOL;
        } else if (transPaths.has(pathId)) {
          lower = compute15(d1, d2, d3, d4, ang12, ang23, ang34, type, 'trans');
          upper = lower + DIST15_TOL;
          lower -= DIST15_TOL;
        } else {
          lower = compute15(d1, d2, d3, d4, ang12, ang23, ang34, type, 'cis') - DIST15_TOL;
          upper = compute15(d1, d2, d3, d4, ang12, ang23, ang34, type, 'trans') + DIST15_TOL;
        }
      } else if (cisPaths.has(pathId)) {
        lower = compute15(d4, d3, d2, d1, ang34, ang23, ang12, 'cis', 'cis') - DIST15_TOL;
        upper = compute15(d4, d3, d2, d1, ang34, ang23, ang12, 'cis', 'trans') + DIST15_TOL;
      } else if (transPaths.has(pathId)) {
        lower = compute15(d4, d3, d2, d1, ang34, ang23, ang12, 'trans', 'cis') - DIST15_TOL;
        upper = compute15(d4, d3, d2, d1, ang34, ang23, ang12, 'trans', 'trans') + DIST15_TOL;
      } else {
        lower = VDW_SCALE_15 * (elementByNumber(atoms[i1].z).vdw + elementByNumber(atoms[i5].z).vdw);
      }
      if (upper < 0) upper = MAX_UPPER;
      checkAndSet(bounds, i1, i5, lower, upper);
      set15[pid] = 1;
    }
  };
  for (const path of paths14) {
    helper15(path.b1, path.b2, path.b3, path.type);
    helper15(path.b3, path.b2, path.b1, path.type);
  }

  // Van der Waals lower bounds for everything else.
  for (let i = 1; i < n; i += 1) {
    const r1 = elementByNumber(atoms[i].z).vdw;
    for (let j = 0; j < i; j += 1) {
      if (bounds.lower(i, j) >= DIST12_DELTA) continue;
      const r2 = elementByNumber(atoms[j].z).vdw;
      const d = topo(i, j);
      bounds.setLower(i, j, (d === 4 ? VDW_SCALE_15 : d === 5 ? VDW_SCALE_15 + 0.5 * (1 - VDW_SCALE_15) : 1) * (r1 + r2));
    }
  }
  let smoothed = true;
  if (options.smooth !== false) smoothed = triangleSmooth(bounds);
  return { n, upper: (i, j) => bounds.upper(i, j), lower: (i, j) => bounds.lower(i, j), smoothed, labels };
}

// RDKit's merge of the 1-4 bounds collected for one pair: the union of the maximal overlapping
// intersections, from the first intersection's lower bound to the last one's upper bound.
function mergeBounds(list) {
  const sorted = list.slice().sort((x, y) => x.lower - y.lower);
  const current = { ...sorted[0] };
  let componentUpper = current.upper;
  let resultLower = null;
  for (const bound of sorted.slice(1)) {
    if (bound.lower <= current.upper) {
      current.lower = bound.lower;
      current.upper = Math.min(current.upper, bound.upper);
    } else {
      if (resultLower === null) resultLower = current.lower;
      current.lower = bound.lower;
      current.upper = bound.lower <= componentUpper ? Math.min(componentUpper, bound.upper) : bound.upper;
    }
    componentUpper = Math.max(componentUpper, bound.upper);
  }
  return { lower: resultLower ?? current.lower, upper: current.upper, a: sorted[0].a, b: sorted[0].b };
}

// Floyd–Warshall-style smoothing of RDKit's triangleSmoothBounds(); stops, as RDKit does, where a
// lower bound passes its upper bound.
function triangleSmooth(bounds) {
  const n = bounds.n;
  const v = bounds.values;
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      if (i === k) continue;
      const ii = Math.min(i, k);
      const ik = Math.max(i, k);
      const Uik = v[ii * n + ik];
      const Lik = v[ik * n + ii];
      for (let j = i + 1; j < n; j += 1) {
        if (j === k) continue;
        const jj = Math.min(j, k);
        const jk = Math.max(j, k);
        const Ukj = v[jj * n + jk];
        const sum = Uik + Ukj;
        if (v[i * n + j] > sum) v[i * n + j] = sum;
        const diffLikUjk = Lik - Ukj;
        const diffLjkUik = v[jk * n + jj] - Uik;
        if (v[j * n + i] < diffLikUjk) v[j * n + i] = diffLikUjk;
        else if (v[j * n + i] < diffLjkUik) v[j * n + i] = diffLjkUik;
        const lower = v[j * n + i];
        const upper = v[i * n + j];
        if (lower - upper > 0) return false;
      }
    }
  }
  return true;
}
