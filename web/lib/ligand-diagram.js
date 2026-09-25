// A 2D diagram of a ligand and the residues it interacts with, in the style of LigPlot+ and
// PoseView: the ligand drawn flat (depict.js), each residue as a label placed where it lies in
// the view, dashed lines for hydrogen bonds, salt bridges, π and metal contacts with their
// distances, arcs on the ligand atoms for hydrophobic contacts, and waters between the atoms
// they bridge. The result is a standalone SVG. Nothing here touches the DOM.
//
// input: {
//   title, subtitle,
//   atoms: [{ element, name, charge, hydrogens, x, y, z }]   heavy atoms of the ligand
//   bonds: [{ a, b, order, aromatic }]                        within the ligand
//   reference: [[x, y]] | null        the atoms on screen, so the drawing matches the view
//   contacts: [{ type, atoms: [ligand atom indices], point: [x, y] (partner on screen),
//                distance, residue: { key, label }, water: { key, label, point } | null }]
//   types: [{ id, label, color }]      interaction types, in order of precedence
// }

import { implicitHydrogens } from './chemistry.js';
import { layoutMolecule } from './depict.js';

const BOND = 34;
const FONT = 12;
const SMALL = 10;
const TEXT = '#1f2328';
const MUTED = '#6b7280';
const ELEMENT_COLORS = { N: '#2155c4', O: '#d1261f', S: '#a37a00', P: '#d06a00', F: '#1e8f3a', CL: '#1e8f3a', BR: '#8a3b12', I: '#6b2c91', B: '#b5651d', SE: '#a37a00' };
// Types drawn as lines, strongest first; hydrophobic contacts are arcs instead.
const LINE_DASH = { 'metal-coordination': '', 'water-bridge': '3 3', 'pi-stacking': '2 3', 'cation-pi': '2 3' };
const HETERO_H = new Set(['N', 'O', 'S', 'P', 'SE', 'B']);

export function ligandDiagram(input) {
  const atoms = input.atoms ?? [];
  const bonds = input.bonds ?? [];
  const types = new Map((input.types ?? []).map((type, index) => [type.id, { ...type, rank: index }]));
  const layout = layoutMolecule({ atoms, bonds }, { reference: input.reference });
  // Screen y points down, like SVG's, so the drawing keeps the view's handedness.
  const points = layout.points;
  const neighbors = atoms.map(() => []);
  for (const bond of bonds) {
    neighbors[bond.a]?.push(bond.b);
    neighbors[bond.b]?.push(bond.a);
  }
  const labels = atoms.map((atom, index) => atomLabel(atom, index, bonds, neighbors, points, input.atomNames));
  const ringOf = smallestRings(layout.rings);
  // Labels keep clear of the atoms, of the middles of bonds and of the centers of rings.
  const obstacles = [
    ...points.map((point) => ({ point, margin: 0.7 })),
    ...bonds.map((bond) => ({ point: scale(add(points[bond.a], points[bond.b]), 0.5), margin: 0.45 })),
    ...layout.rings.map((ring) => ({ point: mean(ring.map((atom) => points[atom])), margin: ring.length > 8 ? 1.2 : 0.8 })),
  ];
  const residues = placeResidues(input.contacts ?? [], points, obstacles, layout.fromReference, types);
  const svg = drawDiagram({ input, atoms, bonds, points, labels, ringOf, rings: layout.rings, residues, types, layout });
  return {
    svg: svg.text,
    width: svg.width,
    height: svg.height,
    method: layout.method,
    approximate: layout.approximate,
    residues: residues.bubbles.length,
    // Where everything went, in bond lengths, for checks.
    placement: { points, labels: [...residues.bubbles, ...residues.waters].map((node) => ({ label: node.label, position: node.position, half: node.half })) },
  };
}

/* ---------- Atom labels ---------- */

