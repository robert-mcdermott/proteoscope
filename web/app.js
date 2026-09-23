import { createRenderer, MESH_VERTEX_STRIDE, packColor, withTimeout } from './lib/renderer.js';
import { createCanvasRenderer } from './lib/renderer-canvas.js';
import { ASYMMETRIC_UNIT_ID, parseStructure } from './lib/parse.js';
import {
  MAX_ASSEMBLY_ATOMS,
  assignSecondary,
  buildSearchItems,
  computeBounds,
  deriveStructure,
  materializeAssemblyModels,
  prepareAssemblyEstimates,
  residueForUniprotPosition,
  uniprotPositionForResidue,
} from './lib/structure.js';
import { buildLines, buildScene, focusNeighborhood } from './lib/scene.js';
import { compareStructures, polymerChainResidues, superposeEnsemble } from './lib/compare.js';
import { composeTransforms, invertTransform, isIdentityTransform, transformPoint } from './lib/superpose.js';
import { buildCartoon } from './lib/cartoon.js';
import { COLOR_SCHEMES, computeAtomColors, titleCase } from './lib/coloring.js';
import {
  BACKGROUNDS,
  CHAIN_PALETTES,
  COLORMAPS,
  PLDDT_BANDS,
  chainPaletteColor,
  colorToHex,
  colormapGradientCSS,
  hexColor,
  sampleColormap,
} from './lib/colors.js';
import {
  cameraBasis,
  cameraMatrices,
  cloneCamera,
  createCamera,
  fitCameraToPoints,
  interpolateCamera,
  orbitCamera,
  panCamera,
  projectToScreen,
  rollCamera,
  spinCamera,
  zoomCamera,
} from './lib/camera.js';
import { add, angleBetween, dihedralAngle, normalize, scale, sub } from './lib/math3d.js';
import { createSequenceView } from './lib/sequence-view.js';
import { drawPAE, drawProfile, drawRamachandran } from './lib/plots.js';
import { dsspSummary } from './lib/dssp.js';
import { KYTE_DOOLITTLE, MAX_ASA } from './lib/residues.js';
import { elementInfo } from './lib/elements.js';

const els = {
  app: document.querySelector('#app'),
  canvas: document.querySelector('#viewport'),
  labelLayer: document.querySelector('#label-layer'),
  loading: document.querySelector('#loading'),
  loadingStatus: document.querySelector('#loading-status'),
  leftToggle: document.querySelector('#left-toggle'),
  rightToggle: document.querySelector('#right-toggle'),
  title: document.querySelector('#structure-title'),
  subtitle: document.querySelector('#structure-subtitle'),
  gpuBadge: document.querySelector('#gpu-badge'),
  searchInput: document.querySelector('#search-input'),
  searchResults: document.querySelector('#search-results'),
  fetchForm: document.querySelector('#fetch-form'),
  fetchInput: document.querySelector('#fetch-input'),
  sampleSelect: document.querySelector('#sample-select'),
  fileInput: document.querySelector('#file-input'),
  addMode: document.querySelector('#add-mode'),
  structuresGroup: document.querySelector('#structures-group'),
  structureList: document.querySelector('#structure-list'),
  structureCount: document.querySelector('#structure-count'),
  styleScope: document.querySelector('#style-scope'),
  compareHint: document.querySelector('#compare-hint'),
  compareControls: document.querySelector('#compare-controls'),
  compareReference: document.querySelector('#compare-reference'),
  compareMobile: document.querySelector('#compare-mobile'),
  compareRefChain: document.querySelector('#compare-ref-chain'),
  compareMobChain: document.querySelector('#compare-mob-chain'),
  compareFitSelection: document.querySelector('#compare-fit-selection'),
  compareRun: document.querySelector('#compare-run'),
  compareReset: document.querySelector('#compare-reset'),
  compareAlphaFold: document.querySelector('#compare-alphafold'),
  compareModels: document.querySelector('#compare-models'),
  compareResult: document.querySelector('#compare-result'),
  chainsTitle: document.querySelector('#chains-title'),
  metaMethod: document.querySelector('#meta-method'),
  metaResolution: document.querySelector('#meta-resolution'),
  metaRFree: document.querySelector('#meta-rfree'),
  metaEntry: document.querySelector('#meta-entry'),
  metaOrganism: document.querySelector('#meta-organism'),
  metaFormat: document.querySelector('#meta-format'),
  metaDate: document.querySelector('#meta-date'),
  metaAssembly: document.querySelector('#meta-assembly'),
  confidenceSummary: document.querySelector('#confidence-summary'),
  assemblyField: document.querySelector('#assembly-field'),
  assemblySelect: document.querySelector('#assembly-select'),
  atomsLabel: document.querySelector('#metric-atoms-label'),
  atomsMetric: document.querySelector('#metric-atoms'),
  residuesMetric: document.querySelector('#metric-residues'),
  chainsMetric: document.querySelector('#metric-chains'),
  modelsMetric: document.querySelector('#metric-models'),
  entityList: document.querySelector('#entity-list'),
  ssSummary: document.querySelector('#ss-summary'),
  polymerRep: document.querySelector('#polymer-rep'),
  ligandRep: document.querySelector('#ligand-rep'),
  sidechainMode: document.querySelector('#sidechain-mode'),
  showWater: document.querySelector('#show-water'),
  showHydrogen: document.querySelector('#show-hydrogen'),
  surfaceKind: document.querySelector('#surface-kind'),
  surfaceColor: document.querySelector('#surface-color'),
  surfaceOpacity: document.querySelector('#surface-opacity'),
  surfaceOpacityValue: document.querySelector('#surface-opacity-value'),
  surfaceStatus: document.querySelector('#surface-status'),
  colorScheme: document.querySelector('#color-scheme'),
  chainPalette: document.querySelector('#chain-palette'),
  paletteField: document.querySelector('#palette-field'),
  colormap: document.querySelector('#colormap'),
  colormapField: document.querySelector('#colormap-field'),
  uniformColor: document.querySelector('#uniform-color'),
  uniformField: document.querySelector('#uniform-field'),
  heteroElement: document.querySelector('#hetero-element'),
  chainList: document.querySelector('#chain-list'),
  chainsAll: document.querySelector('#chains-all'),
  chainsInvert: document.querySelector('#chains-invert'),
  selectionTitle: document.querySelector('#selection-title'),
  selectionHint: document.querySelector('#selection-hint'),
  selectionDetails: document.querySelector('#selection-details'),
  selectionClear: document.querySelector('#selection-clear'),
  focusSelection: document.querySelector('#focus-selection'),
  labelSelection: document.querySelector('#label-selection'),
  isolateSelection: document.querySelector('#isolate-selection'),
  interactionsCard: document.querySelector('#interactions-card'),
  interactionCount: document.querySelector('#interaction-count'),
  interactionSummary: document.querySelector('#interaction-summary'),
  interactionList: document.querySelector('#interaction-list'),
  interactionTypes: document.querySelector('#interaction-types'),
  interfaceA: document.querySelector('#interface-a'),
  interfaceB: document.querySelector('#interface-b'),
  interfaceRun: document.querySelector('#interface-run'),
  interfaceResult: document.querySelector('#interface-result'),
  interactionsClear: document.querySelector('#interactions-clear'),
  interactionsExport: document.querySelector('#interactions-export'),
  measureClear: document.querySelector('#measure-clear'),
  measurementList: document.querySelector('#measurement-list'),
  sasaRun: document.querySelector('#sasa-run'),
  sasaColor: document.querySelector('#sasa-color'),
  sasaResult: document.querySelector('#sasa-result'),
  ramaChain: document.querySelector('#rama-chain'),
  ramaCanvas: document.querySelector('#rama-canvas'),
  ramaSummary: document.querySelector('#rama-summary'),
  profileChain: document.querySelector('#profile-chain'),
  profileMetric: document.querySelector('#profile-metric'),
  profileCanvas: document.querySelector('#profile-canvas'),
  paeCanvas: document.querySelector('#pae-canvas'),
  paeHint: document.querySelector('#pae-hint'),
  paeSummary: document.querySelector('#pae-summary'),
  uniprotChain: document.querySelector('#uniprot-chain'),
  uniprotLoad: document.querySelector('#uniprot-load'),
  uniprotResult: document.querySelector('#uniprot-result'),
  protparamChain: document.querySelector('#protparam-chain'),
  protparam: document.querySelector('#protparam'),
  peptideInput: document.querySelector('#peptide-input'),
  peptideIL: document.querySelector('#peptide-il'),
  peptideMap: document.querySelector('#peptide-map'),
  peptideResult: document.querySelector('#peptide-result'),
  digestEnzyme: document.querySelector('#digest-enzyme'),
  digestMissed: document.querySelector('#digest-missed'),
  digestRun: document.querySelector('#digest-run'),
  siteInput: document.querySelector('#site-input'),
  siteNumbering: document.querySelector('#site-numbering'),
  siteMap: document.querySelector('#site-map'),
  siteResult: document.querySelector('#site-result'),
  xlInput: document.querySelector('#xl-input'),
  xlCrosslinker: document.querySelector('#xl-crosslinker'),
  xlMax: document.querySelector('#xl-max'),
  xlMap: document.querySelector('#xl-map'),
  xlResult: document.querySelector('#xl-result'),
  dataInput: document.querySelector('#data-input'),
  dataColormap: document.querySelector('#data-colormap'),
  dataSymmetric: document.querySelector('#data-symmetric'),
  dataApply: document.querySelector('#data-apply'),
  dataResult: document.querySelector('#data-result'),
  legend: document.querySelector('#legend'),
  modeBanner: document.querySelector('#mode-banner'),
  modelStrip: document.querySelector('#model-strip'),
  modelSlider: document.querySelector('#model-slider'),
  modelLabel: document.querySelector('#model-label'),
  modelPlay: document.querySelector('#model-play'),
  sequencePanel: document.querySelector('#sequence-panel'),
  sequenceToggle: document.querySelector('#sequence-toggle'),
  sequenceChain: document.querySelector('#sequence-chain'),
  sequencePartner: document.querySelector('#sequence-partner'),
  sequenceInfo: document.querySelector('#sequence-info'),
  sequenceTrack: document.querySelector('#sequence-track'),
  tooltip: document.querySelector('#tooltip'),
  toast: document.querySelector('#toast'),
  dropOverlay: document.querySelector('#drop-overlay'),
  resetView: document.querySelector('#reset-view'),
  focusButton: document.querySelector('#focus-button'),
  spinToggle: document.querySelector('#spin-toggle'),
  screenshot: document.querySelector('#screenshot'),
  fullscreen: document.querySelector('#fullscreen'),
  helpButton: document.querySelector('#help-button'),
  exportDialog: document.querySelector('#export-dialog'),
  exportSize: document.querySelector('#export-size'),
  exportSupersample: document.querySelector('#export-supersample'),
  exportTransparent: document.querySelector('#export-transparent'),
  exportLegend: document.querySelector('#export-legend'),
  exportLabels: document.querySelector('#export-labels'),
  exportInfo: document.querySelector('#export-info'),
  exportConfirm: document.querySelector('#export-confirm'),
  exportCopy: document.querySelector('#export-copy'),
  exportMovie: document.querySelector('#export-movie'),
  helpDialog: document.querySelector('#help-dialog'),
};

const LIGHTING_PRESETS = {
  standard: { ambient: 0.42, diffuse: 0.62, specular: 0.22, shininess: 36, ao: 0.75, aoRadius: 5, outline: 0, fog: 0.45, glow: 0, flat: false },
  soft: { ambient: 0.66, diffuse: 0.4, specular: 0.06, shininess: 18, ao: 1, aoRadius: 7, outline: 0, fog: 0.35, glow: 0, flat: false },
  illustrative: { ambient: 1, diffuse: 0, specular: 0, shininess: 10, ao: 0.85, aoRadius: 6, outline: 0.9, fog: 0.15, glow: 0, flat: true },
  glossy: { ambient: 0.34, diffuse: 0.7, specular: 0.6, shininess: 72, ao: 0.6, aoRadius: 5, outline: 0, fog: 0.4, glow: 0, flat: false },
  neon: { ambient: 0.5, diffuse: 0.52, specular: 0.3, shininess: 40, ao: 0.35, aoRadius: 4, outline: 0, fog: 0.55, glow: 0.45, flat: false },
  flat: { ambient: 1, diffuse: 0, specular: 0, shininess: 10, ao: 0, aoRadius: 5, outline: 0.7, fog: 0, glow: 0, flat: true },
};

const DEFAULT_SPIN_RATE = 0.25;

const REPRESENTATION_PRESETS = {
  cartoon: { polymer: 'cartoon', ligand: 'ball-stick', surface: 'off' },
  'ball-stick': { polymer: 'ball-stick', ligand: 'ball-stick', surface: 'off' },
  sticks: { polymer: 'sticks', ligand: 'sticks', surface: 'off' },
  spacefill: { polymer: 'spacefill', ligand: 'spacefill', surface: 'off' },
  trace: { polymer: 'trace', ligand: 'ball-stick', surface: 'off' },
  surface: { polymer: 'cartoon', ligand: 'ball-stick', surface: 'ses' },
};

const INTERACTION_FALLBACK_TYPES = [
  { id: 'hydrogen-bond', label: 'H-bond', color: '#3fa7ff' },
  { id: 'salt-bridge', label: 'Salt bridge', color: '#ff5fa2' },
  { id: 'pi-stacking', label: 'π-stacking', color: '#39d98a' },
  { id: 'cation-pi', label: 'Cation-π', color: '#ffb347' },
  { id: 'hydrophobic', label: 'Hydrophobic', color: '#9aa3ad' },
  { id: 'halogen-bond', label: 'Halogen bond', color: '#40e0d0' },
  { id: 'metal-coordination', label: 'Metal', color: '#b388ff' },
  { id: 'water-bridge', label: 'Water bridge', color: '#7ec8ff' },
];

const DEFAULT_DISPLAY = {
  polymer: 'cartoon',
  ligand: 'ball-stick',
  sidechains: 'focus',
  showWater: false,
  showHydrogen: false,
  atomScale: 1,
  bondScale: 1,
  cartoonWidth: 1,
  cartoonQuality: 6,
  visibleChains: null,
  residueFilter: null,
  residueFilterKey: '',
};

// Colors that tell structures apart in the "Structure" scheme and the structures list.
const STRUCTURE_COLORS = ['#5aa9f0', '#f39c3d', '#5fd08e', '#e8659c', '#a78bfa', '#e8d44d', '#4fd1d9', '#c98b5c'].map(hexColor);
const MAX_OVERLAY_MODELS = 60;
const COMPARISON_SCHEMES = new Set(['deviation', 'lddt', 'rmsf']);
const DATA_SCHEMES = new Set(['coverage', 'data', 'exposure', 'deviation', 'lddt', 'rmsf']);

// Everything that belongs to one loaded structure. `state.structure`, `state.display`,
// `state.selection` and the other per-structure fields below read and write the active entry.
function emptyProteomics() {
  return { coverage: null, data: null, dataLabel: '', sites: [], siteOverrides: null, crosslinks: [] };
}

function entryDefaults() {
  return {
    structure: null,
    sourceLabel: '',
    activeModel: 0,
    display: { ...DEFAULT_DISPLAY },
    color: { scheme: 'chain', palette: 'vivid', colormap: '', uniformColor: '#b8c4d0', heteroByElement: true },
    surface: { kind: 'off', color: 'scheme', opacity: 1, key: '', pending: 0, data: null },
    selection: new Set(),
    selectedAtom: null,
    focus: null,
    labels: new Set(),
    sasa: null,
    proteomics: emptyProteomics(),
    pae: null,
    paeSelection: null,
  };
}

const ENTRY_FIELDS = Object.keys(entryDefaults());

const state = {
  samples: [],
  startup: null,
  entries: [],
  active: null,
  nextEntryId: 1,
  defaults: entryDefaults(),
  styleScope: 'all',
  lighting: { preset: 'standard', ...LIGHTING_PRESETS.standard },
  background: 'dark',
  clip: { near: 0, far: 1 },
  secondaryMode: 'auto',
  camera: createCamera(),
  cameraAnimation: null,
  spin: false,
  hover: { atom: -1, residueKey: null, entry: null },
  measureMode: null,
  measurePending: [],
  measurements: [],
  interactionEnabled: new Set(INTERACTION_FALLBACK_TYPES.map((type) => type.id)),
  interactionTypes: INTERACTION_FALLBACK_TYPES,
  atomColors: null,
  atomFlags: null,
  parts: [],
  partByModel: new Map(),
  atomTotal: 0,
  sceneBounds: null,
  meshSources: new Map(),
  correspondences: new Map(),
  dirty: { scene: true, colors: true, flags: true, render: true, surface: false, panels: true },
  pointers: new Map(),
  drag: null,
  modelTimer: null,
  lastHoverPick: 0,
  pickPending: false,
  renderer: null,
  workers: null,
};

for (const field of ENTRY_FIELDS) {
  Object.defineProperty(state, field, {
    enumerable: true,
    get() {
      return (state.active ?? state.defaults)[field];
    },
    set(value) {
      (state.active ?? state.defaults)[field] = value;
    },
  });
}

// Interaction lists belong to the active structure; the enabled types are shared.
Object.defineProperty(state, 'interactions', {
  enumerable: true,
  get() {
    const entry = state.active;
    return { list: entry?.interactions.list ?? [], title: entry?.interactions.title ?? '', enabled: state.interactionEnabled };
  },
  set(value) {
    if (value.enabled) state.interactionEnabled = value.enabled;
    if (state.active) state.active.interactions = { list: value.list ?? [], title: value.title ?? '' };
  },
});

let sequenceView = null;
let ramaPoints = null;
let profilePoints = null;
let paeLayout = null;
let lazyModules = {};

if (!globalThis.__PROTEOSCOPE_TEST__) {
  init().catch((error) => {
    console.error(error);
    showLoadingError(error.message);
  });
}

async function init() {
  if (window.innerWidth <= 900) els.app.classList.remove('left-open', 'right-open');
  if (window.innerWidth <= 600) els.app.classList.remove('sequence-open');
  setLoading('Starting renderer');
  await initRenderer();
  populateStaticControls();
  bindEvents();
  sequenceView = createSequenceView(els.sequenceTrack, {
    onHover: (key) => setHoverResidue(key, true),
    onSelect: (keys, options) => selectResidues(keys, options),
    onFocus: (key) => focusResidues([key]),
  });
  requestAnimationFrame(frame);

  setLoading('Loading bundled structures');
  const [manifest, startup] = await Promise.all([
    fetch('/api/samples').then((response) => response.json()).catch(() => ({ samples: [] })),
    fetch('/api/startup').then((response) => (response.ok ? response.json() : null)).catch(() => null),
  ]);
  state.samples = manifest.samples ?? [];
  state.startup = startup;
  populateSamples();

  const hashRequest = new URLSearchParams(location.hash.slice(1));
  const fetchRequest = hashRequest.get('fetch') || hashRequest.get('pdb') || hashRequest.get('af') || hashRequest.get('uniprot');
  if (startup?.files?.length) {
    await guardedLoad(async () => {
      await loadStructureFromURL(startup.files[0].url, startup.files[0].name);
      for (const file of startup.files.slice(1)) await loadStructureFromURL(file.url, file.name, { add: true });
      if (startup.files.length > 1) setActiveEntry(state.entries[0]);
    });
  } else if (fetchRequest) {
    // #fetch=4AKE,1AKE loads several entries; adding &superpose fits the others onto the first.
    const ids = fetchRequest.split(',').map((id) => id.trim()).filter(Boolean);
    await fetchStructure(ids[0]);
    for (const id of ids.slice(1)) await fetchStructure(id, { add: true });
    if (state.entries.length > 1) {
      setActiveEntry(state.entries[0]);
      if (hashRequest.has('superpose')) runSuperposition({ reference: state.entries[0], mobiles: state.entries.slice(1) });
    }
  } else {
    const preferred = state.samples.find((sample) => sample.id.startsWith('1m17')) ?? state.samples[0];
    if (!preferred) throw new Error('No embedded structure files were found.');
    els.sampleSelect.value = preferred.id;
    await loadStructureFromURL(preferred.url, preferred.name);
  }
  hideLoading();
}

async function initRenderer() {
  try {
    if (new URLSearchParams(location.search).get('renderer') === 'canvas') throw new Error('Canvas renderer requested');
    state.renderer = await withTimeout(createRenderer(els.canvas, {
      onDeviceLost: (info) => showToast(`The GPU device was lost (${info?.message || 'unknown reason'}). Reload the page to continue.`, true),
    }), 5000, 'WebGPU initialization timed out');
    els.gpuBadge.textContent = 'WebGPU';
    els.gpuBadge.title = `WebGPU · ${state.renderer.label}`;
  } catch (error) {
    console.warn('WebGPU unavailable, using canvas preview:', error);
    state.renderer = createCanvasRenderer(els.canvas);
    els.gpuBadge.textContent = 'Canvas preview';
    els.gpuBadge.classList.add('is-fallback');
    els.gpuBadge.title = 'WebGPU is not available in this browser, so Proteoscope uses a simplified compatibility renderer without surfaces, ambient occlusion or outlines. Use a current Chrome, Edge, Safari 26+ or Firefox 141+ (Windows) for full quality.';
  }
}

function populateStaticControls() {
  const groups = new Map();
  for (const scheme of COLOR_SCHEMES) {
    if (!groups.has(scheme.group)) {
      const group = document.createElement('optgroup');
      group.label = scheme.group;
      groups.set(scheme.group, group);
      els.colorScheme.appendChild(group);
    }
    const option = document.createElement('option');
    option.value = scheme.id;
    option.textContent = scheme.label;
    groups.get(scheme.group).appendChild(option);
  }
  els.colorScheme.value = state.color.scheme;
  for (const [id, palette] of Object.entries(CHAIN_PALETTES)) {
    els.chainPalette.appendChild(new Option(palette.label, id));
  }
  for (const select of [els.colormap, els.dataColormap]) {
    if (select === els.colormap) select.appendChild(new Option('Default', ''));
    for (const [id, map] of Object.entries(COLORMAPS)) select.appendChild(new Option(map.label, id));
  }
  els.dataColormap.value = 'viridis';
  renderInteractionTypeToggles();
  syncControlOutputs();
}

