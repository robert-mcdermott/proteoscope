// 2D layout of a small molecule for drawings such as the ligand interaction diagram. Rings are
// laid out as regular polygons, fused rings edge to edge, and chains grow from the largest ring
// system in 120° zigzags; overlaps left over are removed by flipping branches about single bonds
// (the approach of CDK's structure diagram generator, much simplified). When the result still
// overlaps and the molecule has 3D coordinates, the projection of those coordinates onto their
// best plane is used instead if it overlaps less, as it does for flat molecules such as heme.
// Coordinates are in bond lengths. Nothing here touches the DOM.
//
// A molecule is { atoms: [{ element, x, y, z }], bonds: [{ a, b, order }] } (heavy atoms only).

const THIRD = Math.PI / 3;
// Atoms closer than this (in bond lengths) overlap in a drawing.
const CLASH = 0.5;
// Bonds to metals (heme's Fe–N, a zinc site) are left out of the layout, as chemical drawing
// programs do; each metal then sits at the center of the atoms it binds.
const METALS = new Set(['LI', 'BE', 'NA', 'MG', 'AL', 'K', 'CA', 'SC', 'TI', 'V', 'CR', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'GA', 'RB', 'SR', 'Y', 'ZR', 'NB', 'MO', 'TC', 'RU', 'RH', 'PD', 'AG', 'CD', 'IN', 'SN', 'CS', 'BA', 'LA', 'CE', 'PR', 'ND', 'SM', 'EU', 'GD', 'TB', 'DY', 'HO', 'ER', 'TM', 'YB', 'LU', 'HF', 'TA', 'W', 'RE', 'OS', 'IR', 'PT', 'AU', 'HG', 'TL', 'PB', 'BI', 'U']);

export function layoutMolecule(molecule, options = {}) {
  const atoms = molecule.atoms ?? [];
  const count = atoms.length;
  if (!count) return { points: [], rings: [], method: 'layout', clashes: 0, approximate: false, fromReference: (point) => point };
  const graph = moleculeGraph(count, molecule.bonds ?? []);
  const metal = atoms.map((atom) => METALS.has(String(atom.element).toUpperCase()));
  const organic = metal.some(Boolean) ? moleculeGraph(count, (molecule.bonds ?? []).filter((bond) => !metal[bond.a] && !metal[bond.b])) : graph;
  const rings = findRings(organic);
  const systems = ringSystems(count, rings);
  let points = layoutGraph(organic, systems, atoms);
  flipBranches(organic, points, rings);
  if (organic !== graph) placeMetals(graph, points, metal);
  let method = 'layout';
  let clashes = countClashes(graph, points);
  const has3D = atoms.every((atom) => Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z));
  if (clashes > 0 && has3D) {
    const projected = projectBestPlane(atoms, graph);
    const projectedClashes = countClashes(graph, projected);
    if (projectedClashes < clashes && shortestBond(graph, projected) > 0.55) {
      points = projected;
      method = 'projection';
      clashes = projectedClashes;
    }
  }
  // Turned to match the reference (the view on screen), or the best plane of the 3D atoms.
  const reference = options.reference ?? (has3D ? projectBestPlane(atoms, graph) : null);
  const oriented = orient(points, reference);
  return { points: oriented.points, rings, method, clashes, approximate: clashes > 0, fromReference: oriented.fromReference };
}

/* ---------- Graph and rings ---------- */

function moleculeGraph(count, bonds) {
  const neighbors = Array.from({ length: count }, () => []);
  const edges = [];
  const edgeIndex = new Map();
  for (const bond of bonds) {
    const { a, b } = bond;
    if (a === b || a < 0 || b < 0 || a >= count || b >= count) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeIndex.has(key)) continue;
    edgeIndex.set(key, edges.length);
    edges.push({ a, b, order: bond.order ?? 1 });
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  return { count, neighbors, edges, edgeIndex, edgeOf: (a, b) => edgeIndex.get(a < b ? `${a}-${b}` : `${b}-${a}`) };
}

