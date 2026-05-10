const els = {
  canvas: document.querySelector('#viewport'),
  loading: document.querySelector('#loading'),
  loadingStatus: document.querySelector('#loading-status'),
  sampleSelect: document.querySelector('#sample-select'),
  fileInput: document.querySelector('#file-input'),
  title: document.querySelector('#structure-title'),
  gpuBadge: document.querySelector('#gpu-badge'),
  atomsLabel: document.querySelector('#metric-atoms-label'),
  atomsMetric: document.querySelector('#metric-atoms'),
  totalAtomsMetric: document.querySelector('#metric-total-atoms'),
  residuesMetric: document.querySelector('#metric-residues'),
  chainsMetric: document.querySelector('#metric-chains'),
  modelsMetric: document.querySelector('#metric-models'),
  searchInput: document.querySelector('#search-input'),
  searchResults: document.querySelector('#search-results'),
  chainList: document.querySelector('#chain-list'),
  isolateClear: document.querySelector('#isolate-clear'),
  atomScale: document.querySelector('#atom-scale'),
  bondScale: document.querySelector('#bond-scale'),
  glowScale: document.querySelector('#glow-scale'),
  clipDepth: document.querySelector('#clip-depth'),
  showHetero: document.querySelector('#show-hetero'),
  showWater: document.querySelector('#show-water'),
  showHydrogen: document.querySelector('#show-hydrogen'),
  autoRotate: document.querySelector('#auto-rotate'),
  selectionTitle: document.querySelector('#selection-title'),
  selectionMeta: document.querySelector('#selection-meta'),
  frameSelection: document.querySelector('#frame-selection'),
  measureReset: document.querySelector('#measure-reset'),
  measurementList: document.querySelector('#measurement-list'),
  resetView: document.querySelector('#reset-view'),
  screenshot: document.querySelector('#screenshot'),
  modelStrip: document.querySelector('#model-strip'),
  modelSlider: document.querySelector('#model-slider'),
  modelLabel: document.querySelector('#model-label'),
  tooltip: document.querySelector('#tooltip'),
};

const ELEMENTS = {
  H: { covalent: 0.31, vdw: 1.2, color: [0.92, 0.94, 0.96] },
  C: { covalent: 0.76, vdw: 1.7, color: [0.62, 0.66, 0.7] },
  N: { covalent: 0.71, vdw: 1.55, color: [0.26, 0.5, 1.0] },
  O: { covalent: 0.66, vdw: 1.52, color: [1.0, 0.24, 0.22] },
  S: { covalent: 1.05, vdw: 1.8, color: [1.0, 0.78, 0.24] },
  P: { covalent: 1.07, vdw: 1.8, color: [1.0, 0.5, 0.18] },
  F: { covalent: 0.57, vdw: 1.47, color: [0.5, 0.96, 0.52] },
  CL: { covalent: 1.02, vdw: 1.75, color: [0.2, 0.88, 0.24] },
  BR: { covalent: 1.2, vdw: 1.85, color: [0.62, 0.24, 0.16] },
  I: { covalent: 1.39, vdw: 1.98, color: [0.58, 0.32, 0.86] },
  FE: { covalent: 1.24, vdw: 1.94, color: [0.94, 0.42, 0.2] },
  MG: { covalent: 1.3, vdw: 1.73, color: [0.45, 0.84, 1.0] },
  ZN: { covalent: 1.22, vdw: 1.39, color: [0.55, 0.62, 0.95] },
  CA: { covalent: 1.74, vdw: 2.31, color: [0.32, 0.82, 0.42] },
  NA: { covalent: 1.66, vdw: 2.27, color: [0.5, 0.42, 1.0] },
  K: { covalent: 2.03, vdw: 2.75, color: [0.64, 0.36, 1.0] },
};

const CHAIN_PALETTE = [
  [0.26, 0.78, 0.95],
  [0.98, 0.29, 0.55],
  [1.0, 0.77, 0.27],
  [0.35, 0.91, 0.61],
  [0.72, 0.55, 1.0],
  [1.0, 0.54, 0.33],
  [0.63, 0.95, 0.4],
  [0.39, 0.61, 1.0],
  [0.98, 0.47, 0.92],
  [0.79, 0.9, 1.0],
];

const RESIDUE_CLASSES = {
  hydrophobic: new Set(['ALA', 'VAL', 'ILE', 'LE', 'LEU', 'MET', 'PHE', 'TRP', 'PRO', 'TYR']),
  polar: new Set(['SER', 'THR', 'ASN', 'GLN', 'CYS', 'GLY']),
  positive: new Set(['LYS', 'ARG', 'HIS']),
  negative: new Set(['ASP', 'GLU']),
  nucleic: new Set(['A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU', 'DI']),
};

const WATER_RESIDUES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
const PROTEIN_BACKBONE = new Set(['CA']);
const NUCLEIC_BACKBONE = new Set(['P', "C4'", "C3'", "C5'"]);

const state = {
  samples: [],
  structure: null,
  activeModel: 0,
  representation: 'ball-stick',
  colorScheme: 'chain',
  atomScale: 0.72,
  bondScale: 0.52,
  glowScale: 0.36,
  clipDepth: 1,
  showHetero: true,
  showWater: false,
  showHydrogen: false,
  autoRotate: true,
  isolatedChain: null,
  selectedAtom: null,
  hoveredAtom: null,
  lastMeasureAtom: null,
  measurements: [],
  visibleAtoms: [],
  visibleBonds: [],
  visibleAtomRecords: [],
  camera: {
    target: [0, 0, 0],
    radius: 80,
    yaw: -0.72,
    pitch: 0.34,
    fov: Math.PI / 4.2,
    near: 0.05,
    far: 2000,
    eye: [0, 0, 0],
    forward: [0, 0, -1],
    right: [1, 0, 0],
    up: [0, 1, 0],
  },
  pointer: {
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    dragging: false,
    panning: false,
    moved: false,
  },
};

const gpu = {
  adapter: null,
  device: null,
  context: null,
  format: null,
  depthTexture: null,
  uniformBuffer: null,
  atomBuffer: null,
  glowBuffer: null,
  bondBuffer: null,
  atomBindGroup: null,
  glowBindGroup: null,
  bondBindGroup: null,
  atomPipeline: null,
  glowPipeline: null,
  bondPipeline: null,
  uniformData: new Float32Array(36),
  atomCount: 0,
  glowCount: 0,
  bondCount: 0,
  fallback: false,
  ctx2d: null,
};

init().catch((error) => {
  console.error(error);
  els.loading.classList.add('is-error');
  els.loadingStatus.textContent = error.message;
});

async function init() {
  setLoading('Starting renderer');
  await initRenderer();
  bindEvents();

  setLoading('Loading bundled structures');
  const manifest = await fetch('/api/samples').then((response) => response.json());
  state.samples = manifest.samples ?? [];
  populateSamples();

  const first = state.samples[0];
  if (!first) throw new Error('No embedded structure files were found.');
  await loadStructureFromURL(first.url, first.name);

  setLoading('Rendering');
  requestAnimationFrame(() => els.loading.classList.add('is-hidden'));
  requestAnimationFrame(frame);
}

async function initRenderer() {
  try {
    await withTimeout(initWebGPU(), 4500, 'WebGPU initialization timed out');
  } catch (error) {
    gpu.fallback = true;
    gpu.ctx2d = els.canvas.getContext('2d');
    els.gpuBadge.textContent = 'Canvas preview';
    els.gpuBadge.title = 'WebGPU was not available in this browser, so Proteoscope is using a compatibility preview.';
  }
}