function bindEvents() {
  window.addEventListener('resize', () => {
    updateViewOffset();
    requestRender();
  });
  window.addEventListener('keydown', onKeyDown);
  els.leftToggle.addEventListener('click', () => togglePanel('left-open'));
  els.rightToggle.addEventListener('click', () => togglePanel('right-open'));
  els.sequenceToggle.addEventListener('click', () => {
    togglePanel('sequence-open');
    els.sequenceToggle.setAttribute('aria-expanded', String(els.app.classList.contains('sequence-open')));
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  els.fetchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = els.fetchInput.value.trim();
    if (query) await fetchStructure(query);
  });
  document.querySelectorAll('[data-fetch]').forEach((button) => {
    button.addEventListener('click', () => {
      els.fetchInput.value = button.dataset.fetch;
      fetchStructure(button.dataset.fetch);
    });
  });
  els.sampleSelect.addEventListener('change', async () => {
    const sample = state.samples.find((item) => item.id === els.sampleSelect.value);
    if (!sample) return;
    history.replaceState(null, '', location.pathname + location.search);
    await guardedLoad(() => loadStructureFromURL(sample.url, sample.name, { add: els.addMode.checked }));
  });
  els.fileInput.addEventListener('change', async () => {
    const files = [...(els.fileInput.files ?? [])];
    els.fileInput.value = '';
    await openFiles(files);
  });
  els.assemblySelect.addEventListener('change', () => activateAssembly(els.assemblySelect.value));
  document.querySelectorAll('[data-ss-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveButton('[data-ss-mode]', button);
      state.secondaryMode = button.dataset.ssMode;
      reassignSecondary();
    });
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => applyRepresentationPreset(button.dataset.preset));
  });
  els.polymerRep.addEventListener('change', () => updateDisplay({ polymer: els.polymerRep.value }));
  els.ligandRep.addEventListener('change', () => updateDisplay({ ligand: els.ligandRep.value }));
  els.sidechainMode.addEventListener('change', () => updateDisplay({ sidechains: els.sidechainMode.value }));
  els.showWater.addEventListener('change', () => updateDisplay({ showWater: els.showWater.checked }));
  els.showHydrogen.addEventListener('change', () => updateDisplay({ showHydrogen: els.showHydrogen.checked }));
  for (const [input, key] of [
    [document.querySelector('#atom-scale'), 'atomScale'],
    [document.querySelector('#bond-scale'), 'bondScale'],
    [document.querySelector('#cartoon-width'), 'cartoonWidth'],
    [document.querySelector('#cartoon-quality'), 'cartoonQuality'],
  ]) {
    input.addEventListener('input', () => {
      updateDisplay({ [key]: Number(input.value) });
      syncControlOutputs();
    });
  }

  els.surfaceKind.addEventListener('change', () => {
    for (const entry of styleTargets()) entry.surface.kind = els.surfaceKind.value;
    refreshSurface();
  });
  els.surfaceColor.addEventListener('change', () => {
    for (const entry of styleTargets()) {
      entry.surface.color = els.surfaceColor.value;
      if (entry.id) applySurfaceColors(entry);
    }
  });
  els.surfaceOpacity.addEventListener('input', () => {
    const opacity = Number(els.surfaceOpacity.value);
    els.surfaceOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
    for (const entry of styleTargets()) {
      entry.surface.opacity = opacity;
      if (entry.id) state.renderer.setMeshOpacity(`surface:${entry.id}`, opacity);
    }
    requestRender();
  });
  document.querySelectorAll('[data-style-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      state.styleScope = button.dataset.styleScope;
      renderStyleScope();
    });
  });

  els.colorScheme.addEventListener('change', () => setColorScheme(els.colorScheme.value));
  els.chainPalette.addEventListener('change', () => {
    for (const entry of styleTargets()) entry.color.palette = els.chainPalette.value;
    markColorsDirty();
    renderChains();
  });
  els.colormap.addEventListener('change', () => {
    for (const entry of styleTargets()) entry.color.colormap = els.colormap.value;
    markColorsDirty();
  });
  els.uniformColor.addEventListener('input', () => {
    for (const entry of styleTargets()) entry.color.uniformColor = els.uniformColor.value;
    markColorsDirty();
  });
  els.heteroElement.addEventListener('change', () => {
    for (const entry of styleTargets()) entry.color.heteroByElement = els.heteroElement.checked;
    markColorsDirty();
  });

  document.querySelectorAll('[data-lighting]').forEach((button) => {
    button.addEventListener('click', () => applyLightingPreset(button.dataset.lighting));
  });
  for (const [id, key] of [
    ['ao-strength', 'ao'],
    ['outline-strength', 'outline'],
    ['fog-strength', 'fog'],
    ['glow-scale', 'glow'],
    ['specular', 'specular'],
    ['ao-radius', 'aoRadius'],
  ]) {
    const input = document.querySelector(`#${id}`);
    input.addEventListener('input', () => {
      state.lighting[key] = Number(input.value);
      syncControlOutputs();
      requestRender();
    });
  }
  document.querySelectorAll('[data-background]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveButton('[data-background]', button);
      state.background = button.dataset.background;
      requestRender();
    });
  });
  document.querySelectorAll('[data-projection]').forEach((button) => {
    button.addEventListener('click', () => setProjection(button.dataset.projection === 'orthographic'));
  });
  for (const [id, key] of [['clip-near', 'near'], ['clip-far', 'far']]) {
    const input = document.querySelector(`#${id}`);
    input.addEventListener('input', () => {
      state.clip[key] = Number(input.value);
      if (state.clip.near > state.clip.far - 0.02) {
        if (key === 'near') state.clip.far = Math.min(1, state.clip.near + 0.02);
        else state.clip.near = Math.max(0, state.clip.far - 0.02);
        document.querySelector('#clip-near').value = String(state.clip.near);
        document.querySelector('#clip-far').value = String(state.clip.far);
      }
      syncControlOutputs();
      requestRender();
    });
  }

  els.searchInput.addEventListener('input', renderSearch);
  els.searchInput.addEventListener('keydown', onSearchKey);
  els.searchInput.addEventListener('blur', () => setTimeout(() => els.searchResults.classList.remove('is-visible'), 150));
  els.chainsAll.addEventListener('click', () => setVisibleChains(null));
  els.chainsInvert.addEventListener('click', invertChains);
  els.selectionClear.addEventListener('click', () => clearSelection(true));
  els.focusSelection.addEventListener('click', () => focusResidues([...state.selection]));
  els.focusButton.addEventListener('click', () => focusResidues([...state.selection]));
  els.labelSelection.addEventListener('click', toggleSelectionLabels);
  els.isolateSelection.addEventListener('click', isolateSelectionChains);
  els.measureClear.addEventListener('click', clearMeasurements);
  document.querySelectorAll('[data-measure]').forEach((button) => {
    button.addEventListener('click', () => setMeasureMode(state.measureMode === button.dataset.measure ? null : button.dataset.measure));
  });
  els.resetView.addEventListener('click', () => resetView(true));
  els.spinToggle.addEventListener('click', () => setSpin(!state.spin));
  els.screenshot.addEventListener('click', openExportDialog);
  els.fullscreen.addEventListener('click', toggleFullscreen);
  els.helpButton.addEventListener('click', () => els.helpDialog.showModal());
  els.exportConfirm.addEventListener('click', (event) => {
    event.preventDefault();
    exportImage('download');
  });
  els.exportCopy.addEventListener('click', () => exportImage('clipboard'));
  els.exportMovie.addEventListener('click', recordSpinMovie);
  els.exportSize.addEventListener('change', updateExportInfo);
  els.exportSupersample.addEventListener('change', updateExportInfo);

  els.modelSlider.addEventListener('input', () => setActiveModel(Number(els.modelSlider.value) - 1));
  els.modelPlay.addEventListener('click', toggleModelPlayback);
  els.sequenceChain.addEventListener('change', renderSequence);
  els.sequencePartner.addEventListener('change', () => {
    state.sequencePartnerChoice = els.sequencePartner.value;
    renderSequence();
  });

  els.compareReference.addEventListener('change', () => populateCompareChains());
  els.compareMobile.addEventListener('change', () => populateCompareChains());
  els.compareRun.addEventListener('click', () => runSuperposition());
  els.compareReset.addEventListener('click', resetComparedPositions);
  els.compareAlphaFold.addEventListener('click', compareWithAlphaFold);
  els.compareModels.addEventListener('click', toggleModelOverlay);
  els.compareResult.addEventListener('click', (event) => {
    const action = event.target.closest('[data-compare-action]')?.dataset.compareAction;
    if (action) runCompareAction(action);
  });

  els.interfaceRun.addEventListener('click', runInterfaceAnalysis);
  els.interactionsClear.addEventListener('click', () => {
    state.interactions = { ...state.interactions, list: [], title: '' };
    renderInteractions();
    markSceneDirty();
  });
  els.interactionsExport.addEventListener('click', exportInteractionsCSV);
  els.sasaRun.addEventListener('click', runSASA);
  els.sasaColor.addEventListener('click', () => setColorScheme('exposure', [state.active]));
  els.ramaChain.addEventListener('change', renderRamachandran);
  els.ramaCanvas.addEventListener('click', onRamaClick);
  els.profileChain.addEventListener('change', renderProfile);
  els.profileMetric.addEventListener('change', renderProfile);
  els.profileCanvas.addEventListener('click', onProfileClick);
  bindPAEEvents();

  els.protparamChain.addEventListener('change', renderProtParam);
  els.uniprotLoad.addEventListener('click', loadUniProtFeatures);
  els.peptideMap.addEventListener('click', mapPeptidesFromInput);
  els.digestRun.addEventListener('click', runDigest);
  els.siteMap.addEventListener('click', mapSitesFromInput);
  els.xlMap.addEventListener('click', mapCrosslinksFromInput);
  els.xlCrosslinker.addEventListener('change', () => {
    const preset = lazyModules.proteomics?.CROSSLINKERS?.find((item) => item.id === els.xlCrosslinker.value);
    if (preset?.maxCaCa) els.xlMax.value = String(preset.maxCaCa);
  });
  els.dataApply.addEventListener('click', applyResidueDataFromInput);

  els.canvas.addEventListener('pointerdown', onPointerDown);
  els.canvas.addEventListener('pointermove', onPointerMove);
  els.canvas.addEventListener('pointerup', onPointerUp);
  els.canvas.addEventListener('pointercancel', onPointerUp);
  els.canvas.addEventListener('pointerleave', () => {
    if (!state.drag) setHoverAtom(-1);
    els.tooltip.classList.remove('is-visible');
  });
  els.canvas.addEventListener('dblclick', onDoubleClick);
  els.legend.addEventListener('click', (event) => {
    if (!event.target.closest('h4') && !state.legendCollapsed) return;
    state.legendCollapsed = !state.legendCollapsed;
    renderLegend();
  });
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
  els.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  for (const type of ['dragenter', 'dragover']) {
    window.addEventListener(type, (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      els.dropOverlay.hidden = false;
    });
  }
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) els.dropOverlay.hidden = true;
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    els.dropOverlay.hidden = true;
    await openFiles([...(event.dataTransfer?.files ?? [])]);
  });
}

/* ---------- Loading ---------- */

async function guardedLoad(task) {
  try {
    await task();
  } catch (error) {
    console.error(error);
    hideLoading();
    showToast(error.message || String(error), true);
  }
}

async function fetchStructure(query, options = {}) {
  const request = normalizeFetchQuery(query);
  if (!request) {
    showToast(`"${query}" is not a PDB ID (e.g. 4HHB) or UniProt accession (e.g. P69905).`, true);
    return null;
  }
  let entry = null;
  await guardedLoad(async () => {
    showLoading(`Fetching ${request.label}`);
    const response = await fetch(request.url);
    if (!response.ok) {
      let message = `Could not fetch ${request.label} (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (body.error) message = body.error;
      } catch {
        // Non-JSON error body.
      }
      throw new Error(message);
    }
    const text = await response.text();
    const filename = response.headers.get('X-Proteoscope-Filename') || request.filename;
    const add = options.add ?? els.addMode.checked;
    entry = await loadStructureFromText(text, filename, { source: request.label, add, activate: options.activate });
    entry.fetchId = request.id;
    applyRemoteMetadata(response.headers.get('X-Proteoscope-Meta-B64'), entry);
    els.sampleSelect.value = '';
    updateLocationHash();
    const paeURL = response.headers.get('X-Proteoscope-Pae');
    if (paeURL) loadPAEFromURL(paeURL, entry);
  });
  return entry;
}

// Keeps a shareable #fetch=ID,ID[&superpose] link while every structure came from a fetch.
function updateLocationHash() {
  const ids = state.entries.map((entry) => entry.fetchId);
  if (!ids.length || ids.some((id) => !id)) {
    if (location.hash.includes('fetch=')) history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  const superposed = state.entries.some((entry) => entry.comparison && entry.comparison.referenceId === state.entries[0].id);
  history.replaceState(null, '', `#fetch=${ids.map(encodeURIComponent).join(',')}${superposed ? '&superpose' : ''}`);
}

function applyRemoteMetadata(encoded, entry = state.active) {
  if (!encoded || !entry) return;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const meta = JSON.parse(new TextDecoder().decode(bytes));
    const structureMeta = entry.structure.meta;
    if (meta.uniprotDescription) {
      structureMeta.title = `${meta.entryId || structureMeta.code}: ${meta.uniprotDescription}${meta.gene ? ` (${meta.gene})` : ''}`;
    }
    if (meta.organismScientificName) structureMeta.organism = meta.organismScientificName;
    if (!structureMeta.method) structureMeta.method = `AlphaFold DB v${meta.latestVersion ?? ''} prediction`.replace(' v prediction', ' prediction');
    if (entry === state.active) updateStructureUI();
    else renderStructureList();
  } catch (error) {
    console.warn('Could not decode remote metadata', error);
  }
}

function normalizeFetchQuery(query) {
  const clean = String(query || '').trim();
  const afMatch = clean.match(/^AF-([A-Z0-9-]+?)-F\d+/i);
  const accession = (afMatch ? afMatch[1] : clean).toUpperCase();
  if (/^[0-9][A-Z0-9]{3}$/i.test(clean)) {
    const id = clean.toUpperCase();
    return { id, label: `PDB ${id}`, url: `/api/fetch/pdb/${id}`, filename: `${id}.cif` };
  }
  if (/^pdb_[0-9a-z]{8}$/i.test(clean)) {
    const id = clean.toLowerCase();
    return { id, label: `PDB ${id}`, url: `/api/fetch/pdb/${id}`, filename: `${id}.cif` };
  }
  if (/^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/.test(accession)) {
    return { id: accession, label: `AlphaFold ${accession}`, url: `/api/fetch/afdb/${accession}`, filename: `AF-${accession}-F1.cif` };
  }
  return null;
}

async function openFiles(files) {
  const structures = files.filter((file) => !/\.json$/i.test(file.name));
  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));
  await guardedLoad(async () => {
    let first = null;
    for (const [index, file] of structures.entries()) {
      showLoading(`Reading ${file.name}`);
      const text = await readFileText(file);
      const entry = await loadStructureFromText(text, file.name.replace(/\.gz$/i, ''), { source: 'Local file', add: index > 0 || els.addMode.checked });
      first ??= entry;
    }
    if (structures.length) {
      els.sampleSelect.value = '';
      history.replaceState(null, '', location.pathname);
      if (structures.length > 1) {
        setActiveEntry(first);
        showToast(`Opened ${structures.length} structures. Superpose them in the Analysis tab.`);
      }
    }
    for (const file of jsonFiles) {
      const text = await readFileText(file);
      loadPAEFromJSON(JSON.parse(text), file.name);
    }
  });
}

