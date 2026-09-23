import { buildCartoon } from './cartoon.js';
import { elementInfo } from './elements.js';
import { CYLINDER_STRIDE, CYLINDER_STYLE, SPHERE_STRIDE, createInstanceWriter, packColor } from './renderer.js';

export const REPRESENTATIONS = ['cartoon', 'trace', 'ball-stick', 'sticks', 'spacefill', 'none'];

const SIDECHAIN_EXCLUDED = new Set(['N', 'C', 'O', 'OXT', 'H', 'HA', 'H1', 'H2', 'H3']);
const NUCLEIC_BACKBONE = new Set(['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P', "O5'", "C5'", "O3'"]);

// Builds sphere and cylinder instances for one model. `context.atomOffset` shifts every atom
// index so that several structures can share the renderer's atom color and flag buffers.
export function buildScene(model, structure, display, context = {}) {
  const atoms = model.atoms;
  const count = atoms.length;
  const styles = new Uint8Array(count);
  const visible = new Uint8Array(count);
  const focus = context.focusResidues ?? new Set();
  const emphasis = context.emphasisResidues ?? new Set();
  const offset = context.atomOffset ?? 0;
  const chainVisible = (chain) => !display.visibleChains || display.visibleChains.has(chain);
  const residueVisible = (residue) => chainVisible(residue.chain) && (!display.residueFilter || display.residueFilter.has(residue.key));

  let cartoon = null;
  if (display.polymer === 'cartoon') {
    cartoon = context.cartoon ?? buildCartoon(model, {
      include: residueVisible,
      widthScale: display.cartoonWidth,
      quality: display.cartoonQuality,
    });
  }

  for (let index = 0; index < count; index += 1) {
    const atom = atoms[index];
    if (!chainVisible(atom.chain)) continue;
    if (atom.isHydrogen && !display.showHydrogen) continue;
    const residue = model.residues[model.atomResidue[index]];
    if (display.residueFilter && !display.residueFilter.has(residue.key) && (residue.kind === 'protein' || residue.kind === 'nucleic')) continue;
    styles[index] = atomStyle(atom, residue, display, cartoon, focus.has(residue.key) || emphasis.has(residue.key));
    if (styles[index]) visible[index] = 1;
  }
  if (cartoon) {
    for (const residue of model.residues) {
      if (cartoon.covered.has(residue.key)) {
        const representative = residue.representative;
        if (representative) visible[representative.id] = 1;
      }
    }
  }

  const spheres = createInstanceWriter(SPHERE_STRIDE, Math.max(64, count));
  for (let index = 0; index < count; index += 1) {
    const style = styles[index];
    if (!style) continue;
    const radius = atomRadius(atoms[index], style, display);
    if (radius <= 0) continue;
    writeSphere(spheres, atoms[index], radius, index + offset);
  }

  const cylinders = createInstanceWriter(CYLINDER_STRIDE, Math.max(64, model.bonds.length));
  for (const bond of model.bonds) {
    const styleA = styles[bond.a];
    const styleB = styles[bond.b];
    if (!styleA || !styleB) continue;
    const radius = bondRadius(styleA, styleB, display);
    if (radius <= 0) continue;
    const a = atoms[bond.a];
    const b = atoms[bond.b];
    if (bond.kind === 'metal') {
      writeCylinder(cylinders, [a.x, a.y, a.z], [b.x, b.y, b.z], Math.min(radius, 0.07), bond.a + offset, bond.b + offset, CYLINDER_STYLE.dashed);
    } else {
      writeCylinder(cylinders, [a.x, a.y, a.z], [b.x, b.y, b.z], radius, bond.a + offset, bond.b + offset, 0);
    }
  }
  if (display.polymer === 'trace') writeTrace(cylinders, model, display, residueVisible, offset);
  if (cartoon) {
    for (const connector of cartoon.cylinders) {
      writeCylinder(cylinders, connector.a, connector.b, connector.radius, connector.atomA + offset, connector.atomB + offset, CYLINDER_STYLE.roundCaps);
    }
  }
  for (const line of context.lines ?? []) {
    let style = CYLINDER_STYLE.colorOverride | CYLINDER_STYLE.noPick;
    if (line.dashed !== false) style |= CYLINDER_STYLE.dashed;
    if (line.caps) style |= CYLINDER_STYLE.roundCaps;
    writeCylinder(cylinders, line.from, line.to, line.radius ?? 0.07, (line.atomA ?? 0) + offset, (line.atomB ?? 0) + offset, style, line.color);
  }
  for (const marker of context.markers ?? []) {
    writeSphere(spheres, { x: marker.position[0], y: marker.position[1], z: marker.position[2] }, marker.radius, (marker.atom ?? 0) + offset);
  }

  return {
    spheres: { data: spheres.finish(), count: spheres.count },
    cylinders: { data: cylinders.finish(), count: cylinders.count },
    cartoon,
    styles,
    visible,
  };
}