async function initWebGPU() {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser. Try current Chrome, Edge, or another WebGPU-enabled browser.');
  }
  gpu.adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 2500, 'No WebGPU adapter responded.');
  if (!gpu.adapter) throw new Error('No WebGPU adapter was found.');
  gpu.device = await withTimeout(gpu.adapter.requestDevice(), 2500, 'No WebGPU device responded.');
  gpu.context = els.canvas.getContext('webgpu');
  gpu.format = navigator.gpu.getPreferredCanvasFormat();
  gpu.context.configure({
    device: gpu.device,
    format: gpu.format,
    alphaMode: 'opaque',
  });
  gpu.uniformBuffer = gpu.device.createBuffer({
    label: 'uniforms',
    size: gpu.uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  createPipelines();
  els.gpuBadge.textContent = gpu.adapter.info?.description || 'WebGPU';
}

function createPipelines() {
  const atomModule = gpu.device.createShaderModule({
    label: 'atom impostor shader',
    code: `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  lightDir: vec4<f32>,
  params: vec4<f32>,
};
struct Atom {
  positionRadius: vec4<f32>,
  color: vec4<f32>,
};
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> atoms: array<Atom>;

const corners = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0)
);

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let atom = atoms[instanceIndex];
  let corner = corners[vertexIndex];
  let world = atom.positionRadius.xyz
    + uniforms.cameraRight.xyz * corner.x * atom.positionRadius.w
    + uniforms.cameraUp.xyz * corner.y * atom.positionRadius.w;
  var out: VertexOut;
  out.position = uniforms.viewProj * vec4<f32>(world, 1.0);
  out.uv = corner;
  out.color = atom.color;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let z = sqrt(max(0.0, 1.0 - r2));
  let normal = normalize(
    uniforms.cameraRight.xyz * in.uv.x +
    uniforms.cameraUp.xyz * in.uv.y -
    uniforms.cameraForward.xyz * z
  );
  let view = normalize(-uniforms.cameraForward.xyz);
  let front = max(dot(normal, view), 0.0);
  let diffuse = pow(front, 0.55);
  let specular = pow(front, 34.0);
  let rim = pow(1.0 - front, 2.2);
  let shade = 0.66 + 0.34 * diffuse + 0.16 * specular + 0.06 * rim;
  let color = in.color.rgb * shade + vec3<f32>(0.025, 0.035, 0.038);
  return vec4<f32>(color, in.color.a);
}`,
  });

  const glowModule = gpu.device.createShaderModule({
    label: 'atom glow shader',
    code: `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  lightDir: vec4<f32>,
  params: vec4<f32>,
};
struct Atom {
  positionRadius: vec4<f32>,
  color: vec4<f32>,
};
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> atoms: array<Atom>;
const corners = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0)
);
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let atom = atoms[instanceIndex];
  let corner = corners[vertexIndex];
  let pulse = 1.0 + 0.03 * sin(uniforms.params.x * 1.3 + f32(instanceIndex % 17u));
  let world = atom.positionRadius.xyz
    + uniforms.cameraRight.xyz * corner.x * atom.positionRadius.w * pulse
    + uniforms.cameraUp.xyz * corner.y * atom.positionRadius.w * pulse;
  var out: VertexOut;
  out.position = uniforms.viewProj * vec4<f32>(world, 1.0);
  out.uv = corner;
  out.color = atom.color;
  return out;
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let feather = pow(max(0.0, 1.0 - r2), 2.2);
  return vec4<f32>(in.color.rgb * feather, in.color.a * feather);
}`,
  });

  const bondModule = gpu.device.createShaderModule({
    label: 'bond billboard shader',
    code: `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  lightDir: vec4<f32>,
  params: vec4<f32>,
};
struct Bond {
  startRadius: vec4<f32>,
  endRadius: vec4<f32>,
  color: vec4<f32>,
};
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) side: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> bonds: array<Bond>;
const corners = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, 0.0),
  vec2<f32>( 1.0, 0.0),
  vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0),
  vec2<f32>( 1.0, 0.0),
  vec2<f32>( 1.0, 1.0)
);
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let bond = bonds[instanceIndex];
  let corner = corners[vertexIndex];
  let start = bond.startRadius.xyz;
  let end = bond.endRadius.xyz;
  let axis = normalize(end - start);
  var side = cross(axis, uniforms.cameraForward.xyz);
  if (dot(side, side) < 0.0001) {
    side = uniforms.cameraRight.xyz;
  }
  side = normalize(side);
  let radius = mix(bond.startRadius.w, bond.endRadius.w, corner.y);
  let world = mix(start, end, corner.y) + side * corner.x * radius;
  var out: VertexOut;
  out.position = uniforms.viewProj * vec4<f32>(world, 1.0);
  out.color = bond.color;
  out.side = abs(corner.x);
  return out;
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let edge = smoothstep(1.0, 0.55, in.side);
  return vec4<f32>(in.color.rgb * (0.62 + 0.38 * edge), in.color.a);
}`,
  });

  const atomLayout = gpu.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipelineLayout = gpu.device.createPipelineLayout({ bindGroupLayouts: [atomLayout] });
  const blend = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const additiveBlend = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  };
  gpu.atomPipeline = gpu.device.createRenderPipeline({
    label: 'atoms',
    layout: pipelineLayout,
    vertex: { module: atomModule, entryPoint: 'vs' },
    fragment: { module: atomModule, entryPoint: 'fs', targets: [{ format: gpu.format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
  });
  gpu.glowPipeline = gpu.device.createRenderPipeline({
    label: 'glow',
    layout: pipelineLayout,
    vertex: { module: glowModule, entryPoint: 'vs' },
    fragment: { module: glowModule, entryPoint: 'fs', targets: [{ format: gpu.format, blend: additiveBlend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
  });
  gpu.bondPipeline = gpu.device.createRenderPipeline({
    label: 'bonds',
    layout: pipelineLayout,
    vertex: { module: bondModule, entryPoint: 'vs' },
    fragment: { module: bondModule, entryPoint: 'fs', targets: [{ format: gpu.format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
  });
  gpu.atomBindLayout = atomLayout;
}

function bindEvents() {
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  els.sampleSelect.addEventListener('change', async () => {
    const sample = state.samples.find((item) => item.id === els.sampleSelect.value);
    if (sample) await loadStructureFromURL(sample.url, sample.name);
  });
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    await loadStructureFromText(text, file.name);
    els.sampleSelect.value = '';
  });
  document.querySelectorAll('[data-representation]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveButton('[data-representation]', button);
      state.representation = button.dataset.representation;
      rebuildScene();
    });
  });
  document.querySelectorAll('[data-color-scheme]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveButton('[data-color-scheme]', button);
      state.colorScheme = button.dataset.colorScheme;
      rebuildScene();
    });
  });
  for (const [input, key] of [
    [els.atomScale, 'atomScale'],
    [els.bondScale, 'bondScale'],
    [els.glowScale, 'glowScale'],
    [els.clipDepth, 'clipDepth'],
  ]) {
    input.addEventListener('input', () => {
      state[key] = Number(input.value);
      rebuildScene();
    });
  }
  for (const [input, key] of [
    [els.showHetero, 'showHetero'],
    [els.showWater, 'showWater'],
    [els.showHydrogen, 'showHydrogen'],
    [els.autoRotate, 'autoRotate'],
  ]) {
    input.addEventListener('change', () => {
      state[key] = input.checked;
      if (key === 'autoRotate') return;
      rebuildScene();
    });
  }
  els.searchInput.addEventListener('input', renderSearch);
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = els.searchResults.querySelector('[data-atom-id]');
      if (first) selectAtomByID(Number(first.dataset.atomId), true, false);
    }
    if (event.key === 'Escape') {
      clearSearch();
    }
  });
  els.isolateClear.addEventListener('click', () => {
    state.isolatedChain = null;
    renderChains();
    rebuildScene();
  });
  els.frameSelection.addEventListener('click', () => {
    if (state.selectedAtom) frameAtom(state.selectedAtom);
  });
  els.measureReset.addEventListener('click', clearMeasurements);
  els.resetView.addEventListener('click', resetView);
  els.screenshot.addEventListener('click', exportPNG);
  els.modelSlider.addEventListener('input', () => {
    state.activeModel = Number(els.modelSlider.value) - 1;
    state.selectedAtom = null;
    state.hoveredAtom = null;
    state.lastMeasureAtom = null;
    clearMeasurements();
    fitModel(false);
    rebuildScene();
    updateModelLabel();
  });
  els.canvas.addEventListener('pointerdown', onPointerDown);
  els.canvas.addEventListener('pointermove', onPointerMove);
  els.canvas.addEventListener('pointerup', onPointerUp);
  els.canvas.addEventListener('pointerleave', () => {
    state.hoveredAtom = null;
    els.tooltip.classList.remove('is-visible');
  });
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
}

async function loadStructureFromURL(url, label) {
  setLoading(`Loading ${label}`);
  els.loading.classList.remove('is-hidden', 'is-error');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  const text = await response.text();
  await loadStructureFromText(text, label);
}

async function loadStructureFromText(text, label) {
  const format = detectStructureFormat(text, label);
  setLoading(`Parsing ${format.label} records`);
  const structure = format.kind === 'mmcif' ? parseMMCIF(text, label) : parsePDB(text, label);
  setLoading('Inferring bonds');
  deriveStructure(structure);
  state.structure = structure;
  state.activeModel = 0;
  state.selectedAtom = null;
  state.hoveredAtom = null;
  state.lastMeasureAtom = null;
  state.measurements = [];
  state.isolatedChain = null;
  updateStructureUI();
  fitModel(true);
  rebuildScene();
  els.loading.classList.add('is-hidden');
}

function detectStructureFormat(text, label) {
  const name = String(label || '').toLowerCase();
  if (name.endsWith('.cif') || name.endsWith('.mmcif')) return { kind: 'mmcif', label: 'PDBx/mmCIF' };
  if (/^\s*data_/i.test(text) && /_atom_site\./i.test(text)) return { kind: 'mmcif', label: 'PDBx/mmCIF' };
  return { kind: 'pdb', label: 'PDB' };
}

function createStructure(label, format) {
  return {
    label,
    format,
    meta: {
      title: label,
      code: '',
      classification: '',
      method: '',
      resolution: '',
      numModels: 0,
      keywords: '',
      entities: [],
    },
    helices: [],
    sheets: [],
    conect: [],
    models: [],
    chains: [],
    residues: [],
  };
}

function createModel(number) {
  return {
    number,
    atoms: [],
    bonds: [],
    serialToIndex: new Map(),
    atomKeyToIndex: new Map(),
  };
}

function addAtomToModel(model, atom) {
  model.serialToIndex.set(atom.serial, atom.id);
  registerAtomKeys(model, atom);
  model.atoms.push(atom);
}