async function readFileText(file) {
  if (/\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress .gz files. Please decompress the file first.');
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return file.text();
}

async function loadStructureFromURL(url, label, options = {}) {
  showLoading(`Loading ${label}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  const text = await response.text();
  const filename = response.headers.get('X-Proteoscope-Filename') || url.split('/').pop() || label;
  return loadStructureFromText(text, filename, { source: label, ...options });
}

// Parses and derives a structure, then either replaces the scene or adds it as another entry.
async function loadStructureFromText(text, label, options = {}) {
  showLoading(`Parsing ${label}`);
  await nextFrame();
  const structure = parseStructure(text, label);
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  showLoading('Deriving residues, bonds and secondary structure');
  await nextFrame();
  deriveStructure(structure, { secondaryMode: state.secondaryMode });
  const add = Boolean(options.add) && state.entries.length > 0;
  // A new structure inherits the current style, including when it replaces the scene.
  const template = state.active ?? state.defaults;
  if (!add) removeAllEntries();
  const entry = createEntry(structure, options.source || '', template);
  state.entries.push(entry);
  if (add && entry.color.scheme === 'chain') {
    // Chain colors repeat between entries, so a multi-structure scene starts colored by structure.
    for (const item of state.entries) if (item.color.scheme === 'chain') item.color.scheme = 'structure';
  }
  const activate = options.activate ?? true;
  if (activate || !state.active) {
    setActiveEntry(entry, { silent: true });
    state.legendCollapsed = structure.chains.filter((chain) => chain.polymerKind).length > 8;
    resetPanels();
  }
  updateStructureUI();
  fitView(add, !add);
  markSceneDirty();
  refreshSurface(entry);
  hideLoading();
  return entry;
}

function createEntry(structure, sourceLabel, template = state.active ?? state.defaults) {
  const color = { ...template.color };
  const first = !state.entries.length;
  if (DATA_SCHEMES.has(color.scheme) || (color.scheme === 'uniform' && !first)) color.scheme = 'chain';
  if (color.scheme === 'structure' && first) color.scheme = 'chain';
  if (structure.meta.isPredicted && color.scheme === 'chain') color.scheme = 'plddt';
  else if (!structure.meta.isPredicted && color.scheme === 'plddt') color.scheme = first ? 'chain' : 'structure';
  const used = new Set(state.entries.map((entry) => entry.colorIndex));
  let colorIndex = 0;
  while (used.has(colorIndex)) colorIndex += 1;
  return {
    ...entryDefaults(),
    id: state.nextEntryId++,
    name: uniqueEntryName(structure),
    structure,
    sourceLabel,
    visible: true,
    display: { ...template.display, visibleChains: null, residueFilter: null, residueFilterKey: '' },
    color,
    surface: { kind: template.surface.kind, color: template.surface.color, opacity: template.surface.opacity, key: '', pending: 0, data: null },
    interactions: { list: [], title: '' },
    transform: null,
    transformVersion: 0,
    comparison: null,
    overlay: false,
    rmsf: null,
    colorIndex,
    legend: null,
    surfaceLegend: null,
  };
}

function uniqueEntryName(structure) {
  const base = structure.meta.code || String(structure.label || 'structure').replace(/\.(cif|mmcif|pdb|ent)$/i, '');
  const names = new Set(state.entries.map((entry) => entry.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

function entryColor(entry) {
  return STRUCTURE_COLORS[entry.colorIndex % STRUCTURE_COLORS.length];
}

function entryById(id) {
  return state.entries.find((entry) => String(entry.id) === String(id)) ?? null;
}

function setActiveEntry(entry, options = {}) {
  if (!entry || state.active === entry) return;
  stopModelPlayback();
  state.active = entry;
  state.hover = { atom: -1, residueKey: null, entry: null };
  syncStyleControls();
  if (options.silent) return;
  resetPanels();
  updateStructureUI();
  // Aligned residues of the other structures mirror the new active structure's focus.
  markSceneDirty();
}

function removeEntry(entry) {
  if (!entry || state.entries.length < 2) return;
  state.entries = state.entries.filter((item) => item !== entry);
  releaseEntryMeshes(entry);
  const described = [els.compareResult.dataset.reference, ...(els.compareResult.dataset.mobiles ?? '').split(',')];
  if (described.includes(String(entry.id))) els.compareResult.hidden = true;
  for (const other of state.entries) {
    if (other.comparison?.referenceId === entry.id) other.comparison = null;
  }
  state.correspondences.clear();
  state.measurements = state.measurements.filter((measurement) => measurement.atoms.every((item) => item.entry !== entry));
  state.measurePending = state.measurePending.filter((item) => item.entry !== entry);
  if (state.active === entry) {
    state.active = null;
    setActiveEntry(state.entries[0]);
  } else {
    updateStructureUI();
  }
  updateLocationHash();
  markSceneDirty();
}

function removeAllEntries() {
  for (const entry of state.entries) releaseEntryMeshes(entry);
  state.entries = [];
  state.active = null;
  state.parts = [];
  state.partByModel = new Map();
  state.correspondences.clear();
  state.measurePending = [];
  state.measurements = [];
  state.hover = { atom: -1, residueKey: null, entry: null };
  stopModelPlayback();
}

function releaseEntryMeshes(entry) {
  for (const id of [...state.meshSources.keys()]) {
    if (id.startsWith(`cartoon:${entry.id}:`)) {
      state.renderer?.setMesh(id, null);
      state.meshSources.delete(id);
    }
  }
  state.renderer?.setMesh(`surface:${entry.id}`, null);
}

// Clears result panels that describe the previous active structure.
function resetPanels() {
  for (const box of [els.interfaceResult, els.sasaResult, els.peptideResult, els.siteResult, els.xlResult, els.dataResult, els.uniprotResult]) {
    box.hidden = true;
    box.replaceChildren();
  }
  els.sasaColor.disabled = !state.sasa;
  els.surfaceStatus.textContent = '';
}

function resetEntryAnalysis(entry) {
  entry.activeModel = 0;
  entry.selection = new Set();
  entry.selectedAtom = null;
  entry.focus = null;
  entry.labels = new Set();
  entry.display.visibleChains = null;
  entry.display.residueFilter = null;
  entry.display.residueFilterKey = '';
  entry.interactions = { list: [], title: '' };
  entry.sasa = null;
  entry.proteomics = emptyProteomics();
  entry.pae = null;
  entry.paeSelection = null;
  entry.surface.data = null;
  entry.surface.key = '';
  entry.overlay = false;
  entry.rmsf = null;
  state.renderer?.setMesh(`surface:${entry.id}`, null);
  state.measurements = state.measurements.filter((measurement) => measurement.atoms.every((item) => item.entry !== entry));
  state.measurePending = [];
  if (DATA_SCHEMES.has(entry.color.scheme)) entry.color.scheme = entry.structure.meta.isPredicted ? 'plddt' : 'chain';
  stopModelPlayback();
}

async function activateAssembly(assemblyID) {
  const entry = state.active;
  const structure = entry?.structure;
  if (!structure || structure.activeAssemblyId === assemblyID) return;
  const previous = { id: structure.activeAssemblyId, models: structure.models };
  showLoading(assemblyID === ASYMMETRIC_UNIT_ID ? 'Restoring asymmetric unit' : `Building assembly ${assemblyID}`);
  await nextFrame();
  try {
    // Assembly operators are defined in the deposited frame, so any superposition is undone first;
    // comparisons made with the old chains no longer apply.
    const moved = entry.transform && !isIdentityTransform(entry.transform);
    if (moved) resetEntryPosition(entry);
    entry.comparison = null;
    for (const other of state.entries) if (other.comparison?.referenceId === entry.id) other.comparison = null;
    state.correspondences.clear();
    structure.activeAssemblyId = assemblyID;
    structure.models = materializeAssemblyModels(structure, assemblyID);
    deriveStructure(structure, { secondaryMode: state.secondaryMode });
    resetEntryAnalysis(entry);
    resetPanels();
    updateStructureUI();
    fitView(false, state.entries.length < 2);
    markSceneDirty();
    refreshSurface(entry);
    if (moved) showToast('The superposition was reset because the assembly changed. Superpose again to compare.');
  } catch (error) {
    structure.activeAssemblyId = previous.id;
    structure.models = previous.models;
    showToast(error.message, true);
    updateStructureUI();
  }
  hideLoading();
}

function reassignSecondary() {
  if (!state.entries.length) return;
  for (const entry of state.entries) {
    for (const model of entry.structure.models) {
      assignSecondary(model, entry.structure, state.secondaryMode);
      model.cartoonCache = new Map();
    }
  }
  updateSecondarySummary();
  markSceneDirty();
  markColorsDirty();
  renderSequence();
  refreshTabPanels();
}

/* ---------- Scene ---------- */

function activeModel() {
  return activeModelOf(state.active);
}

function activeModelOf(entry) {
  const models = entry.structure.models;
  return models[entry.activeModel] ?? models[0];
}

function renderedModels(entry) {
  const models = entry.structure.models;
  if (entry.overlay && models.length > 1) return models.slice(0, MAX_OVERLAY_MODELS);
  return [activeModelOf(entry)];
}

// Style changes apply to every structure unless the Style tab is scoped to the active one.
function styleTargets() {
  if (!state.entries.length) return [state.defaults];
  return state.styleScope === 'active' && state.active ? [state.active] : state.entries;
}

function markSceneDirty() {
  state.dirty.scene = true;
  state.dirty.colors = true;
  state.dirty.flags = true;
  requestRender();
}

function markColorsDirty() {
  state.dirty.colors = true;
  requestRender();
}

function markFlagsDirty() {
  state.dirty.flags = true;
  requestRender();
}

function requestRender() {
  state.dirty.render = true;
}

function updateDisplay(patch) {
  for (const entry of styleTargets()) Object.assign(entry.display, patch);
  if ('polymer' in patch || 'ligand' in patch) syncPresetButtons();
  markSceneDirty();
}

function syncPresetButtons() {
  const display = state.display;
  const preset = Object.entries(REPRESENTATION_PRESETS).find(([, value]) => value.polymer === display.polymer && value.ligand === display.ligand && (value.surface === 'off') === (state.surface.kind === 'off'));
  document.querySelectorAll('[data-preset]').forEach((button) => button.classList.toggle('is-active', preset?.[0] === button.dataset.preset));
}

function applyRepresentationPreset(name) {
  const preset = REPRESENTATION_PRESETS[name];
  if (!preset) return;
  setActiveButton('[data-preset]', document.querySelector(`[data-preset="${name}"]`));
  for (const entry of styleTargets()) {
    entry.display.polymer = preset.polymer;
    entry.display.ligand = preset.ligand;
    entry.surface.kind = preset.surface;
  }
  els.polymerRep.value = preset.polymer;
  els.ligandRep.value = preset.ligand;
  els.surfaceKind.value = preset.surface;
  refreshSurface();
  markSceneDirty();
}

function cartoonFor(entry, model) {
  const display = entry.display;
  const chains = display.visibleChains ? [...display.visibleChains].sort().join(',') : '*';
  const key = [model.number, chains, display.residueFilterKey || '*', display.cartoonWidth.toFixed(2), display.cartoonQuality, state.secondaryMode].join('|');
  const cached = model.cartoonCache.get(key);
  if (cached) return cached;
  const cartoon = buildCartoon(model, {
    include: (residue) => (!display.visibleChains || display.visibleChains.has(residue.chain)) && (!display.residueFilter || display.residueFilter.has(residue.key)),
    widthScale: display.cartoonWidth,
    quality: display.cartoonQuality,
  });
  if (model.cartoonCache.size > 6) model.cartoonCache.clear();
  model.cartoonCache.set(key, cartoon);
  return cartoon;
}

// Gives every rendered model a contiguous slice of the renderer's shared atom color and flag
// buffers. Hidden structures keep their slice so toggling visibility does not shift the others.
function layoutParts() {
  const parts = [];
  let offset = 0;
  for (const entry of state.entries) {
    for (const model of renderedModels(entry)) {
      parts.push({ entry, model, offset, count: model.atoms.length });
      offset += model.atoms.length;
    }
  }
  state.parts = parts;
  state.partByModel = new Map(parts.map((part) => [part.model, part]));
  state.atomTotal = offset;
  const liveModels = new Set(parts.map((part) => part.model));
  state.measurements = state.measurements.filter((measurement) => measurement.atoms.every((item) => liveModels.has(item.model)));
  state.measurePending = state.measurePending.filter((item) => liveModels.has(item.model));
}

function rebuildScene() {
  if (!state.entries.length) return;
  layoutParts();
  const sphereChunks = [];
  const cylinderChunks = [];
  const shapes = [];
  const cartoons = new Map();
  let bounds = null;
  for (const part of state.parts) {
    const { entry, model, offset } = part;
    if (!entry.visible) continue;
    const cartoon = entry.display.polymer === 'cartoon' ? cartoonFor(entry, model) : null;
    const scene = buildScene(model, entry.structure, entry.display, {
      cartoon,
      atomOffset: offset,
      focusResidues: entry.focus?.neighborhood ?? mirroredFocus(entry),
      emphasisResidues: siteResidueKeys(entry),
      lines: model === activeModelOf(entry) ? sceneLines(entry) : [],
    });
    sphereChunks.push(scene.spheres);
    cylinderChunks.push(scene.cylinders);
    if (cartoon) {
      cartoons.set(`cartoon:${entry.id}:${model.number}`, { cartoon, offset });
      for (const shape of cartoon.canvasShapes ?? []) shapes.push({ ...shape, atom: shape.atom + offset });
    }
    bounds = unionBounds(bounds, model.bounds);
  }
  cylinderChunks.push(buildLines(measurementLines()));
  const spheres = concatInstances(sphereChunks);
  const cylinders = concatInstances(cylinderChunks);
  state.renderer.setSpheres(spheres.data, spheres.count);
  state.renderer.setCylinders(cylinders.data, cylinders.count);
  for (const [id, { cartoon, offset }] of cartoons) {
    const source = state.meshSources.get(id);
    if (source === cartoon) {
      state.renderer.setMeshAtomOffset(id, offset);
    } else {
      state.renderer.setMesh(id, { vertices: cartoon.vertices, indices: cartoon.indices, opacity: 1, atomOffset: offset });
      state.meshSources.set(id, cartoon);
    }
  }
  for (const id of [...state.meshSources.keys()]) {
    if (!cartoons.has(id)) {
      state.renderer.setMesh(id, null);
      state.meshSources.delete(id);
    }
  }
  for (const entry of state.entries) {
    const part = state.partByModel.get(activeModelOf(entry));
    if (part) state.renderer.setMeshAtomOffset(`surface:${entry.id}`, part.offset);
  }
  state.renderer.setCanvasShapes?.(shapes);
  state.sceneBounds = bounds ?? sceneBoundsFromEntries();
  state.dirty.scene = false;
}

function concatInstances(chunks) {
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
  const count = chunks.reduce((sum, chunk) => sum + chunk.count, 0);
  if (chunks.length === 1) return chunks[0];
  const data = new Uint8Array(bytes);
  let cursor = 0;
  for (const chunk of chunks) {
    data.set(new Uint8Array(chunk.data), cursor);
    cursor += chunk.data.byteLength;
  }
  return { data: data.buffer, count };
}

function unionBounds(a, b) {
  if (!b) return a;
  if (!a) return { min: [...b.min], max: [...b.max], center: [...b.center], radius: b.radius };
  const min = a.min.map((value, axis) => Math.min(value, b.min[axis]));
  const max = a.max.map((value, axis) => Math.max(value, b.max[axis]));
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const reach = (bounds) => Math.hypot(bounds.center[0] - center[0], bounds.center[1] - center[1], bounds.center[2] - center[2]) + bounds.radius;
  return { min, max, center, radius: Math.max(reach(a), reach(b)) };
}

function sceneBoundsFromEntries() {
  let bounds = null;
  for (const entry of state.entries) if (entry.visible) bounds = unionBounds(bounds, activeModelOf(entry).bounds);
  return bounds ?? { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 10 };
}

function sceneLines(entry) {
  const lines = [];
  const typeColors = new Map(state.interactionTypes.map((type) => [type.id, hexColor(type.color)]));
  for (const interaction of entry.interactions.list) {
    if (!state.interactionEnabled.has(interaction.type)) continue;
    lines.push({
      from: interaction.pointA,
      to: interaction.pointB,
      color: typeColors.get(interaction.type) ?? [0.8, 0.8, 0.8],
      radius: interaction.type === 'hydrophobic' ? 0.07 : 0.11,
    });
  }
  for (const link of entry.proteomics.crosslinks) {
    if (!link.atomA || !link.atomB) continue;
    lines.push({
      from: point(link.atomA),
      to: point(link.atomB),
      color: link.satisfied ? [0.32, 0.87, 0.54] : [1, 0.36, 0.36],
      radius: 0.16,
      dashed: false,
      caps: true,
    });
  }
  return lines;
}

// Measurement rulers may join atoms of different structures, so they are drawn on their own.
function measurementLines() {
  const lines = [];
  for (const measurement of state.measurements) {
    const atoms = measurement.atoms.map((item) => item.atom);
    for (let index = 0; index + 1 < atoms.length; index += 1) {
      lines.push({ from: point(atoms[index]), to: point(atoms[index + 1]), color: [1, 0.84, 0.3], radius: 0.07 });
    }
  }
  const pending = state.measurePending.map((item) => item.atom);
  for (let index = 0; index + 1 < pending.length; index += 1) {
    lines.push({ from: point(pending[index]), to: point(pending[index + 1]), color: [1, 0.84, 0.3], radius: 0.06 });
  }
  return lines;
}

function updateColors() {
  if (!state.entries.length) return;
  if (!state.parts.length) layoutParts();
  const total = Math.max(1, state.atomTotal);
  const colors = new Float32Array(total * 4);
  for (const part of state.parts) {
    const { entry, model } = part;
    const { colors: partColors, legend } = computeAtomColors(model, entry.structure, entry.color, colorExtras(entry));
    colors.set(partColors.subarray(0, model.atoms.length * 4), part.offset * 4);
    if (model === activeModelOf(entry)) entry.legend = legend;
  }
  state.atomColors = colors;
  if (!state.atomFlags || state.atomFlags.length !== total) state.atomFlags = new Uint32Array(total);
  state.renderer.setAtomData(colors, state.atomFlags);
  state.dirty.colors = false;
  state.dirty.flags = true;
  for (const entry of state.entries) applySurfaceColors(entry, false);
  renderLegend();
  renderChains();
  sequenceView?.recolor(residueColor);
}

function colorExtras(entry = state.active) {
  const scheme = entry.color.scheme;
  const extras = { overrides: entry.proteomics.siteOverrides, structureColor: entryColor(entry) };
  if (scheme === 'coverage' && entry.proteomics.coverage) extras.residueValues = entry.proteomics.coverage;
  if (scheme === 'data' && entry.proteomics.data) {
    extras.residueValues = entry.proteomics.data;
    extras.dataLabel = entry.proteomics.dataLabel;
    extras.symmetric = els.dataSymmetric.checked;
  }
  if (scheme === 'exposure' && entry.sasa?.relative) extras.residueValues = entry.sasa.relative;
  if (scheme === 'deviation' || scheme === 'lddt') {
    const comparison = comparisonFor(entry);
    if (comparison) {
      extras.residueValues = comparison.values(scheme);
      extras.comparisonNote = state.entries.length > 2 ? `vs ${comparison.partnerName} · gray: not aligned` : 'After superposition · gray: not aligned';
    }
  }
  if (scheme === 'rmsf' && entry.rmsf) extras.residueValues = entry.rmsf;
  return extras;
}

function residueColor(key) {
  if (!state.atomColors || !state.structure) return null;
  const model = activeModel();
  const part = state.partByModel.get(model);
  const atom = model.residueMap.get(key)?.representative;
  if (!atom || !part) return null;
  const offset = (part.offset + atom.id) * 4;
  return [state.atomColors[offset], state.atomColors[offset + 1], state.atomColors[offset + 2]];
}

function updateFlags() {
  if (!state.atomFlags || !state.entries.length) return;
  const flags = state.atomFlags;
  flags.fill(0);
  const source = state.active;
  const hoverEntry = state.hover.entry;
  for (const part of state.parts) {
    const { entry, model, offset } = part;
    const mark = (keys, bit) => {
      for (const key of keys) {
        const residue = model.residueMap.get(key);
        if (residue) for (const atom of residue.atoms) flags[offset + atom.id] |= bit;
      }
    };
    // The selection and hover of one structure light up the aligned residues of the others.
    mark(entry === source ? entry.selection : mapKeys(source, entry, source?.selection), 1);
    if (state.hover.residueKey && hoverEntry) {
      mark(entry === hoverEntry ? [state.hover.residueKey] : mapKeys(hoverEntry, entry, [state.hover.residueKey]), 2);
    }
  }
  for (const item of state.measurePending) {
    const part = state.partByModel.get(item.model);
    if (part) flags[part.offset + item.atom.id] |= 1;
  }
  state.renderer.updateAtomFlags(flags);
  state.dirty.flags = false;
}

/* ---------- Frame loop ---------- */

function frame(time) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.1, Math.max(0, (time - (state.lastFrameTime ?? time)) / 1000));
  state.lastFrameTime = time;
  if (!state.structure) return;
  let animating = false;
  if (state.cameraAnimation) {
    const animation = state.cameraAnimation;
    const t = Math.min(1, (time - animation.start) / animation.duration);
    Object.assign(state.camera, interpolateCamera(animation.from, animation.to, t));
    if (t >= 1) state.cameraAnimation = null;
    animating = true;
  }
  if (state.spin && !state.drag) {
    spinCamera(state.camera, (state.spinRate ?? DEFAULT_SPIN_RATE) * elapsed);
    animating = true;
  }
  if (state.dirty.scene) rebuildScene();
  if (state.dirty.colors) updateColors();
  if (state.dirty.flags) updateFlags();
  if (state.dirty.render || animating) {
    state.dirty.render = false;
    renderFrame(time);
    updateLabels();
  }
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(els.canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(els.canvas.clientHeight * ratio));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
}

function currentView() {
  resizeCanvas();
  const aspect = els.canvas.width / Math.max(1, els.canvas.height);
  const matrices = cameraMatrices(state.camera, aspect);
  return { ...matrices, orthographic: state.camera.orthographic };
}

function renderSettings(overrides = {}) {
  const lighting = state.lighting;
  const radius = Math.max(4, (state.sceneBounds ?? sceneBoundsFromEntries()).radius);
  const basis = cameraBasis(state.camera);
  const centerDepth = state.camera.distance;
  const depthOf = (fraction) => centerDepth - radius + 2 * radius * fraction;
  const background = BACKGROUNDS[state.background] ?? BACKGROUNDS.dark;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  return {
    clip: {
      near: depthOf(state.clip.near),
      far: depthOf(state.clip.far),
      nearEnabled: state.clip.near > 0.001,
      farEnabled: state.clip.far < 0.999,
    },
    lightDirection: normalize(add(add(scale(basis.right, -0.42), scale(basis.up, 0.56)), scale(basis.forward, -0.72))),
    material: { ambient: lighting.ambient, diffuse: lighting.diffuse, specular: lighting.specular, shininess: lighting.shininess },
    flat: lighting.flat,
    highlightColor: [0.35, 1, 0.55],
    highlightStrength: 0.5,
    hoverColor: [1, 0.95, 0.5],
    hoverStrength: 0.38,
    glow: lighting.glow,
    dashPeriod: 0.42,
    fog: { start: centerDepth - radius * 0.3, end: centerDepth + radius * 1.1, strength: lighting.fog * 0.85 },
    background: { top: background.top, bottom: background.bottom, alpha: 1 },
    ao: { enabled: lighting.ao > 0.001, strength: lighting.ao, radius: lighting.aoRadius, bias: 0.04 + lighting.aoRadius * 0.01 },
    outline: { enabled: lighting.outline > 0.001, strength: lighting.outline, width: ratio, threshold: 0.8 },
    fxaa: true,
    pixelRatio: ratio,
    ...overrides,
  };
}

function renderFrame(time) {
  const view = currentView();
  state.renderer.render(view, { ...renderSettings(), time: time * 0.001 });
}

function updateViewOffset() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const { left, right, top, bottom } = occludedMargins();
  state.camera.offset = [(left - right) / width, (bottom - top) / height];
}

function occludedMargins() {
  const styles = getComputedStyle(els.app);
  const px = (name) => parseFloat(styles.getPropertyValue(name)) || 0;
  const narrow = window.innerWidth <= 900;
  const left = !narrow && els.app.classList.contains('left-open') ? px('--left-width') + px('--gutter') * 2 : 0;
  const right = !narrow && els.app.classList.contains('right-open') ? px('--right-width') + px('--gutter') * 2 + 52 : 52;
  const top = px('--topbar');
  const bottom = els.sequencePanel.hidden ? 0 : els.sequencePanel.getBoundingClientRect().height + px('--gutter');
  return { left, right, top, bottom };
}

function viewportRegion() {
  const { left, right, top, bottom } = occludedMargins();
  return { width: Math.max(200, window.innerWidth - left - right), height: Math.max(160, window.innerHeight - top - bottom) };
}

function fitView(animate = true, principal = true, atoms = null) {
  if (!state.structure) return;
  updateViewOffset();
  const source = atoms ?? visibleSceneAtoms();
  if (!source.length) return;
  const points = new Float32Array(source.length * 3);
  source.forEach((atom, index) => {
    points[index * 3] = atom.x;
    points[index * 3 + 1] = atom.y;
    points[index * 3 + 2] = atom.z;
  });
  const radius = sceneBoundsFromEntries().radius;
  const target = cloneCamera(state.camera);
  target.sceneRadius = radius;
  fitCameraToPoints(target, points, viewportRegion(), { keepRotation: !principal, padding: atoms ? 4 : 2, sceneRadius: radius });
  animateCamera(target, animate ? 450 : 0);
}

function visibleSceneAtoms() {
  const atoms = [];
  for (const entry of state.entries) {
    if (!entry.visible) continue;
    const model = activeModelOf(entry);
    const { visibleChains, residueFilter } = entry.display;
    for (const atom of model.atoms) {
      if (atom.kind === 'water' || (visibleChains && !visibleChains.has(atom.chain))) continue;
      if (residueFilter && (atom.kind === 'protein' || atom.kind === 'nucleic') && !residueFilter.has(atom.residueKey)) continue;
      atoms.push(atom);
    }
  }
  return atoms;
}

function animateCamera(target, duration = 400) {
  if (duration <= 0) {
    Object.assign(state.camera, target);
    state.cameraAnimation = null;
    requestRender();
    return;
  }
  state.cameraAnimation = { from: cloneCamera(state.camera), to: target, start: performance.now(), duration };
}

function resetView(animate = true) {
  fitView(animate, true);
}

function setProjection(orthographic) {
  state.camera.orthographic = orthographic;
  document.querySelectorAll('[data-projection]').forEach((button) => {
    button.classList.toggle('is-active', (button.dataset.projection === 'orthographic') === orthographic);
  });
  requestRender();
}

function setSpin(value) {
  state.spin = value;
  els.spinToggle.classList.toggle('is-active', value);
  requestRender();
}

/* ---------- Interaction ---------- */

function canvasPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  const ratioX = els.canvas.width / Math.max(1, rect.width);
  const ratioY = els.canvas.height / Math.max(1, rect.height);
  return { x: (event.clientX - rect.left) * ratioX, y: (event.clientY - rect.top) * ratioY };
}

function onPointerDown(event) {
  els.canvas.setPointerCapture(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  state.cameraAnimation = null;
  if (state.pointers.size === 2) {
    const [a, b] = [...state.pointers.values()];
    state.drag = { mode: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
    return;
  }
  const mode = event.button === 2 || event.button === 1 || event.shiftKey ? 'pan' : event.altKey ? 'roll' : 'rotate';
  state.drag = { mode, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  els.canvas.classList.add('is-dragging');
}

function onPointerMove(event) {
  if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const drag = state.drag;
  if (drag) {
    if (drag.mode === 'pinch' && state.pointers.size >= 2) {
      const [a, b] = [...state.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomCamera(state.camera, drag.distance / Math.max(1, distance));
      drag.distance = distance;
      requestRender();
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === 'pan') panCamera(state.camera, dx, dy, els.canvas.clientHeight);
    else if (drag.mode === 'roll') rollCamera(state.camera, dx * 0.006);
    else orbitCamera(state.camera, dx, dy);
    requestRender();
    return;
  }
  scheduleHoverPick(event);
}

function onPointerUp(event) {
  state.pointers.delete(event.pointerId);
  const drag = state.drag;
  if (state.pointers.size === 0) {
    state.drag = null;
    els.canvas.classList.remove('is-dragging');
  }
  try {
    els.canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Capture may already be released.
  }
  if (drag && !drag.moved && drag.mode !== 'pinch' && event.type === 'pointerup' && event.button !== 2) {
    handleClick(event);
  }
}

async function handleClick(event) {
  const hit = resolvePick(await pickAt(event));
  if (state.measureMode) {
    if (hit) addMeasureAtom(hit);
    return;
  }
  if (!hit) {
    if (!event.shiftKey) clearSelection(false);
    return;
  }
  // Clicking another structure makes it the active one.
  const additive = (event.shiftKey || event.metaKey || event.ctrlKey) && hit.entry === state.active;
  setActiveEntry(hit.entry);
  state.selectedAtom = hit.atom;
  selectResidues([hit.atom.residueKey], { additive, toggle: true });
}

async function onDoubleClick(event) {
  const hit = resolvePick(await pickAt(event));
  if (!hit || state.measureMode) return;
  setActiveEntry(hit.entry);
  focusResidues([hit.atom.residueKey]);
}

// Maps an index in the shared atom buffers back to its structure, model and atom.
function resolvePick(index) {
  if (!Number.isInteger(index) || index < 0) return null;
  let low = 0;
  let high = state.parts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const part = state.parts[middle];
    if (index < part.offset) high = middle - 1;
    else if (index >= part.offset + part.count) low = middle + 1;
    else {
      const atom = part.model.atoms[index - part.offset];
      return atom ? { entry: part.entry, model: part.model, atom, part } : null;
    }
  }
  return null;
}

function residueIn(model, atom) {
  return model.residues[model.atomResidue[atom.id]] ?? null;
}

function onWheel(event) {
  event.preventDefault();
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  zoomCamera(state.camera, Math.exp(delta * 0.0012));
  state.cameraAnimation = null;
  requestRender();
}

async function pickAt(event) {
  const point = canvasPoint(event);
  try {
    return await state.renderer.pick(point.x, point.y);
  } catch {
    return -1;
  }
}

function scheduleHoverPick(event) {
  if (state.pickPending || !state.structure) return;
  state.pickPending = true;
  const clientX = event.clientX;
  const clientY = event.clientY;
  requestAnimationFrame(async () => {
    const atomIndex = await pickAt({ clientX, clientY });
    state.pickPending = false;
    setHoverAtom(atomIndex, clientX, clientY);
  });
}

function setHoverAtom(atomIndex, clientX = 0, clientY = 0) {
  if (!state.structure) return;
  const hit = resolvePick(atomIndex);
  const residueKey = hit?.atom.residueKey ?? null;
  if (hit) {
    els.tooltip.innerHTML = tooltipHTML(hit);
    const x = Math.min(window.innerWidth - 300, clientX + 14);
    els.tooltip.style.transform = `translate(${x}px, ${clientY + 14}px)`;
    els.tooltip.classList.add('is-visible');
  } else {
    els.tooltip.classList.remove('is-visible');
  }
  state.hover.atom = atomIndex;
  if (state.hover.residueKey !== residueKey || state.hover.entry !== (hit?.entry ?? null)) {
    state.hover.residueKey = residueKey;
    state.hover.entry = hit?.entry ?? null;
    sequenceView?.setHover(hit?.entry === state.active ? residueKey : null);
    markFlagsDirty();
  }
}

function setHoverResidue(key) {
  if (state.hover.residueKey === key && state.hover.entry === state.active) return;
  state.hover.residueKey = key;
  state.hover.entry = key ? state.active : null;
  sequenceView?.setHover(key);
  markFlagsDirty();
}

function componentNameOf(residue, entry = state.active) {
  if (!residue || (residue.kind !== 'ligand' && residue.kind !== 'ion')) return '';
  const name = entry.structure.componentNames?.get(residue.resName);
  return name ? titleCase(name) : '';
}

function tooltipHTML(hit) {
  const { entry, model, atom } = hit;
  const residue = residueIn(model, atom);
  const parts = [`${atom.name} · ${atom.element}`];
  const componentName = componentNameOf(residue, entry);
  if (componentName) parts.unshift(componentName);
  if (residue?.kind === 'protein') parts.push(secondaryText(residue));
  if (Number.isFinite(residue?.confidence) && entry.structure.meta.isPredicted) parts.push(`pLDDT ${residue.confidence.toFixed(1)}`);
  else parts.push(`B ${atom.bFactor.toFixed(1)}`);
  const extra = residueDataText(residue, entry);
  if (extra) parts.push(extra);
  const prefix = state.entries.length > 1 ? `${entry.name} · ` : '';
  const modelNote = entry.overlay ? ` · model ${model.number}` : '';
  return `<strong>${escapeHTML(prefix + residueLabel(residue ?? atom) + modelNote)}</strong><span>${escapeHTML(parts.join(' · '))}</span>`;
}

function residueDataText(residue, entry = state.active) {
  if (!residue) return '';
  const parts = [];
  const coverage = entry.proteomics.coverage?.get(residue.key);
  if (coverage) parts.push(`${coverage} peptide${coverage === 1 ? '' : 's'}`);
  const data = entry.proteomics.data?.get(residue.key);
  if (Number.isFinite(data)) parts.push(`${entry.proteomics.dataLabel || 'value'} ${formatNumberShort(data)}`);
  const relative = entry.sasa?.relative?.get(residue.key);
  if (Number.isFinite(relative)) parts.push(`RSA ${(relative * 100).toFixed(0)}%`);
  const comparison = comparisonFor(entry);
  const deviation = comparison?.lookup(residue.key);
  if (deviation) parts.push(`${formatNumberShort(deviation.distance)} Å from ${comparison.partnerName}${Number.isFinite(deviation.lddt) ? ` · lDDT ${deviation.lddt.toFixed(2)}` : ''}`);
  const fluctuation = entry.rmsf?.get(residue.key);
  if (Number.isFinite(fluctuation)) parts.push(`RMSF ${fluctuation.toFixed(1)} Å`);
  return parts.join(' · ');
}

function onKeyDown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
    if (event.key === 'Escape') target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;
  const presets = ['cartoon', 'ball-stick', 'sticks', 'spacefill', 'trace', 'surface'];
  if (/^[1-6]$/.test(key)) applyRepresentationPreset(presets[Number(key) - 1]);
  else if (key === 'r' || key === 'R') resetView(true);
  else if (key === 'f' || key === 'F') focusResidues([...state.selection]);
  else if (key === 'd' || key === 'D') setMeasureMode(state.measureMode === 'distance' ? null : 'distance');
  else if (key === 'a' || key === 'A') setMeasureMode(state.measureMode === 'angle' ? null : 'angle');
  else if (key === 't' || key === 'T') setMeasureMode(state.measureMode === 'dihedral' ? null : 'dihedral');
  else if (key === 'l' || key === 'L') toggleSelectionLabels();
  else if (key === 's' || key === 'S') setSpin(!state.spin);
  else if (key === 'p' || key === 'P') openExportDialog();
  else if (key === 'o' || key === 'O') setProjection(!state.camera.orthographic);
  else if (key === 'w' || key === 'W') {
    els.showWater.checked = !els.showWater.checked;
    updateDisplay({ showWater: els.showWater.checked });
  } else if (key === 'h' || key === 'H') {
    els.showHydrogen.checked = !els.showHydrogen.checked;
    updateDisplay({ showHydrogen: els.showHydrogen.checked });
  } else if (key === '/') {
    event.preventDefault();
    els.searchInput.focus();
  } else if (key === '?') {
    els.helpDialog.showModal();
  } else if (key === 'Escape') {
    if (state.measureMode) setMeasureMode(null);
    else if (state.focus) clearFocus();
    else clearSelection(true);
  } else if (key === 'Backspace' || key === 'Delete') {
    if (state.measurements.length) {
      state.measurements.pop();
      renderMeasurements();
      markSceneDirty();
    }
  } else {
    return;
  }
  event.preventDefault();
}

/* ---------- Selection and focus ---------- */

function selectResidues(keys, options = {}) {
  if (!state.structure) return;
  const next = options.additive ? new Set(state.selection) : new Set();
  for (const key of keys) {
    if (options.additive && options.toggle && next.has(key) && keys.length === 1) next.delete(key);
    else next.add(key);
  }
  state.selection = next;
  if (!options.keepAtom && keys.length === 1 && state.selectedAtom?.residueKey !== keys[0]) {
    state.selectedAtom = activeModel().residueMap.get(keys[0])?.representative ?? null;
  }
  if (options.frame && keys.length) frameResidues(keys);
  onSelectionChanged();
}

function clearSelection(clearFocusToo) {
  state.selection = new Set();
  state.selectedAtom = null;
  if (clearFocusToo && state.focus) clearFocus();
  onSelectionChanged();
}

function onSelectionChanged() {
  sequenceView?.setSelection(state.selection);
  const first = [...state.selection][0];
  if (first) sequenceView?.scrollTo(first);
  renderSelectionPanel();
  if (activeTabName() === 'analysis') {
    renderRamachandran();
    renderProfile();
  }
  markFlagsDirty();
}

function frameResidues(keys) {
  const model = activeModel();
  const atoms = keys.flatMap((key) => model.residueMap.get(key)?.atoms ?? []);
  if (!atoms.length) return;
  fitView(true, false, atoms);
}

async function focusResidues(keys) {
  if (!state.structure || !keys.length) return;
  const model = activeModel();
  const valid = keys.filter((key) => model.residueMap.has(key));
  if (!valid.length) return;
  state.selection = new Set(valid);
  const neighborhood = focusNeighborhood(model, valid, 5);
  state.focus = { residues: new Set(valid), neighborhood };
  const atoms = [...neighborhood].flatMap((key) => model.residueMap.get(key)?.atoms ?? []).filter((atom) => !atom.isHydrogen);
  fitView(true, false, atoms);
  onSelectionChanged();
  markSceneDirty();
  await computeFocusInteractions(valid);
}

function clearFocus() {
  state.focus = null;
  state.interactions = { ...state.interactions, list: [], title: '' };
  renderInteractions();
  markSceneDirty();
}

async function computeFocusInteractions(keys) {
  const focus = state.focus;
  const module = await loadModule('interactions', './lib/interactions.js');
  if (!module?.findInteractions || state.focus !== focus) return;
  const model = activeModel();
  const focusAtoms = keys.flatMap((key) => model.residueMap.get(key)?.atoms ?? []).map((atom) => atom.id);
  try {
    const list = module.findInteractions(model, focusAtoms, { includeWater: state.display.showWater });
    const residue = model.residueMap.get(keys[0]);
    state.interactions = { ...state.interactions, list, title: keys.length === 1 ? residueLabel(residue) : `${keys.length} residues` };
  } catch (error) {
    console.error(error);
    showToast(`Interaction analysis failed: ${error.message}`, true);
  }
  renderInteractions();
  markSceneDirty();
}

function toggleSelectionLabels() {
  if (!state.selection.size) return;
  const allLabeled = [...state.selection].every((key) => state.labels.has(key));
  for (const key of state.selection) {
    if (allLabeled) state.labels.delete(key);
    else state.labels.add(key);
  }
  requestRender();
}

function isolateSelectionChains() {
  if (!state.selection.size) return;
  const model = activeModel();
  const chains = new Set([...state.selection].map((key) => model.residueMap.get(key)?.chain).filter(Boolean));
  setVisibleChains(chains);
}

/* ---------- Measurements ---------- */

function setMeasureMode(mode) {
  state.measureMode = mode;
  state.measurePending = [];
  document.querySelectorAll('[data-measure]').forEach((button) => button.classList.toggle('is-active', button.dataset.measure === mode));
  els.app.classList.toggle('measure-mode', Boolean(mode));
  const needed = { distance: 2, angle: 3, dihedral: 4 }[mode];
  els.modeBanner.hidden = !mode;
  if (mode) els.modeBanner.textContent = `${capitalize(mode === 'dihedral' ? 'torsion' : mode)}: click ${needed} atoms · Esc to finish`;
  markSceneDirty();
}

// Measurement atoms are { entry, model, atom } so a ruler can span two structures.
function addMeasureAtom(hit) {
  const needed = { distance: 2, angle: 3, dihedral: 4 }[state.measureMode];
  if (state.measurePending.at(-1)?.atom === hit.atom) return;
  state.measurePending.push({ entry: hit.entry, model: hit.model, atom: hit.atom });
  if (state.measurePending.length >= needed) {
    const atoms = [...state.measurePending];
    state.measurements.push({ type: state.measureMode, atoms, value: measureValue(state.measureMode, atoms.map((item) => item.atom)) });
    state.measurePending = [];
    renderMeasurements();
  }
  markSceneDirty();
}

function updateMeasurementValues() {
  for (const measurement of state.measurements) measurement.value = measureValue(measurement.type, measurement.atoms.map((item) => item.atom));
  renderMeasurements();
}

function measureValue(type, atoms) {
  const p = atoms.map(point);
  if (type === 'distance') return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1], p[0][2] - p[1][2]);
  if (type === 'angle') return angleBetween(sub(p[0], p[1]), sub(p[2], p[1])) * 180 / Math.PI;
  return dihedralAngle(p[0], p[1], p[2], p[3]) * 180 / Math.PI;
}

function formatMeasurement(measurement) {
  return measurement.type === 'distance' ? `${measurement.value.toFixed(2)} Å` : `${measurement.value.toFixed(1)}°`;
}

function clearMeasurements() {
  state.measurements = [];
  state.measurePending = [];
  renderMeasurements();
  markSceneDirty();
}

function renderMeasurements() {
  const fragment = document.createDocumentFragment();
  const multiple = state.entries.length > 1;
  state.measurements.forEach((measurement, index) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const atoms = measurement.atoms.map((item) => item.atom);
    const labels = measurement.atoms.map((item) => `${multiple ? `${item.entry.name} ` : ''}${shortAtomLabel(item.atom)}`);
    row.innerHTML = `<i style="background:#ffd166"></i><span>${escapeHTML(labels.join(' – '))}</span><strong>${formatMeasurement(measurement)}</strong><button type="button" title="Remove">×</button>`;
    row.querySelector('button').addEventListener('click', (event) => {
      event.stopPropagation();
      state.measurements.splice(index, 1);
      renderMeasurements();
      markSceneDirty();
    });
    row.addEventListener('click', () => fitView(true, false, atoms));
    fragment.appendChild(row);
  });
  els.measurementList.replaceChildren(fragment);
}

/* ---------- Labels ---------- */

function updateLabels() {
  if (!state.structure) return;
  const view = currentView();
  const width = els.canvas.clientWidth;
  const height = els.canvas.clientHeight;
  const labels = collectLabels();
  const pool = els.labelLayer.children;
  let used = 0;
  for (const label of labels.slice(0, 400)) {
    const screen = projectToScreen(view, label.position, width, height);
    if (!screen || screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height) continue;
    const element = pool[used] ?? els.labelLayer.appendChild(document.createElement('div'));
    const className = `label-3d ${label.kind}`;
    if (element.className !== className) element.className = className;
    if (element.textContent !== label.text) element.textContent = label.text;
    element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -140%)`;
    used += 1;
  }
  while (pool.length > used) pool[pool.length - 1].remove();
}

function collectLabels() {
  const labels = [];
  for (const entry of state.entries) {
    if (!entry.visible) continue;
    const model = activeModelOf(entry);
    const prefix = entry !== state.active && state.entries.length > 1 ? `${entry.name} · ` : '';
    for (const key of entry.labels) {
      const residue = model.residueMap.get(key);
      if (residue?.representative) labels.push({ position: point(residue.representative), text: prefix + residueLabel(residue), kind: 'residue' });
    }
    for (const site of entry.proteomics.sites) {
      if (site.residue?.representative) labels.push({ position: point(site.residue.representative), text: prefix + site.label, kind: 'site' });
    }
  }
  for (const measurement of state.measurements) {
    const atoms = measurement.atoms.map((item) => item.atom);
    if (atoms.length < 2) continue;
    let position;
    if (measurement.type === 'distance') position = scale(add(point(atoms[0]), point(atoms[1])), 0.5);
    else if (measurement.type === 'angle') position = point(atoms[1]);
    else position = scale(add(point(atoms[1]), point(atoms[2])), 0.5);
    labels.push({ position, text: formatMeasurement(measurement), kind: 'measure' });
  }
  return labels;
}

/* ---------- Structures and comparison ---------- */

const EYE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><path d="M4 4l16 16" /></svg>';

function renderStructureList() {
  const count = state.entries.length;
  els.structuresGroup.hidden = count < 2;
  if (count < 2) {
    els.structureList.replaceChildren();
    return;
  }
  els.structureCount.textContent = String(count);
  const fragment = document.createDocumentFragment();
  for (const entry of state.entries) {
    const row = document.createElement('div');
    row.className = `structure-row${entry === state.active ? ' is-active' : ''}${entry.visible ? '' : ' is-hidden'}`;
    const chains = entry.structure.chains.filter((chain) => chain.polymerKind).length;
    const reference = entry.comparison ? entryById(entry.comparison.referenceId) : null;
    const detail = [
      entry.structure.meta.isPredicted ? 'Predicted' : titleCase(entry.structure.meta.method || ''),
      `${chains} chain${chains === 1 ? '' : 's'}`,
      entry.overlay ? `${Math.min(entry.structure.models.length, MAX_OVERLAY_MODELS)} models overlaid` : '',
      reference ? `on ${reference.name}, ${entry.comparison.stats.rmsd.toFixed(2)} Å` : entry.transform ? 'moved' : '',
    ].filter(Boolean).join(' · ');
    row.innerHTML = `<button type="button" class="structure-main" title="${entry === state.active ? 'Active structure' : 'Make active'}"><i style="background:${colorToHex(entryColor(entry))}"></i><span><strong>${escapeHTML(entry.name)}</strong><small>${escapeHTML(detail)}</small></span></button>
      <button type="button" class="structure-action" data-action="visibility" title="${entry.visible ? 'Hide' : 'Show'} ${escapeHTML(entry.name)}" aria-pressed="${entry.visible}">${entry.visible ? EYE_ICON : EYE_OFF_ICON}</button>
      <button type="button" class="structure-action" data-action="remove" title="Remove ${escapeHTML(entry.name)} from the scene" aria-label="Remove">×</button>`;
    row.querySelector('.structure-main').addEventListener('click', () => setActiveEntry(entry));
    row.querySelector('[data-action="visibility"]').addEventListener('click', () => setEntryVisible(entry, !entry.visible));
    row.querySelector('[data-action="remove"]').addEventListener('click', () => removeEntry(entry));
    fragment.appendChild(row);
  }
  els.structureList.replaceChildren(fragment);
}

function setEntryVisible(entry, visible) {
  entry.visible = visible;
  renderStructureList();
  markSceneDirty();
  refreshSurface(entry);
  renderLegend();
}

function updateCompareControls() {
  const entries = state.entries;
  const multiple = entries.length > 1;
  els.compareControls.hidden = !multiple;
  els.compareRun.hidden = !multiple;
  els.compareReset.hidden = !entries.some((entry) => entry.transform);
  els.compareFitSelection.closest('.toggles').hidden = !multiple;
  els.compareHint.hidden = multiple;
  const fill = (select, options, preferred) => {
    const previous = select.value;
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    const values = options.map(([value]) => value);
    select.value = values.includes(previous) ? previous : values.includes(preferred) ? preferred : values[0] ?? '';
  };
  if (multiple) {
    const choices = entries.map((entry) => [String(entry.id), entry.name]);
    const reference = entries.find((entry) => !entry.comparison) ?? entries[0];
    fill(els.compareReference, choices, String(reference.id));
    const mobileChoices = choices.filter(([id]) => id !== els.compareReference.value);
    if (mobileChoices.length > 1) mobileChoices.push(['*', 'All other structures']);
    const preferred = state.active && String(state.active.id) !== els.compareReference.value ? String(state.active.id) : mobileChoices[0]?.[0];
    fill(els.compareMobile, mobileChoices, preferred);
    populateCompareChains();
  }
  const active = state.active;
  const hasUniprot = Boolean(active && !active.structure.meta.isPredicted && [...active.structure.sequences.values()].some((info) => info.kind === 'protein' && info.uniprot?.some((segment) => segment.accession)));
  els.compareAlphaFold.disabled = !hasUniprot;
  els.compareAlphaFold.title = hasUniprot ? 'Fetch the AlphaFold DB model for each UniProt accession of this entry and superpose it by UniProt numbering' : 'Needs an experimental structure with a UniProt cross-reference';
  const models = active?.structure.models.length ?? 1;
  els.compareModels.disabled = models < 2;
  els.compareModels.textContent = active?.overlay ? 'Show one model' : 'Overlay models';
  els.compareModels.title = models < 2 ? 'Needs a file with several models (NMR ensemble, predictions)' : `Superpose all ${models} models on their common core and show them together`;
}

function populateCompareChains() {
  const fill = (select, entry) => {
    const previous = select.value;
    const options = [new Option('All chains (paired automatically)', '*')];
    if (entry) {
      for (const chain of polymerChainResidues(activeModelOf(entry)).values()) {
        const info = entry.structure.chains.find((item) => item.id === chain.id);
        options.push(new Option(info ? chainOptionLabel(info) : chain.id, chain.id));
      }
    }
    select.replaceChildren(...options);
    select.value = [...select.options].some((option) => option.value === previous) ? previous : '*';
  };
  fill(els.compareRefChain, entryById(els.compareReference.value));
  const mobile = els.compareMobile.value === '*' ? null : entryById(els.compareMobile.value);
  fill(els.compareMobChain, mobile);
  els.compareMobChain.disabled = !mobile;
}

function pairOf(entry) {
  return { model: activeModelOf(entry), structure: entry.structure };
}

// Superposes one or more moving structures onto a reference. Reads the Analysis tab controls
// unless options name the structures directly.
function runSuperposition(options = {}) {
  const reference = options.reference ?? entryById(els.compareReference.value);
  const mobiles = (options.mobiles ?? (els.compareMobile.value === '*'
    ? state.entries.filter((entry) => entry !== reference)
    : [entryById(els.compareMobile.value)])).filter((entry) => entry && entry !== reference);
  if (!reference || !mobiles.length) {
    showToast('Choose two different structures to superpose.', true);
    return [];
  }
  const refChain = options.refChain ?? (els.compareRefChain.value || '*');
  const mobChain = options.mobChain ?? (els.compareMobChain.value || '*');
  let fitKeys = null;
  if (options.fitSelection ?? els.compareFitSelection.checked) {
    fitKeys = new Set(reference.selection);
    if (fitKeys.size < 3) {
      showToast(`Select at least three residues of ${reference.name} to fit on (for example one domain), or untick "Fit on selected residues".`, true);
      return [];
    }
  }
  const results = [];
  for (const mobile of mobiles) {
    try {
      const result = compareStructures(pairOf(reference), pairOf(mobile), {
        refChains: refChain !== '*' ? [refChain] : null,
        mobChains: mobChain !== '*' && mobiles.length === 1 ? [mobChain] : null,
        fitKeys,
      });
      applyComparison(reference, mobile, result);
      results.push({ mobile, result });
    } catch (error) {
      console.warn(error);
      results.push({ mobile, error });
    }
  }
  const predicted = results.filter((item) => item.result && stylePredictedComparison(reference, item.mobile));
  renderCompareResult(reference, results, {
    fitOnSelection: Boolean(fitKeys),
    note: predicted.length ? 'Experimental structure in gray, predicted model colored by pLDDT.' : '',
  });
  if (results.some((item) => item.result)) {
    if (!COMPARISON_SCHEMES.has(reference.color.scheme) && reference.color.scheme !== 'plddt') {
      for (const entry of [reference, ...mobiles]) if (entry.color.scheme === 'chain') entry.color.scheme = 'structure';
    }
    syncStyleControls();
    fitView(true, false);
  }
  return results;
}

// A predicted model superposed on an experimental structure keeps its pLDDT colors, is trimmed to
// the aligned span when it is much longer (full-length models of one domain), and the
// experimental structure turns neutral gray so it cannot be confused with the pLDDT blues.
function stylePredictedComparison(reference, mobile) {
  if (!mobile.structure.meta.isPredicted || reference.structure.meta.isPredicted || !mobile.comparison) return false;
  if (mobile.color.scheme === 'structure' || mobile.color.scheme === 'chain') mobile.color.scheme = 'plddt';
  const polymer = [...polymerChainResidues(activeModelOf(mobile)).values()].reduce((total, chain) => total + chain.residues.length, 0);
  if (mobile.comparison.byMobile.size < polymer * 0.7) trimToAligned(mobile, true);
  if (['chain', 'structure', 'plddt'].includes(reference.color.scheme)) {
    reference.color.scheme = 'uniform';
    reference.color.uniformColor = '#c9ced6';
  }
  return true;
}

function applyComparison(reference, mobile, result) {
  applyEntryTransform(mobile, result.transform);
  const byMobile = new Map();
  const byReference = new Map();
  for (const pair of result.pairs) {
    byMobile.set(pair.mob.key, { key: pair.ref.key, distance: pair.distance, lddt: pair.lddt, fitted: pair.fitted });
    byReference.set(pair.ref.key, { key: pair.mob.key, distance: pair.distance, lddt: pair.lddt, fitted: pair.fitted });
  }
  mobile.comparison = { referenceId: reference.id, time: performance.now(), stats: result.stats, chainPairs: result.chainPairs, byMobile, byReference };
  if (mobile.display.residueFilter) trimToAligned(mobile, true);
  state.correspondences.clear();
  updateLocationHash();
  updateMeasurementValues();
  renderStructureList();
  renderSequence();
  markSceneDirty();
  refreshSurface(mobile);
}

// Moves every model of a structure rigidly; the cumulative transform is kept so the move can be
// undone and assemblies can be rebuilt in the deposited frame.
function applyEntryTransform(entry, transform) {
  if (!transform || isIdentityTransform(transform)) return;
  for (const model of entry.structure.models) {
    for (const atom of model.atoms) {
      const moved = transformPoint(transform, atom.x, atom.y, atom.z);
      atom.x = moved[0];
      atom.y = moved[1];
      atom.z = moved[2];
    }
    model.bounds = computeBounds(model.atoms);
    model.cartoonCache = new Map();
  }
  const combined = entry.transform ? composeTransforms(transform, entry.transform) : { rotation: [...transform.rotation], translation: [...transform.translation] };
  entry.transform = isIdentityTransform(combined, 1e-7) ? null : combined;
  entry.transformVersion += 1;
  for (const item of entry.interactions.list) {
    if (item.pointA) item.pointA = transformPoint(transform, ...item.pointA);
    if (item.pointB) item.pointB = transformPoint(transform, ...item.pointB);
  }
  entry.surface.key = '';
}

function resetEntryPosition(entry) {
  if (entry.transform) applyEntryTransform(entry, invertTransform(entry.transform));
  entry.transform = null;
  entry.comparison = null;
  // Anything fitted onto this structure was fitted onto coordinates that just moved.
  for (const other of state.entries) if (other.comparison?.referenceId === entry.id) other.comparison = null;
  state.correspondences.clear();
}

function resetComparedPositions() {
  for (const entry of state.entries) if (entry.transform || entry.comparison) resetEntryPosition(entry);
  for (const entry of state.entries) {
    if (entry.color.scheme === 'deviation' || entry.color.scheme === 'lddt') entry.color.scheme = 'structure';
    if (entry.display.residueFilter) setResidueFilter(entry, null);
    refreshSurface(entry);
  }
  els.compareResult.hidden = true;
  updateLocationHash();
  updateMeasurementValues();
  syncStyleControls();
  renderStructureList();
  renderSequence();
  updateCompareControls();
  markSceneDirty();
  fitView(true, false);
}

function setResidueFilter(entry, keys) {
  entry.display.residueFilter = keys;
  entry.display.residueFilterKey = keys ? `filter-${keys.size}-${performance.now().toFixed(0)}` : '';
}

// Hides the polymer residues of a moved structure outside the span it shares with its reference
// (for example the extra domains of a full-length AlphaFold model). Unaligned loops inside the
// span stay visible, since they are often exactly the regions an experiment did not resolve.
function trimToAligned(entry, trim) {
  if (!trim || !entry.comparison) {
    setResidueFilter(entry, null);
    return;
  }
  const keep = new Set();
  const model = activeModelOf(entry);
  for (const chain of polymerChainResidues(model).values()) {
    const aligned = chain.residues.map((residue, index) => (entry.comparison.byMobile.has(residue.key) ? index : -1)).filter((index) => index >= 0);
    if (!aligned.length) continue;
    for (let index = aligned[0]; index <= aligned.at(-1); index += 1) keep.add(chain.residues[index].key);
  }
  setResidueFilter(entry, keep);
}

// The per-residue comparison data describing `entry`: its own superposition, or the most recent
// one that used it as the reference (the active structure's, when it is one of them).
function comparisonFor(entry) {
  if (!entry) return null;
  if (entry.comparison) {
    return comparisonView(entry.comparison.byMobile, entryById(entry.comparison.referenceId)?.name ?? 'reference');
  }
  const mobiles = state.entries.filter((other) => other.comparison?.referenceId === entry.id);
  if (!mobiles.length) return null;
  const mobile = mobiles.includes(state.active) ? state.active : mobiles.reduce((a, b) => (b.comparison.time > a.comparison.time ? b : a));
  return comparisonView(mobile.comparison.byReference, mobile.name);
}

function comparisonView(map, partnerName) {
  return {
    partnerName,
    lookup: (key) => map.get(key) ?? null,
    values(metric) {
      const values = new Map();
      for (const [key, item] of map) {
        const value = metric === 'lddt' ? item.lddt : item.distance;
        if (Number.isFinite(value)) values.set(key, value);
      }
      return values;
    },
  };
}

// Residue-key correspondence between two structures, directly or through a shared reference.
function correspondence(from, to) {
  const cacheKey = `${from.id}>${to.id}`;
  if (state.correspondences.has(cacheKey)) return state.correspondences.get(cacheKey);
  const toReference = (entry) => new Map([...entry.comparison.byMobile].map(([key, item]) => [key, item.key]));
  const fromReference = (entry) => new Map([...entry.comparison.byReference].map(([key, item]) => [key, item.key]));
  let map = null;
  if (to.comparison?.referenceId === from.id) map = fromReference(to);
  else if (from.comparison?.referenceId === to.id) map = toReference(from);
  else if (from.comparison && to.comparison && from.comparison.referenceId === to.comparison.referenceId) {
    const up = toReference(from);
    const down = fromReference(to);
    map = new Map();
    for (const [key, referenceKey] of up) {
      const target = down.get(referenceKey);
      if (target) map.set(key, target);
    }
  }
  state.correspondences.set(cacheKey, map);
  return map;
}

function mapKeys(from, to, keys) {
  if (!from || !to || !keys) return [];
  if (from === to) return [...keys];
  const map = correspondence(from, to);
  if (!map) return [];
  const result = [];
  for (const key of keys) {
    const mapped = map.get(key);
    if (mapped) result.push(mapped);
  }
  return result;
}

// Side chains around the active structure's focus are shown on the aligned residues of the
// others too, so a binding site can be compared across structures.
function mirroredFocus(entry) {
  const source = state.active;
  if (!source?.focus || source === entry) return null;
  const keys = mapKeys(source, entry, source.focus.neighborhood);
  return keys.length ? new Set(keys) : null;
}

function renderCompareResult(reference, results, options = {}) {
  const rows = results.map(({ mobile, result, error }) => {
    if (error) return `<div class="warn">${escapeHTML(mobile.name)}: ${escapeHTML(error.message)}</div>`;
    const stats = result.stats;
    const chains = result.chainPairs.length
      ? `chains ${result.chainPairs.map((pair) => (pair.ref === pair.mob ? pair.ref : `${pair.ref}↔${pair.mob}`)).join(', ')}`
      : stats.correspondence === 'uniprot' ? 'matched by UniProt numbering' : '';
    const chainTable = result.chainPairs.length > 1
      ? `<table><thead><tr><th>Chains</th><th>Pairs</th><th>Identity</th><th>RMSD</th><th>TM</th></tr></thead><tbody>${result.chainPairs.map((pair) => `<tr><td>${escapeHTML(pair.ref === pair.mob ? pair.ref : `${pair.ref}↔${pair.mob}`)}</td><td>${pair.pairs}</td><td>${(pair.identity * 100).toFixed(0)}%</td><td>${Number.isFinite(pair.rmsd) ? `${pair.rmsd.toFixed(2)} Å` : ''}</td><td>${Number.isFinite(pair.tmScore) ? pair.tmScore.toFixed(3) : ''}</td></tr>`).join('')}</tbody></table>`
      : '';
    const fittedOn = stats.fittedOn
      ? `<div class="hint">Fitted on chain ${escapeHTML(stats.fittedOn)}: it brings more residues within 2 Å than a fit of all chains, so the chains are arranged differently in the two structures. Per-chain RMSD is under this fit; per-chain TM-score uses each chain's own best superposition.</div>`
      : '';
    return `<div class="compare-summary">
      <div><strong>${escapeHTML(mobile.name)}</strong> onto <strong>${escapeHTML(reference.name)}</strong>${chains ? ` <span class="muted">· ${escapeHTML(chains)}</span>` : ''}</div>
      <dl class="compare-stats">
        <div><dt>RMSD</dt><dd>${stats.rmsd.toFixed(2)} Å <small>${stats.keptCount} of ${stats.fitCount} pairs</small></dd></div>
        <div><dt>All pairs</dt><dd>${stats.rmsdAll.toFixed(2)} Å <small>${stats.pairCount} pairs</small></dd></div>
        <div><dt>TM-score</dt><dd>${Number.isFinite(stats.tmScore) ? stats.tmScore.toFixed(3) : 'n/a'}</dd></div>
        <div title="Local Distance Difference Test, over paired Cα atoms"><dt>lDDT</dt><dd>${Number.isFinite(stats.lddt) ? stats.lddt.toFixed(3) : 'n/a'}</dd></div>
        <div><dt>Identity</dt><dd>${(stats.identity * 100).toFixed(1)}%</dd></div>
        <div><dt>Within 2 Å</dt><dd>${stats.closeCount ?? stats.keptCount} <small>of ${stats.pairCount}</small></dd></div>
      </dl>
      ${fittedOn}${chainTable}
    </div>`;
  });
  const succeeded = results.some((item) => item.result);
  const trimmed = results.some((item) => item.result && item.mobile.display.residueFilter);
  els.compareResult.hidden = false;
  els.compareResult.innerHTML = `${rows.join('')}
    ${succeeded ? `<div class="button-row">
      <button type="button" data-compare-action="deviation">Color by deviation</button>
      <button type="button" data-compare-action="lddt" title="Local Distance Difference Test: the fraction of local Cα distances (within 15 Å) that agree, per residue">Color by lDDT</button>
      <button type="button" data-compare-action="structure">Color by structure</button>
      <button type="button" data-compare-action="trim" aria-pressed="${trimmed}">${trimmed ? 'Show all residues' : 'Trim to aligned region'}</button>
    </div>
    <p class="hint">${options.note ? `${escapeHTML(options.note)} ` : ''}RMSD over Cα pairs kept after pruning pairs more than 2 Å apart${options.fitOnSelection ? ', fitted on the selected residues only' : ''}. TM-score is normalized by the reference length; lDDT compares local distances within 15 Å and needs no superposition. Hover a residue to see its deviation.</p>` : ''}`;
  els.compareResult.dataset.reference = String(reference.id);
  els.compareResult.dataset.mobiles = results.filter((item) => item.result).map((item) => item.mobile.id).join(',');
  updateCompareControls();
}

function comparedEntries() {
  const ids = new Set([els.compareResult.dataset.reference, ...(els.compareResult.dataset.mobiles ?? '').split(',')].filter(Boolean));
  const entries = state.entries.filter((entry) => ids.has(String(entry.id)));
  return entries.length ? entries : state.entries;
}

function runCompareAction(action) {
  const entries = comparedEntries();
  if (action === 'deviation' || action === 'lddt' || action === 'structure') {
    setColorScheme(action, entries);
    syncStyleControls();
    return;
  }
  if (action === 'rmsf') {
    setColorScheme('rmsf', [state.active]);
    syncStyleControls();
    return;
  }
  if (action === 'trim') {
    const mobiles = entries.filter((entry) => entry.comparison);
    const trimmed = mobiles.some((entry) => entry.display.residueFilter);
    for (const entry of mobiles) {
      trimToAligned(entry, !trimmed);
      refreshSurface(entry);
    }
    const button = els.compareResult.querySelector('[data-compare-action="trim"]');
    if (button) {
      button.textContent = trimmed ? 'Trim to aligned region' : 'Show all residues';
      button.setAttribute('aria-pressed', String(!trimmed));
    }
    markSceneDirty();
  }
}

// Fetches the AlphaFold DB model of every UniProt accession in the active entry and superposes
// each onto its chain by UniProt numbering (sequence alignment as a fallback).
async function compareWithAlphaFold() {
  const reference = state.active;
  if (!reference) return;
  if (reference.structure.meta.isPredicted) {
    showToast('Make an experimental structure active to compare it with its AlphaFold model.', true);
    return;
  }
  const accessions = new Map();
  for (const [chainId, info] of reference.structure.sequences) {
    if (info.kind !== 'protein') continue;
    for (const segment of info.uniprot ?? []) {
      const accession = segment.accession?.toUpperCase();
      if (accession && !accessions.has(accession)) accessions.set(accession, chainId);
    }
  }
  if (!accessions.size) {
    showToast(`${reference.name} has no UniProt cross-reference, so its AlphaFold model cannot be located.`, true);
    return;
  }
  const results = [];
  for (const [accession, chainId] of [...accessions].slice(0, 4)) {
    let model = state.entries.find((entry) => entry.fetchId === accession && entry !== reference) ?? null;
    if (!model) model = await fetchStructure(accession, { add: true, activate: false });
    if (!model) {
      results.push({ mobile: { name: `AF-${accession}` }, error: new Error('no AlphaFold DB model could be fetched.') });
      continue;
    }
    model.color.scheme = 'plddt';
    let result = null;
    let lastError = null;
    for (const options of [{ correspondence: 'uniprot', refChains: [chainId], accession }, { refChains: [chainId] }]) {
      try {
        result = compareStructures(pairOf(reference), pairOf(model), options);
        if (result.stats.pairCount >= 10) break;
        result = null;
      } catch (error) {
        lastError = error;
      }
    }
    if (result) {
      applyComparison(reference, model, result);
      stylePredictedComparison(reference, model);
      results.push({ mobile: model, result });
    } else {
      results.push({ mobile: model, error: lastError ?? new Error('too few residues could be paired.') });
    }
  }
  setActiveEntry(reference);
  renderCompareResult(reference, results, { note: 'Experimental structure in gray, AlphaFold model colored by pLDDT.' });
  syncStyleControls();
  markSceneDirty();
  fitView(true, false);
}

// Shows every model of an ensemble at once, superposed on the core they share, with per-residue
// RMSF; a second call returns to one model at a time.
function toggleModelOverlay() {
  const entry = state.active;
  if (!entry || entry.structure.models.length < 2) return;
  stopModelPlayback();
  if (entry.overlay) {
    entry.overlay = false;
    if (entry.color.scheme === 'rmsf') entry.color.scheme = 'chain';
  } else {
    const models = entry.structure.models.slice(0, MAX_OVERLAY_MODELS);
    const referenceIndex = Math.min(entry.activeModel, models.length - 1);
    let result;
    try {
      result = superposeEnsemble(models, referenceIndex);
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    models.forEach((model, index) => {
      const transform = result.transforms[index];
      if (isIdentityTransform(transform)) return;
      for (const atom of model.atoms) {
        const moved = transformPoint(transform, atom.x, atom.y, atom.z);
        atom.x = moved[0];
        atom.y = moved[1];
        atom.z = moved[2];
      }
      model.bounds = computeBounds(model.atoms);
      model.cartoonCache = new Map();
    });
    entry.rmsf = result.rmsf;
    entry.overlay = true;
    const values = [...result.rmsf.values()].sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    els.compareResult.hidden = false;
    els.compareResult.dataset.reference = String(entry.id);
    els.compareResult.dataset.mobiles = '';
    els.compareResult.innerHTML = `<div class="compare-summary"><div><strong>${escapeHTML(entry.name)}</strong> · ${models.length} models superposed on model ${models[referenceIndex].number}</div>
      <dl class="compare-stats">
        <div><dt>Mean RMSD</dt><dd>${result.meanRmsd.toFixed(2)} Å <small>core Cα</small></dd></div>
        <div><dt>Median RMSF</dt><dd>${median.toFixed(2)} Å</dd></div>
        <div><dt>Max RMSF</dt><dd>${(values.at(-1) ?? 0).toFixed(1)} Å</dd></div>
        <div><dt>Residues</dt><dd>${result.keys.length}</dd></div>
      </dl></div>
      <div class="button-row"><button type="button" data-compare-action="rmsf">Color by RMSF</button></div>
      <p class="hint">Each model is fitted to the reference model on Cα atoms, pruning pairs more than 2 Å apart so flexible termini do not steer the fit. RMSF is the fluctuation about the mean position.</p>`;
    if (models.length < entry.structure.models.length) showToast(`Showing the first ${MAX_OVERLAY_MODELS} of ${entry.structure.models.length} models.`);
  }
  layoutParts();
  updateModelLabel();
  updateCompareControls();
  renderStructureList();
  markSceneDirty();
  fitView(true, false);
}

/* ---------- Structure UI ---------- */

function updateStructureUI() {
  const structure = state.structure;
  const meta = structure.meta;
  els.title.textContent = meta.title;
  els.title.title = meta.title;
  const count = state.entries.length;
  els.subtitle.textContent = [count > 1 ? `${state.active.name} · ${count} structures` : '', state.sourceLabel, structure.format === 'mmcif' ? 'PDBx/mmCIF' : 'PDB'].filter(Boolean).join(' · ');
  document.title = `${meta.code || structure.label} · Proteoscope`;
  setMeta(els.metaMethod, meta.isPredicted && !meta.method ? 'Predicted model' : titleCase(meta.method) || 'Unknown');
  setMeta(els.metaResolution, meta.resolution ? meta.resolution.replace(' Angstroms', ' Å') : 'n/a');
  setMeta(els.metaRFree, meta.rFree ? Number(meta.rFree).toFixed(3) : 'n/a');
  setMeta(els.metaEntry, meta.code || 'Local');
  setMeta(els.metaOrganism, titleCase(meta.organism) || 'n/a');
  setMeta(els.metaFormat, structure.format === 'mmcif' ? 'PDBx/mmCIF' : 'PDB');
  setMeta(els.metaDate, meta.depositionDate || 'n/a');
  const assembly = structure.assemblies.find((item) => item.id === structure.activeAssemblyId);
  setMeta(els.metaAssembly, assembly ? assemblyLabel(assembly, false) : 'Asymmetric unit');
  updateAssemblyOptions();
  renderConfidenceSummary();
  const models = structure.models.length;
  els.modelsMetric.textContent = formatNumber(models);
  els.residuesMetric.textContent = formatNumber(structure.residues.filter((residue) => residue.kind !== 'water').length);
  els.chainsMetric.textContent = formatNumber(structure.chains.length);
  els.modelSlider.max = String(models);
  els.modelSlider.value = String(state.activeModel + 1);
  els.modelStrip.classList.toggle('is-visible', models > 1);
  updateModelLabel();
  renderEntities();
  updateSecondarySummary();
  populateChainSelects();
  renderChains();
  renderSequence();
  renderSelectionPanel();
  renderInteractions();
  renderMeasurements();
  renderStructureList();
  renderStyleScope();
  updateCompareControls();
  refreshTabPanels();
  clearSearch();
  updateViewOffset();
}

function activeTabName() {
  return document.querySelector('[data-tab].is-active')?.dataset.tab ?? 'structure';
}

function refreshTabPanels() {
  const tab = activeTabName();
  if (tab === 'analysis') {
    renderRamachandran();
    renderProfile();
    renderPAE();
  } else if (tab === 'proteomics') {
    renderProtParam();
  }
}

function setMeta(element, value) {
  element.textContent = value;
  element.title = value;
}

function renderConfidenceSummary() {
  const structure = state.structure;
  const residues = structure.residues.filter((residue) => residue.kind === 'protein' && Number.isFinite(residue.confidence));
  if (!structure.meta.isPredicted || !residues.length) {
    els.confidenceSummary.hidden = true;
    return;
  }
  const mean = residues.reduce((sum, residue) => sum + residue.confidence, 0) / residues.length;
  const counts = PLDDT_BANDS.map((band, index) => residues.filter((residue) => {
    const upper = index === 0 ? Infinity : PLDDT_BANDS[index - 1].min;
    return residue.confidence > band.min && residue.confidence <= upper;
  }).length);
  els.confidenceSummary.hidden = false;
  els.confidenceSummary.innerHTML = `<div><strong>Predicted model</strong> · mean pLDDT <strong>${mean.toFixed(1)}</strong> over ${formatNumber(residues.length)} residues${structure.meta.confidenceSource ? ` · ${escapeHTML(structure.meta.confidenceSource)}` : ''}</div>
    <div class="confidence-bar">${PLDDT_BANDS.map((band, index) => `<i title="${escapeHTML(band.label)}: ${counts[index]}" style="flex:${counts[index]};background:${colorToHex(band.color)}"></i>`).join('')}</div>`;
}

function updateAssemblyOptions() {
  const structure = state.structure;
  const hasAssemblies = structure.assemblies.length > 0 && !(structure.assemblies.length === 1 && structure.assemblies[0].estimatedAtoms === structure.baseModels[0].atoms.length && structure.format === 'pdb');
  els.assemblyField.hidden = !hasAssemblies;
  els.assemblySelect.replaceChildren();
  if (!hasAssemblies) return;
  els.assemblySelect.appendChild(new Option('Asymmetric unit', ASYMMETRIC_UNIT_ID));
  for (const assembly of structure.assemblies) {
    const option = new Option(assemblyLabel(assembly, true), assembly.id);
    option.disabled = assembly.estimatedAtoms > MAX_ASSEMBLY_ATOMS;
    if (option.disabled) {
      option.textContent += ' · too large';
      option.title = `Estimated ${formatNumber(assembly.estimatedAtoms)} atoms/model exceeds the ${formatNumber(MAX_ASSEMBLY_ATOMS)} atom safety limit.`;
    }
    els.assemblySelect.appendChild(option);
  }
  els.assemblySelect.value = structure.activeAssemblyId;
}

function assemblyLabel(assembly, includeAtoms) {
  const details = assembly.oligomericDetails || assembly.details || 'assembly';
  const atoms = includeAtoms && assembly.estimatedAtoms ? ` · ${formatNumber(assembly.estimatedAtoms)} atoms` : '';
  return `${assembly.id}: ${details}${atoms}`;
}

function renderEntities() {
  const structure = state.structure;
  const fragment = document.createDocumentFragment();
  const polymerChains = structure.chains.filter((chain) => chain.polymerKind);
  const groups = new Map();
  for (const chain of polymerChains) {
    const key = chain.description || `Chain ${chain.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chain);
  }
  for (const [description, chains] of groups) {
    const row = document.createElement('div');
    const color = chainPaletteColor(structure.chains.indexOf(chains[0]), state.color.palette);
    row.innerHTML = `<i style="background:${colorToHex(color)}"></i><span title="${escapeHTML(description)}">${escapeHTML(titleCase(description))}</span><em>${escapeHTML(chains.map((chain) => chain.id).join(', '))}</em>`;
    fragment.appendChild(row);
  }
  const ligands = new Set();
  for (const residue of structure.residues) {
    if (residue.kind === 'ligand' || residue.kind === 'ion') ligands.add(residue.resName);
  }
  if (ligands.size) {
    const row = document.createElement('div');
    const names = [...ligands].map((id) => {
      const name = structure.componentNames?.get(id);
      return name ? `${id}: ${titleCase(name)}` : id;
    });
    row.title = names.join('\n');
    row.innerHTML = `<i style="background:#5bdb80"></i><span>Ligands &amp; ions</span><em>${escapeHTML([...ligands].slice(0, 8).join(', '))}${ligands.size > 8 ? '…' : ''}</em>`;
    fragment.appendChild(row);
  }
  els.entityList.replaceChildren(fragment);
}

function updateSecondarySummary() {
  const model = activeModel();
  const counts = dsspSummary(model.residues.map((residue) => residue.dssp));
  const protein = model.residues.filter((residue) => residue.kind === 'protein').length;
  if (!protein) {
    els.ssSummary.textContent = 'No protein chains.';
    return;
  }
  const helix = (counts.H ?? 0) + (counts.G ?? 0) + (counts.I ?? 0);
  const strand = counts.E ?? 0;
  const source = model.residues.find((residue) => residue.kind === 'protein' && residue.ssSource !== 'none')?.ssSource ?? 'none';
  els.ssSummary.textContent = `Showing ${source === 'none' ? 'coil only' : source}. DSSP: ${pct(helix, protein)} helix, ${pct(strand, protein)} strand across ${formatNumber(protein)} residues.`;
}

function populateChainSelects() {
  const structure = state.structure;
  const polymer = structure.chains.filter((chain) => chain.polymerKind);
  const proteinChains = polymer.filter((chain) => chain.polymerKind === 'protein');
  const fill = (select, chains, includeAll = false) => {
    const previous = select.value;
    select.replaceChildren();
    if (includeAll) select.appendChild(new Option('All chains', '*'));
    for (const chain of chains) select.appendChild(new Option(chainOptionLabel(chain), chain.id));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  };
  fill(els.sequenceChain, polymer);
  fill(els.ramaChain, proteinChains, true);
  fill(els.profileChain, polymer);
  fill(els.protparamChain, polymer);
  fill(els.uniprotChain, proteinChains);
  fill(els.interfaceA, polymer);
  fill(els.interfaceB, polymer);
  if (polymer.length > 1 && els.interfaceA.value === els.interfaceB.value) els.interfaceB.value = polymer[1].id;
  els.sequencePanel.hidden = !polymer.length;
  els.app.classList.toggle('no-sequence', !polymer.length);
}

function chainOptionLabel(chain) {
  return `${chain.id}${chain.description ? ` · ${titleCase(chain.description).slice(0, 40)}` : ''}`;
}

function renderChains() {
  if (!state.structure) return;
  els.chainsTitle.textContent = state.entries.length > 1 ? `Chains · ${state.active.name}` : 'Chains';
  const fragment = document.createDocumentFragment();
  state.structure.chains.forEach((chain, index) => {
    const visible = !state.display.visibleChains || state.display.visibleChains.has(chain.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chain-button${visible ? '' : ' is-hidden-chain'}`;
    button.setAttribute('aria-pressed', String(visible));
    button.title = `${visible ? 'Hide' : 'Show'} chain ${chain.id} · double-click to show only this chain`;
    const color = chainPaletteColor(index, state.color.palette);
    const kind = chain.polymerKind || (chain.kinds.water === chain.residues ? 'water' : 'ligand');
    const detail = chain.polymerKind ? `${formatNumber(chain.polymerResidues)} residues · ${formatNumber(chain.atoms)} atoms` : `${formatNumber(chain.residues)} groups · ${formatNumber(chain.atoms)} atoms`;
    button.innerHTML = `<span class="chain-swatch" style="--swatch:${colorToHex(color)}"></span><span><strong>${escapeHTML(chain.id)}${chain.description ? ` · ${escapeHTML(titleCase(chain.description))}` : ''}</strong><small>${detail}</small></span><em>${kind === 'protein' ? 'prot' : kind === 'nucleic' ? 'NA' : kind}</em>`;
    button.addEventListener('click', () => toggleChain(chain.id));
    button.addEventListener('dblclick', () => setVisibleChains(new Set([chain.id])));
    fragment.appendChild(button);
  });
  els.chainList.replaceChildren(fragment);
  els.chainsAll.disabled = !state.display.visibleChains;
}

function toggleChain(chainID) {
  const all = state.structure.chains.map((chain) => chain.id);
  const visible = new Set(state.display.visibleChains ?? all);
  if (visible.has(chainID)) visible.delete(chainID);
  else visible.add(chainID);
  setVisibleChains(visible.size === all.length ? null : visible);
}

function invertChains() {
  const all = state.structure.chains.map((chain) => chain.id);
  const visible = state.display.visibleChains ?? new Set(all);
  const inverted = new Set(all.filter((id) => !visible.has(id)));
  setVisibleChains(inverted.size === 0 || inverted.size === all.length ? null : inverted);
}

function setVisibleChains(chains) {
  state.display.visibleChains = chains;
  renderChains();
  markSceneDirty();
  refreshSurface(state.active);
}

/* ---------- Sequence ---------- */

function renderSequence() {
  if (!state.structure || !sequenceView) return;
  const info = state.structure.sequences.get(els.sequenceChain.value) ?? [...state.structure.sequences.values()][0];
  if (!info) {
    sequenceView.render(null);
    els.sequenceInfo.textContent = '';
    return;
  }
  sequenceView.render(info, residueColor, { partner: sequencePartner() });
  const uniprot = info.uniprot?.[0];
  const missing = info.items.filter((item) => !item.residue && !item.gap).length;
  els.sequenceInfo.textContent = [
    `${info.items.filter((item) => !item.gap).length} residues`,
    missing ? `${missing} not modeled` : '',
    info.source === 'model' ? 'from coordinates' : `from ${info.source}`,
    uniprot?.accession ? `UniProt ${uniprot.accession}` : '',
  ].filter(Boolean).join(' · ');
}

// Structures whose residues are paired with the active one (directly or through a shared
// reference) can be shown as a second sequence row.
function sequencePartner() {
  const active = state.active;
  const partners = active ? state.entries.filter((entry) => entry !== active && correspondence(active, entry)?.size) : [];
  els.sequencePartner.hidden = !partners.length;
  if (!partners.length) {
    els.sequencePartner.replaceChildren();
    return null;
  }
  const choice = state.sequencePartnerChoice;
  els.sequencePartner.replaceChildren(new Option('No aligned row', 'none'), ...partners.map((entry) => new Option(`Aligned: ${entry.name}`, String(entry.id))));
  const partner = choice === 'none' ? null : partners.find((entry) => String(entry.id) === choice) ?? partners.at(-1);
  els.sequencePartner.value = partner ? String(partner.id) : 'none';
  if (!partner) return null;
  const map = correspondence(active, partner);
  const model = activeModelOf(partner);
  return {
    name: partner.name,
    lookup(key) {
      const residue = model.residueMap.get(map.get(key));
      if (!residue) return null;
      const deviation = comparisonFor(active)?.partnerName === partner.name ? comparisonFor(active).lookup(key) : null;
      return { code: residue.code || 'X', label: `${residue.resName} ${residue.chain}${residue.resSeq}${residue.iCode || ''}${deviation ? ` · ${deviation.distance.toFixed(1)} Å` : ''}` };
    },
  };
}

/* ---------- Selection panel ---------- */

function renderSelectionPanel() {
  const model = state.structure ? activeModel() : null;
  const keys = [...state.selection];
  els.selectionDetails.replaceChildren();
  const disabled = !keys.length;
  for (const button of [els.focusSelection, els.labelSelection, els.isolateSelection, els.focusButton]) button.disabled = disabled;
  if (!model || !keys.length) {
    els.selectionTitle.textContent = 'Nothing selected';
    els.selectionHint.hidden = false;
    return;
  }
  els.selectionHint.hidden = true;
  if (keys.length > 1) {
    const residues = keys.map((key) => model.residueMap.get(key)).filter(Boolean);
    els.selectionTitle.textContent = `${residues.length} residues selected`;
    addDetail('Residues', residues.slice(0, 6).map((residue) => `${residue.resName}${residue.resSeq}`).join(', ') + (residues.length > 6 ? '…' : ''), true);
    addDetail('Chains', [...new Set(residues.map((residue) => residue.chain))].join(', '));
    addDetail('Atoms', formatNumber(residues.reduce((sum, residue) => sum + residue.atoms.length, 0)));
    return;
  }
  const residue = model.residueMap.get(keys[0]);
  if (!residue) return;
  els.selectionTitle.textContent = residueLabel(residue);
  const chain = state.structure.chains.find((item) => item.id === residue.chain);
  const componentName = componentNameOf(residue);
  if (componentName) addDetail('Name', componentName, true);
  else if (chain?.description) addDetail('Molecule', titleCase(chain.description), true);
  addDetail('Type', residue.modified ? `${residue.kind} (modified ${residue.parent})` : residue.kind);
  if (residue.kind === 'protein') {
    addDetail('Secondary', secondaryText(residue));
    if (Number.isFinite(residue.phi) || Number.isFinite(residue.psi)) addDetail('φ / ψ', `${formatAngle(residue.phi)} / ${formatAngle(residue.psi)}`);
  }
  if (state.structure.meta.isPredicted && Number.isFinite(residue.confidence)) addDetail('pLDDT', residue.confidence.toFixed(1));
  else addDetail('Mean B', residue.bFactor.toFixed(1));
  const info = state.structure.sequences.get(residue.chain);
  const uniprot = info ? uniprotPositionForResidue(info, residue) : null;
  if (uniprot) addDetail('UniProt', `${uniprot.accession} ${residue.code}${uniprot.position}`);
  const relative = state.sasa?.relative?.get(residue.key);
  if (Number.isFinite(relative)) addDetail('Rel. SASA', `${(relative * 100).toFixed(0)}%`);
  const extra = residueDataText(residue);
  if (extra) addDetail('Data', extra, true);
  const atom = state.selectedAtom?.residueKey === residue.key ? state.selectedAtom : null;
  if (atom) {
    addDetail('Atom', `${atom.name} (${atom.element}) #${atom.serial}`);
    addDetail('Occupancy · B', `${atom.occupancy.toFixed(2)} · ${atom.bFactor.toFixed(1)}${atom.altCount ? ` · ${atom.altCount} alt` : ''}`);
  }
}

function addDetail(label, value, wide = false) {
  const div = document.createElement('div');
  if (wide) div.className = 'wide';
  div.innerHTML = `<dt>${escapeHTML(label)}</dt><dd title="${escapeHTML(value)}">${escapeHTML(value)}</dd>`;
  els.selectionDetails.appendChild(div);
}

/* ---------- Interactions ---------- */

function renderInteractionTypeToggles() {
  const fragment = document.createDocumentFragment();
  for (const type of state.interactionTypes) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" ${state.interactions.enabled.has(type.id) ? 'checked' : ''} /><i style="background:${type.color}"></i>${escapeHTML(type.label)}`;
    label.querySelector('input').addEventListener('change', (event) => {
      if (event.target.checked) state.interactions.enabled.add(type.id);
      else state.interactions.enabled.delete(type.id);
      renderInteractions();
      markSceneDirty();
    });
    fragment.appendChild(label);
  }
  els.interactionTypes.replaceChildren(fragment);
}