// The smallest set of smallest rings: the shortest ring through each bond, then (for cages the
// shortest rings do not span) the fundamental cycles of a spanning tree, keeping those
// independent of the rings already taken (over GF(2), as bond sets). Each ring lists its atoms
// in order around it.
export function findRings(graph) {
  const { count, neighbors, edges } = graph;
  const components = connectedComponents(count, neighbors);
  const wanted = edges.length - count + components.length;
  if (wanted <= 0) return [];
  const candidates = new Map();
  for (const edge of edges) {
    const path = shortestPath(neighbors, edge.a, edge.b, edge);
    if (!path) continue;
    const key = [...path].sort((x, y) => x - y).join(',');
    if (!candidates.has(key)) candidates.set(key, path);
  }
  const sorted = [...candidates.values()].sort((x, y) => x.length - y.length);
  const basis = [];
  const rings = [];
  const addRing = (ring) => {
    let mask = 0n;
    for (let index = 0; index < ring.length; index += 1) mask |= 1n << BigInt(graph.edgeOf(ring[index], ring[(index + 1) % ring.length]));
    if (!reduceAgainst(basis, mask)) return false;
    rings.push(ring);
    return true;
  };
  for (const ring of sorted) {
    if (rings.length >= wanted) break;
    addRing(ring);
  }
  if (rings.length < wanted) {
    for (const ring of fundamentalCycles(graph)) {
      if (rings.length >= wanted) break;
      addRing(ring);
    }
  }
  return rings;
}

// Gaussian elimination over GF(2): adds the mask to the basis unless it depends on it.
function reduceAgainst(basis, mask) {
  let value = mask;
  for (const row of basis) {
    if (value & row.pivot) value ^= row.mask;
  }
  if (!value) return false;
  let pivot = 1n;
  while (!(value & pivot)) pivot <<= 1n;
  for (const row of basis) if (row.mask & pivot) row.mask ^= value;
  basis.push({ mask: value, pivot });
  return true;
}