function atomLabel(atom, index, bonds, neighbors, points, withNames) {
  const element = String(atom.element ?? '').toUpperCase();
  const charge = Number(atom.charge) || 0;
  const bondOrders = bonds.filter((bond) => bond.a === index || bond.b === index).reduce((sum, bond) => sum + (bond.aromatic && !(bond.order > 1) ? 1.5 : bond.order ?? 1), 0);
  const hydrogens = Number.isFinite(atom.hydrogens) ? atom.hydrogens : HETERO_H.has(element) ? implicitHydrogens(element, bondOrders, charge, Boolean(atom.aromatic)) : 0;
  const shown = element !== 'C' || charge !== 0 || neighbors[index].length === 0;
  if (!shown) return { shown: false, name: withNames ? atom.name : '' };
  const symbol = element.length > 1 ? element[0] + element.slice(1).toLowerCase() : element;
  // Hydrogens go on the side away from the bonds.
  const origin = points[index];
  let side = 0;
  for (const next of neighbors[index]) side += points[next][0] - origin[0];
  const hText = HETERO_H.has(element) && hydrogens > 0 ? `H${hydrogens > 1 ? hydrogens : ''}` : '';
  return {
    shown: true,
    symbol,
    hydrogens: hText,
    left: side > 0.3,
    charge: charge === 0 ? '' : `${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '−'}`,
    color: ELEMENT_COLORS[element] ?? TEXT,
    name: withNames ? atom.name : '',
  };
}

function smallestRings(rings) {
  const byBond = new Map();
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const known = byBond.get(key);
      if (!known || ring.length < known.length) byBond.set(key, ring);
    }
  }
  return byBond;
}

/* ---------- Residues ---------- */

// One label per residue, first where the residue lies in the view (relative to the ligand), at
// least a fixed distance out, then pushed clear of the ligand and of each other.
function placeResidues(contacts, points, obstacles, fromReference, types) {
  const center = mean(points);
  const groups = new Map();
  const waters = new Map();
  for (const contact of contacts) {
    const anchor = contact.atoms.length ? mean(contact.atoms.map((atom) => points[atom])) : center;
    const key = contact.residue.key;
    if (!groups.has(key)) groups.set(key, { key, label: contact.residue.label, contacts: [], anchors: [], targets: [] });
    const group = groups.get(key);
    group.contacts.push({ ...contact, anchor });
    group.anchors.push(anchor);
    if (contact.point) group.targets.push(fromReference(contact.point));
    if (contact.water && !waters.has(contact.water.key)) waters.set(contact.water.key, { key: contact.water.key, label: contact.water.label, point: contact.water.point ? fromReference(contact.water.point) : null, anchors: [] });
    if (contact.water) waters.get(contact.water.key).anchors.push(anchor);
  }
  const bubbles = [...groups.values()].map((group) => {
    const anchor = mean(group.anchors);
    const target = group.targets.length ? mean(group.targets) : null;
    let direction = target ? sub(target, anchor) : sub(anchor, center);
    if (length(direction) < 0.3) direction = sub(anchor, center);
    if (length(direction) < 0.3) direction = [0, -1];
    direction = normalize(direction);
    const strongest = group.contacts.reduce((best, contact) => ((types.get(contact.type)?.rank ?? 99) < (types.get(best.type)?.rank ?? 99) ? contact : best));
    const size = textSize(group.label, FONT);
    return { ...group, type: strongest.type, anchor, direction, half: [size[0] / 2 / BOND + 0.25, size[1] / 2 / BOND + 0.18], kind: 'residue', rank: types.get(strongest.type)?.rank ?? 99 };
  });
  const waterNodes = [...waters.values()].map((water) => {
    const anchor = mean(water.anchors);
    const direction = normalize(water.point && length(sub(water.point, anchor)) > 0.3 ? sub(water.point, anchor) : sub(anchor, center));
    const size = textSize(water.label, SMALL);
    return { ...water, anchor, direction, half: [size[0] / 2 / BOND + 0.15, size[1] / 2 / BOND + 0.12], kind: 'water', rank: -1 };
  });
  // Waters first (they sit close in), then residues by the strength of their contact.
  const placed = [];
  for (const node of [...waterNodes, ...bubbles].sort((a, b) => a.rank - b.rank)) {
    node.home = clearSpot(node, obstacles, placed, node.kind === 'water' ? 1.5 : 2.4);
    node.position = node.home.slice();
    placed.push(node);
  }
  relax([...bubbles, ...waterNodes], obstacles);
  return { bubbles, waters: waterNodes };
}