function renderInteractions() {
  const list = state.interactions.list.filter((item) => state.interactions.enabled.has(item.type));
  els.interactionsCard.hidden = !state.interactions.list.length && !state.interactions.title;
  els.interactionCount.textContent = state.interactions.title ? `${state.interactions.title} · ${list.length}` : String(list.length);
  const counts = new Map();
  for (const item of list) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  els.interactionSummary.replaceChildren(...state.interactionTypes.filter((type) => counts.has(type.id)).map((type) => {
    const chip = document.createElement('span');
    chip.innerHTML = `<i style="background:${type.color}"></i>${escapeHTML(type.label)} ${counts.get(type.id)}`;
    return chip;
  }));
  const model = state.structure ? activeModel() : null;
  const typeInfo = new Map(state.interactionTypes.map((type) => [type.id, type]));
  const fragment = document.createDocumentFragment();
  for (const item of list.slice(0, 300)) {
    const row = document.createElement('div');
    row.className = 'list-row';
    const a = model?.residueMap.get(item.residueA);
    const b = model?.residueMap.get(item.residueB);
    const type = typeInfo.get(item.type);
    row.innerHTML = `<i style="background:${type?.color ?? '#999'}"></i><span title="${escapeHTML(type?.label ?? item.type)}">${escapeHTML(`${a ? shortResidueLabel(a) : '?'} ↔ ${b ? shortResidueLabel(b) : '?'}`)}</span><strong>${Number.isFinite(item.distance) ? `${item.distance.toFixed(2)} Å` : ''}</strong><span></span>`;
    row.addEventListener('click', () => {
      const keys = [item.residueA, item.residueB].filter(Boolean);
      selectResidues(keys, { frame: true });
    });
    fragment.appendChild(row);
  }
  els.interactionList.replaceChildren(fragment);
}