// The shortest path from a to b that does not use the bond between them.
function shortestPath(neighbors, a, b, skip) {
  const previous = new Map([[a, -1]]);
  const queue = [a];
  for (let head = 0; head < queue.length; head += 1) {
    const atom = queue[head];
    for (const next of neighbors[atom]) {
      if (previous.has(next)) continue;
      if ((atom === skip.a && next === skip.b) || (atom === skip.b && next === skip.a)) continue;
      previous.set(next, atom);
      if (next === b) {
        const path = [];
        for (let step = b; step !== -1; step = previous.get(step)) path.push(step);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function fundamentalCycles(graph) {
  const { count, neighbors, edges } = graph;
  const parent = new Int32Array(count).fill(-2);
  const depth = new Int32Array(count);
  const treeEdges = new Set();
  for (let root = 0; root < count; root += 1) {
    if (parent[root] !== -2) continue;
    parent[root] = -1;
    const queue = [root];
    for (let head = 0; head < queue.length; head += 1) {
      const atom = queue[head];
      for (const next of neighbors[atom]) {
        if (parent[next] !== -2) continue;
        parent[next] = atom;
        depth[next] = depth[atom] + 1;
        treeEdges.add(graph.edgeOf(atom, next));
        queue.push(next);
      }
    }
  }
  const cycles = [];
  edges.forEach((edge, index) => {
    if (treeEdges.has(index)) return;
    let a = edge.a;
    let b = edge.b;
    const left = [a];
    const right = [b];
    while (a !== b) {
      if (depth[a] >= depth[b]) {
        a = parent[a];
        left.push(a);
      } else {
        b = parent[b];
        right.push(b);
      }
    }
    right.pop();
    cycles.push([...left, ...right.reverse()]);
  });
  return cycles.sort((x, y) => x.length - y.length);
}

function connectedComponents(count, neighbors) {
  const seen = new Int32Array(count).fill(-1);
  const components = [];
  for (let start = 0; start < count; start += 1) {
    if (seen[start] >= 0) continue;
    const members = [start];
    seen[start] = components.length;
    for (let head = 0; head < members.length; head += 1) {
      for (const next of neighbors[members[head]]) {
        if (seen[next] < 0) {
          seen[next] = components.length;
          members.push(next);
        }
      }
    }
    components.push(members);
  }
  return components;
}

// Rings that share an atom form a ring system (naphthalene, a steroid, a spiro compound).
function ringSystems(count, rings) {
  const parent = rings.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const owner = new Int32Array(count).fill(-1);
  rings.forEach((ring, index) => {
    for (const atom of ring) {
      if (owner[atom] >= 0) parent[find(index)] = find(owner[atom]);
      else owner[atom] = index;
    }
  });
  const groups = new Map();
  rings.forEach((ring, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(ring);
  });
  return [...groups.values()].map((list) => ({ rings: list, atoms: new Set(list.flat()) }));
}

/* ---------- Layout ---------- */

function layoutGraph(graph, systems, atoms) {
  const { count, neighbors } = graph;
  const points = new Array(count).fill(null);
  const systemOf = new Int32Array(count).fill(-1);
  systems.forEach((system, index) => {
    for (const atom of system.atoms) systemOf[atom] = index;
    system.template = layoutRingSystem(system);
    // Cages (camphor, adamantane) do not flatten into polygons: their own 3D shape, projected,
    // draws them better.
    if (system.bridged) system.template = projectedTemplate(system, graph, atoms) ?? system.template;
  });
  const components = connectedComponents(count, neighbors);
  let offset = 0;
  for (const members of components) {
    const placed = layoutComponent(graph, members, systems, systemOf, points);
    // Components sit side by side, left to right.
    const xs = members.map((atom) => placed[atom][0]);
    const ys = members.map((atom) => placed[atom][1]);
    const minX = Math.min(...xs);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const atom of members) points[atom] = [placed[atom][0] - minX + offset, placed[atom][1] - midY];
    offset += Math.max(...xs) - minX + 1.5;
  }
  return points;
}

function layoutComponent(graph, members, systems, systemOf, points) {
  const { neighbors } = graph;
  const turn = new Map();
  const queue = [];
  const place = (atom, point) => {
    points[atom] = point;
    queue.push(atom);
  };
  // The largest ring system, or the most connected atom of a chain, comes first.
  const memberSystems = [...new Set(members.map((atom) => systemOf[atom]).filter((index) => index >= 0))];
  if (memberSystems.length) {
    const first = memberSystems.reduce((best, index) => (systems[index].atoms.size > systems[best].atoms.size ? index : best));
    for (const [atom, point] of systems[first].template) place(atom, point.slice());
    systems[first].placed = true;
  } else {
    const root = members.reduce((best, atom) => (neighbors[atom].length > neighbors[best].length ? atom : best));
    place(root, [0, 0]);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const atom = queue[head];
    const open = neighbors[atom].filter((next) => !points[next]);
    if (!open.length) continue;
    const directions = openDirections(graph, points, atom, open, turn);
    // Bigger branches take the directions that continue the zigzag.
    const ordered = open.slice().sort((x, y) => branchSize(graph, y, atom) - branchSize(graph, x, atom));
    ordered.forEach((next, index) => {
      const direction = directions[index];
      const target = [points[atom][0] + direction[0], points[atom][1] + direction[1]];
      const system = systemOf[next];
      if (system >= 0 && !systems[system].placed) {
        placeSystem(graph, systems[system], next, target, points[atom], points, place);
        systems[system].placed = true;
      } else {
        place(next, target);
        if (direction.turn) turn.set(next, direction.turn);
      }
    });
  }
  return points;
}

// Directions (unit vectors) for the unplaced neighbors of a placed atom.
function openDirections(graph, points, atom, open, turn) {
  const origin = points[atom];
  const placed = graph.neighbors[atom].filter((next) => points[next]);
  const k = open.length;
  const toward = placed.map((next) => unit([points[next][0] - origin[0], points[next][1] - origin[1]]));
  if (!toward.length) {
    // The first atom of a chain: its bonds spread evenly (two at 120° for a zigzag).
    const start = k === 2 ? -Math.PI / 6 : Math.PI / 2;
    const step = k === 2 ? 2 * THIRD : (2 * Math.PI) / k;
    return Array.from({ length: k }, (_, index) => withTurn(fromAngle(start + index * step), index === 0 ? 1 : -1));
  }
  if (toward.length === 1) {
    const ahead = [-toward[0][0], -toward[0][1]];
    if (k === 1 && isLinear(graph, atom)) return [ahead];
    if (k === 1) {
      // Zigzag: the next bond turns the other way from the one before.
      let sign = turn.has(atom) ? -turn.get(atom) : 0;
      if (!sign) {
        const left = rotate(ahead, THIRD);
        const right = rotate(ahead, -THIRD);
        sign = crowding(points, origin, left) <= crowding(points, origin, right) ? 1 : -1;
      }
      return [withTurn(rotate(ahead, sign * THIRD), sign)];
    }
    if (k === 2) {
      const sign = turn.has(atom) ? -turn.get(atom) : 1;
      return [withTurn(rotate(ahead, sign * THIRD), sign), withTurn(rotate(ahead, -sign * THIRD), -sign)];
    }
    if (k === 3) return [rotate(ahead, Math.PI / 2), ahead, rotate(ahead, -Math.PI / 2)];
    return Array.from({ length: k }, (_, index) => rotate(toward[0], ((index + 1) * 2 * Math.PI) / (k + 1)));
  }
  // Ring atoms and branch points: the open bonds share a gap between placed bonds, the widest
  // unless it is crowded (inside a cage drawn from its 3D shape, say).
  const angles = toward.map((vector) => Math.atan2(vector[1], vector[0])).sort((x, y) => x - y);
  const gaps = angles.map((angle, index) => {
    const start = index === 0 ? angles[angles.length - 1] : angles[index - 1];
    return { start, size: index === 0 ? angle + 2 * Math.PI - start : angle - start };
  });
  let best = null;
  for (const gap of gaps) {
    // Two substituents on a ring atom spread as in a gem-dimethyl group, not across the whole gap.
    const spread = k === 2 && toward.length === 2 ? Math.min(gap.size, 2 * THIRD * 1.1) : gap.size;
    const first = gap.start + (gap.size - spread) / 2;
    const directions = Array.from({ length: k }, (_, index) => fromAngle(first + (spread * (index + 1)) / (k + 1)));
    const narrow = spread / (k + 1) < THIRD * 0.75 ? 10 : 0;
    const cost = narrow + directions.reduce((sum, direction) => sum + crowding(points, origin, direction), 0) - gap.size * 0.05;
    if (!best || cost < best.cost) best = { cost, directions };
  }
  return best.directions;
}

// An atom with a triple bond or two double bonds (alkynes, nitriles, allenes, azides) is linear.
function isLinear(graph, atom) {
  let doubles = 0;
  for (const next of graph.neighbors[atom]) {
    const order = graph.edges[graph.edgeOf(atom, next)].order;
    if (order === 3) return true;
    if (order === 2) doubles += 1;
  }
  return doubles >= 2;
}

function branchSize(graph, start, from) {
  const seen = new Set([from, start]);
  const stack = [start];
  while (stack.length) {
    const atom = stack.pop();
    for (const next of graph.neighbors[atom]) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size - 1;
}

// How close a bond in this direction comes to atoms already placed (lower is freer).
function crowding(points, origin, direction) {
  const end = [origin[0] + direction[0] * 1.5, origin[1] + direction[1] * 1.5];
  let total = 0;
  for (const point of points) {
    if (!point) continue;
    const distance = Math.hypot(point[0] - end[0], point[1] - end[1]);
    total += 1 / Math.max(0.2, distance) ** 2;
  }
  return total;
}

// A ring system's own layout (atom → [x, y]): the most fused ring first, then each ring next to
// the ones placed, across a shared bond (fused), at a shared atom (spiro), or around several
// shared atoms (bridged, only approximately).
function layoutRingSystem(system) {
  const rings = system.rings;
  const positions = new Map();
  const shared = (ring) => ring.filter((atom) => positions.has(atom));
  const fusedCount = (ring) => rings.filter((other) => other !== ring && other.filter((atom) => ring.includes(atom)).length >= 2).length;
  const first = rings.reduce((best, ring) => (fusedCount(ring) > fusedCount(best) || (fusedCount(ring) === fusedCount(best) && ring.length > best.length) ? ring : best));
  placePolygon(first, [0, 0], Math.PI / 2 + Math.PI / first.length, 1, positions);
  const done = new Set([first]);
  while (done.size < rings.length) {
    let next = null;
    let nextRank = -1;
    for (const ring of rings) {
      if (done.has(ring)) continue;
      const common = shared(ring);
      if (!common.length) continue;
      // Fused rings (one shared bond) first, then spiro, then bridged.
      const rank = common.length === 2 && adjacentInRing(ring, common[0], common[1]) ? 3 : common.length === 1 ? 2 : 1;
      if (rank > nextRank) {
        next = ring;
        nextRank = rank;
      }
    }
    if (!next) break;
    const common = shared(next);
    if (nextRank === 3) placeFused(next, common, rings.filter((ring) => done.has(ring)), positions);
    else if (nextRank === 2) placeSpiro(next, common[0], positions);
    else {
      placeBridged(next, positions);
      system.bridged = true;
    }
    done.add(next);
  }
  return positions;
}

function projectedTemplate(system, graph, atoms) {
  const members = [...system.atoms];
  if (!members.every((atom) => Number.isFinite(atoms[atom]?.x) && Number.isFinite(atoms[atom]?.y) && Number.isFinite(atoms[atom]?.z))) return null;
  const local = new Map(members.map((atom, index) => [atom, index]));
  const bonds = graph.edges.filter((edge) => local.has(edge.a) && local.has(edge.b)).map((edge) => ({ a: local.get(edge.a), b: local.get(edge.b) }));
  const subgraph = moleculeGraph(members.length, bonds);
  const projected = projectBestPlane(members.map((atom) => atoms[atom]), subgraph);
  return new Map(members.map((atom, index) => [atom, projected[index]]));
}

// A metal bound to two or more placed atoms goes to their center; bound to one, it goes on
// that atom's free side; bound to none, beside the molecule.
function placeMetals(graph, points, metal) {
  for (let atom = 0; atom < points.length; atom += 1) {
    if (!metal[atom]) continue;
    const partners = graph.neighbors[atom].filter((next) => !metal[next]);
    if (partners.length >= 2) {
      points[atom] = centroid(partners.map((next) => points[next]));
    } else if (partners.length === 1) {
      const origin = points[partners[0]];
      const others = graph.neighbors[partners[0]].filter((next) => next !== atom).map((next) => points[next]);
      const away = others.length ? unit([origin[0] - centroid(others)[0], origin[1] - centroid(others)[1]]) : [1, 0];
      points[atom] = [origin[0] + away[0], origin[1] + away[1]];
    }
  }
}

function adjacentInRing(ring, a, b) {
  const i = ring.indexOf(a);
  const j = ring.indexOf(b);
  return Math.abs(i - j) === 1 || Math.abs(i - j) === ring.length - 1;
}

function circumradius(size) {
  return 1 / (2 * Math.sin(Math.PI / size));
}

// Places a ring's atoms (in ring order) on a regular polygon, starting at an angle.
function placePolygon(ring, center, startAngle, direction, positions) {
  const radius = circumradius(ring.length);
  const step = (2 * Math.PI) / ring.length;
  ring.forEach((atom, index) => {
    if (positions.has(atom)) return;
    const angle = startAngle + direction * index * step;
    positions.set(atom, [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
  });
}

// Ring order starting at `atom` and going away from `other` (its neighbor in the ring).
function ringFrom(ring, atom, other) {
  const start = ring.indexOf(atom);
  const forward = ring[(start + 1) % ring.length] !== other;
  return ring.map((_, index) => ring[(start + (forward ? index : ring.length - index)) % ring.length]);
}

function placeFused(ring, [a, b], placedRings, positions) {
  const pa = positions.get(a);
  const pb = positions.get(b);
  // The new ring goes on the side of the shared bond away from the ring that has it already.
  const owner = placedRings.find((other) => other.includes(a) && other.includes(b));
  const away = centroid((owner ?? [...positions.keys()]).map((atom) => positions.get(atom)));
  const middle = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  let normal = unit([-(pb[1] - pa[1]), pb[0] - pa[0]]);
  if ((middle[0] - away[0]) * normal[0] + (middle[1] - away[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
  const apothem = 1 / (2 * Math.tan(Math.PI / ring.length));
  const center = [middle[0] + normal[0] * apothem, middle[1] + normal[1] * apothem];
  const order = ringFrom(ring, a, b);
  const angleA = Math.atan2(pa[1] - center[1], pa[0] - center[0]);
  const angleB = Math.atan2(pb[1] - center[1], pb[0] - center[0]);
  const step = (2 * Math.PI) / ring.length;
  // B is one step before A; the others follow A in the other direction.
  const direction = angleDifference(angleA - step, angleB) < angleDifference(angleA + step, angleB) ? 1 : -1;
  placePolygon(order, center, angleA, direction, positions);
}

function placeSpiro(ring, atom, positions) {
  const point = positions.get(atom);
  const others = [...positions.values()];
  const away = unit([point[0] - centroid(others)[0], point[1] - centroid(others)[1]]);
  const radius = circumradius(ring.length);
  const center = [point[0] + away[0] * radius, point[1] + away[1] * radius];
  const start = ring.indexOf(atom);
  const order = ring.map((_, index) => ring[(start + index) % ring.length]);
  placePolygon(order, center, Math.atan2(point[1] - center[1], point[0] - center[0]), 1, positions);
}

// Runs of unplaced atoms between placed ones go on arcs that bulge away from the placed atoms.
function placeBridged(ring, positions) {
  const size = ring.length;
  const placedCenter = centroid([...positions.values()]);
  for (let start = 0; start < size; start += 1) {
    const from = ring[start];
    if (!positions.has(from) || positions.has(ring[(start + 1) % size])) continue;
    const run = [];
    let index = (start + 1) % size;
    while (!positions.has(ring[index]) && run.length < size) {
      run.push(ring[index]);
      index = (index + 1) % size;
    }
    const p = positions.get(from);
    const q = positions.get(ring[index]);
    const segments = run.length + 1;
    const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const height = chord < segments ? Math.sqrt(segments * segments - chord * chord) / 2 : 0;
    const middle = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let normal = chord > 1e-6 ? unit([-(q[1] - p[1]), q[0] - p[0]]) : [0, 1];
    if ((middle[0] - placedCenter[0]) * normal[0] + (middle[1] - placedCenter[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
    run.forEach((atom, step) => {
      const t = (step + 1) / segments;
      const bulge = height * Math.sin(Math.PI * t);
      positions.set(atom, [p[0] + (q[0] - p[0]) * t + normal[0] * bulge, p[1] + (q[1] - p[1]) * t + normal[1] * bulge]);
    });
  }
}

// Places a whole ring system so that its atom `atom` sits at `target`, with the bond back to
// the atom at `from` along the ring's outward direction; of the two mirror images, the one that
// overlaps less with what is placed already.
function placeSystem(graph, system, atom, target, from, points, place) {
  const template = system.template;
  const anchor = template.get(atom);
  const inside = graph.neighbors[atom].filter((next) => template.has(next)).map((next) => template.get(next));
  const outward = unit([anchor[0] - centroid(inside)[0], anchor[1] - centroid(inside)[1]]);
  const wanted = unit([from[0] - target[0], from[1] - target[1]]);
  let best = null;
  for (const mirror of [1, -1]) {
    const rotation = Math.atan2(wanted[1], wanted[0]) - Math.atan2(mirror * outward[1], outward[0]);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const placed = new Map();
    for (const [member, point] of template) {
      const dx = point[0] - anchor[0];
      const dy = mirror * (point[1] - anchor[1]);
      placed.set(member, [target[0] + dx * cos - dy * sin, target[1] + dx * sin + dy * cos]);
    }
    let penalty = 0;
    for (const point of points) {
      if (!point) continue;
      for (const candidate of placed.values()) penalty += overlap(point, candidate);
    }
    if (!best || penalty < best.penalty) best = { placed, penalty };
  }
  for (const [member, point] of best.placed) place(member, point);
}

/* ---------- Clean-up and quality ---------- */

function overlap(a, b) {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
  return distance < 0.8 ? (0.8 - distance) ** 2 : 0;
}

// Overlap of atoms that are not bonded to each other.
function overlapScore(graph, points) {
  let total = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      if (graph.edgeOf(a, b) !== undefined) continue;
      total += overlap(points[a], points[b]);
    }
  }
  return total;
}

export function countClashes(graph, points) {
  let clashes = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      if (graph.edgeOf(a, b) !== undefined) continue;
      if (Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]) < CLASH) clashes += 1;
    }
  }
  return clashes;
}

// Reflects the smaller side of each acyclic bond across the bond while that lowers the overlap.
function flipBranches(graph, points, rings) {
  const ringBonds = new Set();
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) ringBonds.add(graph.edgeOf(ring[index], ring[(index + 1) % ring.length]));
  }
  const candidates = [];
  graph.edges.forEach((edge, index) => {
    if (ringBonds.has(index)) return;
    const side = sideOf(graph, edge.b, edge.a);
    const other = graph.count - side.length;
    const small = side.length <= other ? side : sideOf(graph, edge.a, edge.b);
    if (small.length > 1) candidates.push({ edge, side: small });
  });
  let score = overlapScore(graph, points);
  for (let pass = 0; pass < 4 && score > 0; pass += 1) {
    let improved = false;
    for (const { edge, side } of candidates) {
      const saved = side.map((atom) => points[atom].slice());
      reflect(points, side, points[edge.a], points[edge.b]);
      const next = overlapScore(graph, points);
      if (next < score - 1e-9) {
        score = next;
        improved = true;
      } else {
        side.forEach((atom, index) => {
          points[atom] = saved[index];
        });
      }
    }
    if (!improved) break;
  }
}

// The atoms reached from `start` without crossing to `from`.
function sideOf(graph, start, from) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const atom = stack.pop();
    for (const next of graph.neighbors[atom]) {
      if (next === from && atom === start) continue;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}

function reflect(points, atoms, p, q) {
  const axis = unit([q[0] - p[0], q[1] - p[1]]);
  for (const atom of atoms) {
    const dx = points[atom][0] - p[0];
    const dy = points[atom][1] - p[1];
    const along = dx * axis[0] + dy * axis[1];
    points[atom] = [p[0] + 2 * along * axis[0] - dx, p[1] + 2 * along * axis[1] - dy];
  }
}

function shortestBond(graph, points) {
  let shortest = Infinity;
  for (const { a, b } of graph.edges) shortest = Math.min(shortest, Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]));
  return shortest;
}

/* ---------- 3D projection and orientation ---------- */

// The atoms' 3D coordinates projected onto the plane of two of their principal axes, in bond
// lengths: of the three planes, the one where the fewest atoms overlap and the bonds shorten
// least (for most molecules, the plane of largest spread).
function projectBestPlane(atoms, graph) {
  let best = null;
  for (const [first, second] of [[0, 1], [0, 2], [1, 2]]) {
    const points = projectOnto(atoms, graph, first, second);
    const score = countClashes(graph, points) * 10 - shortestBond(graph, points);
    if (!best || score < best.score - 1e-9) best = { points, score };
  }
  return best.points;
}

function projectOnto(atoms, graph, firstAxis, secondAxis) {
  const center = [0, 1, 2].map((axis) => atoms.reduce((sum, atom) => sum + [atom.x, atom.y, atom.z][axis], 0) / atoms.length);
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const atom of atoms) {
    const d = [atom.x - center[0], atom.y - center[1], atom.z - center[2]];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) covariance[i][j] += d[i] * d[j];
  }
  const axes = principalAxes(covariance);
  const first = axes[firstAxis];
  const second = axes[secondAxis];
  let bond = 0;
  for (const { a, b } of graph.edges) bond += Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z);
  const scale = graph.edges.length ? graph.edges.length / bond : 1 / 1.5;
  return atoms.map((atom) => {
    const d = [atom.x - center[0], atom.y - center[1], atom.z - center[2]];
    return [scale * (d[0] * first[0] + d[1] * first[1] + d[2] * first[2]), scale * (d[0] * second[0] + d[1] * second[1] + d[2] * second[2])];
  });
}