// The first spot along the residue's direction (or turned away from it as little as possible)
// where its label clears the ligand and the labels placed before it.
function clearSpot(node, obstacles, placed, start) {
  let best = null;
  for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3, Math.PI]) {
    const direction = rotate(node.direction, turn);
    for (let distance = start; distance <= 8; distance += 0.35) {
      const position = add(node.anchor, scale(direction, distance));
      const probe = { position, half: node.half };
      const clear = obstacles.every((item) => boxGap(probe, item.point, item.margin) >= 0)
        && placed.every((other) => Math.abs(position[0] - other.position[0]) >= node.half[0] + other.half[0] + 0.12 || Math.abs(position[1] - other.position[1]) >= node.half[1] + other.half[1] + 0.12);
      if (!clear) continue;
      const cost = distance + Math.abs(turn) * 2.2;
      if (!best || cost < best.cost) best = { cost, position };
      break;
    }
  }
  return best?.position ?? add(node.anchor, scale(node.direction, start + 4));
}

// Springs pull each label to its place; the ligand and the other labels push.
function relax(nodes, obstacles) {
  for (let step = 0; step < 300; step += 1) {
    const rate = step < 200 ? 0.08 : 0.03;
    for (const node of nodes) {
      let force = scale(sub(node.home, node.position), node.kind === 'water' ? 0.2 : 0.05);
      for (const item of obstacles) {
        const gap = boxGap(node, item.point, item.margin);
        if (gap < 0) force = add(force, scale(normalize(sub(node.position, item.point), normalize(sub(node.position, node.anchor), [0, -1])), -gap * 1.2));
      }
      for (const other of nodes) {
        if (other === node) continue;
        const dx = Math.abs(node.position[0] - other.position[0]) - (node.half[0] + other.half[0] + 0.15);
        const dy = Math.abs(node.position[1] - other.position[1]) - (node.half[1] + other.half[1] + 0.15);
        if (dx < 0 && dy < 0) {
          const push = normalize(sub(node.position, other.position), [0.7, 0.7]);
          force = add(force, scale(push, Math.min(-dx, -dy) * 1.2));
        }
      }
      node.position = add(node.position, scale(force, rate / 0.08));
    }
  }
}

// How far a point is outside a label's box grown by a margin (negative inside).
function boxGap(node, point, margin) {
  const dx = Math.abs(point[0] - node.position[0]) - node.half[0] - margin;
  const dy = Math.abs(point[1] - node.position[1]) - node.half[1] - margin;
  return Math.max(dx, dy);
}

/* ---------- Drawing ---------- */