async function runInterfaceAnalysis() {
  if (!state.structure) return;
  const chainA = els.interfaceA.value;
  const chainB = els.interfaceB.value;
  if (!chainA || !chainB || chainA === chainB) {
    showToast('Choose two different chains for interface analysis.', true);
    return;
  }
  const module = await loadModule('interactions', './lib/interactions.js');
  if (!module) return;
  const model = activeModel();
  const list = module.findInterfaceInteractions
    ? module.findInterfaceInteractions(model, chainA, chainB, { includeWater: state.display.showWater })
    : module.findInteractions(model, model.atoms.filter((atom) => atom.chain === chainA).map((atom) => atom.id), {
      groupB: model.atoms.filter((atom) => atom.chain === chainB).map((atom) => atom.id),
    });
  state.interactions = { ...state.interactions, list, title: `${chainA}:${chainB} interface` };
  const residues = new Set();
  for (const item of list) {
    if (item.residueA) residues.add(item.residueA);
    if (item.residueB) residues.add(item.residueB);
  }
  state.focus = { residues: new Set(residues), neighborhood: new Set(residues) };
  const counts = new Map();
  for (const item of list) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  const typeInfo = new Map(state.interactionTypes.map((type) => [type.id, type]));
  els.interfaceResult.hidden = false;
  els.interfaceResult.innerHTML = `<strong>${list.length}</strong> contacts between chains ${escapeHTML(chainA)} and ${escapeHTML(chainB)} · ${residues.size} interface residues<ul>${[...counts].map(([type, count]) => `<li>${escapeHTML(typeInfo.get(type)?.label ?? type)}: ${count}</li>`).join('')}</ul>${state.sasa ? '' : '<span class="hint">Compute SASA to add buried surface area.</span>'}`;
  if (state.sasa) appendBuriedArea(chainA, chainB);
  renderInteractions();
  markSceneDirty();
  const atoms = [...residues].flatMap((key) => model.residueMap.get(key)?.atoms ?? []);
  if (atoms.length) fitView(true, false, atoms);
}

