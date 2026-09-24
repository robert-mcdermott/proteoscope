// Residue chemistry from the wwPDB Chemical Component Dictionary (CCD; Westbrook et al. 2015,
// doi:10.1093/bioinformatics/btu789): bond orders, aromatic flags, formal charges and the
// hydrogens each heavy atom carries. Components come from a file's own _chem_comp_atom and
// _chem_comp_bond loops (RCSB and PDBe mmCIF include them), from the built-in table of standard
// residues below, or from a CCD entry fetched on demand. applyChemistry() writes them onto a
// model: bond.order (1–3) and bond.aromatic, atom.aromatic and atom.hydrogens (hydrogens of the
// dictionary definition, leaving atoms excluded, so a residue inside a chain counts as linked).

// Multiple (A=B, A#B) and aromatic (A:B) bonds of the standard residues and a few common
// modified ones, then hydrogens on N, O and S as NAME/COUNT; generated from the CCD (CC0).
const STANDARD = {
  ALA: 'C=O|N/1',
  ARG: 'C=O CZ=NH2|N/1 NE/1 NH1/2 NH2/2',
  ASN: 'C=O CG=OD1|N/1 ND2/2',
  ASP: 'C=O CG=OD1|N/1 OD2/1',
  CYS: 'C=O|N/1 SG/1',
  GLN: 'C=O CD=OE1|N/1 NE2/2',
  GLU: 'C=O CD=OE1|N/1 OE2/1',
  GLY: 'C=O|N/1',
  HIS: 'C=O CG:ND1 CG:CD2 ND1:CE1 CD2:NE2 CE1:NE2|N/1 ND1/1 NE2/1',
  ILE: 'C=O|N/1',
  LEU: 'C=O|N/1',
  LYS: 'C=O|N/1 NZ/3',
  MET: 'C=O|N/1',
  PHE: 'C=O CG:CD1 CG:CD2 CD1:CE1 CD2:CE2 CE1:CZ CE2:CZ|N/1',
  PRO: 'C=O|',
  SER: 'C=O|N/1 OG/1',
  THR: 'C=O|N/1 OG1/1',
  TRP: 'C=O CG:CD1 CG:CD2 CD1:NE1 CD2:CE2 CD2:CE3 NE1:CE2 CE2:CZ2 CE3:CZ3 CZ2:CH2 CZ3:CH2|N/1 NE1/1',
  TYR: 'C=O CG:CD1 CG:CD2 CD1:CE1 CD2:CE2 CE1:CZ CE2:CZ|N/1 OH/1',
  VAL: 'C=O|N/1',
  MSE: 'C=O|N/1',
  SEP: 'C=O P=O1P|N/1 O2P/1 O3P/1',
  TPO: 'P=O1P C=O|N/1 O2P/1 O3P/1',
  PTR: 'C=O CG:CD1 CG:CD2 CD1:CE1 CD2:CE2 CE1:CZ CE2:CZ P=O1P|N/1 O2P/1 O3P/1',
  HYP: 'C=O|OD1/1',
  A: "P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C6 C5:C4 C6:N1 N1:C2 C2:N3 N3:C4|OP2/1 O2'/1 N6/2",
  C: "P=OP1 C2=O2 N3=C4 C5=C6|OP2/1 O2'/1 N4/2",
  G: "P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C4 C6=O6 C2=N3|OP2/1 O2'/1 N1/1 N2/2",
  U: "P=OP1 C2=O2 C4=O4 C5=C6|OP2/1 O2'/1 N3/1",
  DA: 'P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C6 C5:C4 C6:N1 N1:C2 C2:N3 N3:C4|OP2/1 N6/2',
  DC: 'P=OP1 C2=O2 N3=C4 C5=C6|OP2/1 N4/2',
  DG: 'P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C4 C6=O6 C2=N3|OP2/1 N1/1 N2/2',
  DT: 'P=OP1 C2=O2 C4=O4 C5=C6|OP2/1 N3/1',
  I: "P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C4 C6=O6 C2=N3|OP2/1 O2'/1 N1/1",
  DI: 'P=OP1 N9:C8 N9:C4 C8:N7 N7:C5 C5:C4 C6=O6 C2=N3|OP2/1 N1/1',
};