function registerAtomKeys(model, atom) {
  const keys = [
    atomLookupKey(atom.chain, atom.authSeq ?? atom.resSeq, atom.iCode, atom.resName, atom.name),
    atom.authKey,
    atom.labelKey,
  ].filter(Boolean);
  for (const key of keys) {
    if (!model.atomKeyToIndex.has(key)) model.atomKeyToIndex.set(key, atom.id);
  }
}

function atomLookupKey(chain, seq, iCode, comp, atom) {
  const parts = [chain, seq, iCode, comp, atom].map((value) => normalizeLookupPart(value));
  if (!parts[0] || !parts[1] || !parts[4]) return '';
  return parts.join('|');
}

function normalizeLookupPart(value) {
  const clean = cleanCIFValue(value);
  return clean ? clean.toUpperCase() : '';
}

function parsePDB(text, label) {
  const structure = createStructure(label, 'pdb');
  let currentModel = null;
  let implicitModel = null;
  const titleParts = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === 'HEADER') {
      structure.meta.classification = slice(line, 10, 50).trim();
      structure.meta.code = slice(line, 62, 66).trim();
    } else if (record === 'TITLE') {
      const part = slice(line, 10, 80).trim();
      if (part) titleParts.push(part);
    } else if (record === 'EXPDTA') {
      structure.meta.method = slice(line, 10, 80).trim();
    } else if (line.startsWith('REMARK   2 RESOLUTION.')) {
      structure.meta.resolution = line.slice(23).trim();
    } else if (record === 'NUMMDL') {
      structure.meta.numModels = parseIntSafe(slice(line, 10, 14));
    } else if (record === 'HELIX') {
      structure.helices.push({
        chain: slice(line, 19, 20).trim(),
        start: parseIntSafe(slice(line, 21, 25)),
        end: parseIntSafe(slice(line, 33, 37)),
        type: 'helix',
      });
    } else if (record === 'SHEET') {
      structure.sheets.push({
        chain: slice(line, 21, 22).trim(),
        start: parseIntSafe(slice(line, 22, 26)),
        end: parseIntSafe(slice(line, 33, 37)),
        type: 'sheet',
      });
    } else if (record === 'MODEL') {
      currentModel = createModel(parseIntSafe(slice(line, 10, 14)) || structure.models.length + 1);
      structure.models.push(currentModel);
    } else if (record === 'ENDMDL') {
      currentModel = null;
    } else if (record === 'ATOM' || record === 'HETATM') {
      if (!currentModel) {
        if (!implicitModel) {
          implicitModel = createModel(1);
          structure.models.push(implicitModel);
        }
        currentModel = implicitModel;
      }
      const atom = parseAtomLine(line, record, currentModel.atoms.length);
      if (atom) addAtomToModel(currentModel, atom);
      if (implicitModel) currentModel = implicitModel;
    } else if (record === 'CONECT') {
      const source = parseIntSafe(slice(line, 6, 11));
      for (let offset = 11; offset <= 26; offset += 5) {
        const target = parseIntSafe(slice(line, offset, offset + 5));
        if (source && target) structure.conect.push([source, target]);
      }
    }
  }

  if (titleParts.length) structure.meta.title = titleParts.join(' ').replace(/\s+/g, ' ');
  if (structure.meta.code) structure.meta.title = `${structure.meta.code}: ${structure.meta.title}`;
  if (!structure.models.length) throw new Error('No ATOM or HETATM records were found in this PDB file.');
  structure.meta.numModels = structure.models.length;
  return structure;
}

function parseAtomLine(line, record, id) {
  const serial = parseIntSafe(slice(line, 6, 11));
  const name = slice(line, 12, 16).trim();
  const altLoc = slice(line, 16, 17).trim();
  if (altLoc && altLoc !== 'A' && altLoc !== '1') return null;
  const resName = slice(line, 17, 20).trim();
  const chain = slice(line, 21, 22).trim() || '_';
  const resSeq = parseIntSafe(slice(line, 22, 26));
  const iCode = slice(line, 26, 27).trim();
  const x = parseFloatSafe(slice(line, 30, 38));
  const y = parseFloatSafe(slice(line, 38, 46));
  const z = parseFloatSafe(slice(line, 46, 54));
  if (![x, y, z].every(Number.isFinite)) return null;
  const occupancy = parseFloatSafe(slice(line, 54, 60));
  const bFactor = parseFloatSafe(slice(line, 60, 66));
  const element = inferElement(slice(line, 76, 78).trim(), name);
  const isWater = WATER_RESIDUES.has(resName);
  const isHydrogen = element === 'H' || name.startsWith('H');
  const residueKey = `${chain}:${resSeq}${iCode}:${resName}`;
  const isHet = record === 'HETATM';
  const polymerType = inferPolymerType(resName);
  const authSeq = String(resSeq || '');
  return {
    id,
    serial,
    name,
    altLoc,
    resName,
    chain,
    resSeq,
    authSeq,
    labelSeq: authSeq,
    iCode,
    x,
    y,
    z,
    occupancy: Number.isFinite(occupancy) ? occupancy : 0,
    bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    element,
    record,
    isHet,
    isWater,
    isHydrogen,
    residueKey,
    authKey: atomLookupKey(chain, authSeq, iCode, resName, name),
    labelKey: atomLookupKey(chain, authSeq, iCode, resName, name),
    polymerType,
    ss: 'coil',
  };
}

function parseMMCIF(text, label) {
  const cif = parseCIFDocument(text);
  const structure = createStructure(label, 'mmcif');
  applyMMCIFMetadata(structure, cif, label);
  applyMMCIFSecondaryStructure(structure, cif);
  applyMMCIFConnections(structure, cif);

  const atomRows = getCIFRows(cif, 'atom_site');
  if (!atomRows.length) throw new Error('No _atom_site records were found in this PDBx/mmCIF file.');

  const modelsByNumber = new Map();
  for (const row of atomRows) {
    const group = cleanCIFValue(row.group_pdb).toUpperCase();
    if (group && group !== 'ATOM' && group !== 'HETATM') continue;
    const record = group === 'HETATM' ? 'HETATM' : 'ATOM';
    const altLoc = cleanCIFValue(row.label_alt_id);
    if (altLoc && altLoc !== 'A' && altLoc !== '1') continue;
    const modelNumber = parseIntSafe(row.pdbx_pdb_model_num) || 1;
    let model = modelsByNumber.get(modelNumber);
    if (!model) {
      model = createModel(modelNumber);
      modelsByNumber.set(modelNumber, model);
      structure.models.push(model);
    }
    const atom = parseMMCIFAtom(row, record, model.atoms.length);
    if (atom) addAtomToModel(model, atom);
  }

  structure.models.sort((a, b) => a.number - b.number);
  structure.models = structure.models.filter((model) => model.atoms.length > 0);
  if (!structure.models.length) throw new Error('No usable atom coordinates were found in this PDBx/mmCIF file.');
  structure.meta.numModels = structure.models.length;
  return structure;
}

function parseMMCIFAtom(row, record, id) {
  const serial = parseIntSafe(row.id) || id + 1;
  const name = firstCIFValue(row.auth_atom_id, row.label_atom_id, row.type_symbol) || 'X';
  const resName = (firstCIFValue(row.auth_comp_id, row.label_comp_id) || 'UNK').toUpperCase();
  const authChain = firstCIFValue(row.auth_asym_id);
  const labelChain = firstCIFValue(row.label_asym_id);
  const chain = authChain || labelChain || '_';
  const authSeq = firstCIFValue(row.auth_seq_id);
  const labelSeq = firstCIFValue(row.label_seq_id);
  const seqText = authSeq || labelSeq || '0';
  const resSeq = parseIntSafe(seqText);
  const iCode = firstCIFValue(row.pdbx_pdb_ins_code);
  const x = parseFloatSafe(row.cartn_x);
  const y = parseFloatSafe(row.cartn_y);
  const z = parseFloatSafe(row.cartn_z);
  if (![x, y, z].every(Number.isFinite)) return null;
  const occupancy = parseFloatSafe(row.occupancy);
  const bFactor = parseFloatSafe(row.b_iso_or_equiv);
  const element = inferElement(firstCIFValue(row.type_symbol), name);
  const isWater = WATER_RESIDUES.has(resName);
  const isHydrogen = element === 'H' || name.startsWith('H');
  const residueID = seqText || String(resSeq || 0);
  const residueKey = `${chain}:${residueID}${iCode}:${resName}`;
  const isHet = record === 'HETATM';
  const polymerType = inferPolymerType(resName);
  const labelComp = firstCIFValue(row.label_comp_id) || resName;
  const authComp = firstCIFValue(row.auth_comp_id) || resName;
  const labelAtom = firstCIFValue(row.label_atom_id) || name;
  const authAtom = firstCIFValue(row.auth_atom_id) || name;
  return {
    id,
    serial,
    name,
    altLoc: firstCIFValue(row.label_alt_id),
    resName,
    chain,
    authChain: authChain || chain,
    labelChain: labelChain || chain,
    resSeq,
    authSeq,
    labelSeq,
    iCode,
    x,
    y,
    z,
    occupancy: Number.isFinite(occupancy) ? occupancy : 0,
    bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    element,
    record,
    isHet,
    isWater,
    isHydrogen,
    residueKey,
    authKey: atomLookupKey(authChain || chain, authSeq || seqText, iCode, authComp, authAtom),
    labelKey: atomLookupKey(labelChain || chain, labelSeq || seqText, iCode, labelComp, labelAtom),
    polymerType,
    ss: 'coil',
  };
}