function exportInteractionsCSV() {
  if (!state.interactions.list.length || !state.structure) {
    showToast('No interactions to export yet.', true);
    return;
  }
  const model = activeModel();
  const rows = [['type', 'residue_a', 'atom_a', 'residue_b', 'atom_b', 'distance_angstrom']];
  for (const item of state.interactions.list) {
    const a = model.residueMap.get(item.residueA);
    const b = model.residueMap.get(item.residueB);
    rows.push([item.type, a ? shortResidueLabel(a) : '', model.atoms[item.atomA]?.name ?? 'centroid', b ? shortResidueLabel(b) : '', model.atoms[item.atomB]?.name ?? 'centroid', Number.isFinite(item.distance) ? item.distance.toFixed(2) : '']);
  }
  downloadText(`${fileStem()}-interactions.csv`, rows.map((row) => row.join(',')).join('\n'), 'text/csv');
}

/* ---------- Surfaces and SASA ---------- */

function surfaceWorker() {
  if (!state.workers) {
    const worker = new Worker(new URL('./lib/surface-worker.js', import.meta.url), { type: 'module' });
    const pending = new Map();
    let counter = 0;
    worker.addEventListener('message', (event) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });
    worker.addEventListener('error', (event) => {
      for (const entry of pending.values()) entry.reject(new Error(event.message || 'Surface worker failed'));
      pending.clear();
    });
    state.workers = {
      run(type, payload, transfer = []) {
        counter += 1;
        const id = counter;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, type, payload }, transfer);
        });
      },
    };
  }
  return state.workers;
}

function surfaceAtoms(entry, model) {
  const { visibleChains, residueFilter } = entry.display;
  return model.atoms.filter((atom) => atom.kind !== 'water' && !atom.isHydrogen
    && (!visibleChains || visibleChains.has(atom.chain))
    && (!residueFilter || (atom.kind !== 'protein' && atom.kind !== 'nucleic') || residueFilter.has(atom.residueKey)));
}

// Recomputes the surface of one structure, or of every structure when none is given.
async function refreshSurface(target = null) {
  const entries = target ? [target] : [...state.entries];
  await Promise.all(entries.map(refreshEntrySurface));
}

async function refreshEntrySurface(entry) {
  const surface = entry.surface;
  const meshId = `surface:${entry.id}`;
  const isActive = entry === state.active;
  if (surface.kind === 'off' || !entry.visible) {
    if (surface.kind === 'off') {
      surface.data = null;
      surface.key = '';
    }
    state.renderer.setMesh(meshId, null);
    if (isActive) els.surfaceStatus.textContent = '';
    renderLegend();
    requestRender();
    return;
  }
  if (state.renderer.kind !== 'webgpu') {
    if (isActive) els.surfaceStatus.textContent = 'Surfaces need WebGPU.';
    return;
  }
  const model = activeModelOf(entry);
  const atoms = surfaceAtoms(entry, model);
  const key = [entry.structure.activeAssemblyId, model.number, surface.kind, entry.display.visibleChains ? [...entry.display.visibleChains].sort().join(',') : '*', entry.display.residueFilterKey || '*', entry.transformVersion].join('|');
  if (key === surface.key && surface.data) {
    if (!state.renderer.meshIds().includes(meshId)) await applySurfaceColors(entry, true);
    return;
  }
  surface.key = key;
  const ticket = (surface.pending += 1);
  const positions = new Float32Array(atoms.length * 3);
  const radii = new Float32Array(atoms.length);
  atoms.forEach((atom, index) => {
    positions[index * 3] = atom.x;
    positions[index * 3 + 1] = atom.y;
    positions[index * 3 + 2] = atom.z;
    radii[index] = elementInfo(atom.element).vdw;
  });
  const label = els.surfaceKind.querySelector(`option[value="${surface.kind}"]`)?.textContent ?? surface.kind;
  if (isActive) els.surfaceStatus.textContent = `Computing ${label} surface for ${formatNumber(atoms.length)} atoms…`;
  const started = performance.now();
  try {
    const result = await surfaceWorker().run('surface', { positions, radii, options: { kind: surface.kind } }, [positions.buffer, radii.buffer]);
    if (ticket !== surface.pending || !state.entries.includes(entry)) return;
    const atomIds = new Uint32Array(result.atoms.length);
    for (let index = 0; index < result.atoms.length; index += 1) atomIds[index] = atoms[result.atoms[index]]?.id ?? 0;
    surface.data = { positions: result.positions, normals: result.normals, indices: result.indices, atoms: atomIds, potential: null };
    const triangles = result.indices.length / 3;
    surface.status = `${formatNumber(triangles)} triangles · ${((performance.now() - started) / 1000).toFixed(1)} s${result.spacing ? ` · grid ${result.spacing.toFixed(2)} Å` : ''}`;
    if (entry === state.active) els.surfaceStatus.textContent = surface.status;
    await applySurfaceColors(entry, true);
  } catch (error) {
    console.error(error);
    if (ticket === surface.pending && entry === state.active) els.surfaceStatus.textContent = `Surface failed: ${error.message}`;
  }
}

async function applySurfaceColors(entry = state.active, force = true) {
  const data = entry?.surface.data;
  if (!data || !entry.visible) return;
  const model = activeModelOf(entry);
  const mode = entry.surface.color;
  const vertexCount = data.positions.length / 3;
  const isActive = entry === state.active;
  let vertexColors = null;
  if (mode === 'electrostatic') {
    if (!data.potential) {
      const module = await loadModule('electrostatics', './lib/electrostatics.js');
      if (!module) return;
      const charges = module.assignCharges(model.atoms, model.residues);
      const charged = [];
      for (let index = 0; index < charges.length; index += 1) if (charges[index] !== 0) charged.push(index);
      const chargePositions = new Float32Array(charged.length * 3);
      const chargeValues = new Float32Array(charged.length);
      charged.forEach((atomIndex, index) => {
        const atom = model.atoms[atomIndex];
        chargePositions[index * 3] = atom.x;
        chargePositions[index * 3 + 1] = atom.y;
        chargePositions[index * 3 + 2] = atom.z;
        chargeValues[index] = charges[atomIndex];
      });
      if (isActive) els.surfaceStatus.textContent = 'Computing Coulombic potential…';
      const points = data.positions.slice();
      const normals = data.normals.slice();
      data.potential = await surfaceWorker().run('potential', {
        points,
        normals,
        chargePositions,
        charges: chargeValues,
        options: { offset: 1.4 },
      }, [points.buffer, normals.buffer, chargePositions.buffer, chargeValues.buffer]);
      data.range = module.COULOMBIC_RANGE ?? [-10, 10];
      entry.surface.status = `${formatNumber(data.indices.length / 3)} triangles · Coulombic potential from ${formatNumber(charged.length)} charged atoms`;
      if (entry === state.active) els.surfaceStatus.textContent = entry.surface.status;
      if (data !== entry.surface.data) return;
    }
    vertexColors = new Uint32Array(vertexCount);
    const [low, high] = data.range;
    for (let index = 0; index < vertexCount; index += 1) {
      const t = (data.potential[index] - low) / (high - low);
      vertexColors[index] = packColor(sampleColormap('electrostatic', t));
    }
  } else if (mode === 'hydrophobicity') {
    vertexColors = new Uint32Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) {
      const atom = model.atoms[data.atoms[index]];
      const residue = atom ? residueIn(model, atom) : null;
      const value = KYTE_DOOLITTLE[residue?.parent];
      vertexColors[index] = packColor(value === undefined ? [0.85, 0.85, 0.85] : sampleColormap('hydrophobicity', (value + 4.5) / 9));
    }
  } else if (mode === 'uniform') {
    vertexColors = new Uint32Array(vertexCount).fill(packColor([0.93, 0.93, 0.93]));
  }
  if (!force && !vertexColors && data.uploadedMode === 'scheme') return;
  const buffer = new ArrayBuffer(vertexCount * MESH_VERTEX_STRIDE);
  const floats = new Float32Array(buffer);
  const uints = new Uint32Array(buffer);
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 8;
    floats[offset] = data.positions[index * 3];
    floats[offset + 1] = data.positions[index * 3 + 1];
    floats[offset + 2] = data.positions[index * 3 + 2];
    floats[offset + 3] = data.normals[index * 3];
    floats[offset + 4] = data.normals[index * 3 + 1];
    floats[offset + 5] = data.normals[index * 3 + 2];
    uints[offset + 6] = data.atoms[index];
    uints[offset + 7] = vertexColors ? vertexColors[index] : 0;
  }
  data.uploadedMode = mode;
  const part = state.partByModel.get(model);
  state.renderer.setMesh(`surface:${entry.id}`, { vertices: buffer, indices: data.indices, opacity: entry.surface.opacity, atomOffset: part?.offset ?? 0 });
  if (mode === 'electrostatic') {
    entry.surfaceLegend = { type: 'gradient', title: 'Coulombic potential (kcal/mol·e)', colormap: 'electrostatic', minLabel: String(data.range[0]), maxLabel: `+${data.range[1]}`, note: 'Formal charges, ε = 4r, 1.4 Å offset' };
  } else if (mode === 'hydrophobicity') {
    entry.surfaceLegend = { type: 'gradient', title: 'Surface hydropathy', colormap: 'hydrophobicity', minLabel: 'Hydrophilic', maxLabel: 'Hydrophobic' };
  } else {
    entry.surfaceLegend = null;
  }
  renderLegend();
  requestRender();
}

async function runSASA() {
  if (!state.structure) return;
  if (typeof Worker === 'undefined') return;
  const model = activeModel();
  const atoms = model.atoms.filter((atom) => atom.kind !== 'water' && !atom.isHydrogen);
  els.sasaResult.hidden = false;
  els.sasaResult.textContent = `Computing SASA for ${formatNumber(atoms.length)} atoms…`;
  const chainIndex = new Map(state.structure.chains.map((chain, index) => [chain.id, index]));
  const positions = new Float32Array(atoms.length * 3);
  const radii = new Float32Array(atoms.length);
  const groups = new Int32Array(atoms.length);
  atoms.forEach((atom, index) => {
    positions[index * 3] = atom.x;
    positions[index * 3 + 1] = atom.y;
    positions[index * 3 + 2] = atom.z;
    radii[index] = elementInfo(atom.element).vdw;
    groups[index] = chainIndex.get(atom.chain) ?? -1;
  });
  try {
    const started = performance.now();
    const result = await surfaceWorker().run('sasa-groups', { positions, radii, groups, options: { probe: 1.4, points: 96 } }, [positions.buffer, radii.buffer, groups.buffer]);
    if (model !== activeModel()) return;
    const atomSASA = new Float32Array(model.atoms.length);
    const isolatedSASA = new Float32Array(model.atoms.length);
    atoms.forEach((atom, index) => {
      atomSASA[atom.id] = result.complex[index];
      isolatedSASA[atom.id] = result.isolated[index];
    });
    const relative = new Map();
    const absolute = new Map();
    for (const residue of model.residues) {
      if (residue.kind === 'water') continue;
      const total = residue.atoms.reduce((sum, atom) => sum + atomSASA[atom.id], 0);
      absolute.set(residue.key, total);
      const max = MAX_ASA[residue.parent];
      if (max) relative.set(residue.key, total / max);
    }
    const chains = [];
    for (const chain of state.structure.chains.filter((item) => item.polymerKind)) {
      const chainAtoms = atoms.filter((atom) => atom.chain === chain.id);
      const inComplex = chainAtoms.reduce((sum, atom) => sum + atomSASA[atom.id], 0);
      const alone = chainAtoms.reduce((sum, atom) => sum + isolatedSASA[atom.id], 0);
      chains.push({ id: chain.id, inComplex, alone, buried: alone - inComplex });
    }
    state.sasa = { atomSASA, relative, absolute, chains, atoms };
    els.sasaColor.disabled = false;
    const total = atoms.reduce((sum, atom) => sum + atomSASA[atom.id], 0);
    els.sasaResult.innerHTML = `Total SASA <strong>${formatNumber(Math.round(total))} Å²</strong> · ${((performance.now() - started) / 1000).toFixed(1)} s
      <table><thead><tr><th>Chain</th><th>SASA</th><th>Alone</th><th>Buried</th></tr></thead><tbody>${chains.map((chain) => `<tr><td>${escapeHTML(chain.id)}</td><td>${formatNumber(Math.round(chain.inComplex))}</td><td>${formatNumber(Math.round(chain.alone))}</td><td>${formatNumber(Math.round(chain.buried))}</td></tr>`).join('')}</tbody></table>
      <span class="hint">Buried = SASA of the isolated chain minus SASA in the complex (Å²).</span>`;
    renderSelectionPanel();
    renderProfile();
    if (state.color.scheme === 'exposure') markColorsDirty();
  } catch (error) {
    console.error(error);
    els.sasaResult.textContent = `SASA failed: ${error.message}`;
  }
}

async function appendBuriedArea(chainA, chainB) {
  const model = activeModel();
  const atoms = model.atoms.filter((atom) => (atom.chain === chainA || atom.chain === chainB) && atom.kind !== 'water' && !atom.isHydrogen);
  const positions = new Float32Array(atoms.length * 3);
  const radii = new Float32Array(atoms.length);
  atoms.forEach((atom, index) => {
    positions.set([atom.x, atom.y, atom.z], index * 3);
    radii[index] = elementInfo(atom.element).vdw;
  });
  const result = await surfaceWorker().run('sasa', { positions, radii, options: { probe: 1.4, points: 96 } }, [positions.buffer, radii.buffer]);
  const pair = (result.sasa ?? result).reduce((sum, value) => sum + value, 0);
  const alone = (id) => state.sasa.chains.find((chain) => chain.id === id)?.alone ?? 0;
  const buried = alone(chainA) + alone(chainB) - pair;
  els.interfaceResult.insertAdjacentHTML('beforeend', `<div>Buried surface area <strong>${formatNumber(Math.round(buried))} Å²</strong> (≈ ${formatNumber(Math.round(buried / 2))} Å² per side)</div>`);
}

/* ---------- Plots ---------- */

function renderRamachandran() {
  if (!state.structure) return;
  const model = activeModel();
  const chain = els.ramaChain.value || '*';
  const residues = model.residues.filter((residue) => residue.kind === 'protein' && (chain === '*' || residue.chain === chain));
  const result = drawRamachandran(els.ramaCanvas, residues, { selected: state.selection });
  ramaPoints = result;
  const plotted = result.points.length;
  const ssCounts = { helix: 0, sheet: 0 };
  for (const item of result.points) if (item.residue.ss in ssCounts) ssCounts[item.residue.ss] += 1;
  els.ramaSummary.textContent = plotted
    ? `${plotted} residues · colored by secondary structure; triangles Gly, squares Pro. Shaded regions are approximate favored areas. Click a point to select it.`
    : 'No residues with complete backbone dihedrals.';
}

function onRamaClick(event) {
  if (!ramaPoints) return;
  const rect = els.ramaCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (els.ramaCanvas.width / rect.width);
  const y = (event.clientY - rect.top) * (els.ramaCanvas.height / rect.height);
  let best = null;
  for (const item of ramaPoints.points) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d <= ramaPoints.radius * 2 && (!best || d < best.d)) best = { d, item };
  }
  if (best) selectResidues([best.item.residue.key], { additive: event.shiftKey, frame: true });
}

function profileSeries() {
  const model = activeModel();
  const chain = els.profileChain.value;
  const metric = els.profileMetric.value;
  const residues = model.residues.filter((residue) => residue.chain === chain && (residue.kind === 'protein' || residue.kind === 'nucleic'));
  if (metric === 'bfactor') {
    const predicted = state.structure.meta.isPredicted;
    return {
      label: predicted ? 'pLDDT' : 'Mean B-factor (Å²)',
      series: residues.map((residue) => ({ residue, value: predicted && Number.isFinite(residue.confidence) ? residue.confidence : residue.bFactor })),
      options: predicted ? { min: 0, max: 100, bands: PLDDT_BANDS.map((band, index) => ({ from: Math.max(0, band.min), to: index === 0 ? 100 : PLDDT_BANDS[index - 1].min, color: `${colorToHex(band.color)}33` })) } : {},
    };
  }
  if (metric === 'sasa') {
    if (!state.sasa) return { label: 'Relative SASA', series: [], options: { emptyText: 'Compute SASA first' } };
    return { label: 'Relative SASA', series: residues.map((residue) => ({ residue, value: state.sasa.relative.get(residue.key) ?? NaN })), options: { min: 0 } };
  }
  if (metric === 'hydrophobicity') {
    const window = 9;
    const values = residues.map((residue) => KYTE_DOOLITTLE[residue.parent]);
    return {
      label: 'Kyte-Doolittle (window 9)',
      series: residues.map((residue, index) => {
        const slice = values.slice(Math.max(0, index - 4), index + 5).filter(Number.isFinite);
        return { residue, value: slice.length >= Math.min(window, residues.length) / 2 ? slice.reduce((a, b) => a + b, 0) / slice.length : NaN };
      }),
      options: { min: -4.5, max: 4.5, bands: [{ from: 0, to: 4.5, color: 'rgba(204,140,13,0.12)' }] },
    };
  }
  const data = state.proteomics.data;
  if (!data) return { label: 'Custom data', series: [], options: { emptyText: 'Load residue data in the Proteomics tab' } };
  return { label: state.proteomics.dataLabel || 'Custom data', series: residues.map((residue) => ({ residue, value: data.get(residue.key) ?? NaN })), options: {} };
}

function renderProfile() {
  if (!state.structure) return;
  const { label, series, options } = profileSeries();
  profilePoints = drawProfile(els.profileCanvas, series, { ...options, label, selected: state.selection });
}

function onProfileClick(event) {
  if (!profilePoints?.points.length) return;
  const rect = els.profileCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (els.profileCanvas.width / rect.width);
  let best = null;
  for (const item of profilePoints.points) {
    const d = Math.abs(item.x - x);
    if (!best || d < best.d) best = { d, item };
  }
  if (best?.item.residue) selectResidues([best.item.residue.key], { additive: event.shiftKey, frame: true });
}

/* ---------- PAE ---------- */

async function loadPAEFromURL(url, entry = state.active) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    loadPAEFromJSON(await response.json(), 'AlphaFold DB', entry);
  } catch (error) {
    console.warn('PAE fetch failed', error);
  }
}

function loadPAEFromJSON(json, source, entry = state.active) {
  if (!entry) return;
  const document0 = Array.isArray(json) ? json[0] : json;
  const matrix = document0?.predicted_aligned_error ?? document0?.pae;
  if (!Array.isArray(matrix) || !Array.isArray(matrix[0])) {
    showToast(`${source}: no PAE matrix found (expected predicted_aligned_error or pae).`, true);
    return;
  }
  const size = matrix.length;
  const flat = new Float32Array(size * size);
  let max = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = Number(matrix[row][column]) || 0;
      flat[row * size + column] = value;
      if (value > max) max = value;
    }
  }
  const residues = paeResidues(size, document0, entry);
  entry.pae = {
    size,
    matrix: flat,
    max: Number(document0.max_predicted_aligned_error ?? document0.max_pae) || Math.max(31.75, max),
    residues,
    chainBoundaries: chainBoundaries(residues),
    source,
  };
  if (Array.isArray(document0.plddt) && !entry.structure.meta.isPredicted) {
    entry.structure.meta.isPredicted = true;
  }
  if (entry === state.active) {
    renderPAE();
    showToast(`Loaded PAE matrix (${size} × ${size}) from ${source}.`);
  }
}

