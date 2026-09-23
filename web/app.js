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
import { countMask, evaluateSelection, looksLikeSelection, parseSelection, residueKeysFromMask } from './lib/select.js';
import { COMMANDS, CommandError, parseCommand, suggestCommands } from './lib/commands.js';
import { base64ToBytes, bytesToBase64, compressText, decodeLinkPayload, decompressBytes, decompressText, dequantizeMatrix, encodeLinkPayload, quantizeMatrix } from './lib/codec.js';
import { createZip, isZip, listZip, readZipEntry } from './lib/zip.js';
import { binaryCIFToText, isBinaryCIF } from './lib/bcif.js';
import { mapValidation, validationLevel } from './lib/validation.js';
import { MISSENSE_THRESHOLDS, missenseClass, parseAlphaMissense, rankedSubstitutions } from './lib/missense.js';
import { paeDomains } from './lib/pae-domains.js';
import { RAMA_CATEGORIES, RAMA_FAVORED, classifyRamachandran, loadTop8000, ramaDensity } from './lib/ramachandran.js';
import { combineDepth, depthSummary, msaDepth } from './lib/msa.js';
import { readNpz, readNpy, squareMatrix } from './lib/npy.js';
import { interfaceScores } from './lib/interface-scores.js';
import {
  detectPredictionSets,
  parseAF3Confidences,
  parseAF3Summary,
  parseBoltzAffinity,
  parseBoltzConfidence,
  parseChaiScores,
  parseColabFoldScores,
  rankModels,
  tokensForPAE,
} from './lib/predictions.js';
import { buildMolViewSpec, referenceCameraPosition, residueColors, residueSelector } from './lib/mvs.js';
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
import { add, angleBetween, dihedralAngle, normalize, quatFromAxisAngle, quatMultiply, quatNormalize, scale, sub } from './lib/math3d.js';
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
  sessionSave: document.querySelector('#session-save'),
  sessionLink: document.querySelector('#session-link'),
  sessionMvs: document.querySelector('#session-mvs'),
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
  selectionSticks: document.querySelector('#selection-sticks'),
  selectionHide: document.querySelector('#selection-hide'),
  selectionColor: document.querySelector('#selection-color'),
  selectionResetStyle: document.querySelector('#selection-reset-style'),
  helpCommands: document.querySelector('#help-commands'),
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
  ramaCategory: document.querySelector('#rama-category'),
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
  folderInput: document.querySelector('#folder-input'),
  predictionGroup: document.querySelector('#prediction-group'),
  predictionCount: document.querySelector('#prediction-count'),
  predictionTitle: document.querySelector('#prediction-title'),
  predictionModels: document.querySelector('#prediction-models'),
  predictionPairs: document.querySelector('#prediction-pairs'),
  predictionDetail: document.querySelector('#prediction-detail'),
  predictionSuperpose: document.querySelector('#prediction-superpose'),
  predictionExport: document.querySelector('#prediction-export'),
  validationLoad: document.querySelector('#validation-load'),
  validationColor: document.querySelector('#validation-color'),
  validationFit: document.querySelector('#validation-fit'),
  validationClashes: document.querySelector('#validation-clashes'),
  validationResult: document.querySelector('#validation-result'),
  paeView: document.querySelector('#pae-view'),
  paeDomainsButton: document.querySelector('#pae-domains'),
  msaDepth: document.querySelector('#msa-depth'),
  paeDomainResult: document.querySelector('#pae-domain-result'),
  missenseLoad: document.querySelector('#missense-load'),
  missenseResult: document.querySelector('#missense-result'),
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
  // Per-residue styling from commands and the selection card: extra representation
  // ("sticks", "ball-stick", "spacefill") and hidden residues, keyed by residue key.
  residueStyles: null,
  hiddenResidues: null,
  overrideKey: '',
};

// Colors that tell structures apart in the "Structure" scheme and the structures list.
const STRUCTURE_COLORS = ['#5aa9f0', '#f39c3d', '#5fd08e', '#e8659c', '#a78bfa', '#e8d44d', '#4fd1d9', '#c98b5c'].map(hexColor);
const MAX_OVERLAY_MODELS = 60;
const COMPARISON_SCHEMES = new Set(['deviation', 'lddt', 'rmsf']);
const DATA_SCHEMES = new Set(['coverage', 'data', 'exposure', 'deviation', 'lddt', 'rmsf', 'validation', 'densityfit', 'missense', 'domains', 'msa']);

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
    // wwPDB validation report, AlphaMissense scores, PAE domains, and MSA depth per residue.
    validation: null,
    missense: null,
    domains: null,
    msa: null,
    // AlphaFold 3 contact probabilities, and the prediction set and model this entry came from.
    contacts: null,
    prediction: null,
  };
}

const ENTRY_FIELDS = Object.keys(entryDefaults());

const state = {
  samples: [],
  startup: null,
  entries: [],
  predictionSets: [],
  crosslinkRequest: null,
  pairMetric: 'iptm',
  paeView: 'pae',
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
  if (startup?.remoteControl) connectRemoteControl();
  populateSamples();

  const hashRequest = new URLSearchParams(location.hash.slice(1));
  const fetchRequest = hashRequest.get('fetch') || hashRequest.get('pdb') || hashRequest.get('af') || hashRequest.get('uniprot');
  const sessionPayload = hashRequest.get('session');
  if (sessionPayload && !startup?.files?.length) {
    const link = location.href;
    await guardedLoad(async () => {
      state.restoringSession = true;
      try {
        await restoreSession(JSON.parse(await decodeLinkPayload(sessionPayload)));
      } finally {
        state.restoringSession = false;
      }
    });
    history.replaceState(null, '', link);
    if (!state.entries.length) {
      const fallback = state.samples.find((sample) => sample.id.startsWith('1m17')) ?? state.samples[0];
      if (fallback) await loadStructureFromURL(fallback.url, fallback.name, { origin: { type: 'sample', id: fallback.id } });
    }
  } else if (startup?.files?.length) {
    // Files and folders named on the command line open like dropped ones.
    await openFiles(startup.files.map(urlRef));
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
    await loadStructureFromURL(preferred.url, preferred.name, { origin: { type: 'sample', id: preferred.id } });
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
  renderHelpCommands();
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
    await guardedLoad(() => loadStructureFromURL(sample.url, sample.name, { add: els.addMode.checked, origin: { type: 'sample', id: sample.id } }));
  });
  els.fileInput.addEventListener('change', async () => {
    const files = [...(els.fileInput.files ?? [])];
    els.fileInput.value = '';
    await openFiles(files);
  });
  els.folderInput.addEventListener('change', async () => {
    const files = [...(els.folderInput.files ?? [])].filter((file) => !file.name.startsWith('.'));
    els.folderInput.value = '';
    await openFiles(files.slice(0, MAX_FOLDER_FILES));
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
  els.chainsAll.addEventListener('click', () => {
    if (state.display.hiddenResidues?.size) setHiddenResidues(state.active, null);
    setVisibleChains(null);
  });
  els.selectionSticks.addEventListener('click', () => styleSelection({ overlay: 'sticks' }));
  els.selectionHide.addEventListener('click', () => styleSelection({ hide: true }));
  els.selectionColor.addEventListener('input', () => styleSelection({ color: els.selectionColor.value }));
  els.selectionResetStyle.addEventListener('click', () => styleSelection({ reset: true }));
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

  for (const [button, command] of [[els.sessionSave, 'save'], [els.sessionLink, 'link'], [els.sessionMvs, 'mvs']]) {
    button.addEventListener('click', () => runCommand(command));
  }
  els.compareReference.addEventListener('change', () => populateCompareChains());
  els.compareMobile.addEventListener('change', () => populateCompareChains());
  els.compareRun.addEventListener('click', () => runSuperposition());
  els.compareReset.addEventListener('click', resetComparedPositions);
  els.compareAlphaFold.addEventListener('click', compareWithAlphaFold);
  els.compareModels.addEventListener('click', () => toggleModelOverlay());
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
  els.sasaRun.addEventListener('click', () => runSASA());
  els.validationLoad.addEventListener('click', () => runCommand(state.active?.validation ? 'validate refresh' : 'validate'));
  els.validationColor.addEventListener('click', () => setColorScheme('validation', [state.active]));
  els.validationFit.addEventListener('click', () => setColorScheme('densityfit', [state.active]));
  els.validationClashes.addEventListener('change', () => setShowClashes(els.validationClashes.checked));
  els.paeDomainsButton.addEventListener('click', () => runCommand('domains'));
  els.msaDepth.addEventListener('click', () => runCommand('msa'));
  els.predictionSuperpose.addEventListener('click', () => guardedLoad(superposePredictionModels));
  els.predictionExport.addEventListener('click', exportPredictionCSV);
  document.querySelectorAll('[data-pair-metric]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pairMetric = button.dataset.pairMetric;
      renderPrediction();
    });
  });
  document.querySelectorAll('[data-pae-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.paeView = button.dataset.paeView;
      renderPAE();
    });
  });
  els.missenseLoad.addEventListener('click', () => runCommand('missense'));
  els.sasaColor.addEventListener('click', () => setColorScheme('exposure', [state.active]));
  els.ramaChain.addEventListener('change', renderRamachandran);
  els.ramaCategory.addEventListener('change', renderRamachandran);
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
    // Folder entries must be taken from the event before any await.
    const pending = collectDroppedFiles(event.dataTransfer);
    await openFiles(await pending);
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
    const response = await fetch(options.refresh ? `${request.url}?refresh=1` : request.url);
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
    entry = await loadStructureFromText(text, filename, { source: request.label, add, activate: options.activate, origin: { type: 'fetch', id: request.id } });
    entry.fetchId = request.id;
    entry.sourceURL = (response.headers.get('X-Proteoscope-Source') || '').replace(/\.gz$/i, '');
    applyRemoteMetadata(response.headers.get('X-Proteoscope-Meta-B64'), entry);
    els.sampleSelect.value = '';
    updateLocationHash();
    const paeURL = response.headers.get('X-Proteoscope-Pae');
    if (paeURL) loadPAEFromURL(paeURL, entry);
    // AlphaFold DB models have their alignment next to them (downloads cached before the header
    // existed still get it).
    entry.msaURL = response.headers.get('X-Proteoscope-Msa') || (request.url.startsWith('/api/fetch/afdb/') ? `${request.url}/msa` : null);
  });
  return entry;
}