// Older files name phosphate oxygens O1P–O3P and sugar atoms with '*'.
const ATOM_ALIASES = new Map([['O1P', 'OP1'], ['O2P', 'OP2'], ['O3P', 'OP3']]);
// Intra-residue bonds of a fully matched residue follow the dictionary; one it lists is added
// only if its atoms are closer than this, so badly placed atoms do not grow long sticks.
const MAX_DICTIONARY_BOND = 3;
const HETEROATOMS = new Set(['N', 'O', 'S', 'SE']);
// Placeholder names (unknown ligand, residue, atom; dummy atoms) have no chemistry to fetch.
const PLACEHOLDERS = new Set(['UNL', 'UNK', 'UNX', 'DUM', 'N', 'DN']);
const standardCache = new Map();

// The component for a residue name: the file's or a fetched one first, then the built-in table.
export function componentFor(resName, components) {
  const id = String(resName ?? '').toUpperCase();
  return components?.get(id) ?? standardComponent(id);
}

export function standardComponent(id) {
  if (!(id in STANDARD)) return null;
  let component = standardCache.get(id);
  if (!component) {
    component = decodeStandard(id, STANDARD[id]);
    standardCache.set(id, component);
  }
  return component;
}

function decodeStandard(id, text) {
  const [bondText, hydrogenText] = text.split('|');
  const component = { id, source: 'standard', atoms: new Map(), bonds: new Map() };
  for (const token of bondText.split(' ').filter(Boolean)) {
    const match = token.match(/^(.+?)([=#:])(.+)$/);
    const order = match[2] === '=' ? 2 : match[2] === '#' ? 3 : 1;
    component.bonds.set(bondKey(match[1], match[3]), { order, aromatic: match[2] === ':' });
    if (match[2] === ':') {
      for (const name of [match[1], match[3]]) atomRecord(component, name).aromatic = true;
    }
  }
  for (const token of (hydrogenText ?? '').split(' ').filter(Boolean)) {
    const [name, count] = token.split('/');
    atomRecord(component, name).hydrogens = Number(count);
  }
  return component;
}

function atomRecord(component, name) {
  let atom = component.atoms.get(name);
  if (!atom) {
    atom = { element: '', charge: null, aromatic: false, leaving: false, hydrogens: 0 };
    component.atoms.set(name, atom);
  }
  return atom;
}

export function bondKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function canonicalName(name) {
  const clean = String(name ?? '').trim().toUpperCase().replaceAll('*', "'");
  return ATOM_ALIASES.get(clean) ?? clean;
}

// The component's name for an atom: its own name, else the modern spelling of an old one (O1P →
// OP1, C1* → C1'). Components such as PLP keep names like O1P, so the raw name is tried first.
function componentName(component, name) {
  const raw = String(name ?? '').trim().toUpperCase();
  if (component.atoms.has(raw)) return raw;
  const canonical = canonicalName(raw);
  return component.atoms.has(canonical) ? canonical : null;
}

// Types the bonds and atoms of every residue whose component is known (an `isolated` component,
// a docking pose, is bonded to nothing outside itself). A residue whose heavy
// atoms all carry dictionary names ("complete") takes its intra-residue bonds from the
// dictionary: distance-inferred bonds it does not list are dropped and listed ones are added.
// Bonds between residues (peptide, phosphodiester, disulfide, covalent links) stay single.
// Returns the residue names that have no chemistry yet (ligands and modified residues only).
export function applyChemistry(model, structure = {}) {
  const components = structure.components ?? new Map();
  const conectOrders = structure.conectOrders ?? null;
  const residueOf = model.atomResidue;
  const missing = new Set();
  const matched = new Map();
  let changedBonds = false;
  // Heavy-atom bonds inferred within each residue, to check fetched dictionary entries against.
  const inferred = new Map();
  for (const bond of model.bonds ?? []) {
    if (bond.kind !== 'covalent' || residueOf?.[bond.a] !== residueOf?.[bond.b]) continue;
    if (model.atoms[bond.a].isHydrogen || model.atoms[bond.b].isHydrogen) continue;
    const list = inferred.get(residueOf[bond.a]);
    if (list) list.push(bond);
    else inferred.set(residueOf[bond.a], [bond]);
  }

  for (const residue of model.residues ?? []) {
    for (const atom of residue.atoms) {
      atom.aromatic = false;
      atom.hydrogens = undefined;
    }
    residue.chemistry = '';
    if (residue.kind === 'water' || residue.kind === 'ion') continue;
    const resName = String(residue.resName).toUpperCase();
    const component = PLACEHOLDERS.has(resName) ? null : componentFor(resName, components);
    if (!component) {
      if ((residue.kind === 'ligand' || residue.modified) && !PLACEHOLDERS.has(resName)) missing.add(resName);
      continue;
    }
    // A fetched dictionary entry types a residue only when it is the same molecule: files from
    // docking or modeling programs reuse codes such as LIG, MOL or CPD, often with generic atom
    // names (C1, N1…) that such entries also use.
    if (component.source === 'ccd' && !matchesComponent(residue, component, inferred.get(residue.index) ?? [], model.atoms)) continue;
    // A component without bond orders (a PDBQT pose) only isolates its residue; the residue is
    // typed from geometry.
    if (component.untyped) {
      matched.set(residue.index, { component, names: new Map(), complete: false });
      continue;
    }
    const names = new Map();
    // The built-in table lists only atoms with hydrogens or multiple bonds; it never replaces
    // distance-inferred bonds.
    let complete = component.source !== 'standard';
    for (const atom of residue.atoms) {
      const name = componentName(component, atom.name) ?? canonicalName(atom.name);
      names.set(atom.id, name);
      const record = component.atoms.get(name);
      if (!record) {
        if (!atom.isHydrogen) complete = false;
        // Heteroatoms the built-in table does not list carry no hydrogens.
        if (component.source === 'standard' && HETEROATOMS.has(atom.element)) atom.hydrogens = 0;
        continue;
      }
      atom.aromatic = Boolean(record.aromatic);
      if (!atom.isHydrogen) atom.hydrogens = record.allHydrogens ?? record.hydrogens ?? 0;
      if (Number.isFinite(record.charge) && record.charge !== 0 && !atom.charge && residue.kind === 'ligand') atom.charge = record.charge;
    }
    residue.chemistry = component.source ?? 'file';
    matched.set(residue.index, { component, names, complete });
  }

  const kept = [];
  const present = new Set();
  const count = model.atoms.length;
  for (const bond of model.bonds ?? []) {
    bond.order = bond.sourceOrder ?? 1;
    bond.aromatic = bond.sourceAromatic ?? false;
    const a = model.atoms[bond.a];
    const b = model.atoms[bond.b];
    const residueA = residueOf?.[bond.a];
    const residueB = residueOf?.[bond.b];
    const match = residueA === residueB ? matched.get(residueA) : null;
    // Molecules from docking files stand alone: a pose placed over the crystal ligand, or
    // against the receptor, is never bonded to it.
    if (residueA !== residueB && (matched.get(residueA)?.component.isolated || matched.get(residueB)?.component.isolated)) {
      changedBonds = true;
      continue;
    }
    if (match && !match.component.untyped && bond.kind === 'covalent') {
      const typed = match.component.bonds.get(bondKey(match.names.get(a.id), match.names.get(b.id)));
      if (typed) {
        bond.order = typed.order;
        bond.aromatic = typed.aromatic;
      } else if (match.complete && !a.isHydrogen && !b.isHydrogen) {
        changedBonds = true;
        continue;
      }
    } else if (!match && conectOrders && bond.kind === 'covalent' && bond.sourceOrder === undefined) {
      const order = conectOrders.get(pairKey(a.serial, b.serial));
      if (order > 1) bond.order = order;
    }
    present.add(bond.a < bond.b ? bond.a * count + bond.b : bond.b * count + bond.a);
    kept.push(bond);
  }

  // Dictionary bonds that distance inference missed (long bonds in strained or poorly fitted
  // ligands), for complete residues only.
  for (const [residueIndex, match] of matched) {
    if (!match.complete) continue;
    const residue = model.residues[residueIndex];
    const byName = new Map();
    for (const atom of residue.atoms) byName.set(match.names.get(atom.id), atom);
    for (const [key, typed] of match.component.bonds) {
      const [nameA, nameB] = key.split('|');
      const a = byName.get(nameA);
      const b = byName.get(nameB);
      if (!a || !b) continue;
      const pair = a.id < b.id ? a.id * count + b.id : b.id * count + a.id;
      if (present.has(pair)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > MAX_DICTIONARY_BOND) continue;
      present.add(pair);
      kept.push({ a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), kind: 'covalent', order: typed.order, aromatic: typed.aromatic });
      changedBonds = true;
    }
  }
  if (changedBonds) model.bonds = kept;
  // Dictionary hydrogens make way for bonds to other residues (peptide and glycosidic bonds, the
  // leaving hydrogens of a linked residue). The built-in table already assumes the peptide bonds.
  for (const bond of kept) {
    if (bond.kind !== 'covalent') continue;
    const residueA = residueOf?.[bond.a];
    const residueB = residueOf?.[bond.b];
    if (residueA === residueB) continue;
    for (const [index, residueIndex] of [[bond.a, residueA], [bond.b, residueB]]) {
      const match = matched.get(residueIndex);
      const atom = model.atoms[index];
      if (!match || match.component.source === 'standard' || atom.isHydrogen || !(atom.hydrogens > 0)) continue;
      atom.hydrogens -= 1;
    }
  }
  model.chemistryVersion = (model.chemistryVersion ?? 0) + 1;
  return missing;
}

// Every heavy atom by name and element, every heavy-atom bond inferred from the coordinates in
// the dictionary, and at least half of the dictionary's heavy atoms present.
function matchesComponent(residue, component, bonds, atoms) {
  const names = new Map();
  let heavy = 0;
  for (const atom of residue.atoms) {
    if (atom.isHydrogen) continue;
    const name = componentName(component, atom.name);
    const record = name ? component.atoms.get(name) : null;
    if (!record || (record.element && record.element !== String(atom.element).toUpperCase())) return false;
    names.set(atom.id, name);
    heavy += 1;
  }
  for (const bond of bonds) {
    if (!component.bonds.has(bondKey(names.get(atoms[bond.a].id), names.get(atoms[bond.b].id)))) return false;
  }
  let listed = 0;
  for (const record of component.atoms.values()) if (record.element !== 'H' && record.element !== 'D' && !record.leaving) listed += 1;
  return heavy * 2 >= listed;
}

// PDB CONECT records written by RDKit, Open Babel or PyMOL repeat a partner for double and
// triple bonds. Keys are serial pairs.
export function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Standard valences for hydrogens left implicit in SDF/MOL2 files without explicit hydrogens:
// the lowest valence that fits the bonds, adjusted for the formal charge.
const VALENCES = { C: [4], N: [3, 5], O: [2], S: [2, 4, 6], P: [3, 5], B: [3], SE: [2, 4, 6], SI: [4] };

export function implicitHydrogens(element, bondOrderSum, charge = 0, aromatic = false) {
  const valences = VALENCES[String(element).toUpperCase()];
  if (!valences) return 0;
  let used = bondOrderSum;
  // Aromatic bonds count 1.5; a ring atom with two aromatic bonds and no substituent is C–H.
  if (aromatic) used = Math.ceil(used - 1e-9);
  // Aromatic atoms keep their lowest valence: the N of 1-methylimidazole and the S of thiophene
  // carry no hydrogen.
  const allowed = aromatic ? valences.slice(0, 1) : valences;
  // A charged atom bonds like its isoelectronic neighbor: N⁺ like C, O⁻ like F, B⁻ like C;
  // carbocations and carbanions both have three bonds.
  const upper = String(element).toUpperCase();
  const shift = upper === 'C' ? -Math.abs(charge) : upper === 'B' ? -charge : charge;
  for (const valence of allowed) {
    const target = valence + shift;
    if (target >= used) return Math.max(0, Math.round(target - used));
  }
  return 0;
}

/* ---------- Multiple bonds in sticks ---------- */

const decorationCache = new WeakMap();

// For every double, triple or aromatic bond: the unit vector perpendicular to the bond along
// which extra lines are offset, toward the center of the smallest ring containing the bond when
// there is one (inner lines, as in chemical drawings), otherwise in the plane of a substituent.
export function bondDecorations(model) {
  const cached = decorationCache.get(model);
  // Offsets are directions in space: a superposition (geometryVersion) turns them.
  if (cached && cached.version === model.chemistryVersion && cached.geometry === model.geometryVersion && cached.bonds === model.bonds) return cached.items;
  const atoms = model.atoms;
  const neighbors = new Map();
  const link = (from, to) => {
    const list = neighbors.get(from);
    if (list) list.push(to);
    else neighbors.set(from, [to]);
  };
  for (const bond of model.bonds ?? []) {
    if (bond.kind !== 'covalent' || atoms[bond.a].isHydrogen || atoms[bond.b].isHydrogen) continue;
    link(bond.a, bond.b);
    link(bond.b, bond.a);
  }
  const items = [];
  (model.bonds ?? []).forEach((bond, index) => {
    if (!(bond.order > 1 || bond.aromatic)) return;
    const a = atoms[bond.a];
    const b = atoms[bond.b];
    const axis = [b.x - a.x, b.y - a.y, b.z - a.z];
    const ring = smallestRing(neighbors, bond.a, bond.b);
    let direction = null;
    if (ring) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const atom of ring) {
        cx += atoms[atom].x;
        cy += atoms[atom].y;
        cz += atoms[atom].z;
      }
      const toCenter = [cx / ring.length - (a.x + b.x) / 2, cy / ring.length - (a.y + b.y) / 2, cz / ring.length - (a.z + b.z) / 2];
      direction = perpendicular(toCenter, axis);
    }
    if (!direction) {
      const substituent = (neighbors.get(bond.a) ?? []).find((other) => other !== bond.b)
        ?? (neighbors.get(bond.b) ?? []).find((other) => other !== bond.a);
      if (substituent !== undefined) {
        const origin = (neighbors.get(bond.a) ?? []).includes(substituent) ? a : b;
        const s = atoms[substituent];
        direction = perpendicular([s.x - origin.x, s.y - origin.y, s.z - origin.z], axis);
      }
    }
    items.push({ index, direction: direction ?? anyPerpendicular(axis), ring: Boolean(ring) });
  });
  decorationCache.set(model, { version: model.chemistryVersion, geometry: model.geometryVersion, bonds: model.bonds, items });
  return items;
}