function drawDiagram({ input, atoms, bonds, points, labels, ringOf, rings, residues, types, layout }) {
  const parts = [];
  const px = (point) => [point[0] * BOND, point[1] * BOND];
  const colorOf = (type) => types.get(type)?.color ?? MUTED;
  const used = new Set();

  // Interaction lines under everything else.
  for (const bubble of residues.bubbles) {
    for (const contact of bubble.contacts) {
      if (contact.type === 'hydrophobic') {
        used.add('hydrophobic');
        continue;
      }
      used.add(contact.type);
      const color = colorOf(contact.type);
      const dash = LINE_DASH[contact.type] ?? '5 3';
      if (contact.water) {
        const water = residues.waters.find((node) => node.key === contact.water.key);
        if (!water) continue;
        parts.push(line(px(contact.anchor), px(clipToBox(water, contact.anchor)), color, dash, 1.4));
        parts.push(line(px(clipToBox(water, bubble.position)), px(clipToBox(bubble, water.position)), color, dash, 1.4));
        continue;
      }
      const start = contact.anchor;
      const end = clipToBox(bubble, start);
      parts.push(line(px(start), px(end), color, dash, 1.5));
      if (Number.isFinite(contact.distance) && contact.type !== 'hydrophobic') {
        const middle = px(scale(add(start, end), 0.5));
        parts.push(text(middle[0], middle[1] - 3, `${contact.distance.toFixed(2)}`, SMALL - 1, color, { halo: true }));
      }
    }
  }
  // π contacts start at the ring's center: a small dashed circle marks it.
  for (const bubble of residues.bubbles) {
    for (const contact of bubble.contacts) {
      if ((contact.type === 'pi-stacking' || contact.type === 'cation-pi') && contact.atoms.length > 2) {
        const center = px(contact.anchor);
        parts.push(`<circle cx="${fmt(center[0])}" cy="${fmt(center[1])}" r="${fmt(BOND * 0.28)}" fill="none" stroke="${colorOf(contact.type)}" stroke-width="1.2" stroke-dasharray="2 2"/>`);
      }
    }
  }

  // The ligand's bonds.
  for (const bond of bonds) parts.push(...drawBond(bond, points, labels, ringOf, px));
  // Aromatic rings without alternating bonds get a circle.
  for (const ring of rings) {
    const edges = ring.map((atom, index) => bonds.find((bond) => (bond.a === atom && bond.b === ring[(index + 1) % ring.length]) || (bond.b === atom && bond.a === ring[(index + 1) % ring.length])));
    if (edges.every((bond) => bond?.aromatic) && !edges.some((bond) => bond.order > 1) && ring.length <= 7) {
      const center = px(mean(ring.map((atom) => points[atom])));
      parts.push(`<circle cx="${fmt(center[0])}" cy="${fmt(center[1])}" r="${fmt(BOND * 0.55 * circumradius(ring.length))}" fill="none" stroke="${TEXT}" stroke-width="1.2"/>`);
    }
  }
  // Hydrophobic contacts: arcs on the ligand atoms, facing the residue, one per atom and residue.
  const lashes = new Set();
  for (const bubble of residues.bubbles) {
    for (const contact of bubble.contacts) {
      if (contact.type !== 'hydrophobic') continue;
      for (const atom of contact.atoms.slice(0, 1)) {
        if (lashes.has(`${atom}|${bubble.key}`)) continue;
        lashes.add(`${atom}|${bubble.key}`);
        const center = px(points[atom]);
        const facing = Math.atan2(bubble.position[1] - points[atom][1], bubble.position[0] - points[atom][0]);
        parts.push(eyelash(center, facing, colorOf('hydrophobic')));
      }
    }
  }
  // Atom labels over the bonds.
  labels.forEach((label, index) => {
    const [x, y] = px(points[index]);
    if (label.shown) parts.push(atomText(x, y, label));
    if (label.name) parts.push(text(x + 7, y + 12, label.name, SMALL - 2, MUTED));
  });
  // Waters and residues.
  for (const water of residues.waters) {
    const [x, y] = px(water.position);
    parts.push(`<rect x="${fmt(x - water.half[0] * BOND)}" y="${fmt(y - water.half[1] * BOND)}" width="${fmt(2 * water.half[0] * BOND)}" height="${fmt(2 * water.half[1] * BOND)}" rx="${fmt(water.half[1] * BOND)}" fill="#e8f3ff" stroke="${colorOf('water-bridge')}" stroke-width="1"/>`);
    parts.push(text(x, y + SMALL * 0.35, water.label, SMALL, '#1f5f9e'));
  }
  for (const bubble of residues.bubbles) {
    const [x, y] = px(bubble.position);
    const color = colorOf(bubble.type);
    parts.push(`<rect x="${fmt(x - bubble.half[0] * BOND)}" y="${fmt(y - bubble.half[1] * BOND)}" width="${fmt(2 * bubble.half[0] * BOND)}" height="${fmt(2 * bubble.half[1] * BOND)}" rx="${fmt(Math.min(8, bubble.half[1] * BOND))}" fill="${tint(color)}" stroke="${color}" stroke-width="1.3"/>`);
    parts.push(text(x, y + FONT * 0.35, bubble.label, FONT, TEXT, { weight: 600 }));
  }

  // Bounds of everything drawn, then the title above and the legend below.
  const extents = [...points.map(px)];
  for (const node of [...residues.bubbles, ...residues.waters]) {
    const [x, y] = px(node.position);
    extents.push([x - node.half[0] * BOND, y - node.half[1] * BOND], [x + node.half[0] * BOND, y + node.half[1] * BOND]);
  }
  const minX = Math.min(...extents.map((point) => point[0])) - 24;
  const maxX = Math.max(...extents.map((point) => point[0])) + 24;
  const minY = Math.min(...extents.map((point) => point[1])) - 24;
  const maxY = Math.max(...extents.map((point) => point[1])) + 18;
  const legendItems = [...types.values()].filter((type) => used.has(type.id));
  const legend = legendRows(legendItems, Math.max(360, maxX - minX));
  const header = input.title ? 44 : 12;
  const footer = legend.height + (layout.approximate ? 18 : 0) + 12;
  const width = Math.max(maxX - minX, legend.width + 24);
  const height = maxY - minY + header + footer;
  const originX = -minX + (width - (maxX - minX)) / 2;
  const originY = -minY + header;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="Helvetica, Arial, sans-serif">`);
  if (input.background !== 'none') out.push(`<rect width="100%" height="100%" fill="${input.background ?? '#ffffff'}"/>`);
  if (input.title) {
    const room = Math.max(12, Math.floor((width - 32) / (15 * 0.62)));
    const title = input.title.length > room ? `${input.title.slice(0, room - 1)}…` : input.title;
    out.push(text(16, 22, title, 15, TEXT, { anchor: 'start', weight: 700 }));
    if (input.subtitle) out.push(text(16, 38, input.subtitle, SMALL + 1, MUTED, { anchor: 'start' }));
  }
  out.push(`<g transform="translate(${fmt(originX)} ${fmt(originY)})">${parts.join('')}</g>`);
  const legendTop = maxY - minY + header + 6;
  out.push(`<g transform="translate(16 ${fmt(legendTop)})">${legend.text}</g>`);
  if (layout.approximate) out.push(text(16, legendTop + legend.height + 12, 'Approximate layout: some atoms of this ligand overlap in 2D.', SMALL, '#b45309', { anchor: 'start' }));
  out.push('</svg>');
  return { text: out.join(''), width, height };
}

function drawBond(bond, points, labels, ringOf, px) {
  const a = points[bond.a];
  const b = points[bond.b];
  if (!a || !b) return [];
  if (bond.coordination) {
    const direction = normalize(sub(b, a));
    const start = add(a, scale(direction, labels[bond.a].shown ? 0.3 : 0));
    const end = sub(b, scale(direction, labels[bond.b].shown ? 0.3 : 0));
    return [line(px(start), px(end), MUTED, '3 2', 1.1)];
  }
  const trimA = labels[bond.a].shown ? 0.3 : 0;
  const trimB = labels[bond.b].shown ? 0.3 : 0;
  const direction = normalize(sub(b, a));
  const start = add(a, scale(direction, trimA));
  const end = sub(b, scale(direction, trimB));
  const normal = [-direction[1], direction[0]];
  const out = [line(px(start), px(end), TEXT, '', 1.5)];
  const order = bond.order ?? 1;
  if (order === 2) {
    const key = bond.a < bond.b ? `${bond.a}-${bond.b}` : `${bond.b}-${bond.a}`;
    const ring = ringOf.get(key);
    if (ring) {
      // Inside the ring, shorter.
      const center = mean(ring.map((atom) => points[atom]));
      const side = Math.sign(dot(sub(center, a), normal)) || 1;
      const offset = scale(normal, 0.18 * side);
      const inset = scale(direction, 0.16);
      out.push(line(px(add(add(start, offset), inset)), px(sub(add(end, offset), inset)), TEXT, '', 1.3));
    } else {
      // Outside rings: two lines either side of the bond.
      out.length = 0;
      out.push(line(px(add(start, scale(normal, 0.09))), px(add(end, scale(normal, 0.09))), TEXT, '', 1.4));
      out.push(line(px(sub(start, scale(normal, 0.09))), px(sub(end, scale(normal, 0.09))), TEXT, '', 1.4));
    }
  } else if (order >= 3) {
    for (const side of [-1, 1]) out.push(line(px(add(start, scale(normal, 0.13 * side))), px(add(end, scale(normal, 0.13 * side))), TEXT, '', 1.3));
  }
  return out;
}

function atomText(x, y, label) {
  const main = `<tspan>${escapeXML(label.symbol)}</tspan>`;
  const hydrogens = label.hydrogens ? `<tspan>H</tspan>${label.hydrogens.length > 1 ? `<tspan baseline-shift="sub" font-size="${SMALL - 1}">${label.hydrogens.slice(1)}</tspan>` : ''}` : '';
  const charge = label.charge ? `<tspan baseline-shift="super" font-size="${SMALL - 1}">${escapeXML(label.charge)}</tspan>` : '';
  const content = label.left ? `${hydrogens}${main}${charge}` : `${main}${hydrogens}${charge}`;
  // The element symbol is centered on the atom; hydrogens extend to one side.
  const shift = label.hydrogens ? (label.left ? -1 : 1) * textSize(label.hydrogens, FONT)[0] * 0.5 : 0;
  return `<text x="${fmt(x + shift)}" y="${fmt(y + FONT * 0.36)}" font-size="${FONT + 1}" text-anchor="middle" fill="${label.color}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${content}</text>`;
}

