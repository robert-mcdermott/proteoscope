// MolViewSpec (MVS) export: builds the node tree that Mol* reads from .mvsj files and .mvsx
// archives (https://molstar.org/mol-view-spec-docs/). Pure; the app describes its scene with
// URLs, components, representations and colors, and this module writes the tree.

export const MVS_VERSION = '1';

// scene: {
//   title, description, background: '#rrggbb',
//   camera: { target, position, up } (already in MVS reference-camera terms) | null,
//   structures: [{
//     url, format ('mmcif' | 'pdb'), structure: { type: 'model', model_index } | { type: 'assembly', assembly_id },
//     transform: { rotation: row-major 3 × 3, translation } | null,
//     components: [{ selector, representations: [{ type, params, colors: [{ color, selector }], opacity }], labels: [text] }],
//   }],
// }
export function buildMolViewSpec(scene, options = {}) {
  const children = [];
  for (const item of scene.structures ?? []) {
    const structureChildren = [];
    if (item.transform) {
      structureChildren.push(node('transform', {
        rotation: columnMajor(item.transform.rotation),
        translation: item.transform.translation.map(round),
      }));
    }
    for (const component of item.components ?? []) {
      const componentChildren = [];
      for (const representation of component.representations ?? []) {
        const representationChildren = (representation.colors ?? []).map((color) => node('color', color.selector ? { color: color.color, selector: color.selector } : { color: color.color }));
        if (Number.isFinite(representation.opacity) && representation.opacity < 1) representationChildren.push(node('opacity', { opacity: round(representation.opacity) }));
        componentChildren.push(node('representation', { type: representation.type, ...(representation.params ?? {}) }, representationChildren));
      }
      for (const text of component.labels ?? []) componentChildren.push(node('label', { text }));
      if (component.tooltip) componentChildren.push(node('tooltip', { text: component.tooltip }));
      if (componentChildren.length) structureChildren.push(node('component', { selector: component.selector }, componentChildren));
    }
    children.push(node('download', { url: item.url }, [
      node('parse', { format: item.format }, [
        node('structure', item.structure ?? { type: 'model' }, structureChildren),
      ]),
    ]));
  }
  if (scene.background) children.push(node('canvas', { background_color: scene.background }));
  if (scene.camera) {
    children.push(node('camera', {
      target: scene.camera.target.map(round),
      position: scene.camera.position.map(round),
      up: scene.camera.up.map((value) => round(value, 4)),
    }));
  }
  const metadata = { version: MVS_VERSION, timestamp: (options.date ?? new Date()).toISOString() };
  if (scene.title) metadata.title = scene.title;
  if (scene.description) metadata.description = scene.description;
  return { metadata, root: node('root', null, children) };
}

function node(kind, params, children = []) {
  const result = { kind };
  if (params && Object.keys(params).length) result.params = params;
  if (children.length) result.children = children;
  return result;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// MVS rotation matrices are column-major (numpy Fortran order); x' = R·x + t.
export function columnMajor(rotation) {
  const r = rotation.map((value) => round(value, 6));
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
}

// Collapses residues (in chain order) into MVS component expressions: consecutive author
// numbers become beg/end ranges; residues with insertion codes are listed individually.
export function residueSelector(residues) {
  const expressions = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    expressions.push(run.start === run.end
      ? { auth_asym_id: run.chain, auth_seq_id: run.start }
      : { auth_asym_id: run.chain, beg_auth_seq_id: run.start, end_auth_seq_id: run.end });
    run = null;
  };
  for (const residue of residues) {
    if (residue.iCode) {
      flush();
      expressions.push({ auth_asym_id: residue.chain, auth_seq_id: residue.seq, pdbx_PDB_ins_code: residue.iCode });
      continue;
    }
    if (run && run.chain === residue.chain && residue.seq === run.end + 1) {
      run.end = residue.seq;
      continue;
    }
    flush();
    run = { chain: residue.chain, start: residue.seq, end: residue.seq };
  }
  flush();
  return expressions;
}

// Groups residues by color into one color node per color. A color shared by every residue
// needs no selector.
export function residueColors(residues) {
  const byColor = new Map();
  for (const residue of residues) {
    if (!byColor.has(residue.color)) byColor.set(residue.color, []);
    byColor.get(residue.color).push(residue);
  }
  if (byColor.size === 1) return [{ color: [...byColor.keys()][0] }];
  return [...byColor].map(([color, group]) => ({ color, selector: residueSelector(group) }));
}

// Converts an actual perspective camera into the 60° reference camera MVS stores:
// p_ref = t + (p − t) · 2 sin(fov / 2).
export function referenceCameraPosition(target, position, fovRadians) {
  const factor = 2 * Math.sin(fovRadians / 2);
  return target.map((value, axis) => value + (position[axis] - value) * factor);
}