// Keeps a shareable #fetch=ID,ID[&superpose] link while every structure came from a fetch.
function updateLocationHash() {
  if (state.restoringSession) return;
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
      structureMeta.title = `${meta.entryId || meta.modelEntityId || structureMeta.code}: ${meta.uniprotDescription}${meta.gene ? ` (${meta.gene})` : ''}`;
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

// Opens dropped or chosen files: prediction folders and AlphaFold Server archives become ranked
// model sets; structures (.pdb, .cif, .bcif, optionally gzipped) open as entries; JSON files are
// sessions or PAE matrices; .npz PAE, .a3m alignments and AlphaMissense tables annotate the active
// structure.
async function openFiles(files) {
  await guardedLoad(async () => {
    let refs = files.map((item) => (item.read ? item : fileRef(item)));
    refs = await expandArchives(refs);
    const { sets, rest } = detectPredictionSets(refs);
    for (const [index, set] of sets.entries()) await openPredictionSet(set, { add: index > 0 || els.addMode.checked });
    const structures = rest.filter((ref) => STRUCTURE_FILE.test(ref.name));
    let first = null;
    for (const [index, ref] of structures.entries()) {
      showLoading(`Reading ${ref.name}`);
      const text = await structureFileText(ref);
      const entry = await loadStructureFromText(text, ref.name.replace(/\.gz$/i, '').replace(/\.bcif$/i, '.cif'), { source: 'Local file', add: sets.length > 0 || index > 0 || els.addMode.checked });
      first ??= entry;
    }
    if (structures.length || sets.length) {
      els.sampleSelect.value = '';
      history.replaceState(null, '', location.pathname);
      if (structures.length > 1) {
        setActiveEntry(first);
        showToast(`Opened ${structures.length} structures. Superpose them in the Analysis tab.`);
      }
    }
    for (const ref of rest.filter((item) => !STRUCTURE_FILE.test(item.name))) await openAnnotationFile(ref);
  });
}

const STRUCTURE_FILE = /\.(pdb|ent|cif|mmcif|bcif)(\.gz)?$/i;

// A uniform view of local files, archive members and server-provided files.
function fileRef(file, path = file.webkitRelativePath || file.name) {
  const gzip = /\.gz$/i.test(file.name);
  const bytes = async () => {
    const raw = new Uint8Array(await file.arrayBuffer());
    return gzip ? decompressBytes(raw) : raw;
  };
  return {
    name: file.name.replace(/\.gz$/i, ''),
    path: path.replace(/\.gz$/i, ''),
    size: file.size,
    read: bytes,
    text: async () => new TextDecoder().decode(await bytes()),
  };
}

function urlRef(file) {
  const read = async () => {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Could not read ${file.name} (HTTP ${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  };
  return { name: file.name, path: file.path || file.name, size: file.size, read, text: async () => new TextDecoder().decode(await read()) };
}

function bytesRef(name, path, data) {
  return { name, path, size: data.length, read: async () => data, text: async () => new TextDecoder().decode(data) };
}

// ZIP archives (AlphaFold Server downloads) are opened into their members; .npz files stay whole.
async function expandArchives(refs) {
  const result = [];
  for (const ref of refs) {
    if (!/\.zip$/i.test(ref.name)) {
      result.push(ref);
      continue;
    }
    showLoading(`Reading ${ref.name}`);
    const bytes = await ref.read();
    if (!isZip(bytes)) throw new Error(`${ref.name} is not a ZIP archive.`);
    const base = ref.path.replace(/\.zip$/i, '');
    for (const entry of listZip(bytes)) {
      if (/(^|\/)(__MACOSX|\.)/.test(entry.name)) continue;
      const data = await readZipEntry(bytes, entry);
      const name = entry.name.split('/').pop();
      const member = bytesRef(name.replace(/\.gz$/i, ''), `${base}/${entry.name}`.replace(/\.gz$/i, ''), /\.gz$/i.test(name) ? await decompressBytes(data) : data);
      result.push(member);
    }
  }
  return result;
}

async function structureFileText(ref) {
  const bytes = await ref.read();
  if (/\.bcif$/i.test(ref.name) || isBinaryCIF(bytes)) return binaryCIFToText(bytes);
  return new TextDecoder().decode(bytes);
}

// Files that describe the active structure rather than open a new one.
async function openAnnotationFile(ref) {
  const name = ref.name.toLowerCase();
  if (name.endsWith('.json')) {
    const text = await ref.text();
    if (await openSessionFile(text)) {
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    loadPAEFromJSON(JSON.parse(text), ref.name);
    return;
  }
  if (!state.active) throw new Error(`Open a structure before ${ref.name}.`);
  if (name.endsWith('.npz') || name.endsWith('.npy')) {
    const matrix = await readPAEArray(ref);
    if (!matrix) throw new Error(`${ref.name} does not contain a square PAE matrix.`);
    setEntryPAE(state.active, matrix, ref.name);
    return;
  }
  if (name.endsWith('.a3m') || name.endsWith('.a2m')) {
    applyMSA(state.active, [msaDepth(await ref.text())], ref.name);
    return;
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    const text = await ref.text();
    if (parseAlphaMissense(text)) {
      showToast('This looks like an AlphaMissense table; use the AlphaMissense button in the Proteomics tab, which maps it by UniProt numbering.', true);
      return;
    }
  }
  throw new Error(`${ref.name}: unsupported file type.`);
}

async function collectDroppedFiles(dataTransfer) {
  const entries = [...(dataTransfer?.items ?? [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.some((entry) => entry.isDirectory)) return [...(dataTransfer?.files ?? [])];
  const refs = [];
  const walk = async (entry, prefix) => {
    if (refs.length > MAX_FOLDER_FILES) return;
    if (entry.isFile) {
      if (entry.name.startsWith('.')) return;
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      refs.push(fileRef(file, `${prefix}${entry.name}`));
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await walk(entry, '');
  if (refs.length > MAX_FOLDER_FILES) showToast(`Only the first ${MAX_FOLDER_FILES} files of the folder were read.`, true);
  return refs;
}

const MAX_FOLDER_FILES = 4000;

async function loadStructureFromURL(url, label, options = {}) {
  showLoading(`Loading ${label}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const filename = response.headers.get('X-Proteoscope-Filename') || url.split('/').pop() || label;
  const binary = /\.bcif$/i.test(filename) || isBinaryCIF(bytes);
  const text = binary ? binaryCIFToText(bytes) : new TextDecoder().decode(bytes);
  return loadStructureFromText(text, binary ? filename.replace(/\.bcif$/i, '.cif') : filename, { source: label, ...options });
}

// Parses and derives a structure, then either replaces the scene or adds it as another entry.
async function loadStructureFromText(text, label, options = {}) {
  showLoading(`Parsing ${label}`);
  await nextFrame();
  const structure = parseStructure(text, label);
  // Files from prediction folders are predictions even when they carry no ModelCIF records.
  if (options.predicted) structure.meta.isPredicted = true;
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
  // Local files keep their text so a saved session can embed them.
  entry.origin = options.origin ?? { type: 'file', name: label, text };
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
    display: { ...template.display, visibleChains: null, residueFilter: null, residueFilterKey: '', residueStyles: null, hiddenResidues: null, overrideKey: '' },
    color,
    colorOverrides: null,
    surface: { kind: template.surface.kind, color: template.surface.color, opacity: template.surface.opacity, key: '', pending: 0, data: null, keys: null },
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
  for (const box of [els.interfaceResult, els.sasaResult, els.peptideResult, els.siteResult, els.xlResult, els.dataResult, els.uniprotResult, els.missenseResult]) {
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
  entry.contacts = null;
  entry.paeSelection = null;
  entry.validation = null;
  entry.missense = null;
  entry.domains = null;
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

async function activateAssembly(assemblyID, entry = state.active) {
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
  const key = [model.number, chains, display.residueFilterKey || '*', display.overrideKey || '*', display.cartoonWidth.toFixed(2), display.cartoonQuality, state.secondaryMode].join('|');
  const cached = model.cartoonCache.get(key);
  if (cached) return cached;
  const cartoon = buildCartoon(model, {
    include: (residue) => (!display.visibleChains || display.visibleChains.has(residue.chain)) && !display.hiddenResidues?.has(residue.key) && (!display.residueFilter || display.residueFilter.has(residue.key)),
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
  const validation = entry.validation?.showClashes ? validationOf(entry) : null;
  for (const clash of validation?.clashes ?? []) {
    // Thicker for worse overlaps (all reported clashes overlap by at least 0.4 Å).
    lines.push({ from: point(clash.atomA), to: point(clash.atomB), color: [1, 0.22, 0.55], radius: 0.06 + Math.min(0.12, clash.overlap * 0.1), caps: true });
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
  // Colors set with "color <color> <selection>" win over proteomics site highlights.
  const overrides = entry.colorOverrides?.size ? new Map([...(entry.proteomics.siteOverrides ?? []), ...entry.colorOverrides]) : entry.proteomics.siteOverrides;
  const extras = { overrides, structureColor: entryColor(entry) };
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
  if (scheme === 'validation' || scheme === 'densityfit') {
    const mapped = validationOf(entry);
    if (mapped && scheme === 'validation') extras.residueValues = mapped.levels;
    if (mapped && scheme === 'densityfit' && mapped.fit.values.size) {
      extras.residueValues = mapped.fit.values;
      extras.fitKind = mapped.fit.kind;
    }
  }
  if (scheme === 'missense' && entry.missense) extras.residueValues = entry.missense.values;
  if (scheme === 'domains' && entry.domains) {
    extras.residueValues = entry.domains.values;
    extras.domainCount = entry.domains.count;
  }
  if (scheme === 'msa' && entry.msa) extras.residueValues = entry.msa.values;
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
    // Each structure shows its own selection plus the residues aligned to the active selection.
    mark(entry.selection, 1);
    if (entry !== source) mark(mapKeys(source, entry, source?.selection), 1);
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

// Per-residue values for the tooltip. The selection card shows AlphaMissense and validation in
// rows of their own, so it leaves them out (options.card).
function residueDataText(residue, entry = state.active, options = {}) {
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
  const missense = entry.missense?.values.get(residue.key);
  if (Number.isFinite(missense) && !options.card) parts.push(`AlphaMissense ${missense.toFixed(2)}`);
  const record = validationOf(entry)?.residues.get(residue.key);
  if (record?.criteria.length && !options.card) parts.push(record.criteria.join(', '));
  const depth = entry.msa?.values.get(residue.key);
  if (Number.isFinite(depth)) parts.push(`MSA depth ${formatNumber(depth)}`);
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
  // A new (non-additive) selection replaces selections made in other structures too.
  if (!options.additive) for (const entry of state.entries) if (entry !== state.active) entry.selection = new Set();
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
  for (const entry of state.entries) entry.selection = new Set();
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

/* ---------- Selections and commands ---------- */

function selectionTargets(entries = state.entries) {
  return entries.map((entry) => ({
    id: entry.id,
    index: state.entries.indexOf(entry) + 1,
    name: entry.name,
    model: activeModelOf(entry),
    structure: entry.structure,
    context: selectionContext(entry),
  }));
}

function selectionContext(entry) {
  const comparison = comparisonFor(entry);
  const deviation = comparison?.values('deviation') ?? null;
  return {
    selected: entry.selection,
    focus: entry.focus?.neighborhood ?? null,
    sites: siteResidueKeys(entry),
    covered: entry.proteomics.coverage ? new Set(entry.proteomics.coverage.keys()) : null,
    aligned: deviation ? new Set(deviation.keys()) : null,
    outliers: validationOf(entry)?.outlierKeys ?? null,
    values: {
      deviation,
      lddt: comparison?.values('lddt') ?? null,
      rmsf: entry.rmsf ?? null,
      rsa: entry.sasa?.relative ?? null,
      rsrz: validationOf(entry)?.values.rsrz ?? null,
      rscc: validationOf(entry)?.values.rscc ?? null,
      qscore: validationOf(entry)?.values.qscore ?? null,
      am: entry.missense?.values ?? null,
      msa: entry.msa?.values ?? null,
    },
    uniprot: (residue) => uniprotNumber(entry, residue),
  };
}

function uniprotNumber(entry, residue) {
  const info = entry.structure.sequences?.get(residue.chain);
  const mapped = info ? uniprotPositionForResidue(info, residue) : null;
  if (mapped) return mapped.position;
  return entry.structure.meta.isPredicted && !residue.iCode ? residue.resSeq : null;
}

// Evaluates selection text on the active model of each structure.
function resolveSelection(text, entries = state.entries) {
  const targets = selectionTargets(entries);
  const masks = evaluateSelection(parseSelection(text), targets);
  const results = [];
  let residues = 0;
  let atoms = 0;
  for (const target of targets) {
    const mask = masks.get(target.id);
    const count = countMask(mask);
    if (!count) continue;
    const keys = residueKeysFromMask(target.model, mask);
    const atomList = [];
    for (let index = 0; index < mask.length; index += 1) if (mask[index]) atomList.push(target.model.atoms[index]);
    results.push({ entry: entryById(target.id), model: target.model, keys, atoms: atomList });
    residues += keys.size;
    atoms += count;
  }
  return { text, results, residues, atoms };
}

function requireSelection(text, entries = state.entries) {
  const resolved = resolveSelection(text, entries);
  if (!resolved.residues) throw new CommandError(`Nothing matches "${text}".`);
  return resolved;
}

function describeResolution(resolved) {
  if (!resolved.residues) return 'nothing matches';
  const where = resolved.results.length === 1 ? (state.entries.length > 1 ? ` in ${resolved.results[0].entry.name}` : '') : ` in ${resolved.results.length} structures`;
  return `${formatNumber(resolved.residues)} residue${resolved.residues === 1 ? '' : 's'}, ${formatNumber(resolved.atoms)} atom${resolved.atoms === 1 ? '' : 's'}${where}`;
}

// Makes a resolved selection the current selection of every structure it touches.
function applySelection(resolved, options = {}) {
  for (const entry of state.entries) {
    entry.selection = new Set(resolved.results.find((result) => result.entry === entry)?.keys ?? []);
    entry.selectedAtom = null;
  }
  if (!state.selection.size) setActiveEntry(resolved.results[0].entry);
  if (options.frame) fitView(true, false, resolved.results.flatMap((result) => result.atoms));
  onSelectionChanged();
}

function findEntry(text) {
  const value = String(text ?? '').trim();
  const lower = value.toLowerCase();
  if (!value) return null;
  const byIndex = value.match(/^#?(\d+)$/);
  if (byIndex) return state.entries[Number(byIndex[1]) - 1] ?? null;
  return state.entries.find((entry) => entry.name.toLowerCase() === lower || entry.fetchId?.toLowerCase() === lower)
    ?? state.entries.find((entry) => entry.name.toLowerCase().startsWith(lower))
    ?? null;
}

function requireEntry(text) {
  const entry = findEntry(text);
  if (!entry) throw new CommandError(`No structure "${text}". Open structures: ${state.entries.map((item, index) => `#${index + 1} ${item.name}`).join(', ')}.`);
  return entry;
}

function markOverridesChanged(entry) {
  entry.display.overrideKey = `o${(state.overrideCounter = (state.overrideCounter ?? 0) + 1)}`;
  markSceneDirty();
}

function setResidueStyles(entry, keys, style) {
  const styles = new Map(entry.display.residueStyles ?? []);
  for (const key of keys) {
    if (style) styles.set(key, style);
    else styles.delete(key);
  }
  entry.display.residueStyles = styles.size ? styles : null;
  markOverridesChanged(entry);
}

// keys === null clears every hidden residue of the structure.
function setHiddenResidues(entry, keys, hidden = true) {
  const set = keys === null ? new Set() : new Set(entry.display.hiddenResidues ?? []);
  for (const key of keys ?? []) {
    if (hidden) set.add(key);
    else set.delete(key);
  }
  entry.display.hiddenResidues = set.size ? set : null;
  markOverridesChanged(entry);
  if (entry.surface.kind !== 'off') refreshSurface(entry);
}

function setColorOverrides(entry, keys, hex) {
  const overrides = new Map(entry.colorOverrides ?? []);
  const color = hex ? hexColor(hex) : null;
  for (const key of keys) {
    if (color) overrides.set(key, color);
    else overrides.delete(key);
  }
  entry.colorOverrides = overrides.size ? overrides : null;
  markColorsDirty();
}

// Selection card buttons: style or hide the selected residues of the active structure.
function styleSelection({ overlay = null, hide = false, color = null, reset = false }) {
  const entry = state.active;
  const keys = [...state.selection];
  if (!entry || !keys.length) {
    showToast('Select residues first.', true);
    return;
  }
  if (overlay) {
    const current = keys.every((key) => entry.display.residueStyles?.get(key) === overlay);
    setResidueStyles(entry, keys, current ? null : overlay);
  }
  if (hide) {
    setHiddenResidues(entry, keys, true);
    clearSelection(false);
    showToast(`Hid ${keys.length} residue${keys.length === 1 ? '' : 's'}. "All" in the Chains card shows them again.`);
  }
  if (color) setColorOverrides(entry, keys, color);
  if (reset) {
    setResidueStyles(entry, keys, null);
    setColorOverrides(entry, keys, null);
  }
}

// Runs one command line. Plain selections ("chain A and resi 10-20") are treated as "select".
// Returns { ok, message, data } and reports the outcome with a toast unless options.quiet.
async function runCommand(text, options = {}) {
  const source = String(text ?? '').trim();
  try {
    if (!source) throw new CommandError('Type a command, for example "help".');
    let parsed = parseCommand(source, { schemes: COLOR_SCHEME_IDS });
    if (!parsed) {
      if (!looksLikeSelection(source)) throw new CommandError(`"${source.split(/\s+/)[0]}" is not a command or a selection. Type "help" for the list.`);
      parsed = parseCommand(`select ${source}`);
    }
    if (!state.structure && !['fetch', 'add', 'help'].includes(parsed.name)) throw new CommandError('Open a structure first.');
    const outcome = await executeCommand(parsed, options);
    const result = typeof outcome === 'object' && outcome ? outcome : { message: outcome ?? '' };
    rememberCommand(source);
    if (!options.quiet && result.message) showToast(result.message);
    return { ok: true, message: result.message ?? '', data: result.data };
  } catch (error) {
    if (!(error instanceof CommandError) && error?.name !== 'SelectionError') console.error(error);
    if (!options.quiet) showToast(error.message, true);
    return { ok: false, message: error.message };
  }
}

async function executeCommand(parsed, options) {
  switch (parsed.name) {
    case 'select': {
      const resolved = requireSelection(parsed.selection);
      applySelection(resolved, { frame: options.frame });
      return {
        message: `Selected ${describeResolution(resolved)}.`,
        data: options.remote ? { residues: resolved.residues, atoms: resolved.atoms, structures: resolved.results.map((result) => ({ name: result.entry.name, residues: [...result.keys] })) } : undefined,
      };
    }
    case 'list':
      return {
        message: state.entries.map((entry, index) => `#${index + 1} ${entry.name}${entry === state.active ? ' (active)' : ''}${entry.visible ? '' : ' (hidden)'}`).join(', '),
        data: state.entries.map((entry, index) => ({
          index: index + 1,
          name: entry.name,
          active: entry === state.active,
          visible: entry.visible,
          chains: entry.structure.chains.filter((chain) => chain.polymerKind).map((chain) => chain.id),
          comparison: entry.comparison ? { reference: entryById(entry.comparison.referenceId)?.name, ...entry.comparison.stats } : null,
        })),
      };
    case 'zoom':
    case 'orient': {
      const atoms = parsed.selection ? requireSelection(parsed.selection).results.flatMap((result) => result.atoms) : null;
      fitView(true, parsed.name === 'orient', atoms);
      return '';
    }
    case 'focus': {
      const resolved = requireSelection(parsed.selection);
      const target = resolved.results.find((result) => result.entry === state.active) ?? resolved.results[0];
      setActiveEntry(target.entry);
      await focusResidues([...target.keys]);
      return `Focused ${formatNumber(target.keys.size)} residue${target.keys.size === 1 ? '' : 's'}${state.entries.length > 1 ? ` in ${target.entry.name}` : ''}.`;
    }
    case 'show':
    case 'hide':
      return representationCommand(parsed);
    case 'color':
      return colorCommand(parsed);
    case 'label':
    case 'unlabel': {
      const resolved = parsed.selection ? requireSelection(parsed.selection) : null;
      const targets = resolved ? resolved.results : [{ entry: state.active, keys: new Set(state.selection) }];
      if (!resolved && !state.selection.size) {
        if (parsed.name === 'unlabel') {
          for (const entry of state.entries) entry.labels = new Set();
          requestRender();
          return 'Removed all labels.';
        }
        throw new CommandError('Select residues or give a selection, for example "label resn STI".');
      }
      let count = 0;
      for (const { entry, keys } of targets) {
        const labels = new Set(entry.labels);
        for (const key of [...keys].slice(0, 300)) {
          if (parsed.name === 'label') labels.add(key);
          else labels.delete(key);
          count += 1;
        }
        entry.labels = labels;
      }
      requestRender();
      return `${parsed.name === 'label' ? 'Labeled' : 'Unlabeled'} ${count} residue${count === 1 ? '' : 's'}.`;
    }
    case 'fetch':
    case 'add': {
      const entry = await fetchStructure(parsed.id, { add: parsed.name === 'add' });
      if (!entry) throw new CommandError(`Could not open ${parsed.id}.`);
      return { message: `Opened ${entry.name}.`, data: { name: entry.name, atoms: activeModelOf(entry).atoms.length, chains: entry.structure.chains.filter((chain) => chain.polymerKind).map((chain) => chain.id) } };
    }
    case 'remove': {
      const entry = requireEntry(parsed.structure);
      if (state.entries.length < 2) throw new CommandError('The last structure cannot be removed; open another one instead.');
      removeEntry(entry);
      return `Removed ${entry.name}.`;
    }
    case 'activate': {
      const entry = requireEntry(parsed.structure);
      setActiveEntry(entry);
      return `${entry.name} is active.`;
    }
    case 'superpose':
      return superposeCommand(parsed);
    case 'alphafold':
      await compareWithAlphaFold();
      return '';
    case 'overlay': {
      if (state.active.structure.models.length < 2) throw new CommandError(`${state.active.name} has one model; overlays need an ensemble such as an NMR structure.`);
      const wanted = parsed.state === 'toggle' ? !state.active.overlay : parsed.state === 'on';
      if (wanted !== Boolean(state.active.overlay)) toggleModelOverlay();
      return '';
    }
    case 'ranking':
      return rankingCommand(parsed.rank);
    case 'domains':
      return findPAEDomains();
    case 'msa': {
      const entry = state.active;
      if (!entry.msa && entry.msaURL) {
        showLoading('Loading the AlphaFold DB alignment');
        try {
          const response = await fetch(entry.msaURL);
          if (!response.ok) throw new CommandError(await responseError(response, 'Could not load the alignment'));
          applyMSA(entry, [msaDepth(await response.text())], 'AlphaFold DB MSA', { quiet: true });
        } finally {
          hideLoading();
        }
      }
      if (!entry.msa) throw new CommandError('No alignment is known for this structure. Open a prediction folder with its MSA, drop an .a3m file, or fetch an AlphaFold DB model.');
      setColorScheme('msa', [entry]);
      renderPAE();
      return `MSA depth: median ${formatNumber(entry.msa.summary.median)} sequences${entry.msa.summary.shallow ? `, ${entry.msa.summary.shallow} residues below ${entry.msa.summary.threshold}` : ''}.`;
    }
    case 'validate': {
      const entry = state.active;
      if (parsed.mode === 'off') {
        entry.validation = null;
        if (['validation', 'densityfit'].includes(entry.color.scheme)) setColorScheme(entry.structure.meta.isPredicted ? 'plddt' : 'chain', [entry]);
        renderValidation();
        renderRamachandran();
        markSceneDirty();
        return 'Validation report cleared.';
      }
      let message = '';
      if (!entry.validation || parsed.mode === 'refresh') message = await loadValidation(entry, { refresh: parsed.mode === 'refresh' });
      if (parsed.mode === 'clashes') {
        setShowClashes(!entry.validation.showClashes, entry);
        return entry.validation.showClashes ? `Showing ${validationOf(entry).clashes.length} clashes.` : 'Clashes hidden.';
      }
      if (parsed.mode === 'fit') {
        if (!validationOf(entry).fit.values.size) throw new CommandError('This report has no per-residue fit to density (NMR entries have none).');
        setColorScheme('densityfit', [entry]);
        return message || `Colored by ${validationOf(entry).fit.kind === 'qscore' ? 'Q-score' : 'RSRZ'}.`;
      }
      setColorScheme('validation', [entry]);
      return message || 'Colored by validation outliers.';
    }
    case 'missense':
      return loadMissense(state.active, { accession: parsed.accession });
    case 'refresh': {
      const entry = state.active;
      if (entry.origin?.type !== 'fetch' || !entry.fetchId) throw new CommandError('Only fetched structures can be downloaded again.');
      const refreshed = await fetchStructure(entry.fetchId, { add: state.entries.length > 1, refresh: true });
      if (!refreshed) throw new CommandError(`Could not download ${entry.fetchId} again.`);
      if (state.entries.length > 1 && refreshed !== entry) removeEntry(entry);
      return `Downloaded ${refreshed.name} again.`;
    }
    case 'preset':
      if (!REPRESENTATION_PRESETS[parsed.value]) throw new CommandError(`Presets: ${Object.keys(REPRESENTATION_PRESETS).join(', ')}.`);
      applyRepresentationPreset(parsed.value);
      return '';
    case 'lighting':
      if (!LIGHTING_PRESETS[parsed.value]) throw new CommandError(`Lighting presets: ${Object.keys(LIGHTING_PRESETS).join(', ')}.`);
      applyLightingPreset(parsed.value);
      return '';
    case 'bg':
      if (!BACKGROUNDS[parsed.value]) throw new CommandError(`Backgrounds: ${Object.keys(BACKGROUNDS).join(', ')}.`);
      setBackground(parsed.value);
      return '';
    case 'distance': {
      const a = requireSingleAtom(parsed.from);
      const b = requireSingleAtom(parsed.to);
      const measurement = { type: 'distance', atoms: [a, b], value: measureValue('distance', [a.atom, b.atom]) };
      state.measurements.push(measurement);
      renderMeasurements();
      markSceneDirty();
      return { message: `Distance ${formatMeasurement(measurement)}.`, data: { distance: measurement.value } };
    }
    case 'turn':
      rotateView(parsed.axis, parsed.degrees);
      return '';
    case 'spin':
      setSpin(parsed.state === 'toggle' ? !state.spin : parsed.state === 'on');
      return '';
    case 'reset':
      resetView(true);
      return '';
    case 'save':
      if (options.remote) return { message: 'Session document returned.', data: await sessionDocument() };
      await saveSession();
      return '';
    case 'link':
      if (options.remote) {
        const link = await sessionLink().catch((error) => {
          throw new CommandError(error.message);
        });
        return { message: link, data: { link } };
      }
      return copySessionLink();
    case 'mvs': {
      if (!options.remote) {
        await exportMolViewSpec();
        return '';
      }
      const { remote, spec, files } = await buildMolViewSpecExport();
      if (remote) return { message: 'MolViewSpec (.mvsj) returned.', data: { format: 'mvsj', spec } };
      const archive = await createZip([{ name: 'index.mvsj', data: JSON.stringify(spec) }, ...files]);
      return { message: 'MolViewSpec archive (.mvsx) returned as base64.', data: { format: 'mvsx', base64: bytesToBase64(archive) } };
    }
    case 'png': {
      els.exportSize.value = String(parsed.scale);
      els.exportTransparent.checked = parsed.transparent;
      const canvas = await renderImageCanvas();
      const dataURL = options.returnImage ? canvas.toDataURL('image/png') : null;
      if (!options.returnImage) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        downloadBlob(`${fileStem()}.png`, blob);
      }
      return { message: `${options.returnImage ? 'Rendered' : 'Saved'} ${canvas.width} × ${canvas.height} PNG.`, data: options.returnImage ? { image: dataURL, width: canvas.width, height: canvas.height } : undefined };
    }
    case 'help': {
      if (parsed.topic) {
        const command = COMMANDS.find((item) => item.name === parsed.topic || item.aliases.includes(parsed.topic));
        if (!command) throw new CommandError(`No command "${parsed.topic}".`);
        return `${command.syntax}: ${command.summary}.`;
      }
      els.helpDialog.showModal();
      els.helpCommands.scrollIntoView({ block: 'start' });
      return '';
    }
    default:
      throw new CommandError(`"${parsed.name}" is not available.`);
  }
}

function representationCommand({ name, representation, selection }) {
  const show = name === 'show';
  if (!selection) {
    switch (representation) {
      case 'water':
        els.showWater.checked = show;
        updateDisplay({ showWater: show });
        return '';
      case 'hydrogens':
        els.showHydrogen.checked = show;
        updateDisplay({ showHydrogen: show });
        return '';
      case 'surface':
        for (const entry of styleTargets()) {
          entry.surface.kind = show ? (entry.surface.kind === 'off' ? 'ses' : entry.surface.kind) : 'off';
          entry.surface.keys = null;
          entry.surface.keysKey = '';
        }
        syncStyleControls();
        refreshSurface();
        return '';
      case 'labels':
        if (show) throw new CommandError('Give residues to label, for example "show labels resn STI".');
        for (const entry of state.entries) entry.labels = new Set();
        requestRender();
        return '';
      case 'cartoon':
      case 'trace':
        updateDisplay({ polymer: show ? representation : 'none' });
        syncStyleControls();
        return '';
      case 'everything':
        for (const entry of state.entries) {
          if (show) {
            entry.visible = true;
            if (entry.display.hiddenResidues) setHiddenResidues(entry, null);
          } else {
            entry.visible = false;
          }
        }
        renderStructureList();
        markSceneDirty();
        refreshSurface();
        return show ? '' : 'Hid all structures; "show everything" shows them again.';
      default:
        if (show) {
          applyRepresentationPreset(representation);
        } else {
          for (const entry of state.entries) if (entry.display.residueStyles) setResidueStyles(entry, [...entry.display.residueStyles.keys()], null);
        }
        syncStyleControls();
        return '';
    }
  }
  const resolved = requireSelection(selection);
  for (const { entry, keys } of resolved.results) {
    switch (representation) {
      case 'sticks':
      case 'ball-stick':
      case 'spacefill':
        if (show) {
          setResidueStyles(entry, keys, representation);
          if (entry.display.hiddenResidues) setHiddenResidues(entry, keys, false);
        } else {
          setResidueStyles(entry, keys, null);
        }
        break;
      case 'surface': {
        const polymerKeys = entry.surface.keys ?? new Set(activeModelOf(entry).residues.filter((residue) => residue.kind !== 'water').map((residue) => residue.key));
        const next = show && !entry.surface.keys ? new Set() : new Set(polymerKeys);
        for (const key of keys) {
          if (show) next.add(key);
          else next.delete(key);
        }
        entry.surface.keys = next;
        entry.surface.keysKey = `s${(state.overrideCounter = (state.overrideCounter ?? 0) + 1)}`;
        if (show && entry.surface.kind === 'off') entry.surface.kind = 'ses';
        refreshSurface(entry);
        break;
      }
      case 'labels': {
        const labels = new Set(entry.labels);
        for (const key of [...keys].slice(0, 300)) {
          if (show) labels.add(key);
          else labels.delete(key);
        }
        entry.labels = labels;
        requestRender();
        break;
      }
      case 'water':
      case 'hydrogens':
        throw new CommandError(`"${name} ${representation}" applies to the whole scene; leave out the selection.`);
      default:
        setHiddenResidues(entry, keys, !show);
    }
  }
  syncStyleControls();
  return `${show ? 'Showing' : 'Hiding'} ${representation === 'everything' || representation === 'cartoon' ? '' : `${representation} for `}${describeResolution(resolved)}.`;
}

function colorCommand({ selection, color, scheme, reset }) {
  if (scheme) {
    setColorScheme(scheme);
    syncStyleControls();
    return '';
  }
  if (reset) {
    if (selection) {
      for (const { entry, keys } of requireSelection(selection).results) setColorOverrides(entry, keys, null);
    } else {
      for (const entry of styleTargets()) if (entry.colorOverrides) setColorOverrides(entry, [...entry.colorOverrides.keys()], null);
    }
    return 'Custom colors removed.';
  }
  if (!selection) {
    for (const entry of styleTargets()) {
      entry.color.scheme = 'uniform';
      entry.color.uniformColor = color;
    }
    syncStyleControls();
    markColorsDirty();
    return '';
  }
  const resolved = requireSelection(selection);
  for (const { entry, keys } of resolved.results) setColorOverrides(entry, keys, color);
  return `Colored ${describeResolution(resolved)}.`;
}

function superposeCommand({ mobile, reference, fit }) {
  const all = ['all', '*'].includes(mobile.toLowerCase());
  const fixed = reference ? requireEntry(reference) : null;
  const moving = all ? null : requireEntry(mobile);
  const referenceEntry = fixed ?? (moving === state.active ? state.entries.find((entry) => entry !== moving) : state.active);
  const mobiles = all ? state.entries.filter((entry) => entry !== referenceEntry) : [moving];
  if (!referenceEntry || !mobiles.length || mobiles.includes(referenceEntry)) throw new CommandError('Superposition needs two different structures, for example "superpose 1AKE onto 4AKE".');
  const fitKeys = fit ? requireSelection(fit, [referenceEntry]).results[0].keys : null;
  const results = runSuperposition({ reference: referenceEntry, mobiles, fitKeys });
  const lines = results.map((item) => (item.error
    ? `${item.mobile.name}: ${item.error.message}`
    : `${item.mobile.name} onto ${referenceEntry.name}: ${item.result.stats.rmsd.toFixed(2)} Å over ${item.result.stats.keptCount} pairs, TM-score ${item.result.stats.tmScore.toFixed(3)}`));
  if (results.every((item) => item.error)) throw new CommandError(lines.join('; '));
  return { message: lines.join('; '), data: results.map((item) => ({ name: item.mobile.name, stats: item.result?.stats ?? null, error: item.error?.message ?? null })) };
}

function requireSingleAtom(text) {
  const resolved = requireSelection(text);
  const atoms = resolved.results.flatMap((result) => result.atoms.map((atom) => ({ entry: result.entry, model: result.model, atom })));
  if (atoms.length !== 1) throw new CommandError(`"${text}" matches ${formatNumber(atoms.length)} atoms; a distance needs exactly one (for example add @CA).`);
  return atoms[0];
}

function rotateView(axis, degrees) {
  const basis = cameraBasis(state.camera);
  const vector = axis === 'x' ? basis.right : axis === 'y' ? basis.up : basis.forward;
  state.camera.rotation = quatNormalize(quatMultiply(quatFromAxisAngle(vector, (-degrees * Math.PI) / 180), state.camera.rotation));
  state.cameraAnimation = null;
  requestRender();
}

function setBackground(name) {
  state.background = name;
  setActiveButton('[data-background]', document.querySelector(`[data-background="${name}"]`));
  requestRender();
}

function renderHelpCommands() {
  els.helpCommands.innerHTML = `<h3>Commands</h3>
    <p class="hint">Type in the search box (<kbd>/</kbd>). Plain selections select; ↑ and ↓ recall earlier commands.</p>
    <dl class="command-list">${COMMANDS.map((command) => `<div><dt><code>${escapeHTML(command.syntax)}</code></dt><dd>${escapeHTML(command.summary)}</dd></div>`).join('')}</dl>
    <h3>Selections</h3>
    <dl class="command-list">
      <div><dt><code>chain A+B</code> <code>resi 40-80</code> <code>resn STI</code> <code>name CA</code> <code>elem FE</code></dt><dd>Chains, residue numbers (with insertion codes), residue and atom names (<code>*</code> wildcards) and elements</dd></div>
      <div><dt><code>/A:40-80@CA</code> <code>#2</code> <code>:HEM</code></dt><dd>ChimeraX-style specs: #structure, /chain, :residues, @atoms</dd></div>
      <div><dt><code>protein</code> <code>nucleic</code> <code>ligand</code> <code>ion</code> <code>water</code> <code>hetatm</code> <code>backbone</code> <code>sidechain</code> <code>helix</code> <code>sheet</code></dt><dd>Classes</dd></div>
      <div><dt><code>and</code> <code>or</code> <code>not</code> <code>( )</code></dt><dd>Logic; words next to each other mean "and"</dd></div>
      <div><dt><code>within 5 of X</code> <code>around 5 of X</code> <code>byres X</code> <code>bychain X</code></dt><dd>Neighborhoods (in Å, across structures) and expansion to whole residues or chains</dd></div>
      <div><dt><code>b &gt; 60</code> <code>plddt &lt; 70</code> <code>deviation &gt; 2</code> <code>rsa &gt; 0.4</code> <code>uniprot 175</code></dt><dd>Values: B-factor, confidence, superposition deviation, lDDT, RMSF, relative SASA, UniProt numbering</dd></div>
      <div><dt><code>sele</code> <code>focus</code> <code>sites</code> <code>covered</code> <code>aligned</code></dt><dd>Current selection, focus, proteomics sites, peptide coverage, residues paired in a comparison</dd></div>
    </dl>`;
}

/* ---------- Remote control ---------- */

// With --remote-control, commands from scripts on this computer (for example a Jupyter notebook)
// arrive over Server-Sent Events; the outcome, including PNG images, sessions and MolViewSpec,
// goes back to the server, which answers the script.
function connectRemoteControl() {
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/remote/events');
  source.addEventListener('command', async (event) => {
    let request;
    try {
      request = JSON.parse(event.data);
    } catch {
      return;
    }
    const result = await runCommand(request.command, { remote: true, returnImage: true });
    try {
      await fetch(`/api/remote/result/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: result.ok, message: result.message, data: result.data ?? null }),
      });
    } catch (error) {
      console.warn('Could not return a remote-control result', error);
    }
  });
  els.gpuBadge.title = `${els.gpuBadge.title} · remote control is on`;
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
  const refChain = options.refChain ?? (options.reference ? '*' : els.compareRefChain.value || '*');
  const mobChain = options.mobChain ?? (options.reference ? '*' : els.compareMobChain.value || '*');
  let fitKeys = options.fitKeys ?? null;
  if (!fitKeys && (options.fitSelection ?? (!options.reference && els.compareFitSelection.checked))) {
    fitKeys = new Set(reference.selection);
    if (fitKeys.size < 3) {
      showToast(`Select at least three residues of ${reference.name} to fit on (for example one domain), or untick "Fit on selected residues".`, true);
      return [];
    }
  }
  const results = [];
  for (const mobile of mobiles) {
    try {
      const recipe = {
        refChains: refChain !== '*' ? [refChain] : null,
        mobChains: mobChain !== '*' && mobiles.length === 1 ? [mobChain] : null,
        fitKeys: fitKeys ? [...fitKeys] : null,
      };
      const result = compareStructures(pairOf(reference), pairOf(mobile), { ...recipe, fitKeys });
      applyComparison(reference, mobile, result, recipe);
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

// `recipe` records how the comparison was made, so a restored session can recompute it.
function applyComparison(reference, mobile, result, recipe = {}) {
  applyEntryTransform(mobile, result.transform);
  const byMobile = new Map();
  const byReference = new Map();
  for (const pair of result.pairs) {
    byMobile.set(pair.mob.key, { key: pair.ref.key, distance: pair.distance, lddt: pair.lddt, fitted: pair.fitted });
    byReference.set(pair.ref.key, { key: pair.mob.key, distance: pair.distance, lddt: pair.lddt, fitted: pair.fitted });
  }
  mobile.comparison = { referenceId: reference.id, time: performance.now(), stats: result.stats, chainPairs: result.chainPairs, byMobile, byReference, recipe };
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
    let recipe = null;
    let lastError = null;
    for (const options of [{ correspondence: 'uniprot', refChains: [chainId], accession }, { refChains: [chainId] }]) {
      try {
        result = compareStructures(pairOf(reference), pairOf(model), options);
        recipe = options;
        if (result.stats.pairCount >= 10) break;
        result = null;
      } catch (error) {
        lastError = error;
      }
    }
    if (result) {
      applyComparison(reference, model, result, recipe);
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
function toggleModelOverlay(entry = state.active) {
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

/* ---------- Sessions and MolViewSpec ---------- */

const SESSION_FORMAT = 'proteoscope-session';
const SESSION_VERSION = 1;

// A session records how to rebuild the workspace: where each structure came from (fetched ID,
// bundled example, or the embedded text of a local file), its style, position, comparisons,
// selections and proteomics overlays, plus the camera and scene settings.
async function sessionDocument(options = {}) {
  const structures = [];
  for (const entry of state.entries) structures.push(await serializeEntry(entry, options));
  const camera = state.camera;
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    created: new Date().toISOString(),
    application: 'Proteoscope',
    title: state.active?.structure.meta.title ?? '',
    view: {
      camera: { target: [...camera.target], distance: camera.distance, rotation: [...camera.rotation], fov: camera.fov, orthographic: camera.orthographic },
      lighting: { ...state.lighting },
      background: state.background,
      clip: { ...state.clip },
      secondaryMode: state.secondaryMode,
      styleScope: state.styleScope,
      legendCollapsed: Boolean(state.legendCollapsed),
    },
    active: state.entries.indexOf(state.active),
    structures,
    measurements: state.measurements.map((measurement) => ({
      type: measurement.type,
      atoms: measurement.atoms.map((item) => ({ structure: state.entries.indexOf(item.entry), model: item.model.number, residue: item.atom.residueKey, atom: item.atom.name })),
    })),
  };
}

async function serializeEntry(entry, options) {
  const origin = entry.origin ?? { type: 'file', name: entry.name };
  let source;
  if (origin.type === 'fetch' || origin.type === 'sample') {
    source = { type: origin.type, id: origin.id };
  } else {
    if (options.link) throw new Error(`${entry.name} is a local file, so it cannot travel in a link. Save the session as a file instead.`);
    source = { type: 'file', name: origin.name, encoding: 'gzip-base64', data: bytesToBase64(await compressText(origin.text ?? '')) };
  }
  const display = { ...entry.display };
  delete display.residueFilter;
  delete display.residueFilterKey;
  delete display.overrideKey;
  display.visibleChains = entry.display.visibleChains ? [...entry.display.visibleChains] : null;
  display.residueStyles = entry.display.residueStyles ? [...entry.display.residueStyles] : null;
  display.hiddenResidues = entry.display.hiddenResidues ? [...entry.display.hiddenResidues] : null;
  const referenceIndex = entry.comparison ? state.entries.findIndex((item) => item.id === entry.comparison.referenceId) : -1;
  const proteomics = entry.proteomics;
  return {
    name: entry.name,
    source,
    visible: entry.visible,
    assembly: entry.structure.activeAssemblyId,
    activeModel: entry.activeModel,
    display,
    color: { ...entry.color },
    colorOverrides: entry.colorOverrides ? [...entry.colorOverrides].map(([key, color]) => [key, colorToHex(color)]) : null,
    surface: { kind: entry.surface.kind, color: entry.surface.color, opacity: entry.surface.opacity, keys: entry.surface.keys ? [...entry.surface.keys] : null },
    transform: entry.transform,
    comparison: referenceIndex >= 0 ? { reference: referenceIndex, ...entry.comparison.recipe } : null,
    trimmed: Boolean(entry.display.residueFilter),
    overlay: Boolean(entry.overlay),
    selection: [...entry.selection],
    focus: entry.focus ? [...entry.focus.residues] : null,
    labels: [...entry.labels],
    proteomics: {
      coverage: proteomics.coverage ? [...proteomics.coverage] : null,
      data: proteomics.data ? [...proteomics.data] : null,
      dataLabel: proteomics.dataLabel,
      sites: proteomics.sites.map((site) => ({ residue: site.residue.key, label: site.label, mismatch: Boolean(site.mismatch) })),
      crosslinks: proteomics.crosslinks.map((link) => ({ ...linkFields(link), atomA: atomRef(link.atomA), atomB: atomRef(link.atomB) })),
    },
    // Recomputed or refetched on restore rather than stored.
    sasa: Boolean(entry.sasa),
    validation: entry.validation ? { clashes: Boolean(entry.validation.showClashes) } : null,
    missense: entry.missense ? { accessions: entry.missense.accessions } : null,
    domains: Boolean(entry.domains),
    msa: entry.msa ? { values: [...entry.msa.values], source: entry.msa.source } : null,
    pae: options.link ? null : await serializePAE(entry),
    prediction: entry.prediction ? predictionSessionFields(entry) : null,
  };
}

// The scores of a predicted model travel with it; the rest of its prediction folder does not.
function predictionSessionFields(entry) {
  const set = predictionSetOf(entry);
  const model = predictionModelOf(entry);
  if (!set || !model) return null;
  const { pae, plddt, ...scores } = model.scores ?? {};
  return {
    tool: set.tool,
    toolLabel: set.toolLabel,
    name: set.name,
    affinity: set.affinityResult ?? null,
    model: {
      id: model.id,
      label: model.label,
      rank: model.rank,
      order: model.order,
      scores,
      chains: model.chains ?? null,
      meanPlddt: Number.isFinite(model.meanPlddt) ? model.meanPlddt : null,
      metrics: model.metrics ?? null,
      tokenKeys: model.tokenKeys ?? null,
      calpha: model.calpha ? [...model.calpha] : null,
    },
  };
}

function restorePrediction(entry, saved) {
  if (!saved?.model) return;
  const model = { ...saved.model, files: {}, entryId: entry.id, calpha: saved.model.calpha ? new Map(saved.model.calpha) : null, meanPlddt: saved.model.meanPlddt ?? NaN };
  const set = { id: `prediction-${state.predictionSets.length + 1}`, tool: saved.tool, toolLabel: saved.toolLabel, name: saved.name, models: [model], files: [], affinityResult: saved.affinity, restored: true };
  state.predictionSets.push(set);
  entry.prediction = { setId: set.id, modelId: model.id };
}

// PAE matrices opened by hand (or from a prediction folder) are stored as bytes at 0.125 Å
// steps; AlphaFold DB matrices of fetched entries are simply fetched again.
async function serializePAE(entry) {
  const pae = entry.pae;
  if (!pae || (entry.origin?.type === 'fetch' && pae.source === 'AlphaFold DB')) return null;
  return {
    source: pae.source,
    size: pae.size,
    max: pae.max,
    encoding: 'uint8x8-gzip-base64',
    data: bytesToBase64(await compressText(quantizeMatrix(pae.matrix, 8))),
    tokens: pae.residues.map((residue) => residue?.key ?? null),
    // Contact probabilities in 1/255 steps.
    contacts: entry.contacts ? bytesToBase64(await compressText(quantizeMatrix(entry.contacts.matrix, 255))) : null,
  };
}

async function restorePAE(entry, saved) {
  if (!saved?.data || saved.encoding !== 'uint8x8-gzip-base64') return;
  const matrix = dequantizeMatrix(await decompressBytes(base64ToBytes(saved.data)), 8);
  if (matrix.length !== saved.size * saved.size) return;
  const model = activeModelOf(entry);
  const residues = (saved.tokens ?? []).map((key) => (key ? model.residueMap.get(key) ?? null : null));
  entry.pae = { size: saved.size, matrix, max: saved.max || 31.75, residues, chainBoundaries: chainBoundaries(residues), source: saved.source || 'Session file' };
  if (saved.contacts) {
    const contacts = dequantizeMatrix(await decompressBytes(base64ToBytes(saved.contacts)), 255);
    if (contacts.length === matrix.length) entry.contacts = { size: saved.size, matrix: contacts };
  }
}

// SASA, validation reports, AlphaMissense and PAE domains are rebuilt after the structures load.
async function restoreEntryExtras(entry, item, problems) {
  try {
    if (item.prediction) restorePrediction(entry, item.prediction);
    if (item.msa?.values) {
      const values = new Map(item.msa.values.filter(([key]) => activeModelOf(entry).residueMap.has(key)));
      if (values.size) entry.msa = { values, source: item.msa.source, summary: depthSummary([...values.values()]) };
    }
    if (item.pae) await restorePAE(entry, item.pae);
    if (item.domains && entry.pae) computePAEDomains(entry);
    if (item.sasa) await runSASA(entry);
    if (item.validation) {
      showLoading(`Loading the validation report for ${entry.name}`);
      await loadValidation(entry);
      entry.validation.showClashes = Boolean(item.validation.clashes);
    }
    if (item.missense) {
      showLoading(`Loading AlphaMissense for ${entry.name}`);
      // An accession typed for a local model is not in the file, so it comes from the session.
      await loadMissense(entry, { color: false, accession: item.missense.accessions?.length === 1 ? item.missense.accessions[0] : null });
    }
  } catch (error) {
    problems.push(`${entry.name}: ${error.message}`);
  }
}

function linkFields(link) {
  const { atomA, atomB, ...fields } = link;
  return fields;
}

function atomRef(atom) {
  return atom ? { residue: atom.residueKey, atom: atom.name } : null;
}

async function saveSession() {
  const document0 = await sessionDocument();
  downloadText(`${fileStem()}.proteoscope.json`, JSON.stringify(document0), 'application/json');
  showToast(`Saved the session (${state.entries.length} structure${state.entries.length === 1 ? '' : 's'}). Open or drop the file to restore it.`);
}

async function sessionLink() {
  const document0 = await sessionDocument({ link: true });
  return `${location.origin}${location.pathname}#session=${await encodeLinkPayload(JSON.stringify(document0))}`;
}

async function copySessionLink() {
  let link;
  try {
    link = await sessionLink();
  } catch (error) {
    throw new CommandError(error.message);
  }
  try {
    await navigator.clipboard.writeText(link);
    return `Copied a link to this view (${formatNumber(link.length)} characters). It opens in Proteoscope on this port.`;
  } catch {
    history.replaceState(null, '', link);
    return 'The link is now in the address bar; copy it from there.';
  }
}

function isSessionDocument(value) {
  return value && typeof value === 'object' && value.format === SESSION_FORMAT;
}

// Rebuilds a saved workspace. Structures load in order, then positions, comparisons, styles,
// selections and the view are reapplied.
async function restoreSession(document0) {
  if (!isSessionDocument(document0)) throw new Error('This file is not a Proteoscope session.');
  if (document0.version > SESSION_VERSION) throw new Error('This session was saved by a newer version of Proteoscope.');
  const items = document0.structures ?? [];
  if (!items.length) throw new Error('The session contains no structures.');
  const view = document0.view ?? {};
  if (view.secondaryMode && view.secondaryMode !== state.secondaryMode) {
    state.secondaryMode = view.secondaryMode;
    setActiveButton('[data-ss-mode]', document.querySelector(`[data-ss-mode="${view.secondaryMode}"]`));
  }
  const entries = [];
  const problems = [];
  for (const [index, item] of items.entries()) {
    showLoading(`Restoring ${item.name ?? `structure ${index + 1}`} (${index + 1} of ${items.length})`);
    const add = entries.some(Boolean);
    let entry = null;
    try {
      entry = await loadSessionSource(item.source, { add, name: item.name });
    } catch (error) {
      problems.push(`${item.name}: ${error.message}`);
    }
    entries.push(entry);
    if (entry) await applyEntrySettings(entry, item);
  }
  // Positions first, then comparisons (whose fits are then near-identity), then the rest.
  items.forEach((item, index) => {
    const entry = entries[index];
    if (entry && item.transform) applyEntryTransform(entry, item.transform);
  });
  items.forEach((item, index) => {
    const entry = entries[index];
    const reference = entries[item.comparison?.reference];
    if (!entry || !reference) return;
    try {
      const { reference: ignored, ...recipe } = item.comparison;
      const fitKeys = recipe.fitKeys ? new Set(recipe.fitKeys) : null;
      applyComparison(reference, entry, compareStructures(pairOf(reference), pairOf(entry), { ...recipe, fitKeys }), recipe);
      if (item.trimmed) trimToAligned(entry, true);
    } catch (error) {
      problems.push(`${item.name}: ${error.message}`);
    }
  });
  items.forEach((item, index) => {
    const entry = entries[index];
    if (entry && item.overlay && !entry.overlay) toggleModelOverlay(entry);
    if (entry) applyEntryState(entry, item);
  });
  state.measurements = (document0.measurements ?? []).map((measurement) => {
    const atoms = measurement.atoms.map((ref) => {
      const entry = entries[ref.structure];
      const model = entry?.structure.models.find((item) => item.number === ref.model);
      const atom = model?.residueMap.get(ref.residue)?.atomByName.get(ref.atom);
      return atom ? { entry, model, atom } : null;
    });
    return atoms.every(Boolean) ? { type: measurement.type, atoms, value: measureValue(measurement.type, atoms.map((item) => item.atom)) } : null;
  }).filter(Boolean);
  applySessionView(view);
  const active = entries[document0.active] ?? entries.find(Boolean);
  if (active) {
    state.active = null;
    setActiveEntry(active);
  }
  for (const [index, item] of items.entries()) {
    if (entries[index]) await restoreEntryExtras(entries[index], item, problems);
  }
  for (const entry of state.entries) refreshSurface(entry);
  updateStructureUI();
  renderMeasurements();
  markSceneDirty();
  markColorsDirty();
  hideLoading();
  if (problems.length) showToast(`Session restored with problems: ${problems.join('; ')}`, true);
  else showToast(`Restored the session (${state.entries.length} structure${state.entries.length === 1 ? '' : 's'}).`);
  for (const entry of state.entries) if (entry.focus) computeFocusInteractionsFor(entry);
}

async function loadSessionSource(source, options) {
  if (source?.type === 'fetch') {
    const entry = await fetchStructure(source.id, { add: options.add, activate: false });
    if (!entry) throw new Error(`could not fetch ${source.id}`);
    return entry;
  }
  if (source?.type === 'sample') {
    const sample = state.samples.find((item) => item.id === source.id);
    if (!sample) throw new Error(`the bundled example ${source.id} is not available`);
    return loadStructureFromURL(sample.url, sample.name, { add: options.add, activate: false, origin: { type: 'sample', id: sample.id } });
  }
  if (source?.type === 'file') {
    const text = source.encoding === 'gzip-base64' ? await decompressText(base64ToBytes(source.data)) : source.data;
    return loadStructureFromText(text, source.name ?? options.name ?? 'structure', { add: options.add, activate: false, source: 'Session file', origin: { type: 'file', name: source.name, text } });
  }
  throw new Error('unknown source');
}

async function applyEntrySettings(entry, item) {
  if (item.name) entry.name = item.name;
  entry.visible = item.visible !== false;
  if (item.assembly && item.assembly !== entry.structure.activeAssemblyId) await activateAssembly(item.assembly, entry);
  entry.activeModel = Math.min(Math.max(0, item.activeModel ?? 0), entry.structure.models.length - 1);
  const display = item.display ?? {};
  Object.assign(entry.display, {
    ...display,
    visibleChains: display.visibleChains ? new Set(display.visibleChains) : null,
    residueStyles: display.residueStyles ? new Map(display.residueStyles) : null,
    hiddenResidues: display.hiddenResidues ? new Set(display.hiddenResidues) : null,
    residueFilter: null,
    residueFilterKey: '',
    overrideKey: `session-${entry.id}`,
  });
  Object.assign(entry.color, item.color ?? {});
  entry.colorOverrides = item.colorOverrides ? new Map(item.colorOverrides.map(([key, hex]) => [key, hexColor(hex)])) : null;
  Object.assign(entry.surface, {
    kind: item.surface?.kind ?? 'off',
    color: item.surface?.color ?? 'scheme',
    opacity: item.surface?.opacity ?? 1,
    keys: item.surface?.keys ? new Set(item.surface.keys) : null,
    keysKey: item.surface?.keys ? `session-${entry.id}` : '',
    key: '',
    data: null,
  });
}

function applyEntryState(entry, item) {
  const model = activeModelOf(entry);
  const known = (keys) => (keys ?? []).filter((key) => model.residueMap.has(key));
  entry.selection = new Set(known(item.selection));
  entry.labels = new Set(known(item.labels));
  const focusKeys = known(item.focus);
  entry.focus = focusKeys.length ? { residues: new Set(focusKeys), neighborhood: focusNeighborhood(model, focusKeys, 5) } : null;
  const proteomics = item.proteomics ?? {};
  entry.proteomics = {
    ...emptyProteomics(),
    coverage: proteomics.coverage ? new Map(proteomics.coverage) : null,
    data: proteomics.data ? new Map(proteomics.data) : null,
    dataLabel: proteomics.dataLabel ?? '',
    sites: (proteomics.sites ?? []).map((site) => ({ residue: model.residueMap.get(site.residue), label: site.label, mismatch: site.mismatch })).filter((site) => site.residue),
    crosslinks: (proteomics.crosslinks ?? []).map((link) => ({
      ...link,
      atomA: model.residueMap.get(link.atomA?.residue)?.atomByName.get(link.atomA?.atom) ?? null,
      atomB: model.residueMap.get(link.atomB?.residue)?.atomByName.get(link.atomB?.atom) ?? null,
    })).filter((link) => link.atomA && link.atomB),
  };
  const overrides = new Map();
  for (const site of entry.proteomics.sites) overrides.set(site.residue.key, site.mismatch ? [1, 0.7, 0.2] : [1, 0.28, 0.72]);
  entry.proteomics.siteOverrides = overrides.size ? overrides : null;
}

function applySessionView(view) {
  if (view.lighting) {
    const preset = LIGHTING_PRESETS[view.lighting.preset] ? view.lighting.preset : 'standard';
    applyLightingPreset(preset);
    state.lighting = { ...state.lighting, ...view.lighting };
    for (const [id, key] of [['ao-strength', 'ao'], ['outline-strength', 'outline'], ['fog-strength', 'fog'], ['glow-scale', 'glow'], ['specular', 'specular'], ['ao-radius', 'aoRadius']]) {
      document.querySelector(`#${id}`).value = String(state.lighting[key]);
    }
  }
  if (view.background && BACKGROUNDS[view.background]) setBackground(view.background);
  if (view.clip) {
    state.clip = { near: Number(view.clip.near) || 0, far: Number.isFinite(view.clip.far) ? view.clip.far : 1 };
    document.querySelector('#clip-near').value = String(state.clip.near);
    document.querySelector('#clip-far').value = String(state.clip.far);
  }
  if (view.styleScope) state.styleScope = view.styleScope === 'active' ? 'active' : 'all';
  state.legendCollapsed = Boolean(view.legendCollapsed);
  if (view.camera) {
    setProjection(Boolean(view.camera.orthographic));
    Object.assign(state.camera, {
      target: [...view.camera.target],
      distance: view.camera.distance,
      rotation: [...view.camera.rotation],
      fov: view.camera.fov ?? state.camera.fov,
    });
    state.cameraAnimation = null;
    state.camera.sceneRadius = sceneBoundsFromEntries().radius;
    updateViewOffset();
  }
  syncControlOutputs();
  requestRender();
}

async function computeFocusInteractionsFor(entry) {
  if (entry !== state.active || !entry.focus) return;
  await computeFocusInteractions([...entry.focus.residues]);
}

async function openSessionFile(text) {
  const parsed = JSON.parse(text);
  if (!isSessionDocument(parsed)) return false;
  await restoreSession(parsed);
  return true;
}

// MolViewSpec export for Mol*: an .mvsj file when every structure has a public URL, otherwise a
// self-contained .mvsx archive with the structure files inside.
async function exportMolViewSpec() {
  const { remote, spec, files } = await buildMolViewSpecExport();
  const json = JSON.stringify(spec, null, 1);
  if (remote) {
    downloadText(`${fileStem()}.mvsj`, json, 'application/json');
    showToast('Saved MolViewSpec (.mvsj). Drop it onto molstar.org/viewer to open it in Mol*.');
  } else {
    const archive = await createZip([{ name: 'index.mvsj', data: json }, ...files]);
    downloadBlob(`${fileStem()}.mvsx`, new Blob([archive], { type: 'application/zip' }));
    showToast('Saved MolViewSpec (.mvsx) with the structure files inside. Drop it onto molstar.org/viewer to open it in Mol*.');
  }
}

// Exports read geometry and colors directly, so pending scene work is done first (the render
// loop may not have run, for example in a background tab).
function ensureSceneCurrent() {
  if (state.dirty.scene) rebuildScene();
  if (state.dirty.colors) updateColors();
  if (state.dirty.flags) updateFlags();
}

async function buildMolViewSpecExport() {
  ensureSceneCurrent();
  const visible = state.entries.filter((entry) => entry.visible);
  if (!visible.length) throw new CommandError('Show at least one structure to export.');
  const remote = visible.every((entry) => entry.origin?.type === 'fetch' && entry.sourceURL);
  const files = [];
  const structures = [];
  for (const [index, entry] of visible.entries()) {
    let url = entry.sourceURL;
    if (!remote) {
      const text = await structureText(entry);
      const extension = entry.structure.format === 'mmcif' ? 'cif' : 'pdb';
      url = `structures/${index + 1}-${entry.name.replace(/[^A-Za-z0-9_.-]+/g, '_')}.${extension}`;
      files.push({ name: url, data: text });
    }
    structures.push(mvsStructure(entry, url));
  }
  const spec = buildMolViewSpec({
    title: state.active ? `${state.active.name}: ${titleCase(String(state.active.structure.meta.title || '').replace(/^[0-9A-Za-z-]+:\s*/, '')) || 'Proteoscope view'}` : 'Proteoscope view',
    description: `Exported from Proteoscope: ${visible.map((entry) => entry.name).join(', ')}.`,
    background: colorToHex(BACKGROUNDS[state.background]?.top ?? [0, 0, 0]),
    camera: mvsCamera(),
    structures,
  });
  return { remote, spec, files };
}

async function structureText(entry) {
  if (entry.origin?.text) return entry.origin.text;
  if (entry.origin?.type === 'sample') {
    const sample = state.samples.find((item) => item.id === entry.origin.id);
    if (sample) return (await fetch(sample.url)).text();
  }
  if (entry.origin?.type === 'fetch') {
    const request = normalizeFetchQuery(entry.origin.id);
    if (request) return (await fetch(request.url)).text();
  }
  throw new CommandError(`The file for ${entry.name} is not available.`);
}

const MVS_POLYMER = { cartoon: 'cartoon', trace: 'backbone', 'ball-stick': 'ball_and_stick', sticks: 'ball_and_stick', spacefill: 'spacefill' };
const MVS_ATOMIC = { 'ball-stick': 'ball_and_stick', sticks: 'ball_and_stick', spacefill: 'spacefill' };

function mvsStructure(entry, url) {
  const model = activeModelOf(entry);
  const part = state.partByModel.get(model);
  const display = entry.display;
  const assembly = entry.structure.activeAssemblyId;
  const colorOf = (atom) => (part && state.atomColors ? colorToHex([...state.atomColors.subarray((part.offset + atom.id) * 4, (part.offset + atom.id) * 4 + 3)]) : '#cccccc');
  const residueInfo = (residue) => ({ chain: residue.authChain ?? residue.chain, seq: residue.resSeq, iCode: residue.iCode || '' });
  const visibleResidue = (residue) => (!display.visibleChains || display.visibleChains.has(residue.chain))
    && !display.hiddenResidues?.has(residue.key)
    && (!display.residueFilter || display.residueFilter.has(residue.key));
  const polymer = model.residues.filter((residue) => (residue.kind === 'protein' || residue.kind === 'nucleic') && visibleResidue(residue));
  const complete = polymer.length === model.residues.filter((residue) => residue.kind === 'protein' || residue.kind === 'nucleic').length;
  const components = [];
  if (MVS_POLYMER[display.polymer] && polymer.length) {
    components.push({
      selector: complete ? 'polymer' : residueSelector(polymer.map(residueInfo)),
      representations: [{
        type: MVS_POLYMER[display.polymer],
        params: display.polymer === 'sticks' ? { size_factor: 0.6 } : undefined,
        colors: residueColors(polymer.map((residue) => ({ ...residueInfo(residue), color: colorOf(residue.representative ?? residue.atoms[0]) }))),
      }],
    });
  }
  // Atom colors grouped per residue and element (type_symbol), falling back to atom names when
  // one element carries several colors.
  const atomicColors = (residues) => {
    const byColor = new Map();
    const push = (color, expression) => {
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(expression);
    };
    for (const residue of residues) {
      const base = { auth_asym_id: residue.authChain ?? residue.chain, auth_seq_id: residue.resSeq };
      if (residue.iCode) base.pdbx_PDB_ins_code = residue.iCode;
      const byElement = new Map();
      for (const atom of residue.atoms) {
        if (atom.isHydrogen && !display.showHydrogen) continue;
        if (!byElement.has(atom.element)) byElement.set(atom.element, []);
        byElement.get(atom.element).push(atom);
      }
      for (const [element, atoms] of byElement) {
        const colors = new Set(atoms.map(colorOf));
        if (colors.size === 1) push([...colors][0], { ...base, type_symbol: element });
        else for (const atom of atoms) push(colorOf(atom), { ...base, auth_atom_id: atom.name });
      }
    }
    return [...byColor].map(([color, selector]) => ({ color, selector }));
  };
  const addAtomic = (residues, style) => {
    if (!residues.length || !MVS_ATOMIC[style]) return;
    components.push({ selector: residueSelector(residues.map(residueInfo)), representations: [{ type: MVS_ATOMIC[style], colors: atomicColors(residues) }] });
  };
  const ligands = model.residues.filter((residue) => (residue.kind === 'ligand' || residue.kind === 'ion') && visibleResidue(residue) && !display.residueStyles?.has(residue.key));
  addAtomic(ligands, display.ligand === 'spacefill' ? 'spacefill' : display.ligand === 'none' ? null : 'ball-stick');
  if (display.showWater) addAtomic(model.residues.filter((residue) => residue.kind === 'water' && visibleResidue(residue)), 'ball-stick');
  for (const style of ['sticks', 'ball-stick', 'spacefill']) {
    addAtomic(model.residues.filter((residue) => display.residueStyles?.get(residue.key) === style && visibleResidue(residue)), style);
  }
  const focus = entry.focus?.neighborhood;
  if (focus) addAtomic(model.residues.filter((residue) => focus.has(residue.key) && residue.kind === 'protein' && !display.residueStyles?.has(residue.key) && visibleResidue(residue)), 'sticks');
  if (entry.surface.kind !== 'off') {
    const surfaceResidues = model.residues.filter((residue) => residue.kind !== 'water' && visibleResidue(residue) && (!entry.surface.keys || entry.surface.keys.has(residue.key)));
    components.push({
      selector: residueSelector(surfaceResidues.map(residueInfo)),
      representations: [{
        type: 'surface',
        params: { surface_type: entry.surface.kind === 'gaussian' ? 'gaussian' : 'molecular' },
        colors: residueColors(surfaceResidues.map((residue) => ({ ...residueInfo(residue), color: colorOf(residue.representative ?? residue.atoms[0]) }))),
        opacity: entry.surface.opacity,
      }],
    });
  }
  for (const key of entry.labels) {
    const residue = model.residueMap.get(key);
    if (residue) components.push({ selector: residueSelector([residueInfo(residue)]), representations: [], labels: [`${residue.resName} ${residue.resSeq}${residue.iCode || ''}`] });
  }
  return {
    url,
    format: entry.structure.format === 'mmcif' ? 'mmcif' : 'pdb',
    structure: assembly && assembly !== ASYMMETRIC_UNIT_ID ? { type: 'assembly', assembly_id: assembly } : { type: 'model', model_index: Math.max(0, entry.structure.models.indexOf(model)) },
    transform: entry.transform,
    components,
  };
}

function mvsCamera() {
  const basis = cameraBasis(state.camera);
  return {
    target: [...state.camera.target],
    position: referenceCameraPosition(state.camera.target, basis.eye, state.camera.fov),
    up: basis.up,
  };
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
  renderPrediction();
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
    renderValidation();
    renderRamachandran();
    renderProfile();
    renderPAE();
    renderDomainResult();
  } else if (tab === 'proteomics') {
    renderProtParam();
    renderMissense();
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
    const rama = model.ramaClasses?.get(residue.key);
    if (rama) addDetail('Ramachandran', `${rama.rama.toLowerCase()} (${RAMA_CATEGORIES.find((item) => item.id === rama.category)?.label.toLowerCase()})`);
  }
  if (state.structure.meta.isPredicted && Number.isFinite(residue.confidence)) addDetail('pLDDT', residue.confidence.toFixed(1));
  else addDetail('Mean B', residue.bFactor.toFixed(1));
  const info = state.structure.sequences.get(residue.chain);
  const uniprot = info ? uniprotPositionForResidue(info, residue) : null;
  if (uniprot) addDetail('UniProt', `${uniprot.accession} ${residue.code}${uniprot.position}`);
  const relative = state.sasa?.relative?.get(residue.key);
  if (Number.isFinite(relative)) addDetail('Rel. SASA', `${(relative * 100).toFixed(0)}%`);
  const missense = state.missense?.positions.get(residue.key);
  if (missense) {
    const top = rankedSubstitutions(missense.item, 4).map((item) => `${item.aa} ${item.score.toFixed(2)}`).join(', ');
    addDetail('AlphaMissense', `mean ${missense.item.mean.toFixed(2)} (${missenseClass(missense.item.mean)}) · worst ${top}`, true);
  }
  const record = validationOf(state.active)?.residues.get(residue.key);
  if (record) {
    const fit = [Number.isFinite(record.rsrz) ? `RSRZ ${record.rsrz.toFixed(2)}` : '', Number.isFinite(record.rscc) ? `RSCC ${record.rscc.toFixed(2)}` : '', Number.isFinite(record.qscore) ? `Q ${record.qscore.toFixed(2)}` : '', Number.isFinite(record.ediam) ? `EDIAm ${record.ediam.toFixed(2)}` : ''].filter(Boolean).join(' · ');
    addDetail('Validation', [record.criteria.length ? record.criteria.join(', ') : 'no outliers', record.rama && residue.kind === 'protein' ? `Rama ${record.rama.toLowerCase()}` : '', fit].filter(Boolean).join(' · '), true);
  }
  const extra = residueDataText(residue, state.active, { card: true });
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
  const { visibleChains, residueFilter, hiddenResidues } = entry.display;
  const only = entry.surface.keys;
  return model.atoms.filter((atom) => atom.kind !== 'water' && !atom.isHydrogen
    && (!visibleChains || visibleChains.has(atom.chain))
    && !hiddenResidues?.has(atom.residueKey)
    && (!only || only.has(atom.residueKey))
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
  const key = [entry.structure.activeAssemblyId, model.number, surface.kind, entry.display.visibleChains ? [...entry.display.visibleChains].sort().join(',') : '*', entry.display.residueFilterKey || '*', entry.display.overrideKey || '*', surface.keysKey || '*', entry.transformVersion].join('|');
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

// Computes SASA for an entry's active model; the panel shows it when the entry is active.
async function runSASA(entry = state.active) {
  if (!entry) return;
  if (typeof Worker === 'undefined') return;
  const shown = () => entry === state.active;
  const structure = entry.structure;
  const model = activeModelOf(entry);
  const atoms = model.atoms.filter((atom) => atom.kind !== 'water' && !atom.isHydrogen);
  if (shown()) {
    els.sasaResult.hidden = false;
    els.sasaResult.textContent = `Computing SASA for ${formatNumber(atoms.length)} atoms…`;
  }
  const chainIndex = new Map(structure.chains.map((chain, index) => [chain.id, index]));
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
    if (model !== activeModelOf(entry)) return;
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
    for (const chain of structure.chains.filter((item) => item.polymerKind)) {
      const chainAtoms = atoms.filter((atom) => atom.chain === chain.id);
      const inComplex = chainAtoms.reduce((sum, atom) => sum + atomSASA[atom.id], 0);
      const alone = chainAtoms.reduce((sum, atom) => sum + isolatedSASA[atom.id], 0);
      chains.push({ id: chain.id, inComplex, alone, buried: alone - inComplex });
    }
    entry.sasa = { atomSASA, relative, absolute, chains, atoms };
    if (entry.color.scheme === 'exposure') markColorsDirty();
    if (!shown()) return;
    els.sasaColor.disabled = false;
    const total = atoms.reduce((sum, atom) => sum + atomSASA[atom.id], 0);
    els.sasaResult.innerHTML = `Total SASA <strong>${formatNumber(Math.round(total))} Å²</strong> · ${((performance.now() - started) / 1000).toFixed(1)} s
      <table><thead><tr><th>Chain</th><th>SASA</th><th>Alone</th><th>Buried</th></tr></thead><tbody>${chains.map((chain) => `<tr><td>${escapeHTML(chain.id)}</td><td>${formatNumber(Math.round(chain.inComplex))}</td><td>${formatNumber(Math.round(chain.alone))}</td><td>${formatNumber(Math.round(chain.buried))}</td></tr>`).join('')}</tbody></table>
      <span class="hint">Buried = SASA of the isolated chain minus SASA in the complex (Å²).</span>`;
    renderSelectionPanel();
    renderProfile();
  } catch (error) {
    console.error(error);
    if (shown()) els.sasaResult.textContent = `SASA failed: ${error.message}`;
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

// Draws φ/ψ on MolProbity Top8000 contours. Residues are classified locally with the same criteria
// (so predicted models and local files are covered too); a loaded wwPDB report's classes win.
async function renderRamachandran() {
  if (!state.structure) return;
  const entry = state.active;
  const model = activeModel();
  const chain = els.ramaChain.value || '*';
  const category = els.ramaCategory.value || 'all';
  let tables = null;
  try {
    tables = await loadTop8000();
  } catch (error) {
    console.warn('Top8000 tables unavailable', error);
  }
  if (entry !== state.active || model !== activeModel()) return;
  const local = tables ? ramaClassesOf(model, tables) : null;
  const validation = validationOf(entry);
  const classOf = (residue) => validation?.residues.get(residue.key)?.rama || local?.get(residue.key)?.rama || '';
  const residues = model.residues.filter((residue) => residue.kind === 'protein' && (chain === '*' || residue.chain === chain) && (category === 'all' || local?.get(residue.key)?.category === category));
  const contourCategory = category === 'all' ? 'general' : category;
  const allowed = RAMA_CATEGORIES.find((item) => item.id === contourCategory)?.allowed ?? 0.0005;
  const contours = tables ? (phi, psi) => {
    const density = ramaDensity(tables[contourCategory], phi, psi);
    return density >= RAMA_FAVORED ? 2 : density >= allowed ? 1 : 0;
  } : null;
  const result = drawRamachandran(els.ramaCanvas, residues, { selected: state.selection, classify: local || validation ? classOf : null, contours });
  ramaPoints = result;
  const plotted = result.points.length;
  if (!plotted) {
    els.ramaSummary.textContent = 'No residues with complete backbone dihedrals.';
    return;
  }
  const counts = { FAVORED: 0, ALLOWED: 0, OUTLIER: 0 };
  for (const item of result.points) {
    const label = classOf(item.residue).toUpperCase();
    if (label in counts) counts[label] += 1;
  }
  const source = validation ? 'wwPDB report (MolProbity)' : 'MolProbity Top8000 criteria';
  els.ramaSummary.textContent = `${plotted} residues · ${counts.FAVORED} favored (${((counts.FAVORED / plotted) * 100).toFixed(1)}%), ${counts.ALLOWED} allowed (yellow), ${counts.OUTLIER} outliers (red) · ${source}; contours: ${contourCategory === 'general' ? 'general case' : RAMA_CATEGORIES.find((item) => item.id === contourCategory)?.label}. Click a point to select it.`;
}

// Local Ramachandran classes, cached per model.
function ramaClassesOf(model, tables) {
  if (!model.ramaClasses) model.ramaClasses = classifyRamachandran(tables, model.residues);
  return model.ramaClasses;
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
  if (metric === 'missense') {
    if (!state.missense) return { label: 'AlphaMissense', series: [], options: { emptyText: 'Load AlphaMissense in the Proteomics tab' } };
    return {
      label: 'AlphaMissense mean pathogenicity',
      series: residues.map((residue) => ({ residue, value: state.missense.values.get(residue.key) ?? NaN })),
      options: { min: 0, max: 1, bands: [{ from: MISSENSE_THRESHOLDS.pathogenic, to: 1, color: 'rgba(207,63,51,0.16)' }, { from: 0, to: MISSENSE_THRESHOLDS.benign, color: 'rgba(58,99,184,0.16)' }] },
    };
  }
  if (metric === 'msa') {
    if (!state.msa) return { label: 'MSA depth', series: [], options: { emptyText: 'Open a prediction folder that includes its MSA' } };
    return { label: 'MSA depth (log10 sequences)', series: residues.map((residue) => ({ residue, value: Math.log10(Math.max(1, state.msa.values.get(residue.key) ?? NaN)) })), options: { min: 0, bands: [{ from: 0, to: Math.log10(30), color: 'rgba(198,40,40,0.14)' }] } };
  }
  if (metric === 'densityfit') {
    const fit = validationOf(state.active)?.fit;
    if (!fit?.values.size) return { label: 'Fit to density', series: [], options: { emptyText: 'Load the validation report above' } };
    return fit.kind === 'qscore'
      ? { label: 'Q-score', series: residues.map((residue) => ({ residue, value: fit.values.get(residue.key) ?? NaN })), options: { min: 0, max: 1 } }
      : { label: 'RSRZ (> 2 is an outlier)', series: residues.map((residue) => ({ residue, value: fit.values.get(residue.key) ?? NaN })), options: { bands: [{ from: 2, to: 99, color: 'rgba(224,71,76,0.16)' }] } };
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
  // AlphaFold 3 confidence files also carry contact probabilities over the same tokens.
  const contacts = parseAF3Confidences({ contact_probs: document0.contact_probs }).contactProbs;
  entry.contacts = contacts?.size === size ? contacts : null;
  entry.domains = null;
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
  const contacts = state.active?.contacts;
  els.paeCanvas.hidden = !pae;
  els.paeHint.hidden = Boolean(pae);
  els.paeView.hidden = !contacts;
  els.paeDomainsButton.disabled = !pae;
  els.msaDepth.disabled = !(state.active?.msa || state.active?.msaURL);
  const view = contacts && state.paeView === 'contacts' ? 'contacts' : 'pae';
  for (const button of els.paeView.querySelectorAll('[data-pae-view]')) button.classList.toggle('is-active', button.dataset.paeView === view);
  if (!pae) {
    els.paeSummary.textContent = '';
    paeLayout = null;
    return;
  }
  if (view === 'contacts') {
    paeLayout = drawPAE(els.paeCanvas, { ...pae, matrix: contacts.matrix, max: 1 }, { selection: state.paeSelection, mode: 'contacts' });
    let likely = 0;
    for (let row = 0; row < contacts.size; row += 1) {
      for (let column = row + 1; column < contacts.size; column += 1) {
        if (contacts.matrix[row * contacts.size + column] > 0.5 && pae.residues[row]?.chain !== pae.residues[column]?.chain) likely += 1;
      }
    }
    els.paeSummary.textContent = `Probability that two tokens are within 8 Å · ${likely} inter-chain pairs above 0.5 · ${pae.source}. Dark = likely contact.`;
    return;
  }
  paeLayout = drawPAE(els.paeCanvas, pae, { selection: state.paeSelection });
  let sum = 0;
  for (const value of pae.matrix) sum += value;
  els.paeSummary.textContent = `${pae.size} ${pae.residues.some((residue) => residue && residue.kind !== 'protein' && residue.kind !== 'nucleic') ? 'tokens' : 'residues'} · mean PAE ${(sum / pae.matrix.length).toFixed(1)} Å · max ${pae.max.toFixed(1)} Å · ${pae.source}. Dark green = confident relative position.`;
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

/* ---------- Prediction sets ---------- */

// Reads the scores of every model, ranks them, computes interface metrics from each model's PAE
// and coordinates, and opens the top-ranked model. Other models open on demand.
async function openPredictionSet(set, options = {}) {
  if (set.models.some((model) => /\.zst$/i.test(model.files.structure?.name ?? '') || /\.zst$/i.test(model.files.confidences?.name ?? ''))) {
    throw new Error(`${set.name} was saved with compressed AlphaFold 3 outputs (.zst). Decompress them first, for example with "zstd -d --rm *.zst" in each folder.`);
  }
  set.id = `prediction-${state.predictionSets.length + 1}`;
  showLoading(`Reading ${set.toolLabel} scores for ${set.name}`);
  for (const model of set.models) {
    try {
      model.scores = await readPredictionScores(set, model);
    } catch (error) {
      console.warn(error);
      model.scores = {};
      model.problem = error.message;
    }
  }
  rankModels(set.models);
  set.models.sort((a, b) => a.rank - b.rank);
  if (set.affinity) set.affinityResult = parseBoltzAffinity(JSON.parse(await set.affinity.text()));
  set.msa = await readPredictionMSA(set);
  for (const [index, model] of set.models.entries()) {
    showLoading(`Scoring ${set.name}: model ${index + 1} of ${set.models.length}`);
    await nextFrame();
    try {
      await scorePredictionModel(set, model);
    } catch (error) {
      console.warn(error);
      model.problem = error.message;
    }
  }
  state.predictionSets.push(set);
  const entry = await loadPredictionModel(set, set.models[0], { add: options.add });
  hideLoading();
  const complex = set.models[0].metrics?.pairs.length;
  showToast(`Opened ${set.toolLabel} prediction ${set.name}: ${set.models.length} model${set.models.length === 1 ? '' : 's'}, ranked by ${rankingScoreLabel(set)}${complex ? '; interface scores in the Structure tab' : ''}.`);
  return entry;
}

function rankingScoreLabel(set) {
  return { af3: 'ranking score', server: 'ranking score', boltz: 'confidence score', chai: 'aggregate score', colabfold: set.models.some((model) => Number.isFinite(model.scores?.iptm)) ? '0.8·ipTM + 0.2·pTM' : 'mean pLDDT' }[set.tool] ?? 'score';
}

async function readJSONFile(file) {
  return JSON.parse(await file.text());
}

async function readPredictionScores(set, model) {
  const files = model.files;
  switch (set.tool) {
    case 'af3':
    case 'server':
      return files.summary ? parseAF3Summary(await readJSONFile(files.summary)) : {};
    case 'boltz':
      return parseBoltzConfidence(await readJSONFile(files.confidence));
    case 'chai':
      return files.scores ? parseChaiScores(await readNpz(await files.scores.read())) : {};
    case 'colabfold':
      return files.scores ? parseColabFoldScores(await readJSONFile(files.scores)) : {};
    default:
      return {};
  }
}

// The PAE of one model as { size, matrix }, plus AlphaFold 3 contact probabilities.
async function readPredictionPAE(set, model) {
  const files = model.files;
  if ((set.tool === 'af3' || set.tool === 'server') && files.confidences) {
    const parsed = parseAF3Confidences(await readJSONFile(files.confidences));
    return { pae: parsed.pae, contacts: parsed.contactProbs, atomPlddts: parsed.atomPlddts };
  }
  if (set.tool === 'boltz' && files.pae) {
    const arrays = await readNpz(await files.pae.read());
    const plddt = files.plddt ? (await readNpz(await files.plddt.read())).get('plddt') : null;
    return { pae: squareMatrix(arrays.get('pae') ?? [...arrays.values()][0]), tokenPlddt: plddt ? Array.from(plddt.data, (value) => (value <= 1 ? value * 100 : value)) : null };
  }
  if (set.tool === 'chai' && files.pae) return { pae: await readPAEArray(files.pae) };
  if (set.tool === 'colabfold' && files.scores) {
    const scores = model.scores?.pae ? model.scores : parseColabFoldScores(await readJSONFile(files.scores));
    return { pae: scores.pae, tokenPlddt: scores.plddt };
  }
  return { pae: null };
}

async function readPAEArray(ref) {
  const bytes = await ref.read();
  if (/\.npy$/i.test(ref.name)) return squareMatrix(readNpy(bytes));
  const arrays = await readNpz(bytes);
  return squareMatrix(arrays.get('pae') ?? [...arrays.values()].find((array) => squareMatrix(array)) ?? null);
}

// Parses the model's structure, maps PAE tokens to residues and computes interface scores and
// the Cα positions used to check cross-links. Large matrices are dropped again afterwards.
async function scorePredictionModel(set, model) {
  const text = await structureFileText(model.files.structure);
  const structure = parseStructure(text, model.files.structure.name.replace(/\.bcif$/i, '.cif'));
  structure.meta.isPredicted = true;
  deriveStructure(structure, { secondaryMode: 'file' });
  const parsed = structure.models[0];
  // Chain-pair matrices from the predictors follow the chain order of the file, ligands included.
  model.chains = [...new Set(parsed.atoms.filter((atom) => atom.kind !== 'water').map((atom) => atom.chain))];
  model.calpha = new Map();
  for (const residue of parsed.residues) {
    const atom = residue.backbone?.CA;
    if (atom) model.calpha.set(`${residue.chain}:${residue.resSeq}`, [atom.x, atom.y, atom.z]);
  }
  const plddts = parsed.residues.filter((residue) => residue.kind === 'protein' || residue.kind === 'nucleic').map((residue) => residue.confidence).filter(Number.isFinite);
  model.meanPlddt = plddts.length ? plddts.reduce((sum, value) => sum + value, 0) / plddts.length : NaN;
  const { pae, tokenPlddt } = await readPredictionPAE(set, model);
  if (!pae) return;
  const tokens = tokensForPAE(parsed, pae.size);
  if (!tokens) {
    model.problem = `The PAE matrix (${pae.size} tokens) does not match the structure.`;
    return;
  }
  const scale = parsed.bFactorRange.max <= 1 ? 100 : 1;
  tokens.forEach((token, index) => {
    token.plddt = Number.isFinite(tokenPlddt?.[index]) ? tokenPlddt[index] : (token.plddtAtom?.bFactor ?? 0) * scale;
  });
  // Dunbrack's examples use a 15 Å PAE cutoff for AlphaFold 2 and 10 Å for AlphaFold 3 and Boltz.
  model.paeCutoff = set.tool === 'colabfold' ? 15 : 10;
  model.metrics = interfaceScores(pae, tokens, { paeCutoff: model.paeCutoff });
  model.tokenKeys = tokens.map((token) => token.residue.key);
  // ColabFold keeps the PAE in its scores file; it is read again when the model opens.
  if (model.scores?.pae) delete model.scores.pae;
}

async function readPredictionMSA(set) {
  try {
    if (set.tool === 'af3' && set.data) {
      const data = await readJSONFile(set.data);
      const chains = new Map();
      for (const item of data.sequences ?? []) {
        const protein = item.protein ?? item.rna ?? item.dna;
        if (!protein) continue;
        const ids = Array.isArray(protein.id) ? protein.id : [protein.id];
        const depth = combineDepth([msaDepth(protein.unpairedMsa ?? ''), msaDepth(protein.pairedMsa ?? '')]);
        if (depth) for (const id of ids) chains.set(String(id), depth);
      }
      return chains.size ? { chains, source: `${set.name}_data.json` } : null;
    }
    const files = set.msas ?? [];
    if (!files.length) return null;
    const results = [];
    for (const file of files) {
      const text = await file.text();
      results.push({ file, depth: msaDepth(/\.csv$/i.test(file.name) ? csvToA3M(text) : text) });
    }
    return { list: results.filter((item) => item.depth), source: files.map((file) => file.name).join(', ') };
  } catch (error) {
    console.warn('MSA not read', error);
    return null;
  }
}

// Boltz MSA tables (key,sequence) hold one aligned sequence per row; the first is the query.
function csvToA3M(text) {
  return String(text).split(/\r?\n/).slice(1).map((line) => line.split(',').pop()?.trim()).filter(Boolean).map((sequence, index) => `>${index}\n${sequence}`).join('\n');
}

// Opens a model as an entry (or activates it), attaching its PAE, contacts, scores and MSA depth.
async function loadPredictionModel(set, model, options = {}) {
  const existing = model.entryId ? entryById(model.entryId) : null;
  if (existing) {
    if (options.showOnly !== false) showOnlyPredictionModel(set, existing);
    return existing;
  }
  showLoading(`Opening ${set.name} ${model.label}`);
  const text = await structureFileText(model.files.structure);
  const add = options.add ?? state.entries.length > 0;
  const entry = await loadStructureFromText(text, `${set.name}_${model.id}.cif`, { source: `${set.toolLabel} · ${model.label}`, add, predicted: true, origin: { type: 'file', name: model.files.structure.name.replace(/\.bcif$/i, '.cif'), text } });
  entry.name = uniqueName(`${set.name} #${model.rank}`);
  entry.prediction = { setId: set.id, modelId: model.id };
  model.entryId = entry.id;
  if (entry.color.scheme === 'chain' || entry.color.scheme === 'structure') entry.color.scheme = 'plddt';
  try {
    const { pae, contacts } = await readPredictionPAE(set, model);
    if (pae) setEntryPAE(entry, pae, `${set.toolLabel} ${model.label}`, { contacts, silent: true });
  } catch (error) {
    console.warn('PAE not read', error);
  }
  applyPredictionMSA(set, entry);
  if (options.showOnly !== false) showOnlyPredictionModel(set, entry);
  markColorsDirty();
  hideLoading();
  return entry;
}

function uniqueName(base) {
  const names = new Set(state.entries.map((entry) => entry.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

// Shows one model of a set at a time; other entries stay as they were.
function showOnlyPredictionModel(set, entry) {
  for (const item of state.entries) {
    if (item.prediction?.setId === set.id) item.visible = item === entry;
  }
  setActiveEntry(entry);
  renderStructureList();
  renderPrediction();
  markSceneDirty();
}

function applyPredictionMSA(set, entry) {
  const msa = set.msa;
  if (!msa) return;
  const model = activeModelOf(entry);
  const values = new Map();
  const polymerByChain = new Map();
  for (const residue of model.residues) {
    if (residue.kind !== 'protein' && residue.kind !== 'nucleic') continue;
    if (!polymerByChain.has(residue.chain)) polymerByChain.set(residue.chain, []);
    polymerByChain.get(residue.chain).push(residue);
  }
  const assign = (residues, depth, offset = 0) => {
    residues.forEach((residue, index) => {
      const value = depth.depth[offset + index];
      if (Number.isFinite(value)) values.set(residue.key, value);
    });
  };
  if (msa.chains) {
    for (const [chain, depth] of msa.chains) if (polymerByChain.has(chain)) assign(polymerByChain.get(chain), depth);
  } else {
    // A single alignment covers either one chain or (ColabFold complexes) all chains in order.
    const chains = [...polymerByChain.values()];
    for (const { depth } of msa.list) {
      if (depth.chainLengths && depth.chainLengths.length === chains.length) {
        let offset = 0;
        chains.forEach((residues, index) => {
          assign(residues, depth, offset);
          offset += depth.chainLengths[index];
        });
      } else {
        const match = chains.find((residues) => residues.length === depth.query.length && !residues.some((residue) => values.has(residue.key)));
        if (match) assign(match, depth);
      }
    }
  }
  if (values.size) entry.msa = { values, source: msa.source, summary: depthSummary([...values.values()]) };
}

function applyMSA(entry, results, source, options = {}) {
  applyPredictionMSA({ msa: { list: results.filter(Boolean).map((depth) => ({ depth })), source } }, entry);
  if (!entry.msa) throw new CommandError(`${source}: the alignment's query does not match a chain of ${entry.name}.`);
  setColorScheme('msa', [entry]);
  if (!options.quiet) showToast(`MSA depth from ${source}: median ${formatNumber(entry.msa.summary.median)} sequences.`);
}

function predictionSetOf(entry = state.active) {
  return entry?.prediction ? state.predictionSets.find((set) => set.id === entry.prediction.setId) ?? null : null;
}

function predictionModelOf(entry = state.active) {
  const set = predictionSetOf(entry);
  return set?.models.find((model) => model.id === entry.prediction.modelId) ?? null;
}

function bestPair(model) {
  return model?.metrics?.pairs.slice().sort((a, b) => b.ipsae - a.ipsae)[0] ?? null;
}

function scoreText(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '–';
}

function renderPrediction() {
  const entry = state.active;
  const set = predictionSetOf(entry);
  els.predictionGroup.hidden = !set;
  if (!set) return;
  const active = predictionModelOf(entry);
  const complex = set.models.some((model) => model.metrics?.pairs.length || model.scores?.chainPairIptm?.length > 1);
  const links = state.crosslinkRequest;
  els.predictionCount.textContent = String(set.models.length);
  els.predictionTitle.textContent = `${set.toolLabel} · ${set.name} · ranked by ${rankingScoreLabel(set)}${set.affinityResult && Number.isFinite(set.affinityResult.value) ? ` · predicted affinity ${set.affinityResult.value.toFixed(2)} log10(IC50 / µM), binder probability ${scoreText(set.affinityResult.probability)}` : ''}`;
  const header = `<tr><th>#</th><th>Model</th><th title="${escapeHTML(rankingScoreLabel(set))}">Score</th>${complex ? `<th title="Interface pTM">ipTM</th><th title="Best chain-pair ipSAE (PAE cutoff ${set.tool === 'colabfold' ? 15 : 10} Å)">ipSAE</th>` : '<th>pLDDT</th>'}${links ? '<th title="Cross-links within the distance limit">XL</th>' : ''}</tr>`;
  const rows = set.models.map((model) => {
    const pair = bestPair(model);
    const xl = links ? crosslinkSatisfaction(model, links) : null;
    const flags = [model.scores?.hasClash ? 'clash' : '', model.problem ? 'problem' : ''].filter(Boolean);
    return `<tr class="${model === active ? 'is-active' : ''}" data-model="${escapeHTML(model.id)}" title="${escapeHTML([model.problem, model.scores?.hasClash ? 'The predictor flagged steric clashes.' : ''].filter(Boolean).join(' ') || 'Show this model')}">
      <td>${model.rank}</td><td>${escapeHTML(model.label)}${flags.length ? ` <span class="warn">⚠</span>` : ''}${model.entryId ? ' <span class="loaded" title="Open in the scene">●</span>' : ''}</td><td>${scoreText(model.scores?.rankingScore)}</td>
      ${complex ? `<td>${scoreText(model.scores?.iptm)}</td><td>${scoreText(pair?.ipsae)}</td>` : `<td>${scoreText(model.meanPlddt, 1)}</td>`}
      ${xl ? `<td class="${xl.satisfied === xl.total ? 'good' : xl.satisfied / Math.max(1, xl.total) < 0.8 ? 'bad' : ''}">${xl.satisfied}/${xl.total}</td>` : links ? '<td>–</td>' : ''}</tr>`;
  }).join('');
  els.predictionModels.innerHTML = `<table class="prediction-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
  for (const row of els.predictionModels.querySelectorAll('[data-model]')) {
    row.addEventListener('click', () => guardedLoad(() => loadPredictionModel(set, set.models.find((model) => model.id === row.dataset.model))));
  }
  renderPredictionPairs(set, active);
  renderPredictionDetail(set, active);
  for (const button of document.querySelectorAll('[data-pair-metric]')) button.classList.toggle('is-active', button.dataset.pairMetric === state.pairMetric);
  document.querySelector('[data-pair-metric]').parentElement.hidden = !complex;
}

// A heat map of chain-pair scores for the active model.
function renderPredictionPairs(set, model) {
  const metrics = model?.metrics;
  const chains = metrics?.chains ?? model?.chains ?? [];
  if (chains.length < 2) {
    els.predictionPairs.replaceChildren();
    return;
  }
  const byPair = new Map((metrics?.pairs ?? []).flatMap((pair) => [[`${pair.chainA}|${pair.chainB}`, pair], [`${pair.chainB}|${pair.chainA}`, pair]]));
  const reportedChains = model.chains ?? chains;
  const value = (a, b) => {
    if (state.pairMetric === 'iptm') {
      const ia = reportedChains.indexOf(a);
      const ib = reportedChains.indexOf(b);
      const reported = model.scores?.chainPairIptm?.[ia]?.[ib];
      if (Number.isFinite(reported)) return reported;
      return byPair.get(`${a}|${b}`)?.iptm;
    }
    return byPair.get(`${a}|${b}`)?.[state.pairMetric];
  };
  const cell = (a, b) => {
    if (a === b) {
      const ptm = model.scores?.chainPtm?.[reportedChains.indexOf(a)];
      return `<td class="diagonal" title="Chain ${escapeHTML(a)} pTM">${scoreText(ptm)}</td>`;
    }
    const score = value(a, b);
    const color = Number.isFinite(score) ? colorToHex(sampleColormap('depth', score)) : 'transparent';
    return `<td style="background:${color}" data-pair="${escapeHTML(a)}|${escapeHTML(b)}" title="${escapeHTML(`${a}–${b}`)}: click to select the interface">${scoreText(score)}</td>`;
  };
  const shown = chains.slice(0, 12);
  els.predictionPairs.innerHTML = `<table class="pair-matrix"><thead><tr><th></th>${shown.map((chain) => `<th>${escapeHTML(chain)}</th>`).join('')}</tr></thead><tbody>${shown.map((a) => `<tr><th>${escapeHTML(a)}</th>${shown.map((b) => cell(a, b)).join('')}</tr>`).join('')}</tbody></table>${chains.length > 12 ? `<p class="hint">Showing 12 of ${chains.length} chains.</p>` : ''}`;
  for (const td of els.predictionPairs.querySelectorAll('[data-pair]')) {
    td.addEventListener('click', () => selectPredictionInterface(model, ...td.dataset.pair.split('|')));
  }
}

function renderPredictionDetail(set, model) {
  if (!model) {
    els.predictionDetail.replaceChildren();
    return;
  }
  const scores = model.scores ?? {};
  const facts = [
    Number.isFinite(scores.ptm) ? `pTM ${scoreText(scores.ptm)}` : '',
    Number.isFinite(scores.iptm) ? `ipTM ${scoreText(scores.iptm)}` : '',
    Number.isFinite(model.meanPlddt) ? `mean pLDDT ${model.meanPlddt.toFixed(1)}` : '',
    Number.isFinite(scores.fractionDisordered) ? `${Math.round(scores.fractionDisordered * 100)}% disordered` : '',
    scores.hasClash ? '<span class="warn">clashes flagged</span>' : '',
    Number.isFinite(scores.extra?.ligandIptm) && scores.extra.ligandIptm > 0 ? `ligand ipTM ${scoreText(scores.extra.ligandIptm)}` : '',
  ].filter(Boolean);
  const pairs = (model.metrics?.pairs ?? []).slice().sort((a, b) => b.ipsae - a.ipsae);
  const links = state.crosslinkRequest ? crosslinkSatisfaction(model, state.crosslinkRequest) : null;
  const msa = state.active?.msa?.summary;
  els.predictionDetail.innerHTML = `<div><strong>${escapeHTML(model.label)}</strong> · rank ${model.rank}${facts.length ? ` · ${facts.join(' · ')}` : ''}</div>
    ${pairs.length ? `<table class="interface-table"><thead><tr><th>Chains</th><th title="max(A→B, B→A); PAE cutoff ${model.paeCutoff ?? 10} Å">ipSAE</th><th title="pDockQ2 (Zhu et al. 2023)">pDockQ2</th><th title="Local interaction score (Kim et al. 2024)">LIS</th><th title="Residue pairs with Cβ within 8 Å">Contacts</th></tr></thead><tbody>${pairs.slice(0, 12).map((pair) => `<tr data-pair="${escapeHTML(pair.chainA)}|${escapeHTML(pair.chainB)}" title="A→B ${scoreText(pair.ipsaeAB)} · B→A ${scoreText(pair.ipsaeBA)} · ipTM from PAE ${scoreText(pair.iptm)} · pDockQ ${scoreText(pair.pdockq)}. Click to select the interface."><td>${escapeHTML(pair.chainA)}–${escapeHTML(pair.chainB)}</td><td>${scoreText(pair.ipsae)}</td><td>${scoreText(pair.pdockq2)}</td><td>${scoreText(pair.lis)}</td><td>${pair.contacts}</td></tr>`).join('')}</tbody></table>` : ''}
    ${links ? `<div>Cross-links: <strong class="${links.satisfied === links.total ? 'good' : ''}">${links.satisfied} of ${links.total}</strong> within ${links.maxDistance} Å Cα–Cα${links.missing ? ` · ${links.missing} not in the model` : ''}</div>` : '<div class="hint">Map cross-links in the Proteomics tab to see how many each model satisfies.</div>'}
    ${msa ? `<div>MSA depth: median ${formatNumber(msa.median)} sequences${msa.shallow ? ` · <span class="warn">${msa.shallow} residues below ${msa.threshold}</span>` : ''} · <button type="button" class="link" data-color-msa>color by depth</button></div>` : ''}
    ${model.problem ? `<div class="warn">${escapeHTML(model.problem)}</div>` : ''}`;
  for (const row of els.predictionDetail.querySelectorAll('[data-pair]')) {
    row.addEventListener('click', () => selectPredictionInterface(model, ...row.dataset.pair.split('|')));
  }
  els.predictionDetail.querySelector('[data-color-msa]')?.addEventListener('click', () => setColorScheme('msa', [state.active]));
}

// Selects the residues on both sides of a predicted interface (Cβ within 8 Å).
function selectPredictionInterface(model, chainA, chainB) {
  const entry = model.entryId ? entryById(model.entryId) : null;
  const pair = model.metrics?.pairs.find((item) => (item.chainA === chainA && item.chainB === chainB) || (item.chainA === chainB && item.chainB === chainA));
  if (!entry || !pair) return;
  const keys = [...new Set(pair.interface.map((index) => model.tokenKeys[index]))];
  if (entry !== state.active) setActiveEntry(entry);
  selectResidues(keys, { frame: true });
  showToast(`Selected ${keys.length} interface residues between chains ${chainA} and ${chainB}.`);
}

// Cross-links checked against a model's Cα positions; unnamed or unknown proteins try every chain.
function crosslinkSatisfaction(model, request) {
  if (!model.calpha) return null;
  let satisfied = 0;
  let total = 0;
  let missing = 0;
  const chains = model.chains ?? [];
  const candidates = (protein) => (protein && chains.includes(protein) ? [protein] : chains);
  for (const link of request.links) {
    let best = Infinity;
    for (const a of candidates(link.proteinA)) {
      for (const b of candidates(link.proteinB ?? link.proteinA)) {
        const p = model.calpha.get(`${a}:${link.residueA}`);
        const q = model.calpha.get(`${b}:${link.residueB}`);
        if (!p || !q || (a === b && link.residueA === link.residueB)) continue;
        best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
    if (!Number.isFinite(best)) {
      missing += 1;
      continue;
    }
    total += 1;
    if (best <= request.maxDistance) satisfied += 1;
  }
  return { satisfied, total, missing, maxDistance: request.maxDistance };
}

async function superposePredictionModels() {
  const set = predictionSetOf();
  if (!set) return;
  const entries = [];
  for (const model of set.models) entries.push(await loadPredictionModel(set, model, { add: true, showOnly: false }));
  for (const entry of entries) entry.visible = true;
  setActiveEntry(entries[0]);
  runSuperposition({ reference: entries[0], mobiles: entries.slice(1) });
  renderStructureList();
  renderPrediction();
}

function exportPredictionCSV() {
  const set = predictionSetOf();
  if (!set) return;
  const header = ['tool', 'job', 'rank', 'model', 'ranking_score', 'ptm', 'iptm', 'mean_plddt', 'chain_a', 'chain_b', 'chain_pair_iptm', 'ipsae', 'ipsae_a_to_b', 'ipsae_b_to_a', 'iptm_from_pae', 'pdockq', 'pdockq2', 'lis', 'contacts', 'xl_satisfied', 'xl_total'];
  const rows = [header];
  const format = (value) => (Number.isFinite(value) ? Number(value.toFixed(4)) : '');
  for (const model of set.models) {
    const xl = state.crosslinkRequest ? crosslinkSatisfaction(model, state.crosslinkRequest) : null;
    const base = [set.toolLabel, set.name, model.rank, model.label, format(model.scores?.rankingScore), format(model.scores?.ptm), format(model.scores?.iptm), format(model.meanPlddt)];
    const pairs = model.metrics?.pairs.length ? model.metrics.pairs : [null];
    for (const pair of pairs) {
      const chains = model.chains ?? [];
      const reported = pair ? model.scores?.chainPairIptm?.[chains.indexOf(pair.chainA)]?.[chains.indexOf(pair.chainB)] : NaN;
      rows.push([...base, pair?.chainA ?? '', pair?.chainB ?? '', format(reported), format(pair?.ipsae), format(pair?.ipsaeAB), format(pair?.ipsaeBA), format(pair?.iptm), format(pair?.pdockq), format(pair?.pdockq2), format(pair?.lis), pair?.contacts ?? '', xl?.satisfied ?? '', xl?.total ?? '']);
    }
  }
  downloadText(`${set.name}_ranking.csv`, rows.map((row) => row.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell)).join(',')).join('\n'), 'text/csv');
}

function rankingCommand(rank) {
  const set = predictionSetOf() ?? state.predictionSets[state.predictionSets.length - 1];
  if (!set) throw new CommandError('Open a prediction folder or AlphaFold Server .zip first.');
  if (rank === null) {
    return {
      message: set.models.map((model) => `#${model.rank} ${model.label} ${scoreText(model.scores?.rankingScore)}`).join(', '),
      data: set.models.map((model) => ({
        rank: model.rank,
        model: model.label,
        rankingScore: model.scores?.rankingScore ?? null,
        ptm: model.scores?.ptm ?? null,
        iptm: model.scores?.iptm ?? null,
        meanPlddt: Number.isFinite(model.meanPlddt) ? model.meanPlddt : null,
        interfaces: (model.metrics?.pairs ?? []).map((pair) => ({ chains: [pair.chainA, pair.chainB], ipsae: pair.ipsae, pdockq: pair.pdockq, pdockq2: pair.pdockq2, lis: pair.lis, contacts: pair.contacts })),
        crosslinks: state.crosslinkRequest ? crosslinkSatisfaction(model, state.crosslinkRequest) : null,
      })),
    };
  }
  const model = set.models.find((item) => item.rank === rank);
  if (!model) throw new CommandError(`${set.name} has ${set.models.length} models.`);
  return loadPredictionModel(set, model).then((entry) => `Showing ${entry.name} (${model.label}).`);
}

// Sets an entry's PAE from a matrix, mapping rows to residues by tokenization.
function setEntryPAE(entry, pae, source, options = {}) {
  const model = activeModelOf(entry);
  const tokens = tokensForPAE(model, pae.size);
  const residues = tokens ? tokens.map((token) => token.residue) : paeResidues(pae.size, {}, entry);
  let max = 0;
  for (const value of pae.matrix) if (value > max) max = value;
  entry.pae = { size: pae.size, matrix: pae.matrix, max: Math.max(31.75, max), residues, chainBoundaries: chainBoundaries(residues), source };
  entry.contacts = options.contacts?.size === pae.size ? options.contacts : null;
  entry.domains = null;
  entry.paeSelection = null;
  if (entry === state.active && !options.silent) {
    renderPAE();
    showToast(`Loaded PAE matrix (${pae.size} × ${pae.size}) from ${source}.`);
  }
}

/* ---------- PAE domains ---------- */

// Clusters the PAE matrix into rigid domains and colors the structure by them.
function findPAEDomains(entry = state.active) {
  if (!entry?.pae) throw new CommandError('Load a PAE matrix first (fetch an AlphaFold DB entry or open a PAE or prediction file).');
  const domains = computePAEDomains(entry);
  setColorScheme('domains', [entry]);
  if (entry === state.active) renderDomainResult(entry);
  return `Found ${domains.count} PAE domain${domains.count === 1 ? '' : 's'} (${domains.sizes.join(', ')} residues).`;
}

function computePAEDomains(entry) {
  const pae = entry.pae;
  // Ligand and ion tokens have no place in a domain.
  const mask = Uint8Array.from(pae.residues, (residue) => (residue && (residue.kind === 'protein' || residue.kind === 'nucleic') ? 1 : 0));
  const { labels, domains } = paeDomains(pae, { mask });
  const values = new Map();
  pae.residues.forEach((residue, index) => {
    if (residue && labels[index] >= 0 && !values.has(residue.key)) values.set(residue.key, labels[index]);
  });
  entry.domains = { values, count: domains.length, sizes: domains.map((domain) => domain.size) };
  markColorsDirty();
  return entry.domains;
}

function renderDomainResult(entry = state.active) {
  const domains = entry?.domains;
  els.paeDomainResult.hidden = !domains;
  if (!domains) return;
  const ranges = domainRanges(entry);
  els.paeDomainResult.innerHTML = `<strong>${domains.count}</strong> domain${domains.count === 1 ? '' : 's'} · PAE < 5 Å graph, greedy modularity (resolution 0.5, at least 10 residues)
    <div class="domain-list">${ranges.map((item) => `<button type="button" class="feature-row detail" data-domain="${item.index}"><span><i class="swatch" style="background:${colorToHex(chainPaletteColor(item.index, entry.color.palette))}"></i>Domain ${item.index + 1}</span><em>${escapeHTML(item.text)}</em></button>`).join('')}</div>`;
  for (const button of els.paeDomainResult.querySelectorAll('[data-domain]')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.domain);
      selectResidues([...entry.domains.values].filter(([, value]) => value === index).map(([key]) => key), { frame: true });
    });
  }
}

// Compact residue ranges per domain, e.g. "A:1-120, A:300-340".
function domainRanges(entry) {
  const model = activeModelOf(entry);
  const byDomain = new Map();
  for (const residue of model.residues) {
    const index = entry.domains.values.get(residue.key);
    if (index === undefined) continue;
    if (!byDomain.has(index)) byDomain.set(index, []);
    byDomain.get(index).push(residue);
  }
  return [...byDomain].sort((a, b) => a[0] - b[0]).map(([index, residues]) => {
    const parts = [];
    let start = residues[0];
    let previous = residues[0];
    for (const residue of residues.slice(1).concat([null])) {
      if (residue && residue.chain === previous.chain && residue.resSeq === previous.resSeq + 1) {
        previous = residue;
        continue;
      }
      parts.push(start === previous ? `${start.chain}:${start.resSeq}` : `${start.chain}:${start.resSeq}-${previous.resSeq}`);
      start = residue;
      previous = residue;
    }
    const confidences = residues.map((residue) => residue.confidence).filter(Number.isFinite);
    const plddt = confidences.length && entry.structure.meta.isPredicted ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : NaN;
    const note = Number.isFinite(plddt) ? ` · pLDDT ${plddt.toFixed(0)}${plddt < 50 ? ' (disordered)' : ''}` : '';
    return { index, text: parts.slice(0, 6).join(', ') + (parts.length > 6 ? ` … (${parts.length} segments)` : '') + note };
  });
}

/* ---------- Validation reports ---------- */

// The PDB ID whose validation report describes this entry, if any.
function validationCode(entry = state.active) {
  if (!entry || entry.structure.meta.isPredicted) return '';
  const code = String(entry.fetchId || entry.structure.meta.code || '').trim();
  return /^[0-9][A-Za-z0-9]{3}$/.test(code) ? code.toUpperCase() : '';
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    if (body.error) return body.error;
  } catch {
    // Not JSON.
  }
  return `${fallback} (HTTP ${response.status}).`;
}

async function loadValidation(entry = state.active, options = {}) {
  const code = validationCode(entry);
  if (!code) throw new CommandError('Validation reports exist for PDB entries: fetch one by its 4-character ID, such as 1M17.');
  if (entry === state.active) {
    els.validationResult.hidden = false;
    els.validationResult.textContent = `Loading the wwPDB validation report for ${code}…`;
  }
  const response = await fetch(`/api/fetch/validation/${code}${options.refresh ? '?refresh=1' : ''}`);
  if (!response.ok) {
    const message = await responseError(response, `Could not load the validation report for ${code}`);
    if (entry === state.active) els.validationResult.innerHTML = `<span class="warn">${escapeHTML(message)}</span>`;
    throw new CommandError(message);
  }
  const report = await response.json();
  entry.validation = { code, report, byModel: new Map(), showClashes: entry.validation?.showClashes ?? false };
  const mapped = validationOf(entry);
  if (entry === state.active) {
    renderValidation();
    renderRamachandran();
  }
  markColorsDirty();
  markSceneDirty();
  return `Loaded the validation report for ${code}: ${mapped.outlierKeys.size} residue${mapped.outlierKeys.size === 1 ? '' : 's'} with outliers, ${mapped.clashes.length} clash${mapped.clashes.length === 1 ? '' : 'es'}.`;
}

// Maps the report onto the entry's active model (models of an NMR ensemble differ).
function validationOf(entry = state.active) {
  const validation = entry?.validation;
  if (!validation) return null;
  const model = activeModelOf(entry);
  let mapped = validation.byModel.get(model);
  if (!mapped) {
    mapped = mapValidation(validation.report, model);
    mapped.levels = new Map([...mapped.residues].map(([key, record]) => [key, validationLevel(record)]));
    const qscore = new Map();
    const rsrz = new Map();
    const rscc = new Map();
    for (const [key, record] of mapped.residues) {
      if (Number.isFinite(record.qscore)) qscore.set(key, record.qscore);
      if (Number.isFinite(record.rsrz)) rsrz.set(key, record.rsrz);
      if (Number.isFinite(record.rscc)) rscc.set(key, record.rscc);
    }
    mapped.values = { rsrz, rscc, qscore };
    mapped.fit = qscore.size >= rsrz.size && qscore.size ? { kind: 'qscore', values: qscore } : { kind: 'rsrz', values: rsrz };
    validation.byModel.set(model, mapped);
  }
  return mapped;
}

function renderValidation() {
  const entry = state.active;
  const code = entry ? validationCode(entry) : '';
  const mapped = validationOf(entry);
  els.validationLoad.disabled = !code;
  els.validationLoad.textContent = mapped ? 'Reload report' : 'Load report';
  els.validationColor.disabled = !mapped;
  els.validationFit.disabled = !mapped?.fit.values.size;
  els.validationClashes.disabled = !mapped;
  els.validationClashes.checked = Boolean(entry?.validation?.showClashes);
  if (!mapped) {
    if (!els.validationResult.textContent.startsWith('Loading')) {
      els.validationResult.hidden = !entry || Boolean(code);
      els.validationResult.innerHTML = entry && !code ? '<span class="hint">Validation reports are available for experimental PDB entries opened by ID or as bundled examples.</span>' : '';
    }
    return;
  }
  const { summary } = mapped;
  const percentile = (value) => (Number.isFinite(value) ? `<span class="percentile" title="Percentile rank among PDB entries (higher is better)"><i style="width:${Math.max(2, Math.min(100, value))}%;background:${percentileColor(value)}"></i></span><small>${Math.round(value)}th</small>` : '');
  const rows = summary.metrics.map((metric) => `<tr><td>${escapeHTML(metric.label)}</td><td>${formatNumberShort(metric.value)}${metric.unit}</td><td>${percentile(metric.absolute)}</td></tr>`).join('');
  const worst = [...mapped.residues]
    .filter(([, record]) => record.criteria.length)
    .map(([key, record]) => ({ key, record, residue: activeModelOf(entry).residueMap.get(key) }))
    .filter((item) => item.residue)
    .sort((a, b) => b.record.criteria.length - a.record.criteria.length || (b.record.rsrz || 0) - (a.record.rsrz || 0));
  const ligands = [...mapped.residues]
    .map(([key, record]) => ({ key, record, residue: activeModelOf(entry).residueMap.get(key) }))
    .filter((item) => item.residue && item.residue.kind === 'ligand');
  els.validationResult.hidden = false;
  els.validationResult.innerHTML = `<div><strong>${escapeHTML(entry.validation.code)}</strong>${Number.isFinite(summary.resolution) ? ` · ${summary.resolution.toFixed(2)} Å` : ''} · wwPDB validation report</div>
    ${rows ? `<table class="validation-table"><thead><tr><th>Metric</th><th>Value</th><th>Percentile</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <div>${mapped.outlierKeys.size} residue${mapped.outlierKeys.size === 1 ? '' : 's'} with outliers · ${mapped.clashes.length} clash${mapped.clashes.length === 1 ? '' : 'es'}${mapped.unmatched ? ` · ${mapped.unmatched} report residues not in this model` : ''}</div>
    ${ligands.length ? `<h4>Ligands</h4><div class="feature-list">${ligands.slice(0, 20).map((item) => `<button type="button" class="feature-row detail" data-residue="${escapeHTML(item.key)}"><span>${escapeHTML(shortResidueLabel(item.residue))}</span><em>${escapeHTML([Number.isFinite(item.record.rscc) ? `RSCC ${item.record.rscc.toFixed(2)}` : '', Number.isFinite(item.record.rsrz) ? `RSRZ ${item.record.rsrz.toFixed(1)}` : '', Number.isFinite(item.record.qscore) ? `Q ${item.record.qscore.toFixed(2)}` : '', ...item.record.criteria.filter((text) => !text.startsWith('RSRZ'))].filter(Boolean).join(' · ') || 'no outliers')}</em></button>`).join('')}</div>` : ''}
    ${worst.length ? `<h4>Worst residues</h4><div class="feature-list">${worst.slice(0, 25).map((item) => `<button type="button" class="feature-row detail" data-residue="${escapeHTML(item.key)}"><span>${escapeHTML(shortResidueLabel(item.residue))}</span><em>${escapeHTML(item.record.criteria.join(', '))}</em></button>`).join('')}</div>${worst.length > 25 ? `<p class="hint">…and ${worst.length - 25} more; select them all with <code>select outliers</code>.</p>` : ''}` : ''}`;
  for (const button of els.validationResult.querySelectorAll('[data-residue]')) {
    button.addEventListener('click', () => focusResidues([button.dataset.residue]));
  }
}

function percentileColor(value) {
  const t = Math.min(1, Math.max(0, value / 100));
  return colorToHex(sampleColormap('bwr', 1 - t));
}

function setShowClashes(show, entry = state.active) {
  if (!entry?.validation) return;
  entry.validation.showClashes = show;
  els.validationClashes.checked = show;
  markSceneDirty();
}

/* ---------- AlphaMissense ---------- */

// UniProt accessions of the entry's protein chains: from SIFTS/DBREF cross-references, or the
// accession of an AlphaFold DB model.
function chainAccessions(entry = state.active) {
  const result = new Map();
  for (const [chain, info] of entry.structure.sequences) {
    if (info.kind !== 'protein') continue;
    const segment = info.uniprot?.find((item) => item.accession);
    if (segment) {
      result.set(chain, { accession: segment.accession.toUpperCase(), mapped: true });
      continue;
    }
    const match = String(entry.structure.meta.code || entry.structure.label || entry.fetchId || '').match(/AF-([A-Z0-9]+(?:-\d+)?)-F1/i)
      ?? (entry.origin?.type === 'fetch' && !/^[0-9][A-Z0-9]{3}$/i.test(entry.fetchId ?? '') ? [null, entry.fetchId] : null);
    if (match) result.set(chain, { accession: match[1].toUpperCase(), mapped: false });
  }
  return result;
}

async function loadMissense(entry = state.active, options = {}) {
  const chains = chainAccessions(entry);
  if (options.accession) {
    for (const [chain, info] of entry.structure.sequences) if (info.kind === 'protein' && !chains.has(chain)) chains.set(chain, { accession: options.accession.toUpperCase(), mapped: false });
  }
  const accessions = [...new Set([...chains.values()].map((item) => item.accession))];
  if (!accessions.length) throw new CommandError('No UniProt accession is known for these chains. For a local model, name one: missense P04637.');
  if (entry === state.active) {
    els.missenseResult.hidden = false;
    els.missenseResult.textContent = `Loading AlphaMissense for ${accessions.join(', ')}…`;
  }
  const tables = new Map();
  const problems = [];
  await Promise.all(accessions.map(async (accession) => {
    const response = await fetch(`/api/fetch/afdb/${encodeURIComponent(accession)}/missense`);
    if (!response.ok) {
      problems.push(await responseError(response, `No AlphaMissense data for ${accession}`));
      return;
    }
    const parsed = parseAlphaMissense(await response.text());
    if (parsed) tables.set(accession, parsed);
    else problems.push(`${accession}: the AlphaMissense file was not understood`);
  }));
  if (!tables.size) {
    const message = problems.join(' ') || 'No AlphaMissense data was found.';
    if (entry === state.active) els.missenseResult.innerHTML = `<span class="warn">${escapeHTML(message)}</span>`;
    throw new CommandError(message);
  }
  const values = new Map();
  const positions = new Map();
  let mismatched = 0;
  const model = activeModelOf(entry);
  for (const residue of model.residues) {
    if (residue.kind !== 'protein') continue;
    const reference = chains.get(residue.chain);
    const table = reference && tables.get(reference.accession);
    if (!table) continue;
    const info = entry.structure.sequences.get(residue.chain);
    const position = reference.mapped ? uniprotPositionForResidue(info, residue)?.position : (residue.iCode ? null : residue.resSeq);
    const item = position ? table.positions.get(position) : null;
    if (!item) continue;
    // A wild-type mismatch means the numbering does not follow UniProt here.
    if (item.wt !== residue.code) {
      mismatched += 1;
      continue;
    }
    values.set(residue.key, item.mean);
    positions.set(residue.key, { accession: reference.accession, position, item });
  }
  entry.missense = { accessions: [...tables.keys()], values, positions, mismatched };
  if (!values.size) throw new CommandError(`AlphaMissense data loaded, but no residue matched the UniProt sequence${mismatched ? ` (${mismatched} wild-type mismatches)` : ''}.`);
  if (options.color !== false) setColorScheme('missense', [entry]);
  else markColorsDirty();
  if (entry === state.active) {
    renderMissense(problems);
    renderSelectionPanel();
    renderProfile();
  }
  return `AlphaMissense: ${values.size} residues colored by mean pathogenicity (${[...tables.keys()].join(', ')}).`;
}

function renderMissense(problems = []) {
  const entry = state.active;
  const missense = entry?.missense;
  if (!missense) {
    els.missenseResult.hidden = true;
    return;
  }
  const model = activeModelOf(entry);
  const ranked = [...missense.values].sort((a, b) => b[1] - a[1]);
  const pathogenic = ranked.filter(([, value]) => value > MISSENSE_THRESHOLDS.pathogenic).length;
  const benign = ranked.filter(([, value]) => value < MISSENSE_THRESHOLDS.benign).length;
  // Identical chains share one row per UniProt position.
  const positions = new Map();
  for (const [key, value] of ranked) {
    const { accession, position } = missense.positions.get(key);
    const id = `${accession}:${position}`;
    if (!positions.has(id)) positions.set(id, { key, value, chains: [] });
    positions.get(id).chains.push(model.residueMap.get(key)?.chain);
  }
  els.missenseResult.hidden = false;
  els.missenseResult.innerHTML = `<div><strong>${missense.values.size}</strong> residues · ${escapeHTML(missense.accessions.join(', '))} · <span class="bad">${pathogenic} likely pathogenic</span> · <span class="good">${benign} likely benign</span> on average${missense.mismatched ? ` · <span class="warn">${missense.mismatched} numbering mismatches</span>` : ''}</div>
    <div class="hint">Mean AlphaMissense score over the 19 substitutions at each position (Cheng et al., Science 2023; CC BY 4.0, via AlphaFold DB). Predictions for research, not for clinical use. Try <code>select am &gt; 0.564 and rsa &lt; 0.2</code> for buried sensitive positions (after SASA).</div>
    ${problems.length ? `<div class="warn">${escapeHTML(problems.join(' '))}</div>` : ''}
    <h4>Most sensitive positions</h4><div class="feature-list">${[...positions.values()].slice(0, 15).map(({ key, value, chains }) => {
      const residue = model.residueMap.get(key);
      const top = rankedSubstitutions(missense.positions.get(key)?.item, 3).map((item) => `${item.aa} ${item.score.toFixed(2)}`).join(', ');
      const label = chains.length > 1 ? `${residue?.resName}${residue?.resSeq} (${chains.join(', ')})` : residue ? shortResidueLabel(residue) : '';
      return residue ? `<button type="button" class="feature-row detail" data-residue="${escapeHTML(key)}"><span>${escapeHTML(label)} · ${value.toFixed(2)}</span><em>${escapeHTML(top)}</em></button>` : '';
    }).join('')}</div>`;
  for (const button of els.missenseResult.querySelectorAll('[data-residue]')) {
    button.addEventListener('click', () => focusResidues([button.dataset.residue]));
  }
}

// The AlphaMissense score of one substitution at a residue, if loaded.
function missenseScore(entry, residue, mutant) {
  const item = entry?.missense?.positions.get(residue.key)?.item;
  const score = item?.scores.get(mutant);
  return Number.isFinite(score) ? score : null;
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
    found.push({ residue: match.residue, label: site.label, value: site.value, mismatch: site.wt && match.residue.code !== site.wt, mutant: site.mutant });
  }
  setSites(found);
  // Substitutions get their AlphaMissense score when it is loaded.
  const scored = found
    .map((item) => ({ ...item, score: item.mutant && item.mutant.length === 1 ? missenseScore(state.active, item.residue, item.mutant) : null }))
    .filter((item) => item.score !== null);
  els.siteResult.hidden = false;
  els.siteResult.innerHTML = `<strong>${found.length}</strong> of ${parsed.length} sites located${found.length ? ` (${found.filter((item) => !item.mismatch).length} with matching wild-type residue)` : ''}.
    ${problems.length ? `<ul>${problems.slice(0, 12).map((text) => `<li class="warn">${escapeHTML(text)}</li>`).join('')}</ul>` : ''}
    ${scored.length ? `<table><thead><tr><th>Variant</th><th>AlphaMissense</th></tr></thead><tbody>${scored.map((item) => `<tr><td>${escapeHTML(item.label)}</td><td class="${item.score > MISSENSE_THRESHOLDS.pathogenic ? 'bad' : item.score < MISSENSE_THRESHOLDS.benign ? 'good' : 'warn'}">${item.score.toFixed(3)} · ${escapeHTML(missenseClass(item.score))}</td></tr>`).join('')}</tbody></table>` : ''}
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
  // Kept for ranking the models of an opened prediction by cross-link satisfaction.
  state.crosslinkRequest = { links, maxDistance };
  renderPrediction();
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

const COLOR_SCHEME_IDS = COLOR_SCHEMES.map((scheme) => scheme.id);
const HISTORY_KEY = 'proteoscope.commandHistory';

// The search box finds residues and atoms, previews selections ("chain A and resi 40-80") with a
// live count, and runs commands ("show sticks within 5 of resn STI"); Enter picks the first row.
function renderSearch() {
  const text = els.searchInput.value.trim();
  state.historyCursor = -1;
  if (!text || !state.structure) {
    clearSearchResults();
    return;
  }
  const items = [];
  const command = commandPreview(text);
  if (command) {
    items.push(command);
  } else {
    if (looksLikeSelection(text)) items.push(selectionPreview(text));
    else if (!/\s/.test(text)) {
      for (const suggestion of suggestCommands(text, 4)) items.push({ kind: 'suggest', label: suggestion.syntax, detail: suggestion.summary, fill: `${suggestion.name} ` });
    }
    if (!state.structure.searchItems) state.structure.searchItems = buildSearchItems(state.structure);
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    let found = 0;
    for (const item of state.structure.searchItems) {
      if (terms.every((term) => item.haystack.includes(term))) {
        items.push({ kind: 'residue', label: item.label, detail: `${item.type} · ${item.sublabel}`, result: item });
        found += 1;
        if (found >= 40) break;
      }
    }
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `search-${item.kind}${item.error ? ' is-error' : ''}${index === 0 ? ' is-active' : ''}`;
    button.innerHTML = `<strong>${escapeHTML(item.label)}</strong><span>${escapeHTML(item.detail ?? '')}</span>`;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => chooseSearchItem(item));
    fragment.appendChild(button);
  });
  els.searchResults.replaceChildren(fragment);
  els.searchResults.classList.toggle('is-visible', items.length > 0);
  els.searchResults.results = items;
}

function commandPreview(text) {
  let parsed;
  try {
    parsed = parseCommand(text, { schemes: COLOR_SCHEME_IDS });
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    return { kind: 'command', label: text, detail: error.message, error: true, text };
  }
  if (!parsed) return null;
  let detail = parsed.command.summary;
  const selection = parsed.selection ?? parsed.fit ?? null;
  if (selection) {
    try {
      detail = `${detail} · ${describeResolution(resolveSelection(selection))}`;
    } catch (error) {
      return { kind: 'command', label: text, detail: error.message, error: true, text };
    }
  }
  return { kind: 'command', label: `▸ ${text}`, detail, text };
}

function selectionPreview(text) {
  try {
    const resolved = resolveSelection(text);
    return { kind: 'selection', label: `Select ${text}`, detail: describeResolution(resolved), text, empty: !resolved.residues };
  } catch (error) {
    return { kind: 'selection', label: text, detail: error.message, error: true, text };
  }
}

async function chooseSearchItem(item) {
  if (!item) return;
  if (item.kind === 'suggest') {
    els.searchInput.value = item.fill;
    els.searchInput.focus();
    renderSearch();
    return;
  }
  if (item.kind === 'residue') {
    chooseSearchResult(item.result);
    return;
  }
  if (item.error) {
    showToast(item.detail, true);
    return;
  }
  const result = await runCommand(item.kind === 'selection' ? `select ${item.text}` : item.text, { frame: item.kind === 'selection' });
  if (result.ok) clearSearch();
}

function onSearchKey(event) {
  const buttons = [...els.searchResults.querySelectorAll('button')];
  const active = buttons.findIndex((button) => button.classList.contains('is-active'));
  const listOpen = els.searchResults.classList.contains('is-visible') && buttons.length > 0;
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (!listOpen || state.historyCursor >= 0)) {
    if (recallHistory(event.key === 'ArrowUp' ? 1 : -1)) event.preventDefault();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = Math.max(0, Math.min(buttons.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
    buttons.forEach((button, index) => button.classList.toggle('is-active', index === next));
    buttons[next]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Tab' && els.searchResults.results?.[Math.max(0, active)]?.kind === 'suggest') {
    event.preventDefault();
    chooseSearchItem(els.searchResults.results[Math.max(0, active)]);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = els.searchResults.results?.[Math.max(0, active)];
    if (item) chooseSearchItem(item);
    else if (els.searchInput.value.trim()) runCommand(els.searchInput.value).then((result) => result.ok && clearSearch());
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

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}

function rememberCommand(text) {
  const history = (state.commandHistory ??= loadHistory());
  if (history[0] !== text) history.unshift(text);
  history.length = Math.min(history.length, 100);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage can be unavailable (private windows); history then lasts for this page only.
  }
}

function recallHistory(step) {
  const history = (state.commandHistory ??= loadHistory());
  if (!history.length) return false;
  const cursor = Math.max(-1, Math.min(history.length - 1, (state.historyCursor ?? -1) + step));
  state.historyCursor = cursor;
  els.searchInput.value = cursor >= 0 ? history[cursor] : '';
  clearSearchResults();
  return true;
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
  ensureSceneCurrent();
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

// Yields so the loading message can paint. Background tabs get no animation frames, so a timer
// keeps loading moving there too.
function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });
}


// Console scripting API for power users (and automated checks).
globalThis.proteoscope = {
  state,
  run: (text, options = {}) => runCommand(text, { quiet: true, ...options }),
  select: (text) => runCommand(`select ${text}`, { quiet: true }),
  session: () => sessionDocument(),
  molViewSpec: () => buildMolViewSpecExport(),
  restoreSession,
  sessionLink,
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
  selectResidues: (keys) => selectResidues(keys, { frame: true }),
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