function eyelash(center, facing, color) {
  const radius = BOND * 0.42;
  const spread = 0.75;
  const from = [center[0] + radius * Math.cos(facing - spread), center[1] + radius * Math.sin(facing - spread)];
  const to = [center[0] + radius * Math.cos(facing + spread), center[1] + radius * Math.sin(facing + spread)];
  const ticks = [-0.5, 0, 0.5].map((offset) => {
    const angle = facing + offset;
    const inner = [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    const outer = [center[0] + (radius + 5) * Math.cos(angle), center[1] + (radius + 5) * Math.sin(angle)];
    return line(inner, outer, color, '', 1.2);
  });
  return `<path d="M ${fmt(from[0])} ${fmt(from[1])} A ${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(to[0])} ${fmt(to[1])}" fill="none" stroke="${color}" stroke-width="1.4"/>${ticks.join('')}`;
}

function legendRows(items, maxWidth) {
  if (!items.length) return { text: '', width: 0, height: 0 };
  const parts = [];
  let x = 0;
  let y = 8;
  let width = 0;
  for (const item of items) {
    const itemWidth = 30 + textSize(item.label, SMALL)[0] + 18;
    if (x > 0 && x + itemWidth > maxWidth) {
      x = 0;
      y += 18;
    }
    if (item.id === 'hydrophobic') parts.push(eyelash([x + 12, y + 8], -Math.PI / 2, item.color));
    else parts.push(line([x, y], [x + 24, y], item.color, LINE_DASH[item.id] ?? '5 3', 1.6));
    parts.push(text(x + 30, y + 4, item.label, SMALL, MUTED, { anchor: 'start' }));
    x += itemWidth;
    width = Math.max(width, x);
  }
  return { text: parts.join(''), width, height: y + 10 };
}

/* ---------- SVG helpers ---------- */

function line(a, b, color, dash, width) {
  return `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function text(x, y, value, size, color, options = {}) {
  const halo = options.halo ? ' stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"' : '';
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${size}" text-anchor="${options.anchor ?? 'middle'}" fill="${color}"${options.weight ? ` font-weight="${options.weight}"` : ''}${halo}>${escapeXML(value)}</text>`;
}

// An approximate text box for Helvetica-like fonts, in pixels.
function textSize(value, size) {
  return [String(value).length * size * 0.6, size * 1.2];
}

// Where the line from a point to a label's center meets the label's box.
function clipToBox(node, from) {
  const d = sub(from, node.position);
  const tx = Math.abs(d[0]) > 1e-9 ? node.half[0] / Math.abs(d[0]) : Infinity;
  const ty = Math.abs(d[1]) > 1e-9 ? node.half[1] / Math.abs(d[1]) : Infinity;
  const t = Math.min(tx, ty, 1);
  return add(node.position, scale(d, t));
}

function tint(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return '#f3f4f6';
  const value = parseInt(match[1], 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * 0.18 + 255 * 0.82);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function escapeXML(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function fmt(value) {
  return Number(value.toFixed(1));
}

function circumradius(size) {
  return 1 / (2 * Math.sin(Math.PI / size));
}

/* ---------- Vectors ---------- */

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function scale(a, factor) {
  return [a[0] * factor, a[1] * factor];
}

function rotate(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [vector[0] * cos - vector[1] * sin, vector[0] * sin + vector[1] * cos];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function length(a) {
  return Math.hypot(a[0], a[1]);
}

function normalize(a, fallback = [1, 0]) {
  const size = length(a);
  return size > 1e-9 ? [a[0] / size, a[1] / size] : fallback;
}

function mean(points) {
  if (!points.length) return [0, 0];
  return scale(points.reduce((sum, point) => add(sum, point), [0, 0]), 1 / points.length);
}