// The two eigenvectors of a symmetric 3×3 matrix with the largest eigenvalues (Jacobi rotations).
function principalAxes(matrix) {
  const a = matrix.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) off += a[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((x, y) => a[y][y] - a[x][x]);
  return order.map((index) => [v[0][index], v[1][index], v[2][index]]);
}

// Turns (and if need be mirrors) the layout to match a reference set of 2D points for the same
// atoms, keeping its size; `fromReference` maps other reference points (the partner residues)
// into the layout's frame.
function orient(points, reference) {
  const center = centroid(points);
  const centered = points.map((point) => [point[0] - center[0], point[1] - center[1]]);
  if (!reference || reference.length !== points.length || points.length < 2) {
    return { points: centered, fromReference: (point) => point };
  }
  const referenceCenter = centroid(reference);
  const target = reference.map((point) => [point[0] - referenceCenter[0], point[1] - referenceCenter[1]]);
  let best = null;
  for (const mirror of [1, -1]) {
    let dot = 0;
    let cross = 0;
    centered.forEach((point, index) => {
      const x = point[0] * mirror;
      const y = point[1];
      dot += x * target[index][0] + y * target[index][1];
      cross += x * target[index][1] - y * target[index][0];
    });
    const fit = Math.hypot(dot, cross);
    if (!best || fit > best.fit) best = { mirror, angle: Math.atan2(cross, dot), fit };
  }
  const cos = Math.cos(best.angle);
  const sin = Math.sin(best.angle);
  const turned = centered.map(([x, y]) => [x * best.mirror * cos - y * sin, x * best.mirror * sin + y * cos]);
  // The scale from reference units to bond lengths.
  let norm = 0;
  let projection = 0;
  turned.forEach((point, index) => {
    projection += point[0] * target[index][0] + point[1] * target[index][1];
    norm += target[index][0] ** 2 + target[index][1] ** 2;
  });
  const scale = norm > 1e-12 ? projection / norm : 1;
  return {
    points: turned,
    fromReference: (point) => [(point[0] - referenceCenter[0]) * scale, (point[1] - referenceCenter[1]) * scale],
  };
}

/* ---------- Vectors ---------- */

function unit(vector) {
  const length = Math.hypot(vector[0], vector[1]);
  return length > 1e-12 ? [vector[0] / length, vector[1] / length] : [1, 0];
}

function rotate(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [vector[0] * cos - vector[1] * sin, vector[0] * sin + vector[1] * cos];
}

function fromAngle(angle) {
  return [Math.cos(angle), Math.sin(angle)];
}

function withTurn(vector, sign) {
  vector.turn = sign;
  return vector;
}

function centroid(points) {
  if (!points.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function angleDifference(a, b) {
  const difference = Math.abs(a - b) % (2 * Math.PI);
  return difference > Math.PI ? 2 * Math.PI - difference : difference;
}

export { moleculeGraph };