// Breadth-first search for the shortest path from a to b that avoids the bond itself; rings of
// up to eight atoms count.
function smallestRing(neighbors, a, b) {
  const previous = new Map([[a, -1]]);
  let frontier = [a];
  for (let depth = 0; depth < 7 && frontier.length; depth += 1) {
    const next = [];
    for (const atom of frontier) {
      for (const other of neighbors.get(atom) ?? []) {
        if (atom === a && other === b) continue;
        if (previous.has(other)) continue;
        previous.set(other, atom);
        if (other === b) {
          const ring = [];
          for (let cursor = b; cursor !== -1; cursor = previous.get(cursor)) ring.push(cursor);
          return ring;
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

function perpendicular(vector, axis) {
  const axisLength2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  if (!(axisLength2 > 0)) return null;
  const along = (vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2]) / axisLength2;
  const x = vector[0] - along * axis[0];
  const y = vector[1] - along * axis[1];
  const z = vector[2] - along * axis[2];
  const length = Math.hypot(x, y, z);
  return length > 1e-6 ? [x / length, y / length, z / length] : null;
}

function anyPerpendicular(axis) {
  const helper = Math.abs(axis[0]) < 0.9 * Math.hypot(...axis) ? [1, 0, 0] : [0, 1, 0];
  const x = axis[1] * helper[2] - axis[2] * helper[1];
  const y = axis[2] * helper[0] - axis[0] * helper[2];
  const z = axis[0] * helper[1] - axis[1] * helper[0];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