// Cylinder instances for free-standing lines (measurements that may join two structures).
export function buildLines(lines) {
  const cylinders = createInstanceWriter(CYLINDER_STRIDE, Math.max(8, lines.length));
  for (const line of lines) {
    let style = CYLINDER_STYLE.colorOverride | CYLINDER_STYLE.noPick;
    if (line.dashed !== false) style |= CYLINDER_STYLE.dashed;
    if (line.caps) style |= CYLINDER_STYLE.roundCaps;
    writeCylinder(cylinders, line.from, line.to, line.radius ?? 0.07, 0, 0, style, line.color);
  }
  return { data: cylinders.finish(), count: cylinders.count };
}

const STYLE = {
  none: 0,
  ballStick: 1,
  sticks: 2,
  spacefill: 3,
  water: 4,
  ion: 5,
  trace: 6,
  sidechain: 7,
};

export { STYLE as ATOM_STYLE };

function representationStyle(name) {
  if (name === 'ball-stick') return STYLE.ballStick;
  if (name === 'sticks') return STYLE.sticks;
  if (name === 'spacefill') return STYLE.spacefill;
  return STYLE.none;
}

function atomStyle(atom, residue, display, cartoon, inFocus) {
  if (atom.kind === 'water') return display.showWater ? (display.polymer === 'spacefill' ? STYLE.spacefill : STYLE.water) : STYLE.none;
  if (atom.kind === 'ion') return display.ligand === 'none' ? STYLE.none : (display.ligand === 'spacefill' ? STYLE.spacefill : STYLE.ion);
  if (atom.kind === 'ligand') return representationStyle(display.ligand);
  const polymer = display.polymer;
  if (polymer === 'ball-stick' || polymer === 'sticks' || polymer === 'spacefill') return representationStyle(polymer);
  if (polymer === 'cartoon' && cartoon && !cartoon.covered.has(residue.key)) return STYLE.ballStick;
  if (polymer === 'trace') {
    if (atom === residue.representative && (residue.backbone.CA === atom || residue.nucleic)) return STYLE.trace;
  }
  const showSidechain = inFocus || display.sidechains === 'all';
  if (!showSidechain) return STYLE.none;
  if (atom.kind === 'protein') {
    if (SIDECHAIN_EXCLUDED.has(atom.name) && !(atom.name === 'N' && residue.parent === 'PRO')) return inFocus && display.sidechains !== 'all' && display.focusBackbone ? STYLE.sidechain : STYLE.none;
    return STYLE.sidechain;
  }
  if (atom.kind === 'nucleic') return NUCLEIC_BACKBONE.has(atom.name) && !inFocus ? STYLE.none : STYLE.sidechain;
  return STYLE.none;
}

function atomRadius(atom, style, display) {
  const info = elementInfo(atom.element);
  const atomScale = display.atomScale ?? 1;
  const bondScale = display.bondScale ?? 1;
  switch (style) {
    case STYLE.spacefill:
      return info.vdw * atomScale;
    case STYLE.ballStick:
      return Math.max(0.2, info.vdw * 0.25 * atomScale);
    case STYLE.sticks:
    case STYLE.sidechain:
      return 0.2 * bondScale;
    case STYLE.water:
      return 0.3 * atomScale;
    case STYLE.ion:
      return info.vdw * 0.42 * atomScale;
    case STYLE.trace:
      return 0.4 * bondScale;
    default:
      return 0;
  }
}