function applyMMCIFMetadata(structure, cif, label) {
  const code = getCIFValue(cif, ['_entry.id']) || cif.dataBlock || '';
  const title = getCIFValue(cif, ['_struct.title']) || label;
  const methods = getCIFColumnValues(cif, 'exptl', 'method');
  const resolution = getCIFValue(cif, [
    '_refine.ls_d_res_high',
    '_em_3d_reconstruction.resolution',
    '_reflns.d_resolution_high',
  ]);
  structure.meta.code = code;
  structure.meta.title = code ? `${code}: ${collapseWhitespace(title)}` : collapseWhitespace(title);
  structure.meta.classification = getCIFValue(cif, ['_struct_keywords.pdbx_keywords', '_struct_keywords.text']);
  structure.meta.keywords = getCIFValue(cif, ['_struct_keywords.text', '_struct_keywords.pdbx_keywords']);
  structure.meta.method = methods.join('; ') || getCIFValue(cif, ['_exptl.method']);
  structure.meta.resolution = resolution ? formatResolution(resolution) : '';
  structure.meta.entities = getCIFRows(cif, 'entity').map((row) => ({
    id: cleanCIFValue(row.id),
    type: cleanCIFValue(row.type),
    description: cleanCIFValue(row.pdbx_description),
  })).filter((entity) => entity.id || entity.description);
}

function applyMMCIFSecondaryStructure(structure, cif) {
  for (const row of getCIFRows(cif, 'struct_conf')) {
    const type = cleanCIFValue(row.conf_type_id).toUpperCase();
    const range = cifResidueRange(row);
    if (!range) continue;
    if (type.startsWith('HELX') || type.includes('HELIX')) {
      structure.helices.push({ ...range, type: 'helix' });
    } else if (type.startsWith('STRN') || type.includes('SHEET') || type.includes('BETA')) {
      structure.sheets.push({ ...range, type: 'sheet' });
    }
  }
  for (const row of getCIFRows(cif, 'struct_sheet_range')) {
    const range = cifResidueRange(row);
    if (range) structure.sheets.push({ ...range, type: 'sheet' });
  }
}

function cifResidueRange(row) {
  const chain = firstCIFValue(row.beg_auth_asym_id, row.beg_label_asym_id);
  const start = parseIntSafe(firstCIFValue(row.beg_auth_seq_id, row.beg_label_seq_id));
  const end = parseIntSafe(firstCIFValue(row.end_auth_seq_id, row.end_label_seq_id));
  if (!chain || !start || !end) return null;
  return { chain, start, end };
}

function applyMMCIFConnections(structure, cif) {
  for (const row of getCIFRows(cif, 'struct_conn')) {
    const aKeys = cifPartnerKeys(row, 'ptnr1');
    const bKeys = cifPartnerKeys(row, 'ptnr2');
    if (aKeys.length && bKeys.length) {
      structure.conect.push({
        aKeys,
        bKeys,
        type: cleanCIFValue(row.conn_type_id),
      });
    }
  }
}

function cifPartnerKeys(row, prefix) {
  const keys = [];
  const ins = firstCIFValue(
    row[`pdbx_${prefix}_pdb_ins_code`],
    row[`pdbx_${prefix}_label_pdb_ins_code`],
    row[`${prefix}_pdb_ins_code`],
  );
  const authKey = atomLookupKey(
    firstCIFValue(row[`${prefix}_auth_asym_id`], row[`pdbx_${prefix}_auth_asym_id`]),
    firstCIFValue(row[`${prefix}_auth_seq_id`], row[`pdbx_${prefix}_auth_seq_id`]),
    ins,
    firstCIFValue(row[`${prefix}_auth_comp_id`], row[`pdbx_${prefix}_auth_comp_id`]),
    firstCIFValue(row[`${prefix}_auth_atom_id`], row[`pdbx_${prefix}_auth_atom_id`]),
  );
  const labelKey = atomLookupKey(
    firstCIFValue(row[`${prefix}_label_asym_id`]),
    firstCIFValue(row[`${prefix}_label_seq_id`]),
    ins,
    firstCIFValue(row[`${prefix}_label_comp_id`]),
    firstCIFValue(row[`${prefix}_label_atom_id`]),
  );
  if (authKey) keys.push(authKey);
  if (labelKey && labelKey !== authKey) keys.push(labelKey);
  return keys;
}

function parseCIFDocument(text) {
  const tokens = tokenizeCIF(text);
  const cif = {
    dataBlock: '',
    fields: new Map(),
    loops: new Map(),
  };
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower.startsWith('data_')) {
      cif.dataBlock = token.slice(5).trim();
      index += 1;
    } else if (lower === 'loop_') {
      index += 1;
      const headers = [];
      while (index < tokens.length && tokens[index].startsWith('_')) {
        headers.push(tokens[index]);
        index += 1;
      }
      if (!headers.length) continue;
      const parsedHeaders = headers.map(splitCIFTag);
      const category = parsedHeaders[0]?.category ?? '';
      const rows = [];
      while (index < tokens.length && !isCIFControlToken(tokens[index])) {
        const row = {};
        let complete = true;
        for (let column = 0; column < parsedHeaders.length; column += 1) {
          if (index >= tokens.length || isCIFControlToken(tokens[index])) {
            complete = false;
            break;
          }
          row[parsedHeaders[column].attribute] = tokens[index];
          index += 1;
        }
        if (complete) rows.push(row);
      }
      if (category && rows.length) {
        if (!cif.loops.has(category)) cif.loops.set(category, []);
        cif.loops.get(category).push(...rows);
      }
    } else if (token.startsWith('_')) {
      if (index + 1 < tokens.length) cif.fields.set(normalizeCIFTag(token), tokens[index + 1]);
      index += 2;
    } else {
      index += 1;
    }
  }
  return cif;
}

function tokenizeCIF(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    const char = text[index];
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === ';' && (index === 0 || text[index - 1] === '\n')) {
      let start = index + 1;
      if (text[start] === '\r') start += 1;
      if (text[start] === '\n') start += 1;
      let end = text.length;
      let cursor = start;
      while (cursor < text.length) {
        const next = text.indexOf('\n;', cursor);
        if (next < 0) break;
        end = next;
        index = next + 2;
        while (index < text.length && text[index] !== '\n') index += 1;
        if (index < text.length) index += 1;
        break;
      }
      if (end === text.length) index = text.length;
      tokens.push(text.slice(start, end));
      continue;
    }
    if (char === '\'' || char === '"') {
      const quote = char;
      index += 1;
      const start = index;
      while (index < text.length && text[index] !== quote) index += 1;
      tokens.push(text.slice(start, index));
      if (index < text.length) index += 1;
      continue;
    }
    const start = index;
    while (index < text.length && !/\s/.test(text[index])) index += 1;
    tokens.push(text.slice(start, index));
  }
  return tokens;
}

function splitCIFTag(tag) {
  const key = normalizeCIFTag(tag).replace(/^_/, '');
  const dot = key.indexOf('.');
  if (dot < 0) return { category: key, attribute: '' };
  return {
    category: key.slice(0, dot),
    attribute: key.slice(dot + 1),
  };
}

function normalizeCIFTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

function isCIFControlToken(token) {
  const lower = token.toLowerCase();
  return token.startsWith('_') || lower === 'loop_' || lower === 'stop_' || lower.startsWith('data_') || lower.startsWith('save_');
}

function getCIFRows(cif, category) {
  return cif.loops.get(String(category).toLowerCase()) ?? [];
}

function getCIFValue(cif, tags) {
  for (const tag of tags) {
    const key = normalizeCIFTag(tag);
    const direct = cleanCIFValue(cif.fields.get(key));
    if (direct) return direct;
    const { category, attribute } = splitCIFTag(key);
    for (const row of getCIFRows(cif, category)) {
      const value = cleanCIFValue(row[attribute]);
      if (value) return value;
    }
  }
  return '';
}