function paeResidues(size, document0, entry = state.active) {
  if (!entry) return [];
  const model = activeModelOf(entry);
  const chains = document0.token_chain_ids;
  const numbers = document0.token_res_ids;
  if (Array.isArray(chains) && Array.isArray(numbers) && chains.length === size) {
    const byKey = new Map(model.residues.map((residue) => [`${residue.chain}:${residue.resSeq}`, residue]));
    return chains.map((chain, index) => byKey.get(`${chain}:${numbers[index]}`) ?? null);
  }
  const polymer = model.residues.filter((residue) => residue.kind === 'protein' || residue.kind === 'nucleic');
  return Array.from({ length: size }, (_, index) => polymer[index] ?? null);
}

function chainBoundaries(residues) {
  const boundaries = [];
  for (let index = 1; index < residues.length; index += 1) {
    if (residues[index]?.chain !== residues[index - 1]?.chain) boundaries.push(index);
  }
  return boundaries;
}

function renderPAE() {
  const pae = state.pae;
  els.paeCanvas.hidden = !pae;
  els.paeHint.hidden = Boolean(pae);
  if (!pae) {
    els.paeSummary.textContent = '';
    paeLayout = null;
    return;
  }
  paeLayout = drawPAE(els.paeCanvas, pae, { selection: state.paeSelection });
  let sum = 0;
  for (const value of pae.matrix) sum += value;
  els.paeSummary.textContent = `${pae.size} residues · mean PAE ${(sum / pae.matrix.length).toFixed(1)} Å · max ${pae.max.toFixed(1)} Å · ${pae.source}. Dark green = confident relative position.`;
}

function bindPAEEvents() {
  let start = null;
  const indexAt = (event) => {
    if (!paeLayout) return null;
    const rect = els.paeCanvas.getBoundingClientRect();
    return paeLayout.toIndex((event.clientX - rect.left) * (els.paeCanvas.width / rect.width), (event.clientY - rect.top) * (els.paeCanvas.height / rect.height));
  };
  els.paeCanvas.addEventListener('pointerdown', (event) => {
    start = indexAt(event);
    if (start) els.paeCanvas.setPointerCapture(event.pointerId);
  });
  els.paeCanvas.addEventListener('pointermove', (event) => {
    const current = indexAt(event);
    if (current && state.pae) {
      const value = state.pae.matrix[current.row * state.pae.size + current.column];
      const a = state.pae.residues[current.row];
      const b = state.pae.residues[current.column];
      els.paeCanvas.title = `aligned ${a ? shortResidueLabel(a) : current.row + 1} · scored ${b ? shortResidueLabel(b) : current.column + 1} · PAE ${value.toFixed(1)} Å`;
    }
    if (!start || !current) return;
    state.paeSelection = { x0: start.column, x1: current.column, y0: start.row, y1: current.row };
    renderPAE();
  });
  els.paeCanvas.addEventListener('pointerup', () => {
    if (!start || !state.paeSelection || !state.pae) {
      start = null;
      return;
    }
    const { x0, x1, y0, y1 } = state.paeSelection;
    const keys = new Set();
    for (const [a, b] of [[Math.min(x0, x1), Math.max(x0, x1)], [Math.min(y0, y1), Math.max(y0, y1)]]) {
      for (let index = a; index <= b; index += 1) {
        const residue = state.pae.residues[index];
        if (residue) keys.add(residue.key);
      }
    }
    start = null;
    selectResidues([...keys], {});
  });
}

/* ---------- Proteomics ---------- */

async function proteomicsModule() {
  const module = await loadModule('proteomics', './lib/proteomics.js');
  if (module && !els.xlCrosslinker.options.length) {
    for (const preset of module.CROSSLINKERS ?? []) els.xlCrosslinker.appendChild(new Option(`${preset.label}${preset.maxCaCa ? ` (≤ ${preset.maxCaCa} Å)` : ''}`, preset.id));
    for (const enzyme of module.ENZYMES ?? []) els.digestEnzyme.appendChild(new Option(enzyme.label, enzyme.id));
  }
  return module;
}

async function renderProtParam() {
  if (!state.structure) return;
  const module = await proteomicsModule();
  if (!module?.sequenceProperties) {
    els.protparam.textContent = 'Sequence tools are unavailable.';
    return;
  }
  const info = state.structure.sequences.get(els.protparamChain.value) ?? [...state.structure.sequences.values()][0];
  if (!info || info.kind !== 'protein') {
    els.protparam.innerHTML = '<div class="wide"><dt>Note</dt><dd>Select a protein chain.</dd></div>';
    return;
  }
  const sequence = info.sequence.replace(/[^A-Z]/g, '');
  const props = module.sequenceProperties(sequence);
  const rows = [
    ['Length', `${props.length} aa (${info.observed} modeled)`],
    ['Average mass', `${formatNumber(Math.round(props.averageMass))} Da`],
    ['Monoisotopic', `${props.monoisotopicMass.toFixed(2)} Da`],
    ['Theoretical pI', props.isoelectricPoint.toFixed(2)],
    ['Net charge pH 7', formatSigned(props.netChargeAtPH7)],
    ['ε280 (cystines)', `${formatNumber(props.extinction.cystines)} M⁻¹cm⁻¹`],
    ['ε280 (reduced)', `${formatNumber(props.extinction.reduced)} M⁻¹cm⁻¹`],
    ['Abs 0.1% (1 g/L)', props.absorbance01.cystines.toFixed(3)],
    ['GRAVY', props.gravy.toFixed(3)],
    ['Aliphatic index', props.aliphaticIndex.toFixed(1)],
    ['Instability index', `${props.instabilityIndex.toFixed(1)} (${props.stable ? 'stable' : 'unstable'})`],
    ['Aromaticity', props.aromaticity.toFixed(3)],
  ];
  els.protparam.innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('') +
    `<div class="wide"><dt>Sequence source</dt><dd>${escapeHTML(info.source === 'model' ? 'Modeled residues only' : `${info.source} (full construct)`)}</dd></div>` +
    (props.warnings?.length ? `<div class="wide"><dt>Notes</dt><dd>${escapeHTML(props.warnings.join(' '))}</dd></div>` : '');
}

const UNIPROT_FEATURE_GROUPS = [
  { title: 'Domains & regions', types: ['Domain', 'Region', 'Motif', 'Repeat', 'Zinc finger', 'DNA binding', 'Coiled coil', 'Compositional bias'], range: true },
  { title: 'Functional sites', types: ['Active site', 'Binding site', 'Site'], sites: true },
  { title: 'Post-translational modifications', types: ['Modified residue', 'Glycosylation', 'Lipidation', 'Cross-link', 'Disulfide bond'], sites: true },
  { title: 'Disease & natural variants', types: ['Natural variant'], sites: true },
  { title: 'Mutagenesis', types: ['Mutagenesis'], sites: true },
];

function uniprotReference(info) {
  const segment = info?.uniprot?.find((item) => item.accession);
  if (segment) return { accession: segment.accession, mapped: true };
  const match = String(state.structure.meta.code || state.structure.label).match(/AF-([A-Z0-9]+(?:-\d+)?)-F1/i);
  return match ? { accession: match[1].toUpperCase(), mapped: false } : null;
}

function residuesForUniprotRange(info, start, end, reference) {
  const residues = [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return residues;
  for (let position = start; position <= end; position += 1) {
    const residue = reference.mapped
      ? residueForUniprotPosition(info, position, reference.accession)
      : info.items.find((item) => item.residue && item.residue.resSeq === position && !item.residue.iCode)?.residue;
    if (residue) residues.push(residue);
  }
  return residues;
}

async function loadUniProtFeatures() {
  if (!state.structure) return;
  const info = state.structure.sequences.get(els.uniprotChain.value);
  const reference = uniprotReference(info);
  els.uniprotResult.hidden = false;
  if (!reference) {
    els.uniprotResult.innerHTML = '<span class="warn">This chain has no UniProt cross-reference in the file.</span>';
    return;
  }
  els.uniprotResult.textContent = `Loading UniProt ${reference.accession}…`;
  try {
    const response = await fetch(`/api/fetch/uniprot/${encodeURIComponent(reference.accession)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const entry = await response.json();
    renderUniProtFeatures(entry, info, reference);
  } catch (error) {
    els.uniprotResult.innerHTML = `<span class="warn">Could not load UniProt ${escapeHTML(reference.accession)}: ${escapeHTML(error.message)}</span>`;
  }
}

function renderUniProtFeatures(entry, info, reference) {
  const features = (entry.features ?? []).map((feature) => {
    const start = Number(feature.location?.start?.value);
    const end = Number(feature.location?.end?.value);
    const disulfide = feature.type === 'Disulfide bond';
    const residues = disulfide
      ? [...residuesForUniprotRange(info, start, start, reference), ...residuesForUniprotRange(info, end, end, reference)]
      : residuesForUniprotRange(info, start, end, reference);
    return { ...feature, start, end, residues, label: uniprotFeatureLabel(feature, start, end, info) };
  });
  const name = entry.proteinDescription?.recommendedName?.fullName?.value ?? entry.uniProtkbId ?? reference.accession;
  const gene = entry.genes?.[0]?.geneName?.value;
  const fragment = document.createElement('div');
  fragment.innerHTML = `<div><strong>${escapeHTML(name)}</strong>${gene ? ` (${escapeHTML(gene)})` : ''} · ${escapeHTML(entry.primaryAccession ?? reference.accession)} · ${entry.sequence?.length ?? '?'} aa${reference.mapped ? '' : ' · numbering assumed identical to UniProt'}</div>
    <input type="search" class="feature-filter" placeholder="Filter, e.g. R175, kinase, phospho, LFS" aria-label="Filter UniProt features" />`;
  const filterInput = fragment.querySelector('input');
  filterInput.addEventListener('input', () => {
    const needle = filterInput.value.trim().toLowerCase();
    state.uniprotFilter = needle;
    renderUniProtFeatureGroups(groupsContainer, features, needle);
  });
  const groupsContainer = document.createElement('div');
  fragment.appendChild(groupsContainer);
  renderUniProtFeatureGroups(groupsContainer, features, '');
  els.uniprotResult.replaceChildren(fragment);
}

function renderUniProtFeatureGroups(container, features, needle) {
  const fragment = document.createDocumentFragment();
  for (const group of UNIPROT_FEATURE_GROUPS) {
    const items = features.filter((feature) => group.types.includes(feature.type));
    if (!items.length) continue;
    const inStructure = items.filter((item) => item.residues.length && (!needle || `${item.label} ${item.description ?? ''} ${item.type}`.toLowerCase().includes(needle)));
    if (needle && !inStructure.length) continue;
    const section = document.createElement('div');
    section.className = 'feature-group';
    section.innerHTML = `<h4>${escapeHTML(group.title)} <small>${inStructure.length}/${items.length} in structure</small></h4>`;
    const list = document.createElement('div');
    list.className = 'feature-list';
    for (const item of inStructure.slice(0, 60)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'feature-row';
      row.title = item.description || item.type;
      row.innerHTML = `<span>${escapeHTML(item.label)}</span><em>${escapeHTML(item.type)}</em>`;
      row.addEventListener('click', () => selectResidues(item.residues.map((residue) => residue.key), { frame: true }));
      list.appendChild(row);
    }
    if (inStructure.length > 60) list.insertAdjacentHTML('beforeend', `<p class="hint">…and ${inStructure.length - 60} more.</p>`);
    section.appendChild(list);
    if (group.sites && inStructure.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Mark ${Math.min(inStructure.length, 200)} as sites`;
      button.addEventListener('click', () => {
        const sites = inStructure.slice(0, 200).flatMap((item) => item.residues.slice(0, 2).map((residue) => ({ residue, label: item.label })));
        setSites(sites);
        focusResidues(sites.map((site) => site.residue.key));
      });
      section.appendChild(button);
    }
    fragment.appendChild(section);
  }
  container.replaceChildren(fragment);
}

function uniprotFeatureLabel(feature, start, end, info) {
  const residueCode = (position) => info.items.find((item) => item.residue?.resSeq === position)?.code ?? '';
  if (feature.type === 'Natural variant' || feature.type === 'Mutagenesis') {
    const original = feature.alternativeSequence?.originalSequence ?? residueCode(start);
    const alternative = feature.alternativeSequence?.alternativeSequences?.join('/') ?? '?';
    const disease = (feature.description || '').match(/in ([A-Z][A-Za-z0-9-]+)/)?.[1];
    return `${original}${start}${alternative}${disease ? ` (${disease})` : ''}`;
  }
  if (start === end) return `${feature.description || feature.type} · ${start}`;
  return `${feature.description || feature.type} · ${start}–${end}`;
}

function polymerSequenceChains() {
  return [...state.structure.sequences.values()].filter((info) => info.kind === 'protein');
}

async function mapPeptidesFromInput() {
  const module = await proteomicsModule();
  if (!module || !state.structure) return;
  const peptides = module.parsePeptides(els.peptideInput.value);
  if (!peptides.length) {
    showToast('Paste one or more peptide sequences first.', true);
    return;
  }
  applyPeptides(module, peptides, 'peptides');
}

async function runDigest() {
  const module = await proteomicsModule();
  if (!module?.digest || !state.structure) return;
  const info = state.structure.sequences.get(els.sequenceChain.value) ?? polymerSequenceChains()[0];
  if (!info) return;
  const peptides = module.digest(info.sequence, els.digestEnzyme.value || 'trypsin', { missedCleavages: Number(els.digestMissed.value) || 0, minLength: 6, maxLength: 40 });
  els.peptideInput.value = peptides.map((peptide) => peptide.sequence).join('\n');
  applyPeptides(module, module.parsePeptides(els.peptideInput.value), `in-silico ${els.digestEnzyme.selectedOptions[0]?.textContent ?? 'digest'} peptides (6–40 aa)`);
}

function applyPeptides(module, peptides, label) {
  const chains = polymerSequenceChains().map((info) => ({ id: info.chain, sequence: info.sequence }));
  const result = module.mapPeptides(peptides, chains, { ilEquivalent: els.peptideIL.checked });
  const coverage = new Map();
  const values = new Map();
  const summaries = [];
  for (const chainResult of result.chains) {
    const info = state.structure.sequences.get(chainResult.id);
    let modeled = 0;
    let modeledCovered = 0;
    info.items.filter((item) => !item.gap).forEach((item, index) => {
      if (!item.residue) return;
      modeled += 1;
      const count = chainResult.coverage[index] ?? 0;
      if (count > 0) {
        modeledCovered += 1;
        coverage.set(item.residue.key, count);
        const value = chainResult.values?.[index];
        if (Number.isFinite(value)) values.set(item.residue.key, value);
      }
    });
    summaries.push({ id: chainResult.id, fraction: chainResult.coverageFraction, modeled, modeledCovered, matches: chainResult.matches.length, coverage: chainResult.coverage });
  }
  state.proteomics.coverage = coverage;
  const hasValues = values.size > 0;
  if (hasValues) {
    state.proteomics.data = values;
    state.proteomics.dataLabel = 'Peptide value';
  }
  els.peptideResult.hidden = false;
  els.peptideResult.innerHTML = `<strong>${peptides.length}</strong> ${escapeHTML(label)} · ${peptides.length - result.unmatched.length} mapped · ${result.unmatched.length} unmatched${result.modifiedSites?.length ? ` · ${result.modifiedSites.length} modified sites` : ''}
    ${summaries.filter((item) => item.matches).map((item) => `<div>Chain ${escapeHTML(item.id)}: <strong>${(item.fraction * 100).toFixed(1)}%</strong> sequence coverage · ${item.modeledCovered}/${item.modeled} modeled residues${coverageBar(item.coverage)}</div>`).join('')}
    ${result.unmatched.length ? `<div class="warn">Unmatched: ${escapeHTML(result.unmatched.slice(0, 8).map((index) => peptides[index].sequence).join(', '))}${result.unmatched.length > 8 ? '…' : ''}</div>` : ''}
    ${hasValues ? '<div class="hint">Peptide values were averaged per residue; choose "Custom residue data" coloring to view them.</div>' : ''}`;
  if (result.modifiedSites?.length) {
    const sites = [];
    for (const site of result.modifiedSites) {
      const info = state.structure.sequences.get(site.chainId);
      const item = info?.items.filter((entry) => !entry.gap)[site.position];
      if (item?.residue) sites.push({ residue: item.residue, label: `${site.residue}${item.residue.resSeq} ${site.label}` });
    }
    setSites(sites);
  }
  setColorScheme('coverage', [state.active]);
  renderProfile();
}

function coverageBar(coverage) {
  if (!coverage?.length) return '';
  const segments = [];
  let start = -1;
  for (let index = 0; index <= coverage.length; index += 1) {
    const covered = index < coverage.length && coverage[index] > 0;
    if (covered && start < 0) start = index;
    if (!covered && start >= 0) {
      segments.push(`<i style="left:${(start / coverage.length) * 100}%;width:${((index - start) / coverage.length) * 100}%"></i>`);
      start = -1;
    }
  }
  return `<div class="coverage-bar">${segments.join('')}</div>`;
}

async function mapSitesFromInput() {
  const module = await proteomicsModule();
  if (!module || !state.structure) return;
  const parsed = module.parseSites(els.siteInput.value);
  if (!parsed.length) {
    showToast('Enter sites such as R175H, pS15 or A:K120.', true);
    return;
  }
  const numbering = els.siteNumbering.value;
  const found = [];
  const problems = [];
  for (const site of parsed) {
    const match = locateSite(site, numbering);
    if (!match) {
      problems.push(`${site.label}: position not in structure`);
      continue;
    }
    if (site.wt && match.residue.code !== site.wt) problems.push(`${site.label}: structure has ${match.residue.resName}${match.residue.resSeq} (${match.numbering})`);
    found.push({ residue: match.residue, label: site.label, value: site.value, mismatch: site.wt && match.residue.code !== site.wt });
  }
  setSites(found);
  els.siteResult.hidden = false;
  els.siteResult.innerHTML = `<strong>${found.length}</strong> of ${parsed.length} sites located${found.length ? ` (${found.filter((item) => !item.mismatch).length} with matching wild-type residue)` : ''}.
    ${problems.length ? `<ul>${problems.slice(0, 12).map((text) => `<li class="warn">${escapeHTML(text)}</li>`).join('')}</ul>` : ''}
    ${structureHasUniprot() ? '' : '<div class="hint">No UniProt mapping in this file, so positions use the structure numbering.</div>'}`;
  if (found.length) {
    focusResidues(found.map((item) => item.residue.key));
  }
}

function structureHasUniprot() {
  return state.structure.uniprotSegments.length > 0;
}

// Collects candidate residues in UniProt and/or author numbering and prefers the one whose
// residue matches the stated wild type, so numbering offsets surface as flagged mismatches.
function locateSite(site, numbering) {
  const model = activeModel();
  const chains = site.chain ? [site.chain] : [...state.structure.sequences.keys()];
  const candidates = [];
  for (const chainId of chains) {
    const info = state.structure.sequences.get(chainId);
    if (!info || info.kind !== 'protein') continue;
    if (numbering !== 'author' && info.uniprot?.length) {
      const residue = residueForUniprotPosition(info, site.position);
      if (residue) candidates.push({ residue, numbering: 'UniProt numbering', rank: numbering === 'uniprot' ? 0 : 1 });
    }
    if (numbering !== 'uniprot') {
      const residue = model.residues.find((item) => item.chain === chainId && item.kind === 'protein' && item.resSeq === site.position && !item.iCode);
      if (residue) candidates.push({ residue, numbering: 'structure numbering', rank: numbering === 'author' ? 0 : 2 });
    }
  }
  if (!candidates.length) return null;
  const matching = site.wt ? candidates.filter((candidate) => candidate.residue.code === site.wt) : candidates;
  const pool = matching.length ? matching : candidates;
  return pool.sort((a, b) => a.rank - b.rank)[0];
}

function setSites(sites) {
  state.proteomics.sites = sites;
  const overrides = new Map();
  for (const site of sites) overrides.set(site.residue.key, site.mismatch ? [1, 0.7, 0.2] : [1, 0.28, 0.72]);
  state.proteomics.siteOverrides = overrides.size ? overrides : null;
  markSceneDirty();
}

function siteResidueKeys(entry = state.active) {
  return new Set(entry.proteomics.sites.map((site) => site.residue.key));
}

async function mapCrosslinksFromInput() {
  const module = await proteomicsModule();
  if (!module || !state.structure) return;
  const parsed = module.parseCrosslinks(els.xlInput.value);
  const links = parsed.links ?? parsed;
  if (!links.length) {
    showToast('Enter cross-links such as A:K123-B:K45.', true);
    return;
  }
  const maxDistance = Number(els.xlMax.value) || 30;
  const model = activeModel();
  const chainIds = state.structure.chains.filter((chain) => chain.polymerKind === 'protein').map((chain) => chain.id);
  const resolveChains = (protein) => {
    if (!protein) return chainIds;
    if (chainIds.includes(protein)) return [protein];
    const needle = protein.toLowerCase();
    const byDescription = state.structure.chains.filter((chain) => chain.description && chain.description.toLowerCase().includes(needle)).map((chain) => chain.id);
    const byAccession = state.structure.uniprotSegments.filter((segment) => segment.accession?.toLowerCase().startsWith(needle)).map((segment) => segment.chain);
    const result = [...new Set([...byDescription, ...byAccession])].filter((id) => chainIds.includes(id));
    return result.length ? result : [];
  };
  const caFor = (chainId, residueNumber) => {
    const residue = model.residues.find((item) => item.chain === chainId && item.resSeq === residueNumber && item.kind === 'protein');
    return residue?.backbone.CA ?? null;
  };
  const mapped = [];
  let missing = 0;
  for (const link of links) {
    let best = null;
    for (const chainA of resolveChains(link.proteinA)) {
      for (const chainB of resolveChains(link.proteinB ?? link.proteinA)) {
        const a = caFor(chainA, link.residueA);
        const b = caFor(chainB, link.residueB);
        if (!a || !b || a === b) continue;
        const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (!best || distance < best.distance) best = { atomA: a, atomB: b, distance };
      }
    }
    if (!best) {
      missing += 1;
      continue;
    }
    mapped.push({ ...link, ...best, satisfied: best.distance <= maxDistance });
  }
  state.proteomics.crosslinks = mapped;
  const satisfied = mapped.filter((link) => link.satisfied).length;
  els.xlResult.hidden = false;
  els.xlResult.innerHTML = `<strong>${mapped.length}</strong> of ${links.length} cross-links mapped · <span class="good">${satisfied} within ${maxDistance} Å</span> · <span class="bad">${mapped.length - satisfied} violated</span>${missing ? ` · <span class="warn">${missing} not in structure</span>` : ''}${parsed.skipped ? ` · ${parsed.skipped} monolinks skipped` : ''}
    <div class="hint">Cα–Cα distances; for homo-oligomers the shortest chain pairing is used.</div>
    <table><thead><tr><th>Link</th><th>Cα–Cα</th></tr></thead><tbody>${mapped.slice().sort((a, b) => b.distance - a.distance).slice(0, 40).map((link) => `<tr><td>${escapeHTML(`${link.atomA.chain}:${link.atomA.resName}${link.atomA.resSeq} – ${link.atomB.chain}:${link.atomB.resName}${link.atomB.resSeq}`)}</td><td class="${link.satisfied ? 'good' : 'bad'}">${link.distance.toFixed(1)} Å</td></tr>`).join('')}</tbody></table>`;
  markSceneDirty();
}

async function applyResidueDataFromInput() {
  const module = await proteomicsModule();
  if (!module || !state.structure) return;
  const parsed = module.parseResidueData(els.dataInput.value);
  const rows = parsed.rows ?? [];
  if (!rows.length) {
    showToast('Paste chain, residue and value columns first.', true);
    return;
  }
  const model = activeModel();
  const values = new Map();
  let unmatched = 0;
  const defaultChain = state.structure.chains.find((chain) => chain.polymerKind)?.id;
  for (const row of rows) {
    const chain = row.chain ?? defaultChain;
    const residue = model.residues.find((item) => item.chain === chain && item.resSeq === row.resSeq && (item.iCode || '') === (row.iCode || ''));
    if (!residue) {
      unmatched += 1;
      continue;
    }
    values.set(residue.key, row.value);
  }
  state.proteomics.data = values;
  state.proteomics.dataLabel = parsed.name || 'Custom data';
  state.color.colormap = els.dataColormap.value;
  els.colormap.value = els.dataColormap.value;
  els.dataResult.hidden = false;
  els.dataResult.innerHTML = `<strong>${values.size}</strong> residues colored${unmatched ? ` · <span class="warn">${unmatched} rows did not match a residue</span>` : ''}${parsed.skipped ? ` · ${parsed.skipped} lines skipped` : ''}.`;
  setColorScheme('data', [state.active]);
  renderProfile();
}

/* ---------- Color scheme and legend ---------- */

// Data-driven schemes (coverage, custom data, exposure) describe one structure, so callers pass
// the entries they apply to; the Style tab applies its choice to the style scope.
function setColorScheme(scheme, entries = styleTargets()) {
  for (const entry of entries) entry.color.scheme = scheme;
  els.colorScheme.value = state.color.scheme;
  updateColorFields(state.color.scheme);
  if (scheme === 'exposure' && !state.sasa) showToast('Compute SASA in the Analysis tab to color by solvent exposure.');
  if (scheme === 'coverage' && !state.proteomics.coverage) showToast('Map peptides in the Proteomics tab to color by coverage.');
  if (scheme === 'data' && !state.proteomics.data) showToast('Load residue values in the Proteomics tab first.');
  if ((scheme === 'deviation' || scheme === 'lddt') && !entries.some((entry) => entry.id && comparisonFor(entry))) showToast('Superpose two structures in the Analysis tab to color by their differences.');
  if (scheme === 'rmsf' && !entries.some((entry) => entry.rmsf)) showToast('Overlay the models of an ensemble in the Analysis tab to color by RMSF.');
  markColorsDirty();
}

function updateColorFields(scheme) {
  els.paletteField.hidden = !['chain', 'entity'].includes(scheme);
  els.colormapField.hidden = !['bfactor', 'exposure', 'coverage', 'data', 'deviation', 'rmsf'].includes(scheme);
  els.uniformField.hidden = scheme !== 'uniform';
}

// Mirrors the active structure's style settings into the Style tab controls.
function syncStyleControls() {
  const display = state.display;
  const color = state.color;
  const surface = state.surface;
  els.polymerRep.value = display.polymer;
  els.ligandRep.value = display.ligand;
  els.sidechainMode.value = display.sidechains;
  els.showWater.checked = display.showWater;
  els.showHydrogen.checked = display.showHydrogen;
  document.querySelector('#atom-scale').value = String(display.atomScale);
  document.querySelector('#bond-scale').value = String(display.bondScale);
  document.querySelector('#cartoon-width').value = String(display.cartoonWidth);
  document.querySelector('#cartoon-quality').value = String(display.cartoonQuality);
  els.surfaceKind.value = surface.kind;
  els.surfaceColor.value = surface.color;
  els.surfaceOpacity.value = String(surface.opacity);
  els.surfaceOpacityValue.textContent = `${Math.round(surface.opacity * 100)}%`;
  els.surfaceStatus.textContent = surface.kind !== 'off' ? surface.status ?? '' : '';
  els.colorScheme.value = color.scheme;
  els.chainPalette.value = color.palette;
  els.colormap.value = color.colormap;
  els.uniformColor.value = color.uniformColor;
  els.heteroElement.checked = color.heteroByElement;
  updateColorFields(color.scheme);
  syncPresetButtons();
  syncControlOutputs();
  renderStyleScope();
}

function renderStyleScope() {
  const multiple = state.entries.length > 1;
  els.styleScope.hidden = !multiple;
  if (!multiple) return;
  document.querySelectorAll('[data-style-scope]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.styleScope === state.styleScope);
    if (button.dataset.styleScope === 'active') button.textContent = `Only ${state.active?.name ?? 'active'}`;
  });
}