function bondRadius(styleA, styleB, display) {
  const bondScale = display.bondScale ?? 1;
  const stick = (style) => style === STYLE.sticks || style === STYLE.sidechain;
  const ball = (style) => style === STYLE.ballStick;
  if (styleA === STYLE.spacefill || styleB === STYLE.spacefill) return 0;
  if (styleA === STYLE.water || styleB === STYLE.water) return 0.1 * bondScale;
  if (stick(styleA) && stick(styleB)) return 0.2 * bondScale;
  if ((stick(styleA) || ball(styleA)) && (stick(styleB) || ball(styleB))) return 0.13 * bondScale;
  if (styleA === STYLE.ion || styleB === STYLE.ion) return 0.1 * bondScale;
  return 0;
}

function writeTrace(cylinders, model, display, residueVisible, offset = 0) {
  const radius = 0.4 * (display.bondScale ?? 1);
  let previous = null;
  for (const residue of model.residues) {
    const usable = (residue.kind === 'protein' && residue.backbone.CA) || (residue.kind === 'nucleic' && residue.representative);
    if (!usable || !residueVisible(residue)) {
      previous = null;
      continue;
    }
    if (previous && residue.linkedToPrevious && previous.chain === residue.chain) {
      const a = previous.representative;
      const b = residue.representative;
      writeCylinder(cylinders, [a.x, a.y, a.z], [b.x, b.y, b.z], radius, a.id + offset, b.id + offset, 0);
    }
    previous = residue;
  }
}

function writeSphere(writer, atom, radius, atomIndex) {
  const offset = writer.next();
  const floats = writer.floats;
  floats[offset] = atom.x;
  floats[offset + 1] = atom.y;
  floats[offset + 2] = atom.z;
  floats[offset + 3] = radius;
  writer.uints[offset + 4] = atomIndex >>> 0;
}

function writeCylinder(writer, a, b, radius, atomA, atomB, style, color = null) {
  const offset = writer.next();
  const floats = writer.floats;
  const uints = writer.uints;
  floats[offset] = a[0];
  floats[offset + 1] = a[1];
  floats[offset + 2] = a[2];
  floats[offset + 3] = radius;
  floats[offset + 4] = b[0];
  floats[offset + 5] = b[1];
  floats[offset + 6] = b[2];
  uints[offset + 7] = atomA >>> 0;
  uints[offset + 8] = atomB >>> 0;
  uints[offset + 9] = style >>> 0;
  uints[offset + 10] = color ? packColor(color) : 0;
}

export function focusNeighborhood(model, residueKeys, radius = 5) {
  const selected = new Set(residueKeys);
  const focusAtoms = [];
  for (const key of selected) {
    const residue = model.residueMap.get(key);
    if (residue) focusAtoms.push(...residue.atoms);
  }
  if (!focusAtoms.length) return selected;
  const cell = radius;
  const grid = new Map();
  for (const atom of focusAtoms) {
    const key = `${Math.floor(atom.x / cell)},${Math.floor(atom.y / cell)},${Math.floor(atom.z / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(atom);
  }
  const radius2 = radius * radius;
  const result = new Set(selected);
  for (const residue of model.residues) {
    if (result.has(residue.key) || residue.kind === 'water') continue;
    let near = false;
    for (const atom of residue.atoms) {
      const gx = Math.floor(atom.x / cell);
      const gy = Math.floor(atom.y / cell);
      const gz = Math.floor(atom.z / cell);
      for (let dx = -1; dx <= 1 && !near; dx += 1) {
        for (let dy = -1; dy <= 1 && !near; dy += 1) {
          for (let dz = -1; dz <= 1 && !near; dz += 1) {
            const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!bucket) continue;
            for (const other of bucket) {
              const ddx = atom.x - other.x;
              const ddy = atom.y - other.y;
              const ddz = atom.z - other.z;
              if (ddx * ddx + ddy * ddy + ddz * ddz <= radius2) {
                near = true;
                break;
              }
            }
          }
        }
      }
      if (near) break;
    }
    if (near) result.add(residue.key);
  }
  return result;
}