function getCIFColumnValues(cif, category, attribute) {
  const values = [];
  const seen = new Set();
  for (const row of getCIFRows(cif, category)) {
    const value = cleanCIFValue(row[String(attribute).toLowerCase()]);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function firstCIFValue(...values) {
  for (const value of values) {
    const clean = cleanCIFValue(value);
    if (clean) return clean;
  }
  return '';
}

function cleanCIFValue(value) {
  const clean = String(value ?? '').trim();
  return clean === '.' || clean === '?' ? '' : clean;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatResolution(value) {
  const clean = cleanCIFValue(value);
  return clean && !/angstrom/i.test(clean) ? `${clean} Angstroms` : clean;
}

function deriveStructure(structure) {
  const firstModel = structure.models[0];
  const residueMap = new Map();
  const chainMap = new Map();

  for (const model of structure.models) {
    assignSecondary(model, structure);
    model.bonds = buildBonds(model, structure.conect);
    model.bounds = computeBounds(model.atoms);
    model.bFactorRange = computeBFactorRange(model.atoms);
  }

  for (const atom of firstModel.atoms) {
    if (!chainMap.has(atom.chain)) {
      chainMap.set(atom.chain, {
        id: atom.chain,
        atoms: 0,
        residues: 0,
        ligands: new Set(),
        color: CHAIN_PALETTE[chainMap.size % CHAIN_PALETTE.length],
      });
    }
    const chain = chainMap.get(atom.chain);
    chain.atoms += 1;
    if (atom.isHet && !atom.isWater) chain.ligands.add(atom.resName);

    if (!residueMap.has(atom.residueKey)) {
      residueMap.set(atom.residueKey, {
        key: atom.residueKey,
        chain: atom.chain,
        resName: atom.resName,
        resSeq: atom.resSeq,
        iCode: atom.iCode,
        atoms: [],
        polymerType: atom.polymerType,
        isHet: atom.isHet,
        ss: atom.ss,
      });
      chain.residues += 1;
    }
    residueMap.get(atom.residueKey).atoms.push(atom);
  }

  structure.chains = [...chainMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  structure.residues = [...residueMap.values()].sort((a, b) => a.chain.localeCompare(b.chain) || a.resSeq - b.resSeq);
  structure.searchItems = buildSearchItems(structure);
}

function assignSecondary(model, structure) {
  for (const atom of model.atoms) {
    atom.ss = 'coil';
    for (const helix of structure.helices) {
      if (atom.chain === helix.chain && atom.resSeq >= helix.start && atom.resSeq <= helix.end) {
        atom.ss = 'helix';
        break;
      }
    }
    if (atom.ss !== 'coil') continue;
    for (const sheet of structure.sheets) {
      if (atom.chain === sheet.chain && atom.resSeq >= sheet.start && atom.resSeq <= sheet.end) {
        atom.ss = 'sheet';
        break;
      }
    }
  }
}

function buildBonds(model, conectRecords) {
  const bonds = [];
  const seen = new Set();
  for (const connection of conectRecords) {
    const [a, b] = resolveConnection(model, connection);
    if (a === undefined || b === undefined || a === b) continue;
    addBond(bonds, seen, a, b, true);
  }

  const cellSize = 2.35;
  const cells = new Map();
  for (const atom of model.atoms) {
    const key = cellKey(atom, cellSize);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(atom.id);
  }

  for (const atom of model.atoms) {
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = cells.get(`${gx + dx},${gy + dy},${gz + dz}`);
          if (!bucket) continue;
          for (const otherID of bucket) {
            if (otherID <= atom.id) continue;
            const other = model.atoms[otherID];
            if (shouldInferBond(atom, other)) addBond(bonds, seen, atom.id, other.id, false);
          }
        }
      }
    }
  }
  return bonds;
}

function resolveConnection(model, connection) {
  if (Array.isArray(connection)) {
    return [model.serialToIndex.get(connection[0]), model.serialToIndex.get(connection[1])];
  }
  return [
    firstMappedIndex(model.atomKeyToIndex, connection.aKeys),
    firstMappedIndex(model.atomKeyToIndex, connection.bKeys),
  ];
}

function firstMappedIndex(map, keys) {
  for (const key of keys ?? []) {
    if (map.has(key)) return map.get(key);
  }
  return undefined;
}

function shouldInferBond(a, b) {
  if (a.isWater || b.isWater) return false;
  if (a.isHydrogen && b.isHydrogen) return false;
  if (a.chain !== b.chain && !a.isHet && !b.isHet) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < 0.16 || d2 > 8.2) return false;
  const ca = elementInfo(a.element).covalent;
  const cb = elementInfo(b.element).covalent;
  const max = Math.min(isMetal(a.element) || isMetal(b.element) ? 2.85 : 2.05, (ca + cb) * 1.28 + 0.18);
  return d2 <= max * max;
}

function addBond(bonds, seen, a, b, explicit) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const key = `${low}:${high}`;
  if (seen.has(key)) return;
  seen.add(key);
  bonds.push({ a: low, b: high, explicit });
}

function buildSearchItems(structure) {
  const items = [];
  for (const residue of structure.residues) {
    const representative =
      residue.atoms.find((atom) => atom.name === 'CA') ??
      residue.atoms.find((atom) => atom.name === 'P') ??
      residue.atoms.find((atom) => atom.name === "C4'") ??
      residue.atoms[0];
    items.push({
      type: residue.isHet ? 'Ligand' : 'Residue',
      label: `${residue.resName} ${residue.chain}${residue.resSeq}${residue.iCode}`,
      sublabel: `${residue.atoms.length} atoms`,
      atomID: representative.id,
      haystack: `${residue.resName} ${ligandAliases(residue.resName)} ${residue.chain} ${residue.resSeq} ${residue.key}`.toLowerCase(),
    });
  }
  for (const atom of structure.models[0].atoms) {
    items.push({
      type: 'Atom',
      label: atomLabel(atom),
      sublabel: `${atom.element} · ${atom.resName} ${atom.chain}${atom.resSeq}`,
      atomID: atom.id,
      haystack: `${atom.name} ${atom.element} ${atom.resName} ${ligandAliases(atom.resName)} ${atom.chain} ${atom.resSeq} ${atom.serial}`.toLowerCase(),
    });
  }
  return items;
}

function ligandAliases(resName) {
  const aliases = {
    HEM: 'heme haem porphyrin iron',
    PO4: 'phosphate',
    HOH: 'water solvent',
    WAT: 'water solvent',
    TOT: 'toto thiazole orange intercalator ligand',
  };
  return aliases[resName] ?? '';
}

function rebuildScene() {
  if (!state.structure) return;
  const model = activeModel();
  const visibleSet = new Set();
  const visibleAtoms = [];
  const atomRecords = [];
  const clipLimit = computeClipLimit();

  for (const atom of model.atoms) {
    if (!atomPassesFilters(atom, clipLimit)) continue;
    if (state.representation === 'backbone' && !isBackboneAtom(atom) && !(atom.isHet && !atom.isWater)) continue;
    const radius = atomRadius(atom);
    const color = atomColor(atom, model);
    const selected = state.selectedAtom && state.selectedAtom.id === atom.id;
    if (selected) {
      color[0] = Math.min(1, color[0] * 1.1 + 0.35);
      color[1] = Math.min(1, color[1] * 1.1 + 0.35);
      color[2] = Math.min(1, color[2] * 1.1 + 0.35);
    }
    visibleSet.add(atom.id);
    visibleAtoms.push({
      x: atom.x,
      y: atom.y,
      z: atom.z,
      radius,
      color,
      alpha: 0.98,
    });
    atomRecords.push({ atom, radius });
  }

  let bonds = [];
  if (state.representation === 'backbone') {
    bonds = buildTraceBonds(atomRecords);
  } else if (state.representation === 'ball-stick') {
    for (const bond of model.bonds) {
      if (!visibleSet.has(bond.a) || !visibleSet.has(bond.b)) continue;
      const a = model.atoms[bond.a];
      const b = model.atoms[bond.b];
      bonds.push(makeBondInstance(a, b, 0.08 * state.bondScale, midpointColor(atomColor(a, model), atomColor(b, model)), 0.82));
    }
  }

  for (const measurement of state.measurements) {
    const a = model.atoms[measurement.a];
    const b = model.atoms[measurement.b];
    if (a && b) bonds.push(makeBondInstance(a, b, 0.09, [1, 0.86, 0.28], 0.96));
  }

  state.visibleAtoms = visibleAtoms;
  state.visibleBonds = bonds;
  state.visibleAtomRecords = atomRecords;
  uploadScene();
  updateSelectionPanel();
  renderChains();
}

function computeClipLimit() {
  if (state.clipDepth > 0.995) return null;
  const model = activeModel();
  const bounds = model.bounds;
  const center = bounds.center;
  const radius = bounds.radius;
  const front = state.camera.forward;
  const depth = (state.clipDepth * 2 - 1) * radius;
  return { center, front, depth };
}

function atomPassesFilters(atom, clipLimit) {
  if (state.isolatedChain && atom.chain !== state.isolatedChain) return false;
  if (atom.isWater && !state.showWater) return false;
  if (atom.isHydrogen && !state.showHydrogen) return false;
  if (atom.isHet && !atom.isWater && !state.showHetero) return false;
  if (clipLimit) {
    const relative = [atom.x - clipLimit.center[0], atom.y - clipLimit.center[1], atom.z - clipLimit.center[2]];
    if (dot(relative, clipLimit.front) > clipLimit.depth) return false;
  }
  return true;
}

function atomRadius(atom) {
  const info = elementInfo(atom.element);
  if (state.representation === 'spacefill') return info.vdw * 0.47 * state.atomScale;
  if (state.representation === 'backbone') return atom.isHet ? info.covalent * 0.36 * state.atomScale : 0.42 * state.atomScale;
  return Math.max(0.13, info.covalent * 0.34 * state.atomScale);
}