// Legends of every visible structure (active first), without duplicates.
function collectLegends() {
  const legends = [];
  const seen = new Set();
  const add = (legend) => {
    if (!legend) return;
    const key = JSON.stringify([legend.type, legend.title, legend.items?.map((item) => item.label), legend.minLabel, legend.maxLabel]);
    if (seen.has(key)) return;
    seen.add(key);
    legends.push(legend);
  };
  const visible = state.entries.filter((entry) => entry.visible);
  const ordered = [state.active, ...visible.filter((entry) => entry !== state.active)].filter((entry) => entry?.visible);
  const byStructure = visible.filter((entry) => entry.color.scheme === 'structure');
  if (byStructure.length) {
    add({ type: 'categorical', title: 'Structures', items: byStructure.map((entry) => ({ label: entry.name, color: entryColor(entry) })) });
  }
  for (const entry of ordered) add(entry.legend);
  for (const entry of ordered) if (entry.surface.kind !== 'off') add(entry.surfaceLegend);
  return legends;
}

function renderLegend() {
  const legends = collectLegends();
  if (!legends.length) {
    els.legend.hidden = true;
    return;
  }
  els.legend.hidden = false;
  els.legend.classList.toggle('is-collapsed', Boolean(state.legendCollapsed));
  els.legend.innerHTML = legends.map(legendHTML).join('<hr>');
  els.legend.title = state.legendCollapsed ? 'Show legend' : 'Click a legend title to collapse it';
}

function legendHTML(legend) {
  if (legend.type === 'categorical') {
    const columns = legend.items.length > 8 ? ' two-columns' : '';
    return `<h4>${escapeHTML(legend.title)}</h4><div class="legend-items${columns}">${legend.items.map((item) => `<div title="${escapeHTML(item.label)}"><i style="background:${colorToHex(item.color)}"></i><span>${escapeHTML(item.label)}</span></div>`).join('')}</div>`;
  }
  if (legend.type === 'gradient') {
    return `<h4>${escapeHTML(legend.title)}</h4><div class="legend-gradient" style="background:${colormapGradientCSS(legend.colormap)}"></div><div class="legend-scale"><span>${escapeHTML(legend.minLabel ?? '')}</span><span>${escapeHTML(legend.maxLabel ?? '')}</span></div>${legend.note ? `<div class="legend-note">${escapeHTML(legend.note)}</div>` : ''}`;
  }
  return `<h4>${escapeHTML(legend.title)}</h4><div class="legend-note">${escapeHTML(legend.text ?? '')}</div>`;
}

/* ---------- Lighting ---------- */

function applyLightingPreset(name) {
  const preset = LIGHTING_PRESETS[name];
  if (!preset) return;
  setActiveButton('[data-lighting]', document.querySelector(`[data-lighting="${name}"]`));
  state.lighting = { preset: name, ...preset };
  for (const [id, key] of [['ao-strength', 'ao'], ['outline-strength', 'outline'], ['fog-strength', 'fog'], ['glow-scale', 'glow'], ['specular', 'specular'], ['ao-radius', 'aoRadius']]) {
    document.querySelector(`#${id}`).value = String(state.lighting[key]);
  }
  syncControlOutputs();
  requestRender();
}

function syncControlOutputs() {
  const pairs = [
    ['atom-scale', (value) => Number(value).toFixed(2)],
    ['bond-scale', (value) => Number(value).toFixed(2)],
    ['cartoon-width', (value) => Number(value).toFixed(2)],
    ['cartoon-quality', (value) => value],
    ['ao-strength', percent],
    ['outline-strength', percent],
    ['fog-strength', percent],
    ['glow-scale', percent],
    ['specular', percent],
    ['ao-radius', (value) => `${Number(value).toFixed(1)} Å`],
    ['clip-near', (value) => (Number(value) <= 0.001 ? 'off' : percent(value))],
    ['clip-far', (value) => (Number(value) >= 0.999 ? 'off' : percent(value))],
  ];
  for (const [id, format] of pairs) {
    const input = document.querySelector(`#${id}`);
    const output = document.querySelector(`#${id}-value`);
    if (input && output) output.textContent = format(input.value);
  }
}

/* ---------- Models ---------- */

function setActiveModel(index) {
  if (!state.structure) return;
  const entry = state.active;
  entry.activeModel = Math.max(0, Math.min(entry.structure.models.length - 1, index));
  els.modelSlider.value = String(entry.activeModel + 1);
  state.interactions = { ...state.interactions, list: [] };
  if (entry.sasa) {
    entry.sasa = null;
    els.sasaColor.disabled = true;
    els.sasaResult.hidden = true;
    if (entry.color.scheme === 'exposure') markColorsDirty();
  }
  // Measurements on the previous model are dropped when the scene layout is rebuilt.
  layoutParts();
  renderMeasurements();
  renderInteractions();
  updateModelLabel();
  markSceneDirty();
  if (entry.focus) computeFocusInteractions([...entry.focus.residues]);
  if (entry.surface.kind !== 'off') refreshSurface(entry);
}

function updateModelLabel() {
  const total = state.structure?.models.length ?? 1;
  const overlay = Boolean(state.active?.overlay) && total > 1;
  els.modelLabel.textContent = overlay ? `all ${Math.min(total, MAX_OVERLAY_MODELS)}` : `${state.activeModel + 1} / ${total}`;
  els.modelSlider.disabled = overlay;
  els.modelPlay.disabled = overlay;
  const model = state.structure ? activeModel() : null;
  els.atomsLabel.textContent = total > 1 ? 'Atoms/model' : 'Atoms';
  els.atomsMetric.textContent = formatNumber(model?.atoms.length ?? 0);
}

function toggleModelPlayback() {
  if (state.modelTimer) {
    stopModelPlayback();
    return;
  }
  if (state.active?.overlay) return;
  els.modelPlay.textContent = '❚❚';
  state.modelTimer = setInterval(() => {
    const total = state.structure?.models.length ?? 1;
    setActiveModel((state.activeModel + 1) % total);
  }, 160);
}

function stopModelPlayback() {
  if (state.modelTimer) clearInterval(state.modelTimer);
  state.modelTimer = null;
  els.modelPlay.textContent = '▶';
}

/* ---------- Search ---------- */

function renderSearch() {
  const query = els.searchInput.value.trim().toLowerCase();
  if (!query || !state.structure) {
    clearSearchResults();
    return;
  }
  if (!state.structure.searchItems) state.structure.searchItems = buildSearchItems(state.structure);
  const terms = query.split(/\s+/).filter(Boolean);
  const results = [];
  for (const item of state.structure.searchItems) {
    if (terms.every((term) => item.haystack.includes(term))) {
      results.push(item);
      if (results.length >= 40) break;
    }
  }
  const fragment = document.createDocumentFragment();
  results.forEach((result, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.index = String(index);
    if (index === 0) button.classList.add('is-active');
    button.innerHTML = `<strong>${escapeHTML(result.label)}</strong><span>${escapeHTML(result.type)} · ${escapeHTML(result.sublabel)}</span>`;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => chooseSearchResult(result));
    fragment.appendChild(button);
  });
  els.searchResults.replaceChildren(fragment);
  els.searchResults.classList.toggle('is-visible', results.length > 0);
  els.searchResults.results = results;
}

function onSearchKey(event) {
  const buttons = [...els.searchResults.querySelectorAll('button')];
  const active = buttons.findIndex((button) => button.classList.contains('is-active'));
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = Math.max(0, Math.min(buttons.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
    buttons.forEach((button, index) => button.classList.toggle('is-active', index === next));
    buttons[next]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    const result = els.searchResults.results?.[Math.max(0, active)];
    if (result) chooseSearchResult(result);
  } else if (event.key === 'Escape') {
    clearSearch();
    els.searchInput.blur();
  }
}

function chooseSearchResult(result) {
  const atom = activeModel().atoms[result.atomID];
  if (atom) state.selectedAtom = atom;
  selectResidues([result.residueKey], { frame: true, keepAtom: true });
  clearSearchResults();
}

function clearSearch() {
  els.searchInput.value = '';
  clearSearchResults();
}

function clearSearchResults() {
  els.searchResults.classList.remove('is-visible');
  els.searchResults.replaceChildren();
}

/* ---------- Export ---------- */

function openExportDialog() {
  updateExportInfo();
  els.exportDialog.showModal();
}

function exportDimensions() {
  const factor = Number(els.exportSize.value) || 2;
  const width = Math.round(els.canvas.clientWidth * factor);
  const height = Math.round(els.canvas.clientHeight * factor);
  const max = state.renderer.maxTextureDimension ?? 8192;
  const scaleDown = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scaleDown), height: Math.round(height * scaleDown), factor: factor * scaleDown };
}

function updateExportInfo() {
  const { width, height } = exportDimensions();
  els.exportInfo.textContent = `${formatNumber(width)} × ${formatNumber(height)} px${els.exportSupersample.checked ? ' · 2× supersampled' : ''}. At 300 dpi: ${(width / 300 * 2.54).toFixed(1)} × ${(height / 300 * 2.54).toFixed(1)} cm.`;
}

async function renderImageCanvas() {
  const { width, height, factor } = exportDimensions();
  const aspect = width / height;
  const exportCamera = { ...cloneCamera(state.camera), offset: [0, 0] };
  const matrices = cameraMatrices(exportCamera, aspect);
  const view = { ...matrices, orthographic: state.camera.orthographic };
  const settings = renderSettings();
  if (els.exportTransparent.checked) settings.background = { ...settings.background, alpha: 0 };
  settings.outline = { ...settings.outline, width: (settings.outline.width ?? 1) * factor / Math.min(window.devicePixelRatio || 1, 2) };
  const image = await state.renderer.capture(view, settings, width, height, els.exportSupersample.checked ? 2 : 1);
  requestRender();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(image.data, width, height), 0, 0);
  const cssScale = width / els.canvas.clientWidth;
  if (els.exportLabels.checked) drawExportLabels(ctx, view, width, height, cssScale);
  if (els.exportLegend.checked) drawExportLegend(ctx, width, height, cssScale);
  return canvas;
}

async function exportImage(target) {
  if (!state.structure) return;
  try {
    els.exportInfo.textContent = 'Rendering…';
    const canvas = await renderImageCanvas();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not encode the image.');
    if (target === 'clipboard') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Image copied to the clipboard.');
    } else {
      downloadBlob(`${fileStem()}.png`, blob);
      showToast(`Saved ${canvas.width} × ${canvas.height} PNG.`);
    }
    els.exportDialog.close();
  } catch (error) {
    console.error(error);
    els.exportInfo.textContent = `Export failed: ${error.message}`;
  }
}

function drawExportLabels(ctx, view, width, height, cssScale) {
  const labels = collectLabels();
  ctx.font = `600 ${Math.round(11 * cssScale)}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const label of labels) {
    const screen = projectToScreen(view, label.position, width, height);
    if (!screen) continue;
    const text = label.text;
    const metrics = ctx.measureText(text);
    const pad = 5 * cssScale;
    const boxWidth = metrics.width + pad * 2;
    const boxHeight = 17 * cssScale;
    const x = screen.x;
    const y = screen.y - boxHeight * 1.1;
    ctx.fillStyle = label.kind === 'measure' ? 'rgba(40,30,4,0.85)' : label.kind === 'site' ? 'rgba(58,8,36,0.85)' : 'rgba(3,5,6,0.78)';
    roundRect(ctx, x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, 4 * cssScale);
    ctx.fill();
    ctx.fillStyle = label.kind === 'measure' ? '#ffd166' : label.kind === 'site' ? '#ffc2e2' : '#fffaf1';
    ctx.fillText(text, x, y + cssScale * 0.5);
  }
}

function drawExportLegend(ctx, width, height, cssScale) {
  const legends = collectLegends();
  if (!legends.length) return;
  const light = state.background === 'white' || state.background === 'gray';
  let y = height - 16 * cssScale;
  const x = 16 * cssScale;
  const lineHeight = 15 * cssScale;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const legend of legends.slice().reverse()) {
    const rows = legend.type === 'categorical' ? legend.items.length : legend.type === 'gradient' ? 2 : 1;
    const boxHeight = (rows + 1.6) * lineHeight;
    const boxWidth = 230 * cssScale;
    y -= boxHeight;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.85)' : 'rgba(8,11,13,0.78)';
    roundRect(ctx, x, y, boxWidth, boxHeight, 6 * cssScale);
    ctx.fill();
    ctx.fillStyle = light ? '#1d6b55' : '#9ee8cf';
    ctx.font = `800 ${Math.round(9.5 * cssScale)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(legend.title.toUpperCase(), x + 9 * cssScale, y + lineHeight * 0.85);
    ctx.font = `500 ${Math.round(10.5 * cssScale)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = light ? '#222' : 'rgba(248,245,238,0.85)';
    if (legend.type === 'categorical') {
      legend.items.forEach((item, index) => {
        const rowY = y + lineHeight * (1.9 + index);
        ctx.fillStyle = colorToHex(item.color);
        ctx.fillRect(x + 9 * cssScale, rowY - 5 * cssScale, 10 * cssScale, 10 * cssScale);
        ctx.fillStyle = light ? '#222' : 'rgba(248,245,238,0.85)';
        ctx.fillText(item.label, x + 25 * cssScale, rowY);
      });
    } else if (legend.type === 'gradient') {
      const gradient = ctx.createLinearGradient(x + 9 * cssScale, 0, x + boxWidth - 9 * cssScale, 0);
      const stops = COLORMAPS[legend.colormap]?.stops ?? COLORMAPS.viridis.stops;
      stops.forEach((stop, index) => gradient.addColorStop(index / (stops.length - 1), colorToHex(stop)));
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 9 * cssScale, y + lineHeight * 1.5, boxWidth - 18 * cssScale, 9 * cssScale);
      ctx.fillStyle = light ? '#222' : 'rgba(248,245,238,0.85)';
      ctx.fillText(legend.minLabel ?? '', x + 9 * cssScale, y + lineHeight * 2.75);
      ctx.textAlign = 'right';
      ctx.fillText(legend.maxLabel ?? '', x + boxWidth - 9 * cssScale, y + lineHeight * 2.75);
      ctx.textAlign = 'left';
    }
    y -= 8 * cssScale;
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

async function recordSpinMovie() {
  if (typeof MediaRecorder === 'undefined' || !els.canvas.captureStream) {
    showToast('Video recording is not supported in this browser.', true);
    return;
  }
  els.exportDialog.close();
  const stream = els.canvas.captureStream(30);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  const done = new Promise((resolve) => recorder.addEventListener('stop', resolve));
  const previousSpin = state.spin;
  const duration = 8000;
  state.spinRate = (Math.PI * 2) / (duration / 1000);
  showToast('Recording one full rotation (8 s)…');
  recorder.start();
  setSpin(true);
  await new Promise((resolve) => setTimeout(resolve, duration));
  recorder.stop();
  await done;
  setSpin(previousSpin);
  state.spinRate = DEFAULT_SPIN_RATE;
  downloadBlob(`${fileStem()}-spin.webm`, new Blob(chunks, { type: 'video/webm' }));
  showToast('Saved spin video (WebM).');
}

/* ---------- Panels and misc UI ---------- */

function activateTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  if (state.structure) refreshTabPanels();
}

function togglePanel(className) {
  const opening = !els.app.classList.contains(className);
  if (opening && window.innerWidth <= 900) {
    if (className === 'left-open') els.app.classList.remove('right-open');
    if (className === 'right-open') els.app.classList.remove('left-open');
  }
  els.app.classList.toggle(className);
  setTimeout(() => {
    updateViewOffset();
    requestRender();
  }, 200);
  updateViewOffset();
  requestRender();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

function setActiveButton(selector, active) {
  document.querySelectorAll(selector).forEach((button) => button.classList.toggle('is-active', button === active));
}

function populateSamples() {
  els.sampleSelect.replaceChildren(new Option('Choose an example…', ''));
  for (const sample of state.samples) {
    const option = new Option(sampleSummary(sample), sample.id);
    option.title = sample.title;
    els.sampleSelect.appendChild(option);
  }
}

function sampleSummary(sample) {
  const title = (sample.title || '').replace(/^[0-9A-Z]{4}:\s*/, '');
  const short = title.length > 46 ? `${title.slice(0, 45)}…` : title;
  return `${sample.name} · ${titleCase(short)}`;
}

function setLoading(message) {
  els.loadingStatus.textContent = message;
}

function showLoading(message) {
  els.loading.classList.remove('is-hidden', 'is-error');
  setLoading(message);
}

function hideLoading() {
  els.loading.classList.add('is-hidden');
}

function showLoadingError(message) {
  els.loading.classList.remove('is-hidden');
  els.loading.classList.add('is-error');
  setLoading(message);
}

let toastTimer = null;
function showToast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', error);
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), error ? 6500 : 3500);
}

async function loadModule(name, path) {
  if (lazyModules[name]) return lazyModules[name];
  if (lazyModules[`${name}:failed`]) return null;
  try {
    const module = await import(path);
    lazyModules[name] = module;
    if (name === 'interactions' && module.INTERACTION_TYPES?.length) {
      state.interactionTypes = module.INTERACTION_TYPES;
      renderInteractionTypeToggles();
    }
    return module;
  } catch (error) {
    console.error(error);
    lazyModules[`${name}:failed`] = true;
    showToast(`Could not load the ${name} module: ${error.message}`, true);
    return null;
  }
}

/* ---------- Helpers ---------- */

function residueLabel(residue) {
  if (!residue) return '';
  return `${residue.resName} ${residue.resSeq}${residue.iCode || ''} · chain ${residue.chain}`;
}

function shortResidueLabel(residue) {
  return `${residue.chain}:${residue.resName}${residue.resSeq}${residue.iCode || ''}`;
}

function shortAtomLabel(atom) {
  return `${atom.chain}:${atom.resName}${atom.resSeq} ${atom.name}`;
}

function secondaryText(residue) {
  const names = { helix: 'Helix', sheet: 'Strand', turn: 'Turn', coil: 'Coil' };
  const source = residue.ssSource === 'none' ? '' : ` (${residue.ssSource}${residue.dssp && residue.ssSource !== 'DSSP' ? `, DSSP ${residue.dssp}` : residue.dssp ? ` ${residue.dssp}` : ''})`;
  return `${names[residue.ss] ?? 'Coil'}${source}`;
}

function fileStem() {
  const code = state.structure?.meta.code || state.structure?.label?.replace(/\.[^.]+$/, '') || 'proteoscope';
  return `${code.toLowerCase()}-proteoscope`;
}

function downloadBlob(filename, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function downloadText(filename, text, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type }));
}

function point(atom) {
  return [atom.x, atom.y, atom.z];
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatNumberShort(value) {
  if (!Number.isFinite(value)) return '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || (magnitude > 0 && magnitude < 0.01)) return value.toExponential(2);
  return Number(value.toFixed(3)).toString();
}

function formatSigned(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatAngle(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)}°` : '–';
}

function percent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function pct(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : '0%';
}


function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}


// Console scripting API for power users (and automated checks).
globalThis.proteoscope = {
  state,
  fetch: fetchStructure,
  add: (query) => fetchStructure(query, { add: true }),
  structures: () => state.entries.map((entry) => ({ id: entry.id, name: entry.name, active: entry === state.active, visible: entry.visible, comparison: entry.comparison?.stats ?? null })),
  activate: (name) => setActiveEntry(state.entries.find((entry) => entry.name === name || entry.id === name)),
  superpose: (mobile, reference, options = {}) => {
    const find = (value) => state.entries.find((entry) => entry.name === value || entry.id === value);
    const referenceEntry = find(reference) ?? state.entries[0];
    const mobiles = mobile ? [find(mobile)].filter(Boolean) : state.entries.filter((entry) => entry !== referenceEntry);
    return runSuperposition({ ...options, reference: referenceEntry, mobiles }).map((item) => ({ name: item.mobile.name, stats: item.result?.stats, error: item.error?.message }));
  },
  compareWithAlphaFold,
  overlayModels: toggleModelOverlay,
  select: (keys) => selectResidues(keys, { frame: true }),
  focus: focusResidues,
  representation: applyRepresentationPreset,
  color: setColorScheme,
  lighting: applyLightingPreset,
  surface: (kind) => {
    state.surface.kind = kind;
    els.surfaceKind.value = kind;
    refreshSurface();
  },
  resetView,
  residues: () => (state.structure ? activeModel().residues : []),
  snapshot: async (options = {}) => {
    if (options.scale) els.exportSize.value = String(options.scale);
    if ('transparent' in options) els.exportTransparent.checked = Boolean(options.transparent);
    if ('supersample' in options) els.exportSupersample.checked = Boolean(options.supersample);
    const canvas = await renderImageCanvas();
    return canvas.toDataURL('image/png');
  },
};

if (globalThis.__PROTEOSCOPE_TEST__) {
  globalThis.__proteoscopeTest = { state, normalizeFetchQuery, loadStructureFromText, colorExtras };
}