function atomColor(atom, model) {
  if (state.colorScheme === 'element') return [...elementInfo(atom.element).color];
  if (state.colorScheme === 'bfactor') return bFactorColor(atom.bFactor, model.bFactorRange);
  if (state.colorScheme === 'residue') return residueColor(atom);
  const chainIndex = state.structure.chains.findIndex((chain) => chain.id === atom.chain);
  return [...CHAIN_PALETTE[(chainIndex < 0 ? 0 : chainIndex) % CHAIN_PALETTE.length]];
}

function residueColor(atom) {
  if (atom.isWater) return [0.55, 0.75, 1.0];
  if (atom.isHet) return [1.0, 0.58, 0.22];
  if (RESIDUE_CLASSES.negative.has(atom.resName)) return [1.0, 0.27, 0.3];
  if (RESIDUE_CLASSES.positive.has(atom.resName)) return [0.28, 0.55, 1.0];
  if (RESIDUE_CLASSES.polar.has(atom.resName)) return [0.35, 0.92, 0.72];
  if (RESIDUE_CLASSES.hydrophobic.has(atom.resName)) return [0.92, 0.8, 0.35];
  if (RESIDUE_CLASSES.nucleic.has(atom.resName)) return [0.74, 0.48, 1.0];
  if (atom.ss === 'helix') return [0.98, 0.36, 0.48];
  if (atom.ss === 'sheet') return [0.96, 0.75, 0.28];
  return [0.76, 0.82, 0.86];
}

function bFactorColor(value, range) {
  const span = Math.max(0.0001, range.max - range.min);
  const t = clamp((value - range.min) / span, 0, 1);
  if (t < 0.5) return lerpColor([0.1, 0.42, 1.0], [0.92, 0.96, 1.0], t * 2);
  return lerpColor([0.92, 0.96, 1.0], [1.0, 0.25, 0.18], (t - 0.5) * 2);
}

function buildTraceBonds(atomRecords) {
  const byChain = new Map();
  for (const record of atomRecords) {
    const atom = record.atom;
    if (atom.isHet) continue;
    if (!byChain.has(atom.chain)) byChain.set(atom.chain, []);
    byChain.get(atom.chain).push(atom);
  }
  const bonds = [];
  for (const atoms of byChain.values()) {
    atoms.sort((a, b) => a.resSeq - b.resSeq || a.name.localeCompare(b.name));
    for (let index = 1; index < atoms.length; index += 1) {
      const a = atoms[index - 1];
      const b = atoms[index];
      const maxDistance = a.polymerType === 'nucleic' || b.polymerType === 'nucleic' ? 8.2 : 4.8;
      if (distance(a, b) <= maxDistance) {
        bonds.push(makeBondInstance(a, b, 0.16 * state.bondScale, midpointColor(atomColor(a, activeModel()), atomColor(b, activeModel())), 0.9));
      }
    }
  }
  for (const record of atomRecords) {
    const atom = record.atom;
    if (!atom.isHet) continue;
    const color = atomColor(atom, activeModel());
    for (const bond of activeModel().bonds) {
      if (bond.a !== atom.id && bond.b !== atom.id) continue;
      const other = activeModel().atoms[bond.a === atom.id ? bond.b : bond.a];
      if (other?.isHet) bonds.push(makeBondInstance(atom, other, 0.07 * state.bondScale, color, 0.74));
    }
  }
  return bonds;
}

function makeBondInstance(a, b, radius, color, alpha) {
  return {
    ax: a.x,
    ay: a.y,
    az: a.z,
    bx: b.x,
    by: b.y,
    bz: b.z,
    radius,
    color,
    alpha,
  };
}

function uploadScene() {
  if (gpu.fallback) return;
  const atomData = new Float32Array(Math.max(1, state.visibleAtoms.length) * 8);
  const glowData = new Float32Array(Math.max(1, state.visibleAtoms.length) * 8);
  for (let index = 0; index < state.visibleAtoms.length; index += 1) {
    const atom = state.visibleAtoms[index];
    const offset = index * 8;
    atomData[offset] = atom.x;
    atomData[offset + 1] = atom.y;
    atomData[offset + 2] = atom.z;
    atomData[offset + 3] = atom.radius;
    atomData[offset + 4] = atom.color[0];
    atomData[offset + 5] = atom.color[1];
    atomData[offset + 6] = atom.color[2];
    atomData[offset + 7] = atom.alpha;

    glowData[offset] = atom.x;
    glowData[offset + 1] = atom.y;
    glowData[offset + 2] = atom.z;
    glowData[offset + 3] = atom.radius * (2.8 + state.glowScale * 5.0);
    glowData[offset + 4] = atom.color[0];
    glowData[offset + 5] = atom.color[1];
    glowData[offset + 6] = atom.color[2];
    glowData[offset + 7] = 0.018 * state.glowScale;
  }

  const bondData = new Float32Array(Math.max(1, state.visibleBonds.length) * 12);
  for (let index = 0; index < state.visibleBonds.length; index += 1) {
    const bond = state.visibleBonds[index];
    const offset = index * 12;
    bondData[offset] = bond.ax;
    bondData[offset + 1] = bond.ay;
    bondData[offset + 2] = bond.az;
    bondData[offset + 3] = bond.radius;
    bondData[offset + 4] = bond.bx;
    bondData[offset + 5] = bond.by;
    bondData[offset + 6] = bond.bz;
    bondData[offset + 7] = bond.radius;
    bondData[offset + 8] = bond.color[0];
    bondData[offset + 9] = bond.color[1];
    bondData[offset + 10] = bond.color[2];
    bondData[offset + 11] = bond.alpha;
  }

  gpu.atomCount = state.visibleAtoms.length;
  gpu.glowCount = state.glowScale > 0 ? state.visibleAtoms.length : 0;
  gpu.bondCount = state.visibleBonds.length;
  gpu.atomBuffer = replaceStorageBuffer(gpu.atomBuffer, atomData, 'atoms');
  gpu.glowBuffer = replaceStorageBuffer(gpu.glowBuffer, glowData, 'glow');
  gpu.bondBuffer = replaceStorageBuffer(gpu.bondBuffer, bondData, 'bonds');
  gpu.atomBindGroup = createBindGroup(gpu.atomBuffer);
  gpu.glowBindGroup = createBindGroup(gpu.glowBuffer);
  gpu.bondBindGroup = createBindGroup(gpu.bondBuffer);
}

function replaceStorageBuffer(previous, data, label) {
  previous?.destroy();
  const buffer = gpu.device.createBuffer({
    label,
    size: Math.max(32, align4(data.byteLength)),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpu.device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function createBindGroup(storageBuffer) {
  return gpu.device.createBindGroup({
    layout: gpu.atomBindLayout,
    entries: [
      { binding: 0, resource: { buffer: gpu.uniformBuffer } },
      { binding: 1, resource: { buffer: storageBuffer } },
    ],
  });
}

function frame(time = 0) {
  updateCamera(time);
  render(time);
  requestAnimationFrame(frame);
}

function updateCamera(time) {
  if (state.autoRotate && !state.pointer.dragging) {
    state.camera.yaw += 0.00016 * (time ? 16.7 : 1);
  }
  const camera = state.camera;
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const sinYaw = Math.sin(camera.yaw);
  const cosYaw = Math.cos(camera.yaw);
  camera.eye = [
    camera.target[0] + camera.radius * cosPitch * sinYaw,
    camera.target[1] + camera.radius * sinPitch,
    camera.target[2] + camera.radius * cosPitch * cosYaw,
  ];
  camera.forward = normalize([
    camera.target[0] - camera.eye[0],
    camera.target[1] - camera.eye[1],
    camera.target[2] - camera.eye[2],
  ]);
  camera.right = normalize(cross(camera.forward, [0, 1, 0]));
  if (length(camera.right) < 0.001) camera.right = [1, 0, 0];
  camera.up = normalize(cross(camera.right, camera.forward));
}

function render(time) {
  if (gpu.fallback) {
    renderCanvas(time);
    return;
  }
  resize();
  const aspect = els.canvas.width / Math.max(1, els.canvas.height);
  const projection = mat4Perspective(state.camera.fov, aspect, state.camera.near, state.camera.far);
  const view = mat4LookAt(state.camera.eye, state.camera.target, state.camera.up);
  const viewProj = mat4Multiply(projection, view);
  gpu.uniformData.set(viewProj, 0);
  gpu.uniformData.set([...state.camera.right, 0], 16);
  gpu.uniformData.set([...state.camera.up, 0], 20);
  gpu.uniformData.set([...state.camera.forward, 0], 24);
  gpu.uniformData.set([...scale(state.camera.forward, -1), 0], 28);
  gpu.uniformData.set([time * 0.001, aspect, state.glowScale, 0], 32);
  gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, gpu.uniformData);

  const commandEncoder = gpu.device.createCommandEncoder();
  const textureView = gpu.context.getCurrentTexture().createView();
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        clearValue: { r: 0.018, g: 0.025, b: 0.027, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: gpu.depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  if (gpu.glowCount > 0) {
    pass.setPipeline(gpu.glowPipeline);
    pass.setBindGroup(0, gpu.glowBindGroup);
    pass.draw(6, gpu.glowCount);
  }
  if (gpu.bondCount > 0) {
    pass.setPipeline(gpu.bondPipeline);
    pass.setBindGroup(0, gpu.bondBindGroup);
    pass.draw(6, gpu.bondCount);
  }
  if (gpu.atomCount > 0) {
    pass.setPipeline(gpu.atomPipeline);
    pass.setBindGroup(0, gpu.atomBindGroup);
    pass.draw(6, gpu.atomCount);
  }
  pass.end();
  gpu.device.queue.submit([commandEncoder.finish()]);
}

function renderCanvas(time) {
  resize();
  const ctx = gpu.ctx2d;
  const width = els.canvas.width;
  const height = els.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#071012');
  background.addColorStop(0.52, '#050708');
  background.addColorStop(1, '#0b0d0d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const projectedBonds = [];
  for (const bond of state.visibleBonds) {
    const a = projectPoint([bond.ax, bond.ay, bond.az]);
    const b = projectPoint([bond.bx, bond.by, bond.bz]);
    if (!a || !b) continue;
    projectedBonds.push({ a, b, bond, z: (a.z + b.z) / 2 });
  }
  projectedBonds.sort((a, b) => b.z - a.z);
  ctx.lineCap = 'round';
  for (const item of projectedBonds) {
    const alpha = Math.max(0.18, item.bond.alpha ?? 0.75);
    ctx.strokeStyle = rgbaCSS(item.bond.color, alpha);
    ctx.lineWidth = Math.max(1.2, item.bond.radius * item.a.scale * 2);
    ctx.beginPath();
    ctx.moveTo(item.a.x, item.a.y);
    ctx.lineTo(item.b.x, item.b.y);
    ctx.stroke();
  }

  const projectedAtoms = [];
  for (let index = 0; index < state.visibleAtoms.length; index += 1) {
    const atom = state.visibleAtoms[index];
    const point = projectPoint([atom.x, atom.y, atom.z]);
    if (!point) continue;
    projectedAtoms.push({ atom, point, record: state.visibleAtomRecords[index] });
  }
  projectedAtoms.sort((a, b) => b.point.z - a.point.z);

  if (state.glowScale > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (const item of projectedAtoms) {
      const radius = Math.max(1.5, item.atom.radius * item.point.scale * (2.2 + state.glowScale * 3.4));
      const gradient = ctx.createRadialGradient(item.point.x, item.point.y, 0, item.point.x, item.point.y, radius);
      gradient.addColorStop(0, rgbaCSS(item.atom.color, 0.06 * state.glowScale));
      gradient.addColorStop(1, rgbaCSS(item.atom.color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(item.point.x, item.point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  for (const item of projectedAtoms) {
    const radius = Math.max(1.6, item.atom.radius * item.point.scale);
    const color = item.atom.color;
    const highlight = state.selectedAtom && item.record?.atom.id === state.selectedAtom.id;
    const gradient = ctx.createRadialGradient(
      item.point.x,
      item.point.y,
      radius * 0.08,
      item.point.x,
      item.point.y,
      radius,
    );
    gradient.addColorStop(0, rgbaCSS(lerpColor(color, [1, 1, 1], 0.5), 1));
    gradient.addColorStop(0.62, rgbaCSS(color, 0.98));
    gradient.addColorStop(1, rgbaCSS(lerpColor(color, [0, 0, 0], 0.28), 0.95));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(item.point.x, item.point.y, radius * (highlight ? 1.28 : 1), 0, Math.PI * 2);
    ctx.fill();
    if (highlight) {
      ctx.strokeStyle = 'rgba(255, 245, 220, 0.95)';
      ctx.lineWidth = Math.max(1.5, radius * 0.16);
      ctx.stroke();
    }
  }
}

function projectPoint(point) {
  const toPoint = sub(point, state.camera.eye);
  const z = dot(toPoint, state.camera.forward);
  if (z <= state.camera.near) return null;
  const height = els.canvas.height;
  const width = els.canvas.width;
  const focal = height / (2 * Math.tan(state.camera.fov / 2));
  return {
    x: width / 2 + dot(toPoint, state.camera.right) * focal / z,
    y: height / 2 - dot(toPoint, state.camera.up) * focal / z,
    z,
    scale: focal / z,
  };
}

function resize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(els.canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(els.canvas.clientHeight * pixelRatio));
  if (gpu.fallback) {
    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
    }
    return;
  }
  if (els.canvas.width === width && els.canvas.height === height && gpu.depthTexture) return;
  els.canvas.width = width;
  els.canvas.height = height;
  gpu.depthTexture?.destroy();
  gpu.depthTexture = gpu.device.createTexture({
    label: 'depth',
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

function onPointerDown(event) {
  els.canvas.setPointerCapture(event.pointerId);
  state.pointer.dragging = true;
  state.pointer.panning = event.shiftKey || event.button === 1;
  state.pointer.lastX = event.clientX;
  state.pointer.lastY = event.clientY;
  state.pointer.moved = false;
}

function onPointerMove(event) {
  const rect = els.canvas.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  if (state.pointer.dragging) {
    const dx = event.clientX - state.pointer.lastX;
    const dy = event.clientY - state.pointer.lastY;
    state.pointer.lastX = event.clientX;
    state.pointer.lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) state.pointer.moved = true;
    if (state.pointer.panning) {
      panCamera(dx, dy);
    } else {
      state.camera.yaw -= dx * 0.006;
      state.camera.pitch = clamp(state.camera.pitch - dy * 0.005, -1.48, 1.48);
    }
    if (state.clipDepth < 0.995) rebuildScene();
    return;
  }

  const hit = pickAtom(state.pointer.x, state.pointer.y);
  state.hoveredAtom = hit?.atom ?? null;
  if (state.hoveredAtom) {
    const atom = state.hoveredAtom;
    els.tooltip.innerHTML = `<strong>${escapeHTML(atomLabel(atom))}</strong><span>${escapeHTML(atom.resName)} ${escapeHTML(atom.chain)}${atom.resSeq} · ${escapeHTML(atom.element)} · B ${atom.bFactor.toFixed(2)}</span>`;
    els.tooltip.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
    els.tooltip.classList.add('is-visible');
  } else {
    els.tooltip.classList.remove('is-visible');
  }
}

function onPointerUp(event) {
  state.pointer.dragging = false;
  if (!state.pointer.moved) {
    const hit = pickAtom(state.pointer.x, state.pointer.y);
    if (hit) selectAtom(hit.atom, false, true);
  }
  try {
    els.canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Some browsers release capture automatically.
  }
}

function onWheel(event) {
  event.preventDefault();
  const scale = Math.exp(event.deltaY * 0.0012);
  state.camera.radius = clamp(state.camera.radius * scale, 1.5, 2200);
  if (state.clipDepth < 0.995) rebuildScene();
}

function panCamera(dx, dy) {
  const speed = state.camera.radius * 0.0018;
  state.camera.target = add(
    state.camera.target,
    add(scale(state.camera.right, -dx * speed), scale(state.camera.up, dy * speed)),
  );
}

function pickAtom(ndcX, ndcY) {
  if (!state.visibleAtomRecords.length) return null;
  const aspect = els.canvas.width / Math.max(1, els.canvas.height);
  const tan = Math.tan(state.camera.fov / 2);
  const rayDirection = normalize(add(
    state.camera.forward,
    add(scale(state.camera.right, ndcX * tan * aspect), scale(state.camera.up, ndcY * tan)),
  ));
  const origin = state.camera.eye;
  let best = null;
  for (const record of state.visibleAtomRecords) {
    const atom = record.atom;
    const center = [atom.x, atom.y, atom.z];
    const toCenter = sub(center, origin);
    const t = dot(toCenter, rayDirection);
    if (t < 0) continue;
    const closest = add(origin, scale(rayDirection, t));
    const miss = distanceVec(center, closest);
    const threshold = Math.max(record.radius * 1.45, 0.32);
    if (miss <= threshold && (!best || t < best.t)) best = { atom, t, miss };
  }
  return best;
}

function selectAtomByID(id, frameSelection = false, measure = false) {
  const atom = activeModel().atoms[id];
  if (atom) selectAtom(atom, frameSelection, measure);
}

function selectAtom(atom, frameSelection = false, measure = false) {
  if (measure && state.lastMeasureAtom && state.lastMeasureAtom.id !== atom.id) {
    state.measurements.push({
      a: state.lastMeasureAtom.id,
      b: atom.id,
      distance: distance(state.lastMeasureAtom, atom),
    });
  }
  state.selectedAtom = atom;
  state.lastMeasureAtom = atom;
  if (frameSelection) frameAtom(atom);
  rebuildScene();
}

function frameAtom(atom) {
  state.camera.target = [atom.x, atom.y, atom.z];
  state.camera.radius = Math.max(8, activeModel().bounds.radius * 0.18);
}

function clearMeasurements() {
  state.measurements = [];
  state.lastMeasureAtom = null;
  rebuildScene();
}

function fitModel(resetAngles) {
  const bounds = activeModel().bounds;
  state.camera.target = [...bounds.center];
  state.camera.radius = Math.max(10, bounds.radius * 2.25);
  state.camera.near = Math.max(0.02, bounds.radius / 500);
  state.camera.far = Math.max(100, bounds.radius * 8);
  if (resetAngles) {
    state.camera.yaw = -0.72;
    state.camera.pitch = 0.34;
  }
}

function resetView() {
  fitModel(true);
  rebuildScene();
}

function exportPNG() {
  els.canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(state.structure?.meta.code || 'proteoscope').toLowerCase()}-view.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
}

function updateStructureUI() {
  const structure = state.structure;
  els.title.textContent = structure.meta.title;
  document.title = `${structure.meta.code || 'Structure'} · Proteoscope`;
  els.residuesMetric.textContent = formatNumber(structure.residues.length);
  els.chainsMetric.textContent = formatNumber(structure.chains.length);
  els.modelsMetric.textContent = formatNumber(structure.models.length);
  els.modelSlider.max = String(structure.models.length);
  els.modelSlider.value = '1';
  els.modelStrip.classList.toggle('is-visible', structure.models.length > 1);
  updateModelLabel();
  updateModelMetrics();
  renderChains();
  clearSearch();
}

function populateSamples() {
  els.sampleSelect.innerHTML = '';
  for (const sample of state.samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sampleSummary(sample);
    els.sampleSelect.appendChild(option);
  }
}

function sampleSummary(sample) {
  if (sample.models > 1) {
    const atomsPerModel = sample.atoms / sample.models;
    const atomsLabel = Number.isInteger(atomsPerModel) ? atomsPerModel.toLocaleString() : sample.atoms.toLocaleString();
    return `${sample.name} · ${atomsLabel} atoms/model · ${sample.models.toLocaleString()} models`;
  }
  return `${sample.name} · ${sample.atoms.toLocaleString()} atoms`;
}

function renderChains() {
  if (!state.structure) return;
  const fragment = document.createDocumentFragment();
  for (const chain of state.structure.chains) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = chain.id === state.isolatedChain ? 'chain-button is-active' : 'chain-button';
    button.innerHTML = `
      <span class="chain-swatch" style="--swatch:${rgbCSS(chain.color)}"></span>
      <span><strong>${escapeHTML(displayChain(chain.id))}</strong><small>${chain.residues} residues · ${chain.atoms} atoms</small></span>
    `;
    button.addEventListener('click', () => {
      state.isolatedChain = state.isolatedChain === chain.id ? null : chain.id;
      renderChains();
      rebuildScene();
    });
    fragment.appendChild(button);
  }
  els.chainList.replaceChildren(fragment);
}

function updateSelectionPanel() {
  const atom = state.selectedAtom;
  if (!atom) {
    els.selectionTitle.textContent = 'None';
    els.selectionMeta.textContent = 'Select an atom or residue.';
  } else {
    els.selectionTitle.textContent = atomLabel(atom);
    els.selectionMeta.textContent = `${atom.resName} ${atom.chain}${atom.resSeq}${atom.iCode} · ${atom.element} · serial ${atom.serial} · occupancy ${atom.occupancy.toFixed(2)} · B ${atom.bFactor.toFixed(2)}`;
  }
  const fragment = document.createDocumentFragment();
  for (const measurement of state.measurements.slice(-6).reverse()) {
    const a = activeModel().atoms[measurement.a];
    const b = activeModel().atoms[measurement.b];
    const row = document.createElement('div');
    row.innerHTML = `<strong>${measurement.distance.toFixed(2)} Å</strong><span>${escapeHTML(shortAtomLabel(a))} ↔ ${escapeHTML(shortAtomLabel(b))}</span>`;
    fragment.appendChild(row);
  }
  els.measurementList.replaceChildren(fragment);
}

function renderSearch() {
  const query = els.searchInput.value.trim().toLowerCase();
  if (!query || !state.structure) {
    els.searchResults.classList.remove('is-visible');
    els.searchResults.replaceChildren();
    return;
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const results = state.structure.searchItems
    .filter((item) => terms.every((term) => item.haystack.includes(term)))
    .slice(0, 32);
  const fragment = document.createDocumentFragment();
  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.atomId = String(result.atomID);
    button.innerHTML = `<strong>${escapeHTML(result.label)}</strong><span>${escapeHTML(result.type)} · ${escapeHTML(result.sublabel)}</span>`;
    button.addEventListener('click', () => {
      selectAtomByID(result.atomID, true, false);
      els.searchResults.classList.remove('is-visible');
    });
    fragment.appendChild(button);
  }
  els.searchResults.replaceChildren(fragment);
  els.searchResults.classList.toggle('is-visible', results.length > 0);
}

function clearSearch() {
  els.searchInput.value = '';
  els.searchResults.classList.remove('is-visible');
  els.searchResults.replaceChildren();
}

function updateModelLabel() {
  els.modelLabel.textContent = `${state.activeModel + 1} / ${state.structure?.models.length ?? 1}`;
  updateModelMetrics();
}

function updateModelMetrics() {
  if (!state.structure) return;
  const model = activeModel();
  const totalAtoms = state.structure.models.reduce((sum, item) => sum + item.atoms.length, 0);
  const hasEnsemble = state.structure.models.length > 1;
  els.atomsLabel.textContent = hasEnsemble ? 'Atoms/model' : 'Atoms';
  els.atomsMetric.textContent = formatNumber(model.atoms.length);
  els.totalAtomsMetric.textContent = formatNumber(totalAtoms);
  els.totalAtomsMetric.parentElement.hidden = !hasEnsemble;
}

function onKeyDown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key.toLowerCase() === 'r') resetView();
  if (event.key === 'Escape') {
    clearSearch();
    clearMeasurements();
  }
}

function setActiveButton(selector, active) {
  document.querySelectorAll(selector).forEach((button) => button.classList.toggle('is-active', button === active));
}

function activeModel() {
  return state.structure.models[state.activeModel] ?? state.structure.models[0];
}

function computeBounds(atoms) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const atom of atoms) {
    min[0] = Math.min(min[0], atom.x);
    min[1] = Math.min(min[1], atom.y);
    min[2] = Math.min(min[2], atom.z);
    max[0] = Math.max(max[0], atom.x);
    max[1] = Math.max(max[1], atom.y);
    max[2] = Math.max(max[2], atom.z);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 1;
  for (const atom of atoms) {
    radius = Math.max(radius, distanceVec(center, [atom.x, atom.y, atom.z]));
  }
  return { min, max, center, radius };
}

function computeBFactorRange(atoms) {
  let min = Infinity;
  let max = -Infinity;
  for (const atom of atoms) {
    min = Math.min(min, atom.bFactor);
    max = Math.max(max, atom.bFactor);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return { min: 0, max: 1 };
  return { min, max };
}

function cellKey(atom, cellSize) {
  return `${Math.floor(atom.x / cellSize)},${Math.floor(atom.y / cellSize)},${Math.floor(atom.z / cellSize)}`;
}

function isBackboneAtom(atom) {
  if (atom.polymerType === 'protein') return PROTEIN_BACKBONE.has(atom.name);
  if (atom.polymerType === 'nucleic') return NUCLEIC_BACKBONE.has(atom.name);
  return false;
}

function inferPolymerType(resName) {
  if (RESIDUE_CLASSES.nucleic.has(resName)) return 'nucleic';
  if (
    RESIDUE_CLASSES.hydrophobic.has(resName) ||
    RESIDUE_CLASSES.polar.has(resName) ||
    RESIDUE_CLASSES.positive.has(resName) ||
    RESIDUE_CLASSES.negative.has(resName)
  ) {
    return 'protein';
  }
  return 'ligand';
}

function inferElement(elementField, atomName) {
  const clean = elementField.trim().toUpperCase();
  if (clean) return clean;
  const letters = atomName.replace(/[0-9']/g, '').trim().toUpperCase();
  if (!letters) return 'C';
  if (letters.length >= 2 && ELEMENTS[letters.slice(0, 2)]) return letters.slice(0, 2);
  return letters[0];
}

function elementInfo(element) {
  return ELEMENTS[element] ?? { covalent: 0.77, vdw: 1.7, color: [0.78, 0.8, 0.82] };
}

function isMetal(element) {
  return ['FE', 'MG', 'ZN', 'MN', 'CU', 'CO', 'NI', 'CA', 'NA', 'K'].includes(element);
}

function atomLabel(atom) {
  return `${atom.name} · ${atom.resName} ${displayChain(atom.chain)}${atom.resSeq}${atom.iCode}`;
}

function shortAtomLabel(atom) {
  return `${atom.name}/${atom.resName}${atom.chain}${atom.resSeq}`;
}

function displayChain(chain) {
  return chain === '_' ? 'Chain _' : `Chain ${chain}`;
}

function setLoading(message) {
  els.loadingStatus.textContent = message;
}

function slice(text, start, end) {
  return text.length > start ? text.slice(start, Math.min(end, text.length)) : '';
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatSafe(value) {
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function align4(size) {
  return Math.ceil(size / 4) * 4;
}

function rgbCSS(color) {
  return `rgb(${Math.round(color[0] * 255)} ${Math.round(color[1] * 255)} ${Math.round(color[2] * 255)})`;
}

function rgbaCSS(color, alpha) {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${alpha})`;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function midpointColor(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v);
  if (len < 0.000001) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function distanceVec(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, center, up) {
  const z = normalize(sub(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return out;
}
