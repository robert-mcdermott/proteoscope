import { createRenderer, MESH_VERTEX_STRIDE, packColor, withTimeout } from './lib/renderer.js';
import { createCanvasRenderer } from './lib/renderer-canvas.js';
import { ASYMMETRIC_UNIT_ID, addAtomToModel, createModel, createStructure, parseCIFDocument, parseStructure, readChemComp } from './lib/parse.js';
import { applyChemistry } from './lib/chemistry.js';
import {
  MAX_ASSEMBLY_ATOMS,
  assignSecondary,
  buildSearchItems,
  computeBounds,
  deriveModel,
  deriveStructure,
  materializeAssemblyModels,
  prepareAssemblyEstimates,
  residueForUniprotPosition,
  uniprotPositionForResidue,
} from './lib/structure.js';
import { buildLines, buildScene, focusNeighborhood } from './lib/scene.js';
import { alignerChains, compareStructures, polymerChainResidues, superposeEnsemble } from './lib/compare.js';
import { alignSequences } from './lib/align.js';
import { composeTransforms, invertTransform, isIdentityTransform, transformDirection, transformPoint } from './lib/superpose.js';
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
import { TRIAGE_METRICS, defaultTriageMetric, rankTriage, triageCSVRows, triageRecords, triageRows } from './lib/triage.js';
import {
  detectPredictionSets,
  flatSquare,
  insidePredictionFolder,
  MISSING_PAE,
  parseAF3Confidences,
  parseAF3Summary,
  parseBoltzAffinity,
  parseBoltzConfidence,
  parseChaiScores,
  parseColabFoldScores,
  parseOpenFold3Aggregated,
  parseOpenFold3Confidences,
  parsePredictionJSON,
  parseProtenixFullData,
  parseProtenixSummary,
  rankModels,
  tokensForPAE,
} from './lib/predictions.js';
import { zstdDecompress } from './lib/zstd.js';
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
import { STRUCTURE_SORTS, classifyQuery, coverageDepth, groupStructures, modelConfidence, modelRequest, shortMethod, sortStructures } from './lib/discover.js';
import { PPSE_EXPOSED, partSphereExposure } from './lib/exposure.js';
import { drawHistogram, drawPAE, drawProfile, drawRamachandran, drawVolcano, drawWoods } from './lib/plots.js';
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
  sampleInfo: document.querySelector('#sample-info'),
  discoverForm: document.querySelector('#discover-form'),
  discoverInput: document.querySelector('#discover-input'),
  discoverOrganism: document.querySelector('#discover-organism'),
  discoverProtein: document.querySelector('#discover-protein'),
  discoverSimilar: document.querySelector('#discover-similar'),
  discoverResult: document.querySelector('#discover-result'),
  reportInput: document.querySelector('#report-input'),
  reportResult: document.querySelector('#report-result'),
  ppseRun: document.querySelector('#ppse-run'),
  evidenceLoad: document.querySelector('#evidence-load'),
  evidenceResult: document.querySelector('#evidence-result'),
  ppseResult: document.querySelector('#ppse-result'),
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
  compareMethod: document.querySelector('#compare-method'),
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
  bondOrders: document.querySelector('#bond-orders'),
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
  methodsDialog: document.querySelector('#methods-dialog'),
  methodsText: document.querySelector('#methods-text'),
  methodsReferences: document.querySelector('#methods-references'),
  folderInput: document.querySelector('#folder-input'),
  predictionGroup: document.querySelector('#prediction-group'),
  conservationRun: document.querySelector('#conservation-run'),
  conservationFile: document.querySelector('#conservation-file'),
  conservationResult: document.querySelector('#conservation-result'),
  densityLoad: document.querySelector('#density-load'),
  densityFile: document.querySelector('#density-file'),
  densityRemove: document.querySelector('#density-remove'),
  densityControls: document.querySelector('#density-controls'),
  densityChannels: document.querySelector('#density-channels'),
  densityRegion: document.querySelector('#density-region'),
  densityRadius: document.querySelector('#density-radius'),
  densityRadiusValue: document.querySelector('#density-radius-value'),
  densityStyle: document.querySelector('#density-style'),
  densityZone: document.querySelector('#density-zone'),
  densityFit: document.querySelector('#density-fit'),
  densityResult: document.querySelector('#density-result'),
  dockingGroup: document.querySelector('#docking-group'),
  dockingCount: document.querySelector('#docking-count'),
  dockingTitle: document.querySelector('#docking-title'),
  dockingPoses: document.querySelector('#docking-poses'),
  dockingFingerprint: document.querySelector('#docking-fingerprint'),
  dockingDetail: document.querySelector('#docking-detail'),
  predictionCount: document.querySelector('#prediction-count'),
  predictionTitle: document.querySelector('#prediction-title'),
  predictionModels: document.querySelector('#prediction-models'),
  predictionPairs: document.querySelector('#prediction-pairs'),
  predictionDetail: document.querySelector('#prediction-detail'),
  predictionSuperpose: document.querySelector('#prediction-superpose'),
  predictionExport: document.querySelector('#prediction-export'),
  triageGroup: document.querySelector('#triage-group'),
  triageCount: document.querySelector('#triage-count'),
  triageSummary: document.querySelector('#triage-summary'),
  triageMetric: document.querySelector('#triage-metric'),
  triageTop: document.querySelector('#triage-top'),
  triageOpen: document.querySelector('#triage-open'),
  triageGallery: document.querySelector('#triage-gallery'),
  triageExport: document.querySelector('#triage-export'),
  triageDialog: document.querySelector('#triage-dialog'),
  triageDialogSummary: document.querySelector('#triage-dialog-summary'),
  triageDialogMetric: document.querySelector('#triage-dialog-metric'),
  triageLevel: document.querySelector('#triage-level'),
  triagePair: document.querySelector('#triage-pair'),
  triageFilter: document.querySelector('#triage-filter'),
  triageHead: document.querySelector('#triage-head'),
  triageBody: document.querySelector('#triage-body'),
  triageMore: document.querySelector('#triage-more'),
  triageGalleryGrid: document.querySelector('#triage-gallery-grid'),
  triageDialogExport: document.querySelector('#triage-dialog-export'),
  triageDialogGallery: document.querySelector('#triage-dialog-gallery'),
  ligandCard: document.querySelector('#ligand-card'),
  ligandCode: document.querySelector('#ligand-code'),
  ligandName: document.querySelector('#ligand-name'),
  ligandDetails: document.querySelector('#ligand-details'),
  ligandLinks: document.querySelector('#ligand-links'),
  ligandStatus: document.querySelector('#ligand-status'),
  ligandDiagramButton: document.querySelector('#ligand-diagram-button'),
  diagramDialog: document.querySelector('#diagram-dialog'),
  diagramTitle: document.querySelector('#diagram-title'),
  diagramView: document.querySelector('#diagram-view'),
  diagramNote: document.querySelector('#diagram-note'),
  diagramNames: document.querySelector('#diagram-names'),
  diagramRedraw: document.querySelector('#diagram-redraw'),
  diagramSaveSVG: document.querySelector('#diagram-save-svg'),
  diagramSavePNG: document.querySelector('#diagram-save-png'),
  densityPeaks: document.querySelector('#density-peaks'),
  densityPeakList: document.querySelector('#density-peak-list'),
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
  // Double, triple and aromatic bonds in sticks: 'ligands' (and modified residues), 'all' or 'off'.
  bondOrders: 'ligands',
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
const DATA_SCHEMES = new Set(['coverage', 'data', 'exposure', 'ppse', 'deviation', 'lddt', 'rmsf', 'validation', 'densityfit', 'mapfit', 'missense', 'domains', 'msa', 'conservation']);

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
    // An imported search report (rows of this structure's proteins) and part-sphere exposure.
    report: null,
    exposure: null,
    exposureWithPAE: false,
    // Public peptides and PTM sites (EBI Proteins API) mapped onto this structure.
    evidence: null,
    // Cross-links as entered or imported, before mapping (mapped ones are in proteomics).
    crosslinkSet: null,
    // HDX-MS peptides, their chain positions and the comparison shown.
    hdx: null,
  };
}

const ENTRY_FIELDS = Object.keys(entryDefaults());

const state = {
  samples: [],
  startup: null,
  entries: [],
  predictionSets: [],
  nextPredictionId: 1,
  // Batch triage: the metric (null: ipSAE for complexes, else pLDDT), one row per job or per
  // model, a fixed chain pair (null: each model's best interface) and a job-name filter.
  triage: { metric: null, level: 'jobs', pair: null, filter: '', gallery: [] },
  // Chemical component facts by CCD code, for the ligand card: { status, info, promise }.
  compounds: new Map(),
  diagram: null,
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
  if (startup?.offline) {
    for (const control of [els.discoverInput, els.discoverOrganism, els.discoverProtein, els.discoverSimilar, ...els.discoverForm.querySelectorAll('button')]) control.disabled = true;
    els.discoverInput.placeholder = 'Search needs network access (started with --offline)';
  }
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
      const fallback = findSample('1m17') ?? state.samples[0];
      if (fallback) await openSample(fallback);
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
      if (hashRequest.get('superpose') === 'structure') await runStructuralSuperposition({ reference: state.entries[0], mobiles: state.entries.slice(1) });
      else if (hashRequest.has('superpose')) runSuperposition({ reference: state.entries[0], mobiles: state.entries.slice(1) });
    }
  } else {
    // The first example opens plainly; its description offers the opening view.
    const preferred = findSample('1m17') ?? state.samples[0];
    if (!preferred) throw new Error('No embedded structure files were found.');
    await openSample(preferred);
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
    state.canvasFallback = true;
    els.gpuBadge.textContent = 'Canvas preview';
    els.gpuBadge.classList.add('is-fallback');
    // Safari 26 provides WebGPU only on macOS Tahoe (26) and later; on Sequoia navigator.gpu is absent.
    const safari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
    const reason = safari && !navigator.gpu
      ? 'Safari provides WebGPU only from macOS Tahoe (26), so Proteoscope uses a simplified renderer without surfaces, ambient occlusion or outlines.'
      : 'This browser does not provide WebGPU, so Proteoscope uses a simplified renderer without surfaces, ambient occlusion or outlines.';
    els.gpuBadge.title = `${reason} For full quality, open ${location.origin} in Chrome, Edge or Brave.`;
    if (new URLSearchParams(location.search).get('renderer') !== 'canvas') showToast(`${reason} For full quality, open this page in Chrome, Edge or Brave.`, true);
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
    const sample = findSample(els.sampleSelect.value);
    if (!sample) return;
    history.replaceState(null, '', location.pathname + location.search);
    await guardedLoad(() => openSample(sample, { add: els.addMode.checked, view: !els.addMode.checked }));
  });
  // A FASTA record pasted into the one-line field would lose its line breaks and run the header
  // into the sequence; the field keeps the first record's sequence.
  els.discoverInput.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/^\s*>/.test(text) || !/\n/.test(text)) return;
    event.preventDefault();
    let sequence = '';
    let headers = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().startsWith('>')) {
        headers += 1;
        if (headers > 1) break;
      } else {
        sequence += line.replace(/[\s\d]/g, '');
      }
    }
    els.discoverInput.value = sequence;
  });
  els.discoverForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runDiscovery(els.discoverInput.value);
  });
  els.discoverProtein.addEventListener('click', () => discoverActiveProtein());
  els.discoverSimilar.addEventListener('click', () => discoverSimilarSequences());
  els.discoverResult.addEventListener('click', onDiscoveryClick);
  els.discoverResult.addEventListener('change', (event) => {
    if (!event.target.matches('[data-discover-sort]') || !state.discovery?.protein) return;
    state.discovery.protein.sort = event.target.value;
    renderDiscovery();
  });
  els.sampleInfo.addEventListener('click', (event) => {
    // The view is replayed on a fresh copy, so views that add structures stay idempotent.
    const sample = findSample(event.target.closest('[data-sample-view]')?.dataset.sampleView);
    if (sample) guardedLoad(() => openSample(sample, { view: true }));
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
  els.bondOrders.addEventListener('change', () => updateDisplay({ bondOrders: els.bondOrders.value }));
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
  document.querySelector('#session-methods').addEventListener('click', () => guardedLoad(openMethodsDialog));
  // Messages go inside the dialog: toasts would sit under its backdrop.
  const methodsStatus = document.querySelector('#methods-status');
  document.querySelector('#methods-copy').addEventListener('click', () => copyText(els.methodsText.value, 'Copied the methods paragraph.', methodsStatus));
  document.querySelector('#methods-copy-references').addEventListener('click', () => copyText([...els.methodsReferences.children].map((item, index) => `${index + 1}. ${item.textContent}`).join('\n'), 'Copied the references.', methodsStatus));
  document.querySelector('#methods-bibtex').addEventListener('click', () => {
    downloadText(`${fileStem()}-references.bib`, state.methods?.bibtex ?? '', 'application/x-bibtex');
    methodsStatus.textContent = `Saved ${fileStem()}-references.bib.`;
  });
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
  els.compareRun.addEventListener('click', () => (els.compareMethod.value === 'structure' ? runStructuralSuperposition() : runSuperposition()));
  // TM-align chooses its own pairs, so a fit on selected residues applies to sequence pairing only.
  els.compareMethod.addEventListener('change', () => {
    const structure = els.compareMethod.value === 'structure';
    const label = els.compareFitSelection.closest('label');
    label.dataset.title ??= label.title;
    els.compareFitSelection.disabled = structure;
    label.title = structure ? 'TM-align chooses the residues it fits; pair residues by sequence to fit on a selection.' : label.dataset.title;
  });
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
  bindTriageEvents();
  bindLigandEvents();
  document.querySelector('#docking-fingerprints').addEventListener('click', () => guardedLoad(() => computePoseFingerprints()));
  els.densityLoad.addEventListener('click', () => runCommand('map'));
  els.conservationRun.addEventListener('click', () => runCommand('conservation'));
  els.conservationFile.addEventListener('change', () => {
    const files = [...els.conservationFile.files];
    els.conservationFile.value = '';
    if (files.length) guardedLoad(() => openAlignmentFiles(files.map((file) => fileRef(file))));
  });
  els.densityFile.addEventListener('change', () => {
    const [file] = els.densityFile.files;
    els.densityFile.value = '';
    if (file) guardedLoad(() => openMapFile(fileRef(file)));
  });
  els.densityRemove.addEventListener('click', () => removeDensity());
  els.densityFit.addEventListener('click', () => runCommand('map fit'));
  els.densityRegion.addEventListener('change', () => {
    if (!state.active?.density) return;
    state.active.density.region = els.densityRegion.value;
    updateDensity(state.active);
  });
  els.densityRadius.addEventListener('input', () => {
    const density = state.active?.density;
    if (!density) return;
    density.radius = Number(els.densityRadius.value);
    els.densityRadiusValue.textContent = `${density.radius} Å`;
    clearTimeout(state.densityLevelTimer);
    state.densityLevelTimer = setTimeout(() => updateDensity(state.active), 150);
  });
  els.densityStyle.addEventListener('change', () => {
    const density = state.active?.density;
    if (!density) return;
    density.style = els.densityStyle.value;
    density.opacity = density.style === 'surface' ? 0.45 : 1;
    drawDensity(state.active);
  });
  els.densityZone.addEventListener('change', () => {
    if (!state.active?.density) return;
    state.active.density.zone = Number(els.densityZone.value);
    updateDensity(state.active);
  });
  document.querySelector('#docking-export').addEventListener('click', exportDockingCSV);
  document.querySelector('#docking-clear').addEventListener('click', () => guardedLoad(clearPoses));
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
    if (state.active?.crosslinkSet) mapCrosslinkSet();
  });
  els.xlMax.addEventListener('change', () => {
    if (state.active?.crosslinkSet) mapCrosslinkSet();
  });
  els.xlResult.addEventListener('click', onCrosslinkClick);
  document.querySelector('#hdx-file').addEventListener('change', async (event) => {
    const [file] = event.target.files ?? [];
    event.target.value = '';
    if (!file) return;
    await guardedLoad(async () => {
      if (!(await importHDX(fileRef(file)))) throw new Error(`${file.name} is not recognized HDX-MS data (DynamX state or cluster data, HDExaminer results or uptake summary).`);
    });
  });
  document.querySelector('#hdx-result').addEventListener('change', onHDXControl);
  document.querySelector('#hdx-result').addEventListener('click', onHDXClick);
  document.querySelector('#xl-file').addEventListener('change', async (event) => {
    const [file] = event.target.files ?? [];
    event.target.value = '';
    if (!file) return;
    await guardedLoad(async () => {
      if (!(await importCrosslinkReport(fileRef(file)))) throw new Error(`${file.name} is not a recognized cross-link export (xiFDR, xiVIEW, pLink, MeroX, XlinkX, MS Annika or MaxLynx).`);
    });
  });
  els.xlResult.addEventListener('change', (event) => {
    const set = state.active?.crosslinkSet;
    if (!event.target.matches('[data-xl-sasd-cutoff]') || !set) return;
    set.sasdCutoff = Number(event.target.value) || 33;
    for (const link of state.active.proteomics.crosslinks) link.satisfied = link.sasd !== null && link.sasd <= set.sasdCutoff;
    renderCrosslinks();
    markSceneDirty();
  });
  els.dataApply.addEventListener('click', applyResidueDataFromInput);
  els.reportInput.addEventListener('change', async () => {
    const [file] = els.reportInput.files ?? [];
    els.reportInput.value = '';
    if (file) await guardedLoad(() => importReport(file));
  });
  els.reportResult.addEventListener('change', onReportControl);
  els.reportResult.addEventListener('click', onReportClick);
  els.ppseRun.addEventListener('click', () => runCommand('exposure'));
  els.evidenceLoad.addEventListener('click', () => runCommand('evidence'));
  els.evidenceResult.addEventListener('click', onEvidenceClick);
  els.evidenceResult.addEventListener('change', (event) => {
    if (!event.target.matches('[data-evidence-type]') || !state.active?.evidence) return;
    state.active.evidence.type = event.target.value;
    renderEvidence();
  });

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

async function guardedLoad(task, options = {}) {
  try {
    await task();
  } catch (error) {
    console.error(error);
    hideLoading();
    showToast(error.message || String(error), true);
    if (options.rethrow) throw error;
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
    if (!add) setSampleSelection(null);
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
  const superposed = state.entries.find((entry) => entry.comparison && entry.comparison.referenceId === state.entries[0].id);
  const method = superposed?.comparison.recipe?.correspondence === 'structure' ? '=structure' : '';
  history.replaceState(null, '', `#fetch=${ids.map(encodeURIComponent).join(',')}${superposed ? `&superpose${method}` : ''}`);
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
// model sets; structures (.pdb, .cif, .bcif, optionally compressed with gzip or Zstandard) open as
// entries; JSON files are sessions or PAE matrices; .npz PAE, .a3m alignments, search reports,
// cross-links and HDX tables annotate the active structure.
// Opens dropped, chosen or named files. options.add adds to the scene (default: the checkbox);
// options.rethrow lets a script see a failure; options.table opens the triage table for a batch.
async function openFiles(files, options = {}) {
  const addMode = options.add ?? els.addMode.checked;
  await guardedLoad(async () => {
    let refs = files.map((item) => (item.read ? item : fileRef(item)));
    refs = await expandArchives(refs);
    const { sets, rest: unclaimed } = detectPredictionSets(refs);
    if (sets.length > 1) await openPredictionBatch(sets, { add: addMode, table: options.table ?? true });
    else if (sets.length) await openPredictionSet(sets[0], { add: addMode });
    // The logs, settings, templates and inputs in a prediction folder are left alone.
    const rest = unclaimed.filter((ref) => !insidePredictionFolder(ref, sets));
    const molecules = rest.filter((ref) => MOLECULE_FILE.test(ref.name));
    const maps = rest.filter((ref) => MAP_FILE.test(ref.name));
    const structures = rest.filter((ref) => STRUCTURE_FILE.test(ref.name));
    let first = null;
    for (const [index, ref] of structures.entries()) {
      showLoading(`Reading ${ref.name}`);
      const text = await structureFileText(ref);
      const entry = await loadStructureFromText(text, ref.name.replace(/\.bcif$/i, '.cif'), { source: 'Local file', add: sets.length > 0 || index > 0 || addMode });
      first ??= entry;
    }
    if (structures.length || sets.length) {
      if (!addMode) setSampleSelection(null);
      history.replaceState(null, '', location.pathname);
      if (structures.length > 1) {
        setActiveEntry(first);
        showToast(`Opened ${structures.length} structures. Superpose them in the Analysis tab.`);
      }
    }
    if (molecules.length) await openMoleculeFiles(molecules);
    for (const ref of maps) await openMapFile(ref);
    const others = rest.filter((item) => !STRUCTURE_FILE.test(item.name) && !MOLECULE_FILE.test(item.name) && !MAP_FILE.test(item.name));
    // Alignments dropped together (one per chain, say) are scored together.
    const alignments = others.filter((item) => isAlignmentFile(item.name));
    if (alignments.length) await openAlignmentFiles(alignments);
    for (const ref of others.filter((item) => !isAlignmentFile(item.name))) await openAnnotationFile(ref);
  }, options);
}

const STRUCTURE_FILE = /\.(pdb|ent|cif|mmcif|bcif)$/i;
const MAP_FILE = /\.(mrc|map|ccp4)$/i;

// Files compressed with gzip or Zstandard (AlphaFold 3's --compress_large_output_files) are read
// decompressed under their inner name.
const COMPRESSED_FILE = /\.(gz|zst)$/i;

async function decompressFile(name, raw) {
  if (/\.gz$/i.test(name)) return decompressBytes(raw);
  if (/\.zst$/i.test(name)) return zstdDecompress(raw);
  return raw;
}

// A uniform view of local files, archive members and server-provided files.
function fileRef(file, path = file.webkitRelativePath || file.name) {
  const bytes = async () => decompressFile(file.name, new Uint8Array(await file.arrayBuffer()));
  return {
    name: file.name.replace(COMPRESSED_FILE, ''),
    path: path.replace(COMPRESSED_FILE, ''),
    size: file.size,
    // Reports are streamed from the File itself (gzipped ones decompress as they are read).
    file,
    read: bytes,
    text: async () => new TextDecoder().decode(await bytes()),
  };
}

// Files named on the command line; the server decompresses gzip but not Zstandard.
function urlRef(file) {
  const read = async () => {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Could not read ${file.name} (HTTP ${response.status}).`);
    return decompressFile(file.name, new Uint8Array(await response.arrayBuffer()));
  };
  const path = file.path || file.name;
  return { name: file.name.replace(COMPRESSED_FILE, ''), path: path.replace(COMPRESSED_FILE, ''), size: file.size, read, text: async () => new TextDecoder().decode(await read()) };
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
      result.push(bytesRef(name.replace(COMPRESSED_FILE, ''), `${base}/${entry.name}`.replace(COMPRESSED_FILE, ''), await decompressFile(name, data)));
    }
  }
  return result;
}

// The first bytes of a file as text: streamed (and decompressed) from local files, read whole
// otherwise.
async function refHead(ref, limit = 65536) {
  const file = ref.file;
  if (!file || /\.zst$/i.test(file.name)) return new TextDecoder().decode((await ref.read()).subarray(0, limit));
  let stream = file.stream();
  if (/\.gz$/i.test(file.name)) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes.subarray(0, limit));
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
    const json = parsePredictionJSON(await ref.text());
    if (isSessionDocument(json)) {
      await restoreSession(json);
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    loadPAEFromJSON(json, ref.name);
    return;
  }
  if (!state.active) throw new Error(`Open a structure before ${ref.name}.`);
  if (name.endsWith('.npz') || name.endsWith('.npy')) {
    const matrix = await readPAEArray(ref);
    if (!matrix) throw new Error(`${ref.name} does not contain a square PAE matrix.`);
    setEntryPAE(state.active, matrix, ref.name);
    return;
  }
  if (isAlignmentFile(name)) {
    await openAlignmentFiles([ref]);
    return;
  }
  if (/\.(csv|tsv|txt|parquet|mztab|xls)$/.test(name)) {
    // The kind of table is decided from its first 64 KB, so a report of gigabytes is not read
    // whole just to find out that it is a search report (which then streams).
    const head = await refHead(ref);
    if (parseAlphaMissense(head.split('\n').slice(0, 3).join('\n'))) {
      showToast('This looks like an AlphaMissense table; use the AlphaMissense button in the Proteomics tab, which maps it by UniProt numbering.', true);
      return;
    }
    if (!/\.parquet$/.test(name)) {
      const { parseCrosslinkReport } = await import('./lib/crosslinks.js');
      if (parseCrosslinkReport(head, ref.name) && await importCrosslinkReport(ref)) return;
      const { parseHDX } = await import('./lib/hdx.js');
      if (parseHDX(head, ref.name) && await importHDX(ref)) return;
    }
    // Zstandard-compressed reports are decompressed whole; other reports stream from the file.
    const file = ref.file && !/\.zst$/i.test(ref.file.name) ? ref.file : new File([await ref.read()], ref.name);
    await importReport(file);
    return;
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
  const structure = options.structure ?? parseStructure(text, label);
  // Files from prediction folders are predictions even when they carry no ModelCIF records.
  if (options.predicted) structure.meta.isPredicted = true;
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  showLoading('Deriving residues, bonds and secondary structure');
  await nextFrame();
  deriveStructure(structure, { secondaryMode: state.secondaryMode });
  const add = Boolean(options.add) && state.entries.length > 0;
  // A new structure inherits the current style, including when it replaces the scene; examples
  // opened with their view start from the defaults instead.
  const template = options.template ?? state.active ?? state.defaults;
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
  completeChemistry(entry);
  return entry;
}

function createEntry(structure, sourceLabel, template = state.active ?? state.defaults) {
  const color = { ...template.color };
  const first = !state.entries.length;
  // Data colorings describe one structure; so does the colormap an import picked for them.
  if (DATA_SCHEMES.has(color.scheme)) color.colormap = '';
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
  const predicted = entry.prediction ? predictionModelOf(entry) : null;
  if (predicted?.entryId === entry.id) predicted.entryId = null;
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
  // A new scene starts a new triage; prediction jobs being opened now are kept.
  state.predictionSets = state.predictionSets.filter((set) => set.incoming);
  state.triage = { ...state.triage, metric: null, pair: null, filter: '', gallery: [] };
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
  if (entry.density) {
    // Pending updates and the follow timer find the map gone.
    entry.density.updateToken += 1;
    clearDensityGeometry(entry);
    volumeWorker().run('drop', { key: String(entry.id) }).catch(() => {});
    entry.density = null;
  }
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
  entry.report = null;
  entry.exposure = null;
  entry.evidence = null;
  entry.crosslinkSet = null;
  entry.hdx = null;
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

/* ---------- Ligand chemistry ---------- */

// Ligands and modified residues that the file does not define (PDB files, predictions) get
// their bond orders, aromaticity and charges from the Chemical Component Dictionary through the
// server, in the background. Until then, or offline without a cached copy, they keep the
// chemistry inferred from their geometry.
async function completeChemistry(entry) {
  const structure = entry.structure;
  structure.componentsRequested ??= new Set();
  const missing = new Set();
  for (const model of new Set([...structure.baseModels, ...structure.models])) {
    for (const id of model.missingComponents ?? []) if (!structure.componentsRequested.has(id)) missing.add(id);
  }
  if (!missing.size) return;
  const batch = [...missing].slice(0, MAX_COMPONENT_REQUESTS);
  for (const id of batch) structure.componentsRequested.add(id);
  const fetched = await Promise.all(batch.map(async (id) => {
    try {
      const response = await fetch(`/api/fetch/ccd/${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      return readChemComp(parseCIFDocument(await response.text())).get(id) ?? null;
    } catch {
      return null;
    }
  }));
  let added = 0;
  for (const component of fetched) {
    if (!component) continue;
    component.source = 'ccd';
    structure.components.set(component.id, component);
    added += 1;
  }
  if (!state.entries.includes(entry)) return;
  if (added) {
    for (const model of new Set([...structure.baseModels, ...structure.models])) applyChemistry(model, structure);
    markSceneDirty();
    if (entry === state.active && state.focus) computeFocusInteractions([...state.focus.residues]);
  }
  // Structures with more ligand types than one batch get the rest next.
  if (missing.size > batch.length) await completeChemistry(entry);
}

const MAX_COMPONENT_REQUESTS = 40;

/* ---------- Ligand card and 2D diagram ---------- */

// The card describes the focused or selected ligand: its names, formula, weight, charge, SMILES
// and InChIKey from RCSB's chemical component API (through the server, and cached), with links
// to the databases that list it. A ligand without a dictionary code (a docking pose, UNL) is
// described from the model alone.
const COMPOUND_LINKS = [
  ['pubchem', 'PubChem', (id) => `https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(id)}`],
  ['chembl', 'ChEMBL', (id) => `https://www.ebi.ac.uk/chembl/explore/compound/${encodeURIComponent(id)}`],
  ['drugbank', 'DrugBank', (id) => `https://go.drugbank.com/drugs/${encodeURIComponent(id)}`],
  ['chebi', 'ChEBI', (id) => `https://www.ebi.ac.uk/chebi/${encodeURIComponent(id)}`],
];
// The order a diagram's residue labels take their color from, strongest interaction first.
const DIAGRAM_PRECEDENCE = ['salt-bridge', 'metal-coordination', 'hydrogen-bond', 'halogen-bond', 'pi-stacking', 'cation-pi', 'water-bridge', 'hydrophobic'];

function ligandCardResidue() {
  if (!state.structure) return null;
  const model = activeModel();
  const keys = state.focus?.residues.size === 1 ? [...state.focus.residues] : state.selection.size === 1 ? [...state.selection] : [];
  const residue = keys.length ? model.residueMap.get(keys[0]) : null;
  return residue && (residue.kind === 'ligand' || residue.kind === 'ion') ? residue : null;
}

// The residue's code in the Chemical Component Dictionary, when the residue is that component:
// the dictionary's chemistry matched it, the file came from the PDB, or it is an ion.
function compoundCode(residue, entry = state.active) {
  const id = String(residue?.resName ?? '').toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(id) || ['UNL', 'UNK', 'UNX', 'DUM'].includes(id)) return '';
  const docking = dockingOf(entry);
  if (docking && poseResidueKey(docking) === residue.key) return '';
  if (residue.kind === 'ion' || residue.chemistry === 'ccd' || residue.chemistry === 'file' || entry?.origin?.type === 'fetch') return id;
  return '';
}

// One lookup per code; a failed one (offline, a network error) is tried again after a minute.
const COMPOUND_RETRY = 60_000;

function compoundRecord(id) {
  let record = state.compounds.get(id);
  if (record && !(record.status === 'error' && Date.now() > record.retryAt)) return record.promise;
  record = { status: 'loading', info: null, message: '' };
  record.promise = (async () => {
    try {
      const response = await fetch(`/api/fetch/compound/${encodeURIComponent(id)}`);
      if (!response.ok) {
        record.status = response.status === 404 ? 'missing' : 'error';
        record.message = await responseError(response, `Could not look up ${id}`);
      } else {
        record.info = await response.json();
        record.status = 'ready';
      }
    } catch (error) {
      record.status = 'error';
      record.message = error.message;
    }
    if (record.status === 'error') record.retryAt = Date.now() + COMPOUND_RETRY;
    return record;
  })();
  state.compounds.set(id, record);
  return record.promise;
}

// The elements of the modeled atoms in Hill order, with hydrogens when the model has them or
// the dictionary's chemistry gives their count.
function modelFormula(residue) {
  const counts = new Map();
  let explicit = 0;
  let implicit = 0;
  let implicitKnown = true;
  for (const atom of residue.atoms) {
    if (atom.isHydrogen) {
      explicit += 1;
      continue;
    }
    const element = elementSymbol(atom.element);
    counts.set(element, (counts.get(element) ?? 0) + 1);
    if (Number.isFinite(atom.hydrogens)) implicit += atom.hydrogens;
    else implicitKnown = false;
  }
  const hydrogens = explicit || (implicitKnown ? implicit : 0);
  if (hydrogens) counts.set('H', hydrogens);
  const order = [...counts.keys()].sort((a, b) => {
    const rank = (element) => (counts.has('C') ? (element === 'C' ? 0 : element === 'H' ? 1 : 2) : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return order.map((element) => `${element}${counts.get(element) > 1 ? counts.get(element) : ''}`).join(' ');
}

function elementSymbol(element) {
  const text = String(element ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function formulaHTML(formula) {
  return String(formula).split(/\s+/).filter(Boolean).map((part) => {
    const match = /^([A-Za-z]{1,2})(\d*)([+-]?\d*[+-]?)$/.exec(part);
    if (!match) return escapeHTML(part);
    return `${escapeHTML(elementSymbol(match[1]))}${match[2] ? `<sub>${match[2]}</sub>` : ''}${match[3] ? `<sup>${escapeHTML(match[3])}</sup>` : ''}`;
  }).join('');
}

// What the card shows, as a record: for the card, the `compound` command and scripts.
function compoundCard(residue, entry = state.active) {
  const id = compoundCode(residue, entry);
  const record = id ? state.compounds.get(id) : null;
  const info = record?.status === 'ready' ? record.info : null;
  // A docking pose is named by its file's title and its place in the list.
  const docking = dockingOf(entry);
  const pose = docking && poseResidueKey(docking) === residue.key ? docking.molecules[docking.index] : null;
  const local = pose ? `${pose.title || 'Pose'} (pose ${docking.index + 1})` : componentNameOf(residue, entry);
  const heavy = residue.atoms.filter((atom) => !atom.isHydrogen).length;
  const links = [];
  if (id && record?.status !== 'missing') {
    links.push({ label: 'RCSB', url: `https://www.rcsb.org/ligand/${encodeURIComponent(id)}` });
    links.push({ label: 'PDBe', url: `https://pdbe.org/chem/${encodeURIComponent(id)}` });
  }
  for (const [key, label, url] of COMPOUND_LINKS) {
    if (info?.related?.[key]) links.push({ label, url: url(info.related[key]), id: info.related[key] });
  }
  return {
    id: id || null,
    residue: shortResidueLabel(residue),
    name: info?.commonName ? titleCase(info.commonName) : info?.name ? titleCase(info.name) : local || residue.resName,
    fullName: info?.name ? titleCase(info.name) : local || null,
    synonyms: info?.synonyms ?? [],
    type: info?.type ?? residue.kind,
    formula: info?.formula || modelFormula(residue),
    formulaFrom: info?.formula ? 'dictionary' : 'model',
    weight: Number.isFinite(info?.weight) ? info.weight : null,
    charge: Number.isFinite(info?.charge) ? info.charge : null,
    smiles: info?.smiles ?? null,
    inchiKey: info?.inchiKey ?? null,
    heavyAtoms: { modeled: heavy, expected: info?.heavyAtoms ?? null },
    links,
    peaks: ligandPeaks(entry, residue),
    status: record?.status ?? (id ? 'loading' : 'model'),
    message: record?.message ?? '',
  };
}

function renderLigandCard() {
  const residue = ligandCardResidue();
  els.ligandCard.hidden = !residue;
  if (!residue) return;
  const entry = state.active;
  const id = compoundCode(residue, entry);
  const known = id ? state.compounds.get(id) : null;
  if (id && (!known || (known.status === 'error' && Date.now() > known.retryAt))) {
    compoundRecord(id).then(() => {
      if (ligandCardResidue() === residue) renderLigandCard();
    });
  }
  const card = compoundCard(residue, entry);
  els.ligandCode.textContent = id || residue.resName;
  els.ligandName.textContent = card.name;
  const rows = [];
  const row = (label, html, options = {}) => rows.push(`<div${options.wide ? ' class="wide"' : ''}><dt>${escapeHTML(label)}</dt><dd${options.mono ? ' class="mono"' : ''} title="${escapeHTML(options.title ?? '')}">${html}</dd></div>`);
  if (card.fullName && card.fullName !== card.name) row('Name', escapeHTML(card.fullName), { wide: true, title: card.fullName });
  row('Formula', `${formulaHTML(card.formula)}${card.formulaFrom === 'model' ? ' <span class="hint">(model)</span>' : ''}`, { title: card.formulaFrom === 'model' ? 'Counted from the modeled atoms' : '' });
  if (card.weight !== null) row('Weight', `${card.weight.toFixed(2)} g/mol`);
  if (card.charge !== null) row('Charge', card.charge > 0 ? `+${card.charge}` : String(card.charge).replace('-', '−'));
  if (card.heavyAtoms.expected) {
    const missing = card.heavyAtoms.expected - card.heavyAtoms.modeled;
    row('Modeled', `${card.heavyAtoms.modeled} of ${card.heavyAtoms.expected} heavy atoms${missing > 0 ? ' <span class="warn">(incomplete)</span>' : ''}`, { title: 'Heavy atoms in the model, of those in the dictionary entry' });
  }
  if (card.smiles) row('SMILES', `${escapeHTML(card.smiles)}`, { wide: true, mono: true, title: card.smiles });
  if (card.inchiKey) row('InChIKey', escapeHTML(card.inchiKey), { wide: true, mono: true, title: card.inchiKey });
  if (card.peaks) row('Fo-Fc peaks', escapeHTML(ligandPeakText(card.peaks)), { wide: true, title: `Difference-map peaks beyond ±${card.peaks.threshold}σ within ${LIGAND_PEAK_DISTANCE} Å of the ligand` });
  els.ligandDetails.innerHTML = rows.join('');
  els.ligandLinks.innerHTML = card.links.map((link) => `<a href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(link.id ?? link.url)}">${escapeHTML(link.label)}</a>`).join('');
  const status = {
    loading: 'Looking up the Chemical Component Dictionary…',
    missing: `${residue.resName} is not in the Chemical Component Dictionary; the formula is counted from the model.`,
    error: `${(card.message || 'The dictionary could not be reached').replace(/\.+$/, '')}. The formula is counted from the model.`,
    model: 'No dictionary code (a docking pose or an unnamed ligand): the formula is counted from the model.',
  }[card.status] ?? '';
  els.ligandStatus.hidden = !status;
  els.ligandStatus.textContent = status;
  els.ligandDiagramButton.disabled = card.heavyAtoms.modeled < 2;
}

// "compound [<selection>]": the card of a ligand, and its facts for scripts.
async function compoundCommand(selection) {
  const residue = resolveLigand(selection);
  const entry = state.active;
  const id = compoundCode(residue, entry);
  if (id) await compoundRecord(id);
  if (!state.selection.has(residue.key) || state.selection.size !== 1) {
    state.selection = new Set([residue.key]);
    onSelectionChanged();
  }
  renderLigandCard();
  const card = compoundCard(residue, entry);
  const facts = [card.formula, card.weight !== null ? `${card.weight.toFixed(2)} g/mol` : ''].filter(Boolean).join(', ');
  return { message: `${card.name}${card.id ? ` (${card.id})` : ''}: ${facts}.`, data: card };
}

// The ligand a command names, or the one shown in the card, or the largest in the structure.
function resolveLigand(selection) {
  const model = activeModel();
  const isLigand = (residue) => residue && (residue.kind === 'ligand' || residue.kind === 'ion');
  if (selection) {
    const resolved = requireSelection(selection, [state.active]);
    const keys = resolved.results.find((result) => result.entry === state.active)?.keys ?? new Set();
    const residue = [...keys].map((key) => model.residueMap.get(key)).find(isLigand);
    if (!residue) throw new CommandError(`"${selection}" matches no ligand in ${state.active.name}.`);
    return residue;
  }
  const shown = ligandCardResidue();
  if (shown) return shown;
  const largest = model.residues.filter((residue) => residue.kind === 'ligand').sort((a, b) => b.atoms.length - a.atoms.length)[0];
  if (!largest) throw new CommandError(`${state.active.name} has no ligands.`);
  return largest;
}

function diagramResidueLabel(residue, chains) {
  if (!residue) return '?';
  if (residue.kind === 'water') return `HOH ${residue.resSeq}`;
  if (residue.kind === 'ion') return `${elementSymbol(residue.atoms[0]?.element ?? residue.resName)}${chains ? ` ${residue.chain}` : ''}`;
  const name = residue.kind === 'protein' ? elementSymbol(residue.resName) : residue.resName;
  return `${name}${residue.resSeq}${residue.iCode || ''}${chains ? ` ${residue.chain}` : ''}`;
}

// The diagram of a ligand with the interactions the Interactions card lists for it, turned to
// match the view.
async function buildLigandDiagram(residue, options = {}) {
  const entry = state.active;
  const model = activeModel();
  const heavy = residue.atoms.filter((atom) => !atom.isHydrogen);
  if (heavy.length < 2) throw new CommandError(`${residueLabel(residue)} has fewer than two heavy atoms; there is nothing to draw.`);
  if (!(state.focus?.residues.size === 1 && state.focus.residues.has(residue.key))) await focusResidues([residue.key]);
  lazyModules.diagram ??= await import('./lib/ligand-diagram.js');
  const local = new Map(heavy.map((atom, index) => [atom.id, index]));
  // Heme's Fe–N bonds and the like are drawn as coordination, not as covalent bonds.
  const bonds = (model.bonds ?? []).filter((bond) => (bond.kind === 'covalent' || bond.kind === 'metal') && local.has(bond.a) && local.has(bond.b))
    .map((bond) => ({ a: local.get(bond.a), b: local.get(bond.b), order: bond.order ?? 1, aromatic: Boolean(bond.aromatic), coordination: bond.kind === 'metal' }));
  // The title uses the ligand's common name, when the dictionary answers in time.
  const code = compoundCode(residue, entry);
  if (code) await Promise.race([compoundRecord(code), new Promise((resolve) => setTimeout(resolve, 4000))]);
  const view = currentView();
  const width = els.canvas.clientWidth;
  const height = els.canvas.clientHeight;
  const onScreen = (position) => {
    const screen = position ? projectToScreen(view, position, width, height) : null;
    return screen ? [screen.x, screen.y] : null;
  };
  let reference = heavy.map((atom) => onScreen(point(atom)));
  if (reference.some((item) => !item)) reference = null;
  const chains = new Set(model.residues.filter((item) => item.kind === 'protein' || item.kind === 'nucleic').map((item) => item.chain)).size > 1;
  const contacts = [];
  for (const item of state.interactions.list) {
    if (item.residueA !== residue.key || !state.interactions.enabled.has(item.type)) continue;
    const ids = item.atomA >= 0 ? [item.atomA] : item.details?.atomsA ?? [];
    const atoms = ids.map((id) => local.get(id)).filter((index) => index !== undefined);
    if (!atoms.length) continue;
    const partner = model.residueMap.get(item.residueB);
    const water = item.type === 'water-bridge' ? model.residueMap.get(item.details?.waterResidue) : null;
    contacts.push({
      type: item.type,
      atoms,
      point: onScreen(item.pointB),
      distance: item.distance,
      residue: { key: item.residueB, label: diagramResidueLabel(partner, chains) },
      water: water ? { key: water.key, label: diagramResidueLabel(water, false), point: onScreen(item.details.waterPoint) } : null,
    });
  }
  const types = DIAGRAM_PRECEDENCE.map((id) => state.interactionTypes.find((type) => type.id === id)).filter(Boolean);
  const card = compoundCard(residue, entry);
  const diagram = lazyModules.diagram.ligandDiagram({
    title: `${card.name}${card.id && card.id !== card.name ? ` (${card.id})` : ''}`,
    subtitle: `${entry.structure.meta.code || entry.name} · ${residueLabel(residue)} · ${contacts.length} interaction${contacts.length === 1 ? '' : 's'}`,
    atoms: heavy.map((atom) => ({ element: atom.element, name: atom.name, charge: atom.charge ?? 0, hydrogens: atom.hydrogens, aromatic: atom.aromatic, x: atom.x, y: atom.y, z: atom.z })),
    bonds,
    reference,
    contacts,
    types,
    atomNames: Boolean(options.names),
  });
  return { ...diagram, residue, card, contacts: contacts.length, fileName: `${fileStem()}-${residue.resName.toLowerCase()}-${residue.chain}${residue.resSeq}-diagram` };
}

async function diagramImage(diagram, scaleFactor = 2) {
  const url = URL.createObjectURL(new Blob([diagram.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The diagram could not be drawn as an image.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(diagram.width * scaleFactor);
    canvas.height = Math.ceil(diagram.height * scaleFactor);
    const context = canvas.getContext('2d');
    context.scale(scaleFactor, scaleFactor);
    context.drawImage(image, 0, 0, diagram.width, diagram.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openLigandDiagram(residue, options = {}) {
  const diagram = await buildLigandDiagram(residue, { names: options.names ?? els.diagramNames.checked });
  state.diagram = diagram;
  els.diagramNames.checked = Boolean(options.names ?? els.diagramNames.checked);
  els.diagramTitle.textContent = `${diagram.card.name}: interaction diagram`;
  els.diagramView.innerHTML = diagram.svg;
  const notes = [];
  if (!diagram.contacts) notes.push('No interactions are listed for this ligand; the diagram shows the ligand alone.');
  if (diagram.method === 'projection') notes.push('Drawn from the ligand\'s own 3D shape, projected onto its plane, because a flat layout overlapped more.');
  if (diagram.approximate) notes.push('Some atoms overlap in 2D: bridged and caged ligands cannot always be drawn flat.');
  els.diagramNote.textContent = notes.join(' ');
  els.diagramNote.hidden = !notes.length;
  if (!els.diagramDialog.open) els.diagramDialog.showModal();
  return diagram;
}

// "diagram [<selection>] [names]": opens the diagram, or returns it (SVG and PNG) to scripts.
async function diagramCommand(parsed, options) {
  const residue = resolveLigand(parsed.selection);
  if (options.remote) {
    const diagram = await buildLigandDiagram(residue, { names: parsed.names });
    const canvas = await diagramImage(diagram, 2);
    return {
      message: `Drew ${diagram.card.name} with ${diagram.contacts} interaction${diagram.contacts === 1 ? '' : 's'} and ${diagram.residues} residue${diagram.residues === 1 ? '' : 's'}${diagram.approximate ? ' (some atoms overlap in 2D)' : ''}.`,
      data: { ligand: diagram.card.id ?? residue.resName, residue: shortResidueLabel(residue), interactions: diagram.contacts, residues: diagram.residues, layout: diagram.method, approximate: diagram.approximate, width: Math.round(diagram.width), height: Math.round(diagram.height), svg: diagram.svg, image: canvas.toDataURL('image/png') },
    };
  }
  await openLigandDiagram(residue, { names: parsed.names || undefined });
  return '';
}

function saveDiagram(format) {
  const diagram = state.diagram;
  if (!diagram) return;
  if (format === 'svg') {
    downloadText(`${diagram.fileName}.svg`, diagram.svg, 'image/svg+xml');
    return;
  }
  guardedLoad(async () => {
    const canvas = await diagramImage(diagram, 3);
    canvas.toBlob((blob) => blob && downloadBlob(`${diagram.fileName}.png`, blob), 'image/png');
  });
}

function bindLigandEvents() {
  els.ligandDiagramButton.addEventListener('click', () => {
    const residue = ligandCardResidue();
    if (residue) guardedLoad(() => openLigandDiagram(residue));
  });
  const redraw = () => {
    const residue = state.diagram ? activeModel()?.residueMap.get(state.diagram.residue.key) : null;
    if (residue) guardedLoad(() => openLigandDiagram(residue, { names: els.diagramNames.checked }));
  };
  els.diagramNames.addEventListener('change', redraw);
  els.diagramRedraw.addEventListener('click', redraw);
  els.diagramSaveSVG.addEventListener('click', () => saveDiagram('svg'));
  els.diagramSavePNG.addEventListener('click', () => saveDiagram('png'));
  els.densityPeaks.addEventListener('click', () => guardedLoad(() => findDifferencePeaks(state.active)));
}

/* ---------- Difference-map peaks ---------- */

// Peaks of the Fo-Fc map past ±3σ within reach of the model, each with its nearest atom: positive
// peaks are density the model does not explain (a missing ligand part, water, alternative
// conformation), negative ones atoms the data do not support.
const PEAK_REACH = 5;
const LIGAND_PEAK_DISTANCE = 3;
const MAX_PEAKS = 200;

async function findDifferencePeaks(entry = state.active, threshold = 3) {
  const density = entry?.density;
  if (!density) throw new CommandError('Load the map first ("map load", or Load map in the Analysis tab).');
  const channel = density.channels.find((item) => item.kind === 'fo-fc');
  if (!channel) {
    throw new CommandError(density.source.kind === 'em'
      ? 'A cryo-EM map has no difference map; difference peaks need the Fo-Fc map of an X-ray entry.'
      : 'This map has no Fo-Fc channel. Load the X-ray entry\'s maps, or open an Fo-Fc map file.');
  }
  const model = activeModelOf(entry);
  const atoms = model.atoms.filter((atom) => !atom.isHydrogen);
  if (!atoms.length) throw new CommandError('The structure has no atoms.');
  const inverse = entry.transform ? invertTransform(entry.transform) : null;
  const positions = new Float32Array(atoms.length * 3);
  atoms.forEach((atom, index) => positions.set(inverse ? transformPoint(inverse, atom.x, atom.y, atom.z) : [atom.x, atom.y, atom.z], index * 3));
  showLoading('Finding difference-map peaks');
  let raw;
  try {
    raw = density.source.type === 'server'
      ? await serverMapPeaks(entry, density, channel, positions, threshold)
      : await volumeWorker().run('peaks', { key: channel.key ?? `${entry.id}:file`, threshold });
  } finally {
    hideLoading();
  }
  if (entry.density !== density) return null;
  const grid = atomGrid(atoms, PEAK_REACH);
  const peaks = [];
  // Tiles report their own peaks in order; the list keeps the highest of all.
  raw.sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma));
  for (const item of raw) {
    // Map frame → the structure's frame (it may have been superposed).
    const position = entry.transform ? transformPoint(entry.transform, ...item.position) : item.position;
    const nearest = grid.nearest(position, PEAK_REACH);
    if (!nearest) continue;
    // Tiles overlap only at their edges; a peak found twice keeps its first (larger) copy.
    if (peaks.some((peak) => Math.hypot(peak.position[0] - position[0], peak.position[1] - position[1], peak.position[2] - position[2]) < 0.7)) continue;
    peaks.push({ position, sigma: item.sigma, atom: nearest.atom, distance: nearest.distance });
    if (peaks.length >= MAX_PEAKS) break;
  }
  density.peaks = { threshold, list: peaks, positive: peaks.filter((peak) => peak.sigma > 0).length, negative: peaks.filter((peak) => peak.sigma < 0).length };
  renderDensityPanel();
  renderLigandCard();
  return density.peaks;
}

// Atoms on a grid for nearest-atom searches within a radius.
function atomGrid(atoms, cell) {
  const cells = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const atom of atoms) {
    const key = keyOf(atom.x, atom.y, atom.z);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(atom);
  }
  return {
    nearest([x, y, z], radius) {
      let best = null;
      const [cx, cy, cz] = [x, y, z].map((value) => Math.floor(value / cell));
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const atom of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const distance = Math.hypot(atom.x - x, atom.y - y, atom.z - z);
              if (distance <= radius && (!best || distance < best.distance)) best = { atom, distance };
            }
          }
        }
      }
      return best;
    },
  };
}

// A peak in words: its height, the atom it is on or near, and a hint of what it may be.
function peakText(peak) {
  const atom = peak.atom;
  const where = `${shortAtomLabel(atom)} ${peak.distance.toFixed(1)} Å`;
  let hint;
  if (peak.sigma < 0) hint = peak.distance <= 1.2 ? 'on the atom: not supported by the data' : 'negative density';
  else if (peak.distance <= 1.2) hint = 'on the atom';
  else if (peak.distance <= 2.3) hint = 'next to the atom: unmodeled part or alternative position';
  else if (peak.distance <= 3.4 && ['N', 'O'].includes(String(atom.element).toUpperCase())) hint = 'possible water';
  else hint = 'unmodeled density';
  return { sigma: `${peak.sigma > 0 ? '+' : '−'}${Math.abs(peak.sigma).toFixed(1)}σ`, where, hint };
}

// The difference peaks within reach of a ligand, when they have been found.
function ligandPeaks(entry, residue) {
  const peaks = entry?.density?.peaks;
  if (!peaks) return null;
  const atoms = residue.atoms.filter((atom) => !atom.isHydrogen);
  const near = peaks.list.filter((peak) => atoms.some((atom) => Math.hypot(atom.x - peak.position[0], atom.y - peak.position[1], atom.z - peak.position[2]) <= LIGAND_PEAK_DISTANCE));
  return { threshold: peaks.threshold, list: near.map((peak) => ({ sigma: Number(peak.sigma.toFixed(2)), atom: peak.atom.residueKey === residue.key ? peak.atom.name : shortAtomLabel(peak.atom), distance: Number(peak.distance.toFixed(2)) })) };
}

function ligandPeakText(peaks) {
  if (!peaks.list.length) return `none past ±${peaks.threshold}σ within ${LIGAND_PEAK_DISTANCE} Å`;
  const shown = peaks.list.slice(0, 3).map((peak) => `${peak.sigma > 0 ? '+' : '−'}${Math.abs(peak.sigma).toFixed(1)}σ at ${peak.atom} (${peak.distance.toFixed(1)} Å)`);
  return `${shown.join('; ')}${peaks.list.length > 3 ? ` and ${peaks.list.length - 3} more` : ''}`;
}

function renderPeakList(entry) {
  const peaks = entry?.density?.peaks;
  els.densityPeakList.hidden = !peaks;
  if (!peaks) return;
  const shown = peaks.expanded ? peaks.list : peaks.list.slice(0, 12);
  els.densityPeakList.innerHTML = `<div>Fo-Fc peaks past ±${peaks.threshold}σ near the model: <strong>${peaks.positive}</strong> positive, <strong>${peaks.negative}</strong> negative${peaks.list.length >= MAX_PEAKS ? ` (the ${MAX_PEAKS} highest)` : ''}. Click one to go to it.</div>${shown.map((peak, index) => {
    const text = peakText(peak);
    return `<button type="button" class="peak-row" data-peak="${index}" title="${escapeHTML(`${text.sigma} ${text.where}: ${text.hint}`)}"><strong class="${peak.sigma > 0 ? 'positive' : 'negative'}">${escapeHTML(text.sigma)}</strong><span>${escapeHTML(text.where)}</span><small>${escapeHTML(text.hint)}</small></button>`;
  }).join('')}${peaks.list.length > shown.length ? `<button type="button" class="link" data-peaks-all>Show all ${peaks.list.length}</button>` : ''}`;
  for (const button of els.densityPeakList.querySelectorAll('[data-peak]')) {
    button.addEventListener('click', () => goToPeak(entry, peaks.list[Number(button.dataset.peak)]));
  }
  els.densityPeakList.querySelector('[data-peaks-all]')?.addEventListener('click', () => {
    peaks.expanded = true;
    renderPeakList(entry);
  });
}

// Frames a peak with the atoms around it, selecting the nearest residue so the map follows.
function goToPeak(entry, peak) {
  if (entry !== state.active) setActiveEntry(entry);
  const model = activeModelOf(entry);
  state.selection = new Set([peak.atom.residueKey]);
  onSelectionChanged();
  const around = model.atoms.filter((atom) => !atom.isHydrogen && Math.hypot(atom.x - peak.position[0], atom.y - peak.position[1], atom.z - peak.position[2]) <= 6);
  fitView(true, false, [...around, { x: peak.position[0], y: peak.position[1], z: peak.position[2] }]);
  markSceneDirty();
}

/* ---------- Docking poses ---------- */

// Poses from docking programs (SDF, MOL2 or PDBQT) are shown one at a time as a ligand of the
// active structure, the receptor, so focus, interactions, the selection language and exports
// treat a pose like any other ligand. Stepping to another pose swaps only the ligand's atoms.
// Residue names for the shown pose: the first the receptor does not use, so the pose's chemistry
// never replaces that of the receptor's own residues (a reference ligand named LIG, say).
const POSE_RESIDUES = ['LIG', 'LG1', 'LG2', 'LG3', 'LG4', 'LG5', 'LG6', 'LG7', 'LG8', 'LG9'];
const MOLECULE_FILE = /\.(sdf|sd|mol|mol2|pdbqt)$/i;
const FINGERPRINT_RADIUS = 9;
const MAX_FINGERPRINT_POSES = 1000;

async function openMoleculeFiles(refs) {
  const files = [];
  for (const ref of refs) files.push({ name: ref.name, text: await ref.text() });
  const { docking, receptors } = await readMoleculeFiles(files);
  // A PDBQT file of protein residues is the receptor itself.
  for (const receptor of receptors) {
    await loadStructureFromText(receptor.text, receptor.name, { source: 'Local file (PDBQT receptor)', add: state.entries.length > 0 && els.addMode.checked });
  }
  if (!docking) return;
  const host = state.active ?? await createPoseHost(docking);
  await attachPoses(host, docking);
  activateTab('structure');
  const scores = docking.columns.length ? ` Scores: ${docking.columns.slice(0, 3).map((column) => column.key).join(', ')}; click a column to sort.` : '';
  showToast(`${docking.molecules.length === 1 ? 'Opened 1 pose' : `Opened ${docking.molecules.length} poses`} in ${host.name}.${scores}`);
}

// The poses of one or more molecule files ({ name, text }), in rank order; PDBQT receptors are
// returned as PDB text.
async function readMoleculeFiles(files) {
  const molfile = await import('./lib/molfile.js');
  const molecules = [];
  const kept = [];
  const receptors = [];
  let format = '';
  for (const file of files) {
    const detected = molfile.detectMolfile(file.text, file.name);
    if (detected === 'pdbqt' && molfile.isPDBQTReceptor(file.text)) {
      receptors.push({ name: file.name.replace(/\.pdbqt$/i, '.pdb'), text: molfile.pdbqtToPDB(file.text) });
      continue;
    }
    const parsed = molfile.parseMolfile(file.text, file.name, detected);
    const stem = file.name.replace(/\.[^.]+$/, '');
    // DiffDock writes one file per pose, rank1_confidence-0.52.sdf.
    const fromName = molfile.confidenceFromName(file.name);
    parsed.molecules.forEach((molecule, index) => {
      molecule.title ||= parsed.molecules.length > 1 ? `${stem} ${index + 1}` : stem;
      molecule.file = file.name;
      molecule.fileRank = fromName?.rank ?? 0;
      if (Number.isFinite(fromName?.confidence) && !molecule.properties.has('confidence')) molecule.properties.set('confidence', String(fromName.confidence));
    });
    molecules.push(...parsed.molecules);
    kept.push(file);
    format ||= parsed.format;
  }
  if (!molecules.length) return { docking: null, receptors };
  if (molecules.every((molecule) => molecule.fileRank)) molecules.sort((a, b) => a.fileRank - b.fileRank);
  return {
    receptors,
    docking: {
      name: kept.length === 1 ? kept[0].name : `${kept.length} files`,
      format,
      files: kept,
      molecules,
      columns: molfile.scoreColumns(molecules),
      index: -1,
      fingerprints: null,
      sort: null,
    },
  };
}

// Without a receptor, the poses open in a structure of their own.
async function createPoseHost(docking, options = {}) {
  const structure = createStructure(docking.name, 'pdb');
  structure.meta.title = docking.name;
  structure.models.push(createModel(1));
  structure.baseModels = structure.models;
  return loadStructureFromText('', docking.name, { ...options, structure, source: `${formatLabel(docking.format)} poses`, origin: { type: 'molecules', name: docking.name } });
}

async function serializeDocking(docking, options) {
  if (options.link) throw new Error(`The docking poses (${docking.name}) are local files, so they cannot travel in a link. Save the session as a file instead.`);
  const files = [];
  for (const file of docking.files) files.push({ name: file.name, data: bytesToBase64(await compressText(file.text)) });
  return { encoding: 'gzip-base64', files, index: docking.index, sort: docking.sort, fingerprints: Boolean(docking.fingerprints) };
}

async function restoreDocking(entry, saved) {
  const files = [];
  for (const file of saved.files ?? []) files.push({ name: file.name, text: await decompressText(base64ToBytes(file.data)) });
  const { docking } = await readMoleculeFiles(files);
  if (!docking) return;
  docking.sort = saved.sort ?? null;
  await attachPoses(entry, docking, { index: Math.min(Math.max(0, saved.index ?? 0), docking.molecules.length - 1), focus: false });
  if (saved.fingerprints) await computePoseFingerprints(entry);
}

function formatLabel(format) {
  return { sdf: 'SDF', mol2: 'MOL2', pdbqt: 'PDBQT' }[format] ?? format.toUpperCase();
}

async function attachPoses(entry, docking, options = {}) {
  const structure = entry.structure;
  if (structure.activeAssemblyId !== ASYMMETRIC_UNIT_ID) await activateAssembly(ASYMMETRIC_UNIT_ID, entry);
  if (entry.docking) removePoseAtoms(entry);
  docking.receptorAtoms = structure.baseModels.map((model) => model.atoms.length);
  const used = new Set(structure.baseModels.flatMap((model) => model.atoms.map((atom) => atom.chain)));
  docking.chain = ['L', 'Z', 'Y', 'X', 'W', 'V', 'U', 'Q'].find((chain) => !used.has(chain)) ?? '~';
  const names = new Set(structure.baseModels.flatMap((model) => model.residues.map((residue) => String(residue.resName).toUpperCase())));
  docking.resName = POSE_RESIDUES.find((name) => !names.has(name) && !structure.components.has(name)) ?? 'LG0';
  entry.docking = docking;
  await showPose(entry, options.index ?? 0, { focus: options.focus ?? true });
}

function removePoseAtoms(entry) {
  const docking = entry.docking;
  entry.structure.baseModels.forEach((model, index) => {
    const count = docking.receptorAtoms?.[index];
    if (Number.isInteger(count) && count !== model.atoms.length) rebuildModelAtoms(model, model.atoms.slice(0, count));
  });
  if (entry.structure.components.get(docking.resName)?.isolated) entry.structure.components.delete(docking.resName);
  deriveStructure(entry.structure, { secondaryMode: state.secondaryMode });
}

function rebuildModelAtoms(model, atoms) {
  Object.assign(model, createModel(model.number));
  for (const atom of atoms) addAtomToModel(model, atom);
}

async function showPose(entry, index, options = {}) {
  const docking = entry.docking;
  const molecule = docking?.molecules[index];
  if (!molecule) return;
  const { moleculeAtoms, moleculeComponent } = await import('./lib/molfile.js');
  const structure = entry.structure;
  const poseKey = poseResidueKey(docking);
  const focused = entry === state.active && state.focus?.residues.has(poseKey);
  structure.components.set(docking.resName, moleculeComponent(molecule, docking.resName));
  structure.baseModels.forEach((model, modelIndex) => {
    const receptor = model.atoms.slice(0, docking.receptorAtoms[modelIndex]);
    const firstSerial = receptor.reduce((max, atom) => Math.max(max, atom.serial || 0), 0) + 1;
    rebuildModelAtoms(model, receptor);
    for (const atom of placedPoseAtoms(entry, moleculeAtoms(molecule, { chain: docking.chain, resName: docking.resName, firstId: model.atoms.length, firstSerial }))) addAtomToModel(model, atom);
  });
  structure.models = structure.baseModels;
  deriveStructure(structure, { secondaryMode: state.secondaryMode });
  docking.index = index;
  // Per-atom results of the previous pose no longer apply.
  entry.sasa = null;
  dropPoseMeasurements(entry, docking.receptorAtoms[0]);
  if (entry === state.active) updateStructureUI();
  markSceneDirty();
  markColorsDirty();
  if (entry.surface.kind !== 'off') refreshSurface(entry);
  if (entry !== state.active) return;
  if (options.focus || focused) await focusResidues([poseKey]);
  renderDocking();
}

// A pose's file coordinates are in the receptor's deposited frame; a superposed receptor moved.
function placedPoseAtoms(entry, atoms) {
  if (!entry.transform) return atoms;
  for (const atom of atoms) [atom.x, atom.y, atom.z] = transformPoint(entry.transform, atom.x, atom.y, atom.z);
  return atoms;
}

function poseResidueKey(docking) {
  return `${docking.chain}:1:${docking.resName}`;
}

// Measurements and pending picks on atoms of the pose, which is being replaced or removed.
function dropPoseMeasurements(entry, receptorCount) {
  const onReceptor = (item) => item.entry !== entry || item.atom.id < receptorCount;
  state.measurements = state.measurements.filter((measurement) => measurement.atoms.every(onReceptor));
  state.measurePending = state.measurePending.filter(onReceptor);
  renderMeasurements();
}

// Receptor ligands that the poses were docked over (most of their atoms within 1.5 Å of a pose):
// left out as interaction partners. Cofactors a pose binds, such as heme, stay.
function overlappedLigands(model, receptorCount, poses) {
  const overlapped = new Set();
  const byResidue = new Map();
  for (let index = 0; index < receptorCount; index += 1) {
    const atom = model.atoms[index];
    if (atom.kind !== 'ligand' || atom.isHydrogen) continue;
    if (!byResidue.has(atom.residueKey)) byResidue.set(atom.residueKey, []);
    byResidue.get(atom.residueKey).push(atom);
  }
  for (const [key, atoms] of byResidue) {
    let close = 0;
    for (const atom of atoms) {
      if (poses.some((pose) => pose.some((other) => (other.x - atom.x) ** 2 + (other.y - atom.y) ** 2 + (other.z - atom.z) ** 2 <= 2.25))) close += 1;
    }
    if (close >= Math.max(3, atoms.length * 0.25)) overlapped.add(key);
  }
  return overlapped;
}

async function clearPoses(entry = state.active) {
  if (!entry?.docking) return;
  const poseKey = poseResidueKey(entry.docking);
  if (entry === state.active && state.focus?.residues.has(poseKey)) clearFocus();
  dropPoseMeasurements(entry, entry.docking.receptorAtoms[0]);
  removePoseAtoms(entry);
  entry.docking = null;
  entry.sasa = null;
  if (entry === state.active) updateStructureUI();
  markSceneDirty();
  markColorsDirty();
  if (entry.surface.kind !== 'off') refreshSurface(entry);
}

function dockingOf(entry = state.active) {
  return entry?.docking ?? null;
}

function stepPose(delta) {
  const docking = dockingOf();
  if (!docking) return;
  const order = dockingOrder(docking);
  const position = order.indexOf(docking.index);
  const next = order[Math.max(0, Math.min(order.length - 1, position + delta))];
  if (next !== undefined && next !== docking.index) guardedLoad(() => showPose(state.active, next));
}

// Pose order in the table: the chosen score column, else the file's order (best first for
// Vina, GNINA, smina and DiffDock).
function dockingOrder(docking) {
  const order = docking.molecules.map((_, index) => index);
  const column = docking.columns.find((item) => item.key === docking.sort);
  if (!column) return order;
  const value = (index) => Number(docking.molecules[index].properties.get(column.key));
  return order.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.isFinite(x) ? -1 : Number.isFinite(y) ? 1 : a - b;
    return (column.lower ? x - y : y - x) || a - b;
  });
}

// Heavy-atom RMSD to the first pose when the atoms correspond (the same molecule written in the
// same atom order, as docking programs do), without superposition.
function poseRMSD(docking, index) {
  const first = docking.molecules[0].atoms;
  const atoms = docking.molecules[index].atoms;
  if (atoms.length !== first.length || atoms.some((atom, position) => atom.element !== first[position].element)) return NaN;
  let sum = 0;
  let count = 0;
  atoms.forEach((atom, position) => {
    if (atom.element === 'H') return;
    const other = first[position];
    sum += (atom.x - other.x) ** 2 + (atom.y - other.y) ** 2 + (atom.z - other.z) ** 2;
    count += 1;
  });
  return count ? Math.sqrt(sum / count) : NaN;
}

// Interaction fingerprints: each pose's interactions with the receptor residues within 9 Å,
// computed on a small model of that pocket so many poses stay fast.
async function computePoseFingerprints(entry = state.active) {
  const docking = dockingOf(entry);
  if (!docking) return;
  const module = await loadModule('interactions', './lib/interactions.js');
  if (!module) return;
  const { moleculeAtoms, moleculeComponent } = await import('./lib/molfile.js');
  const model = entry.structure.baseModels[0];
  const receptorCount = docking.receptorAtoms[0];
  const count = Math.min(docking.molecules.length, MAX_FINGERPRINT_POSES);
  const poses = docking.molecules.slice(0, count).map((molecule) => placedPoseAtoms(entry, moleculeAtoms(molecule, { chain: docking.chain, resName: docking.resName, firstId: 0 })));
  const overlapped = overlappedLigands(model, receptorCount, poses.map((atoms) => atoms.filter((atom) => !atom.isHydrogen)));
  const cell = FINGERPRINT_RADIUS;
  const grid = new Map();
  for (let index = 0; index < receptorCount; index += 1) {
    const atom = model.atoms[index];
    // Waters and a crystal ligand the poses were docked over are left out.
    if (atom.isWater || overlapped.has(atom.residueKey)) continue;
    const key = `${Math.floor(atom.x / cell)},${Math.floor(atom.y / cell)},${Math.floor(atom.z / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(atom);
  }
  const residueAtoms = new Map();
  for (let index = 0; index < receptorCount; index += 1) {
    const atom = model.atoms[index];
    if (!residueAtoms.has(atom.residueKey)) residueAtoms.set(atom.residueKey, []);
    residueAtoms.get(atom.residueKey).push(atom);
  }
  const results = new Array(count);
  let lastUpdate = performance.now();
  for (let pose = 0; pose < count; pose += 1) {
    const molecule = docking.molecules[pose];
    const keys = new Set();
    const limit = FINGERPRINT_RADIUS * FINGERPRINT_RADIUS;
    for (const atom of poses[pose]) {
      const gx = Math.floor(atom.x / cell);
      const gy = Math.floor(atom.y / cell);
      const gz = Math.floor(atom.z / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const other of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
              if (!keys.has(other.residueKey) && (other.x - atom.x) ** 2 + (other.y - atom.y) ** 2 + (other.z - atom.z) ** 2 <= limit) keys.add(other.residueKey);
            }
          }
        }
      }
    }
    const pocket = createModel(1);
    for (const key of keys) for (const atom of residueAtoms.get(key)) addAtomToModel(pocket, { ...atom, id: pocket.atoms.length });
    const first = pocket.atoms.length;
    for (const atom of placedPoseAtoms(entry, moleculeAtoms(molecule, { chain: docking.chain, resName: docking.resName, firstId: first }))) addAtomToModel(pocket, atom);
    deriveModel(pocket, { components: new Map([[docking.resName, moleculeComponent(molecule, docking.resName)]]), conect: [], meta: {}, secondaryRanges: [] }, { secondaryMode: 'file' });
    const list = module.findInteractions(pocket, pocket.atoms.slice(first).map((atom) => atom.id), {});
    const residues = new Map();
    const counts = {};
    for (const interaction of list) {
      counts[interaction.type] = (counts[interaction.type] ?? 0) + 1;
      const key = interaction.residueB;
      if (!key) continue;
      if (!residues.has(key)) residues.set(key, new Set());
      residues.get(key).add(interaction.type);
    }
    results[pose] = { counts, residues };
    if (performance.now() - lastUpdate > 200) {
      lastUpdate = performance.now();
      setLoading(`Interaction fingerprints · ${pose + 1} of ${count} poses`);
      await nextFrame();
    }
  }
  docking.fingerprints = results;
  renderDocking();
}

// Interaction types in the order a fingerprint cell shows them (the first present wins).
const FINGERPRINT_PRIORITY = ['salt-bridge', 'metal-coordination', 'hydrogen-bond', 'halogen-bond', 'pi-stacking', 'cation-pi', 'water-bridge', 'hydrophobic'];

function interactionSummary(counts = {}) {
  const parts = [
    counts['hydrogen-bond'] ? `${counts['hydrogen-bond']} H` : '',
    counts['salt-bridge'] ? `${counts['salt-bridge']} ionic` : '',
    (counts['pi-stacking'] ?? 0) + (counts['cation-pi'] ?? 0) ? `${(counts['pi-stacking'] ?? 0) + (counts['cation-pi'] ?? 0)} π` : '',
    counts['halogen-bond'] ? `${counts['halogen-bond']} X` : '',
    counts['metal-coordination'] ? `${counts['metal-coordination']} metal` : '',
    counts.hydrophobic ? `${counts.hydrophobic} hyd` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'none';
}

function renderDocking() {
  const entry = state.active;
  const docking = dockingOf(entry);
  els.dockingGroup.hidden = !docking;
  if (!docking) return;
  const columns = docking.columns.slice(0, 3);
  els.dockingCount.textContent = String(docking.molecules.length);
  els.dockingTitle.textContent = `${docking.name} · ${formatLabel(docking.format)} · in ${entry.name}${docking.molecules.length > 1 ? ' · click a pose, or press [ and ]' : ''}`;
  const order = dockingOrder(docking);
  const titles = new Set(docking.molecules.map((molecule) => molecule.title));
  const showTitles = titles.size > 1;
  const rmsd = docking.molecules.length > 1 && Number.isFinite(poseRMSD(docking, Math.min(1, docking.molecules.length - 1)));
  const header = `<tr><th>#</th>${showTitles ? '<th>Pose</th>' : ''}${columns.map((column) => `<th class="sortable${docking.sort === column.key ? ' is-sorted' : ''}" data-sort="${escapeHTML(column.key)}" title="${escapeHTML(column.key)} (${column.lower ? 'lower' : 'higher'} is better). Click to sort.">${escapeHTML(shortScoreName(column.key))}</th>`).join('')}${rmsd ? '<th title="Heavy-atom RMSD to pose 1 (Å), without superposition">RMSD</th>' : ''}${docking.fingerprints ? '<th>Interactions</th>' : ''}</tr>`;
  const shown = order.slice(0, 200);
  const rows = shown.map((index) => {
    const molecule = docking.molecules[index];
    const values = columns.map((column) => `<td>${scoreText(Number(molecule.properties.get(column.key)))}</td>`).join('');
    const fingerprint = docking.fingerprints?.[index];
    return `<tr class="${index === docking.index ? 'is-active' : ''}" data-pose="${index}" title="${escapeHTML(`${molecule.title} · ${molecule.formula}`)}"><td>${index + 1}</td>${showTitles ? `<td>${escapeHTML(molecule.title)}</td>` : ''}${values}${rmsd ? `<td>${scoreText(poseRMSD(docking, index), 1)}</td>` : ''}${docking.fingerprints ? `<td>${escapeHTML(fingerprint ? interactionSummary(fingerprint.counts) : '–')}</td>` : ''}</tr>`;
  }).join('');
  els.dockingPoses.innerHTML = `<table class="prediction-table"><thead>${header}</thead><tbody>${rows}</tbody></table>${order.length > shown.length ? `<p class="hint">Showing ${shown.length} of ${order.length} poses.</p>` : ''}`;
  for (const row of els.dockingPoses.querySelectorAll('[data-pose]')) {
    row.addEventListener('click', () => guardedLoad(() => showPose(entry, Number(row.dataset.pose))));
  }
  for (const cell of els.dockingPoses.querySelectorAll('[data-sort]')) {
    cell.addEventListener('click', (event) => {
      event.stopPropagation();
      docking.sort = docking.sort === cell.dataset.sort ? null : cell.dataset.sort;
      renderDocking();
    });
  }
  renderPoseDetail(entry, docking);
  renderFingerprint(entry, docking, order);
}

function shortScoreName(key) {
  const names = { 'Vina affinity': 'Vina', minimizedAffinity: 'Affinity', CNNscore: 'CNN score', CNNaffinity: 'CNN affinity', r_i_docking_score: 'Docking score', r_i_glide_gscore: 'GlideScore' };
  return names[key] ?? key;
}

function renderPoseDetail(entry, docking) {
  const molecule = docking.molecules[docking.index];
  if (!molecule) {
    els.dockingDetail.replaceChildren();
    return;
  }
  const properties = [...molecule.properties].filter(([key]) => !/^model_server/.test(key)).slice(0, 8);
  els.dockingDetail.innerHTML = `<div><strong>${escapeHTML(molecule.title)}</strong> · ${escapeHTML(molecule.formula)} · ${molecule.atoms.filter((atom) => atom.element !== 'H').length} heavy atoms${molecule.file && docking.name !== molecule.file ? ` · ${escapeHTML(molecule.file)}` : ''}</div>
    ${properties.length ? `<div class="hint">${properties.map(([key, value]) => `${escapeHTML(key)} ${escapeHTML(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`).join(' · ')}</div>` : ''}`;
}

function renderFingerprint(entry, docking, order) {
  const results = docking.fingerprints;
  if (!results) {
    els.dockingFingerprint.replaceChildren();
    return;
  }
  const frequency = new Map();
  for (const result of results) for (const key of result?.residues.keys() ?? []) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  const model = activeModelOf(entry);
  const residues = [...frequency.keys()]
    .sort((a, b) => frequency.get(b) - frequency.get(a))
    .slice(0, 36)
    .map((key) => model.residueMap.get(key))
    .filter(Boolean)
    .sort((a, b) => a.chain.localeCompare(b.chain) || a.resSeq - b.resSeq);
  const types = new Map(state.interactionTypes.map((type) => [type.id, type]));
  const poses = order.filter((index) => results[index]).slice(0, 60);
  const cell = (result, residue) => {
    const present = result.residues.get(residue.key);
    if (!present) return '<td></td>';
    const type = FINGERPRINT_PRIORITY.find((id) => present.has(id));
    return `<td style="background:${types.get(type)?.color ?? '#888'}" title="${escapeHTML([...present].map((id) => types.get(id)?.label ?? id).join(', '))}"></td>`;
  };
  els.dockingFingerprint.innerHTML = `<table class="fingerprint"><thead><tr><th></th>${residues.map((residue) => `<th title="${escapeHTML(residueLabel(residue))} · in ${frequency.get(residue.key)} of ${results.length} poses"><span>${escapeHTML(`${residue.code || residue.resName}${residue.resSeq}`)}</span></th>`).join('')}</tr></thead>
    <tbody>${poses.map((index) => `<tr data-pose="${index}" class="${index === docking.index ? 'is-active' : ''}"><th>${index + 1}</th>${residues.map((residue) => cell(results[index], residue)).join('')}</tr>`).join('')}</tbody></table>
    <p class="hint">Residues contacted in most poses; a cell shows the strongest interaction type (colors as in the Interactions card).${poses.length < results.length ? ` First ${poses.length} poses.` : ''}</p>`;
  for (const row of els.dockingFingerprint.querySelectorAll('[data-pose]')) {
    row.addEventListener('click', () => guardedLoad(() => showPose(entry, Number(row.dataset.pose))));
  }
}

function exportDockingCSV() {
  const docking = dockingOf();
  if (!docking) return;
  const header = ['pose', 'title', 'file', 'formula', ...docking.columns.map((column) => column.key), 'rmsd_to_pose_1', 'hydrogen_bonds', 'salt_bridges', 'pi_interactions', 'halogen_bonds', 'metal', 'hydrophobic', 'residues'];
  const rows = [header];
  docking.molecules.forEach((molecule, index) => {
    const result = docking.fingerprints?.[index];
    const counts = result?.counts ?? {};
    const rmsd = poseRMSD(docking, index);
    rows.push([
      index + 1, molecule.title, molecule.file ?? '', molecule.formula,
      ...docking.columns.map((column) => molecule.properties.get(column.key) ?? ''),
      Number.isFinite(rmsd) ? rmsd.toFixed(3) : '',
      ...(result ? [counts['hydrogen-bond'] ?? 0, counts['salt-bridge'] ?? 0, (counts['pi-stacking'] ?? 0) + (counts['cation-pi'] ?? 0), counts['halogen-bond'] ?? 0, counts['metal-coordination'] ?? 0, counts.hydrophobic ?? 0] : ['', '', '', '', '', '']),
      result ? [...result.residues].map(([key, types]) => `${key}(${[...types].join('+')})`).join(' ') : '',
    ]);
  });
  downloadText(`${docking.name.replace(/\.[^.]+$/, '')}_poses.csv`, csvText(rows), 'text/csv');
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

// Whether a residue is drawn: its chain is shown, and it is neither hidden nor filtered out.
function residueShown(entry, residue) {
  const { visibleChains, hiddenResidues, residueFilter } = entry.display;
  return (!visibleChains || visibleChains.has(residue.chain)) && !hiddenResidues?.has(residue.key) && (!residueFilter || residueFilter.has(residue.key));
}

function cartoonFor(entry, model) {
  const display = entry.display;
  const chains = display.visibleChains ? [...display.visibleChains].sort().join(',') : '*';
  const key = [model.number, chains, display.residueFilterKey || '*', display.overrideKey || '*', display.cartoonWidth.toFixed(2), display.cartoonQuality, state.secondaryMode].join('|');
  const cached = model.cartoonCache.get(key);
  if (cached) return cached;
  const cartoon = buildCartoon(model, {
    include: (residue) => residueShown(entry, residue),
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
  // Maps follow their structure's visibility.
  for (const entry of state.entries) if (entry.density && entry.density.shown !== entry.visible) drawDensity(entry);
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
  if (scheme === 'ppse' && entry.exposure) extras.residueValues = new Map([...entry.exposure].map(([key, value]) => [key, value.ppse]));
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
  if (scheme === 'conservation' && entry.conservation) {
    extras.residueValues = entry.conservation.grades;
    extras.conservationNote = entry.conservation.method === 'entropy' ? 'Shannon entropy' : 'Jensen–Shannon divergence (Capra & Singh 2007)';
  }
  if (scheme === 'mapfit' && entry.density?.fit) {
    extras.residueValues = entry.density.fit.values;
    extras.mapFitKind = entry.density.fit.kind;
    extras.mapFitLevel = entry.density.fit.level;
  }
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
  if (!state.drag) followDensity();
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
  const grade = entry.conservation?.grades.get(residue.key);
  if (grade) parts.push(`conservation grade ${grade} (${entry.conservation.values.get(residue.key)?.toFixed(2) ?? '–'})`);
  const fit = entry.density?.fit?.values.get(residue.key);
  if (Number.isFinite(fit)) parts.push(entry.density.fit.kind === 'sigma' ? `map ${fit.toFixed(1)}σ at atoms` : `${formatPercent(fit)} of atoms in the map`);
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
  } else if ((key === '[' || key === ']') && dockingOf()) {
    stepPose(key === ']' ? 1 : -1);
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
  // Without a focus, the map region and zone follow the selection.
  if (!state.focus) densityFocusChanged();
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
  densityFocusChanged();
  await computeFocusInteractions(valid);
}

function clearFocus() {
  state.focus = null;
  state.interactions = { ...state.interactions, list: [], title: '' };
  renderInteractions();
  markSceneDirty();
  densityFocusChanged();
}

async function computeFocusInteractions(keys) {
  const focus = state.focus;
  const module = await loadModule('interactions', './lib/interactions.js');
  if (!module?.findInteractions || state.focus !== focus) return;
  const model = activeModel();
  const focusAtoms = keys.flatMap((key) => model.residueMap.get(key)?.atoms ?? []).map((atom) => atom.id);
  // A docking pose interacts with the receptor, not with a crystal ligand it may overlap.
  const docking = dockingOf();
  const poseKey = docking ? poseResidueKey(docking) : '';
  const pose = docking && keys.includes(poseKey);
  let groupB;
  if (pose) {
    const poseAtoms = (model.residueMap.get(poseKey)?.atoms ?? []).filter((atom) => !atom.isHydrogen);
    const overlapped = overlappedLigands(model, docking.receptorAtoms[0] ?? model.atoms.length, [poseAtoms]);
    groupB = model.atoms.filter((atom) => atom.residueKey !== poseKey && !overlapped.has(atom.residueKey)).map((atom) => atom.id);
  }
  try {
    const list = module.findInteractions(model, focusAtoms, { includeWater: state.display.showWater, groupB });
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
      ppse: entry.exposure ? new Map([...entry.exposure].map(([key, value]) => [key, value.ppse])) : null,
      conservation: entry.conservation?.values ?? null,
      grade: entry.conservation?.grades ?? null,
      mapfit: entry.density?.fit?.values ?? null,
    },
    idr: entry.exposure ? new Set([...entry.exposure].filter(([, value]) => value.idr).map(([key]) => key)) : null,
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
    if (!state.structure && !['fetch', 'add', 'example', 'search', 'help'].includes(parsed.name)) throw new CommandError('Open a structure first.');
    const outcome = await executeCommand(parsed, options);
    const result = typeof outcome === 'object' && outcome ? outcome : { message: outcome ?? '' };
    // Opening views run their commands quietly and leave the history alone.
    if (options.history !== false) rememberCommand(source);
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
    case 'example': {
      if (!parsed.id) {
        return {
          message: `Examples: ${state.samples.map((sample) => sample.id).join(', ')}.`,
          data: state.samples.map((sample) => ({ id: sample.id, name: sample.name, label: sample.label ?? sample.title, category: sample.category ?? '', view: sample.view ?? [] })),
        };
      }
      const sample = findSample(parsed.id);
      if (!sample) throw new CommandError(`No bundled example "${parsed.id}". Type "example" for the list.`);
      const entry = await openSample(sample, { add: parsed.add, view: !parsed.add });
      return { message: `Opened ${entry.name}${parsed.add ? '' : `: ${sample.label ?? sample.title}`}.`, data: { name: entry.name } };
    }
    case 'assembly':
      return assemblyCommand(parsed.assembly);
    case 'evidence': {
      const entry = state.active;
      const summary = await loadEvidence(entry);
      showEvidenceCoverage(entry);
      const evidence = entry.evidence;
      return { message: `Public evidence: ${formatNumber(evidence.peptideCount)} peptides and ${formatNumber(evidence.sites.length)} modification sites on this structure.`, data: summary };
    }
    case 'exposure': {
      const entry = state.active;
      const exposure = computeExposure(entry);
      setColorScheme('ppse', [entry]);
      renderExposureResult(entry);
      renderReport();
      if (els.profileMetric.value === 'ppse') renderProfile();
      const values = [...exposure.values()];
      return `Part-sphere exposure of ${formatNumber(values.length)} residues${entry.exposureWithPAE ? ' (with PAE)' : ''}: ${pct(values.filter((value) => value.idr).length, values.length)} in disordered regions.`;
    }
    case 'search': {
      const result = await runDiscovery(parsed.query, { show: !options.remote });
      if (!result) throw new CommandError('Search is unavailable offline.');
      return result;
    }
    case 'interface':
      return interfaceCommand(parsed.chains);
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
    case 'tmalign':
      return superposeCommand({ ...parsed, method: 'structure' });
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
    case 'triage':
      return triageCommand(parsed, options);
    case 'info':
      return describeActiveStructure();
    case 'interactions':
      return interactionsCommand(parsed.selection);
    case 'compound':
      return compoundCommand(parsed.selection);
    case 'diagram':
      return diagramCommand(parsed, options);
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
      return { message: message || 'Colored by validation outliers.', data: validationSummaryRecord(entry, validationOf(entry)) };
    }
    case 'map':
      return mapCommand(parsed);
    case 'conservation':
      if (parsed.method === 'off') {
        state.active.conservation = null;
        if (state.active.color.scheme === 'conservation') setColorScheme('chain', [state.active]);
        renderConservation();
        renderProfile();
        return 'Conservation cleared.';
      }
      return computeConservation(state.active, { method: parsed.method });
    case 'pose':
      return poseCommand(parsed);
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
      // Scripts and agents get the list; people get the help dialog.
      if (options.remote) return COMMANDS.map((command) => `${command.syntax}: ${command.summary}.`).join('\n');
      els.helpDialog.showModal();
      els.helpCommands.scrollIntoView({ block: 'start' });
      return '';
    }
    default:
      throw new CommandError(`"${parsed.name}" is not available.`);
  }
}

async function assemblyCommand(id) {
  const structure = state.structure;
  const listing = () => [
    `au: asymmetric unit${structure.activeAssemblyId === ASYMMETRIC_UNIT_ID ? ' (shown)' : ''}`,
    ...structure.assemblies.map((assembly) => `${assemblyLabel(assembly, true)}${structure.activeAssemblyId === assembly.id ? ' (shown)' : ''}`),
  ].join('; ');
  if (!id) {
    if (!structure.assemblies.length) return `${state.active.name} defines no assemblies; the file is shown as deposited.`;
    return `Assemblies of ${state.active.name}: ${listing()}.`;
  }
  const wanted = /^(au|asu|asym|asymmetric|0)$/i.test(id) ? ASYMMETRIC_UNIT_ID : id;
  const assembly = structure.assemblies.find((item) => item.id === wanted);
  if (wanted !== ASYMMETRIC_UNIT_ID && !assembly) throw new CommandError(`${state.active.name} has no assembly "${id}". ${structure.assemblies.length ? `Choose: ${listing()}.` : 'It defines none.'}`);
  if (assembly?.estimatedAtoms > MAX_ASSEMBLY_ATOMS) throw new CommandError(`Assembly ${id} would have ${formatNumber(assembly.estimatedAtoms)} atoms, above the ${formatNumber(MAX_ASSEMBLY_ATOMS)} atom limit.`);
  await activateAssembly(wanted);
  if (structure.activeAssemblyId !== wanted) throw new CommandError(`Assembly ${id} could not be built.`);
  const model = activeModel();
  return wanted === ASYMMETRIC_UNIT_ID
    ? `Showing the asymmetric unit of ${state.active.name}.`
    : `Built assembly ${assemblyLabel(assembly, false)}: ${formatNumber(model.atoms.length)} atoms in ${new Set(model.atoms.map((atom) => atom.chain)).size} chains.`;
}

async function interfaceCommand([chainA, chainB]) {
  const chains = state.structure.chains.filter((chain) => chain.polymerKind).map((chain) => chain.id);
  for (const chain of [chainA, chainB]) {
    if (!chains.includes(chain)) throw new CommandError(`${state.active.name} has no polymer chain ${chain}. Polymer chains: ${chains.join(', ')}.`);
  }
  if (chainA === chainB) throw new CommandError('Choose two different chains, for example "interface A B".');
  els.interfaceA.value = chainA;
  els.interfaceB.value = chainB;
  const count = await runInterfaceAnalysis();
  if (count === undefined) throw new CommandError(`The interface between chains ${chainA} and ${chainB} could not be analyzed.`);
  const contacts = interactionRecords(state.interactions.list);
  const residues = new Set(contacts.flatMap((item) => [item.residue, item.partner]));
  return {
    message: `${count ?? 0} contacts between chains ${chainA} and ${chainB}${count ? `: ${interactionCounts(contacts)}` : ''}.`,
    data: { chains: [chainA, chainB], residues: [...residues], contacts },
  };
}

// Interactions as plain records: type, residues, atoms (or ring centroids) and distance.
function interactionRecords(list) {
  const model = activeModel();
  const labels = new Map(state.interactionTypes.map((type) => [type.id, type.label]));
  return list.map((item) => {
    const a = model.residueMap.get(item.residueA);
    const b = model.residueMap.get(item.residueB);
    return {
      type: item.type,
      label: labels.get(item.type) ?? item.type,
      residue: a ? shortResidueLabel(a) : null,
      atom: model.atoms[item.atomA]?.name ?? 'centroid',
      partner: b ? shortResidueLabel(b) : null,
      partnerAtom: model.atoms[item.atomB]?.name ?? 'centroid',
      distance: Number.isFinite(item.distance) ? Number(item.distance.toFixed(2)) : null,
    };
  });
}

function interactionCounts(records) {
  const counts = new Map();
  for (const item of records) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  return [...counts].map(([label, count]) => `${count} ${label.toLowerCase()}`).join(', ');
}

// "interactions <selection>": focuses the residues (as a double-click does) and lists what
// the interaction panel shows.
async function interactionsCommand(selection) {
  const resolved = requireSelection(selection);
  const target = resolved.results.find((result) => result.entry === state.active) ?? resolved.results[0];
  if (target.keys.size > 400) throw new CommandError(`"${selection}" matches ${formatNumber(target.keys.size)} residues; focus a ligand or a few residues, or use "interface <chain> <chain>" for a whole interface.`);
  setActiveEntry(target.entry);
  await focusResidues([...target.keys]);
  const records = interactionRecords(state.interactions.list);
  const model = activeModel();
  const residues = [...target.keys].map((key) => model.residueMap.get(key)).filter(Boolean).map(shortResidueLabel);
  return {
    message: `${records.length} interaction${records.length === 1 ? '' : 's'} of ${state.interactions.title || residues.join(', ')}${records.length ? `: ${interactionCounts(records)}` : ''}.`,
    data: { residues, interactions: records },
  };
}

// "info": what a reader of the Structure tab would learn about the active structure.
function describeActiveStructure() {
  const entry = state.active;
  const structure = entry.structure;
  const meta = structure.meta;
  const model = activeModelOf(entry);
  const polymer = (residue) => residue.kind === 'protein' || residue.kind === 'nucleic';
  const chains = structure.chains.filter((chain) => chain.polymerKind).map((chain) => {
    const sequence = structure.sequences?.get(chain.id);
    return {
      id: chain.id,
      kind: chain.polymerKind,
      molecule: chain.description || null,
      modeledResidues: model.residues.filter((residue) => residue.chain === chain.id && polymer(residue)).length,
      sequenceLength: sequence?.sequence?.length ?? null,
      uniprot: sequence?.uniprot?.find((segment) => segment.accession)?.accession ?? null,
    };
  });
  const ligands = model.residues.filter((residue) => residue.kind === 'ligand' || residue.kind === 'ion').slice(0, 200).map((residue) => ({
    residue: shortResidueLabel(residue),
    name: structure.componentNames?.get(residue.resName) ?? null,
    atoms: residue.atoms.filter((atom) => !atom.isHydrogen).length,
  }));
  const plddts = meta.isPredicted ? model.residues.filter(polymer).map((residue) => residue.confidence).filter(Number.isFinite) : [];
  const set = predictionSetOf(entry);
  const predicted = predictionModelOf(entry);
  const mapped = validationOf(entry);
  const resolution = parseFloat(meta.resolution);
  const data = {
    name: entry.name,
    title: meta.title || null,
    source: entry.origin?.type === 'fetch' ? `fetched ${entry.fetchId}` : entry.origin?.type === 'sample' ? 'bundled example' : entry.origin?.type ? `${entry.origin.type}${entry.origin.name ? ` ${entry.origin.name}` : ''}` : null,
    method: meta.isPredicted && !meta.method ? 'predicted model' : meta.method || null,
    resolution: Number.isFinite(resolution) ? resolution : null,
    rFree: meta.rFree ? Number(meta.rFree) : null,
    organism: meta.organism || null,
    depositionDate: meta.depositionDate || null,
    predicted: Boolean(meta.isPredicted),
    meanPlddt: plddts.length ? Number((plddts.reduce((sum, value) => sum + value, 0) / plddts.length).toFixed(1)) : null,
    atoms: model.atoms.length,
    models: structure.models.length,
    chains,
    ligands,
    prediction: set && predicted ? {
      tool: set.toolLabel,
      job: set.name,
      model: predicted.label,
      rank: predicted.rank,
      rankingScore: predicted.scores?.rankingScore ?? null,
      ptm: predicted.scores?.ptm ?? null,
      iptm: predicted.scores?.iptm ?? null,
      interfaces: (predicted.metrics?.pairs ?? []).map((pair) => ({ chains: [pair.chainA, pair.chainB], ipsae: pair.ipsae, pdockq: pair.pdockq, pdockq2: pair.pdockq2, lis: pair.lis, contacts: pair.contacts })),
    } : null,
    comparison: entry.comparison ? { reference: entryById(entry.comparison.referenceId)?.name ?? null, ...entry.comparison.stats } : null,
    validation: mapped ? validationSummaryRecord(entry, mapped) : null,
    scene: state.entries.map((item, index) => ({ index: index + 1, name: item.name, active: item === entry, visible: item.visible })),
  };
  const method = data.method ? `${data.method}${data.resolution ? `, ${data.resolution.toFixed(2)} Å` : ''}` : 'unknown method';
  return {
    message: `${entry.name}${data.title ? `: ${data.title}` : ''} (${method}${data.meanPlddt ? `, mean pLDDT ${data.meanPlddt}` : ''}); ${chains.length} polymer chain${chains.length === 1 ? '' : 's'}, ${ligands.length} ligand${ligands.length === 1 ? '' : 's'} and ions.`,
    data,
  };
}

// The validation report's summary, ligands and worst residues, for scripts and agents.
function validationSummaryRecord(entry, mapped) {
  const model = activeModelOf(entry);
  const residues = [...mapped.residues].map(([key, record]) => ({ record, residue: model.residueMap.get(key) })).filter((item) => item.residue);
  const number = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
  return {
    entry: entry.validation.code,
    metrics: mapped.summary.metrics.map((metric) => ({ label: metric.label, value: metric.value, unit: metric.unit || null, percentile: number(metric.absolute, 0) })),
    outlierResidues: mapped.outlierKeys.size,
    clashes: mapped.clashes.length,
    ligands: residues.filter((item) => item.residue.kind === 'ligand').slice(0, 50).map((item) => ({ residue: shortResidueLabel(item.residue), rscc: number(item.record.rscc, 3), rsrz: number(item.record.rsrz, 2), qscore: number(item.record.qscore, 3), outliers: item.record.criteria })),
    worst: residues.filter((item) => item.record.criteria.length).sort((a, b) => b.record.criteria.length - a.record.criteria.length || (b.record.rsrz || 0) - (a.record.rsrz || 0)).slice(0, 25).map((item) => ({ residue: shortResidueLabel(item.residue), outliers: item.record.criteria })),
  };
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

async function superposeCommand({ mobile, reference, fit, method }) {
  const all = ['all', '*'].includes(mobile.toLowerCase());
  const fixed = reference ? requireEntry(reference) : null;
  const moving = all ? null : requireEntry(mobile);
  const referenceEntry = fixed ?? (moving === state.active ? state.entries.find((entry) => entry !== moving) : state.active);
  const mobiles = all ? state.entries.filter((entry) => entry !== referenceEntry) : [moving];
  if (!referenceEntry || !mobiles.length || mobiles.includes(referenceEntry)) throw new CommandError('Superposition needs two different structures, for example "superpose 1AKE onto 4AKE".');
  if (method === 'structure' && fit) throw new CommandError('A structure alignment (TM-align) chooses its own residue pairs; "fit" works with sequence superposition.');
  const fitKeys = fit ? requireSelection(fit, [referenceEntry]).results[0].keys : null;
  const results = method === 'structure'
    ? await runStructuralSuperposition({ reference: referenceEntry, mobiles })
    : runSuperposition({ reference: referenceEntry, mobiles, fitKeys });
  const lines = results.map((item) => (item.error
    ? `${item.mobile.name}: ${item.error.message}`
    : method === 'structure'
      ? `${item.mobile.name} onto ${referenceEntry.name} (TM-align): TM-score ${item.result.stats.tmScore.toFixed(3)} (reference) / ${item.result.stats.tmScoreMobile.toFixed(3)} (moving), ${item.result.stats.rmsd.toFixed(2)} Å over ${item.result.stats.alignedLength} aligned residues`
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
    const result = request.files ? await openRemoteFiles(request.files, request.add) : await runCommand(request.command, { remote: true, returnImage: true });
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

// Files a script named by path (POST /api/remote/open, or the MCP server's open_files). The
// reply says what opened; for several prediction jobs, how they rank.
async function openRemoteFiles(files, add) {
  const before = new Set(state.entries.map((entry) => entry.id));
  const setsBefore = new Set(state.predictionSets.map((set) => set.id));
  try {
    await openFiles(files.map(urlRef), { add: Boolean(add), rethrow: true, table: false });
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
  const opened = state.entries.filter((entry) => !before.has(entry.id));
  const sets = state.predictionSets.filter((set) => !setsBefore.has(set.id));
  const data = {
    structures: opened.map((entry) => ({ name: entry.name, atoms: activeModelOf(entry).atoms.length, chains: entry.structure.chains.filter((chain) => chain.polymerKind).map((chain) => chain.id) })),
    predictionJobs: sets.map((set) => ({ job: set.name, tool: set.toolLabel, models: set.models.length })),
  };
  if (sets.length > 1) {
    // The ranking of the jobs just opened, whatever else is open.
    const rows = triageRows(sets, { crosslinks: crosslinkCounter() });
    const metric = defaultTriageMetric(rows);
    data.triage = { metric, rows: triageRecords(rankTriage(rows, { metric }).slice(0, 20)) };
  }
  if (!opened.length && !sets.length) {
    // PAE matrices, alignments, maps and tables annotate the active structure.
    if (!state.active) return { ok: false, message: `Nothing in ${files.length} file${files.length === 1 ? '' : 's'} could be opened.` };
    return { ok: true, message: `Opened ${files.length} file${files.length === 1 ? '' : 's'} into ${state.active.name}.`, data };
  }
  const models = sets.reduce((sum, set) => sum + set.models.length, 0);
  const message = sets.length > 1
    ? `Opened ${sets.length} prediction jobs (${formatNumber(models)} models) and ranked them by ${triageMetricLabel(data.triage.metric)}; the best, ${data.triage.rows[0]?.job ?? ''}, is shown.`
    : `Opened ${opened.map((entry) => entry.name).join(', ')}.`;
  return { ok: true, message, data };
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
  // A quiet superposition (the triage gallery's) only moves the structures.
  if (options.quiet) return results;
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

// Structure-only superposition (TM-align for single chains, MM-align for complexes, in the worker):
// for remote homologs, different complexes or models whose sequences differ.
async function structuralComparison(reference, mobile, recipe) {
  const strip = ({ id, kind, coords, sequence }) => ({ id, kind, coords, sequence });
  const referenceChains = alignerChains(activeModelOf(reference), recipe.refChains).map(strip);
  const mobileChains = alignerChains(activeModelOf(mobile), recipe.mobChains).map(strip);
  if (!referenceChains.length || !mobileChains.length) throw new Error('A structure alignment needs a polymer chain of at least three residues on each side.');
  const structural = await alignWorker().run('structure-align', { mobile: mobileChains, reference: referenceChains });
  return compareStructures(pairOf(reference), pairOf(mobile), { ...recipe, correspondence: 'structure', structural });
}

async function runStructuralSuperposition(options = {}) {
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
  const results = [];
  showLoading('Aligning by structure (TM-align)');
  try {
    for (const mobile of mobiles) {
      try {
        const recipe = {
          correspondence: 'structure',
          refChains: refChain !== '*' ? [refChain] : null,
          mobChains: mobChain !== '*' && mobiles.length === 1 ? [mobChain] : null,
        };
        const result = await structuralComparison(reference, mobile, recipe);
        applyComparison(reference, mobile, result, recipe);
        results.push({ mobile, result });
      } catch (error) {
        console.warn(error);
        results.push({ mobile, error });
      }
    }
  } finally {
    hideLoading();
  }
  const predicted = results.filter((item) => item.result && stylePredictedComparison(reference, item.mobile));
  renderCompareResult(reference, results, { structural: true, note: predicted.length ? 'Experimental structure in gray, predicted model colored by pLDDT.' : '' });
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
    model.geometryVersion = (model.geometryVersion ?? 0) + 1;
  }
  const combined = entry.transform ? composeTransforms(transform, entry.transform) : { rotation: [...transform.rotation], translation: [...transform.translation] };
  entry.transform = isIdentityTransform(combined, 1e-7) ? null : combined;
  entry.transformVersion += 1;
  if (entry.density) drawDensity(entry);
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
      ? `${stats.correspondence === 'structure' ? 'TM-align · ' : ''}chains ${result.chainPairs.map((pair) => (pair.ref === pair.mob ? pair.ref : `${pair.ref}↔${pair.mob}`)).join(', ')}`
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
        ${stats.correspondence === 'structure' ? `<div title="TM-align's RMSD over its aligned residues"><dt>RMSD</dt><dd>${stats.rmsd.toFixed(2)} Å <small>${stats.alignedLength} aligned</small></dd></div>
        <div title="TM-score normalized by the reference and by the moving structure; above 0.5 usually means the same fold"><dt>TM-score</dt><dd>${stats.tmScore.toFixed(3)} <small>/ ${stats.tmScoreMobile.toFixed(3)} moving</small></dd></div>`
    : `<div><dt>RMSD</dt><dd>${stats.rmsd.toFixed(2)} Å <small>${stats.keptCount} of ${stats.fitCount} pairs</small></dd></div>
        <div><dt>All pairs</dt><dd>${stats.rmsdAll.toFixed(2)} Å <small>${stats.pairCount} pairs</small></dd></div>
        <div><dt>TM-score</dt><dd>${Number.isFinite(stats.tmScore) ? stats.tmScore.toFixed(3) : 'n/a'}</dd></div>`}
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
    <p class="hint">${options.note ? `${escapeHTML(options.note)} ` : ''}${options.structural
    ? 'Residues paired by structure alone (TM-align; MM-align for complexes), superposed to maximize the TM-score. lDDT compares local distances within 15 Å and needs no superposition. Hover a residue to see its deviation.'
    : `RMSD over Cα pairs kept after pruning pairs more than 2 Å apart${options.fitOnSelection ? ', fitted on the selected residues only' : ''}. TM-score is normalized by the reference length; lDDT compares local distances within 15 Å and needs no superposition. Hover a residue to see its deviation.`}</p>` : ''}`;
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
    let model = state.entries.find((entry) => (entry.fetchId === accession || (entry.origin?.type === 'sample' && findSample(entry.origin.id)?.accession === accession)) && entry !== reference) ?? null;
    // A bundled AlphaFold model (p53) is used as is, which also works offline.
    const bundled = model ? null : state.samples.find((sample) => sample.accession === accession);
    if (bundled) model = await openSample(bundled, { add: true, activate: false, select: false });
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
      model.geometryVersion = (model.geometryVersion ?? 0) + 1;
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

/* ---------- Methods and provenance ---------- */

// What the session used, for provenance.js: each structure's source with its IDs, versions and
// revision date, and the analyses that ran on it with their parameters.
function methodsContext() {
  return {
    version: state.startup?.version ?? '',
    entries: state.entries.map((entry) => {
      const meta = entry.structure.meta;
      const origin = entry.origin ?? {};
      const accession = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/;
      let source = 'file';
      if (entry.prediction) source = 'prediction';
      else if (origin.type === 'fetch') source = accession.test(String(origin.id).toUpperCase()) ? 'afdb' : 'pdb';
      else if (origin.type === 'sample') source = meta.isPredicted ? 'afdb' : 'example';
      else if (origin.type === 'model') source = 'model';
      else if (origin.type === 'molecules') source = 'poses';
      const label = entry.structure.label ?? '';
      const model = activeModelOf(entry);
      const comparison = entry.comparison;
      const density = entry.density;
      return {
        name: entry.name,
        code: source === 'afdb' ? (label.match(/AF-[A-Z0-9]+-F\d+/)?.[0] ?? meta.code ?? entry.name) : meta.code || entry.name,
        source,
        tool: predictionSetOf(entry)?.toolLabel ?? '',
        method: meta.method,
        resolution: meta.resolution ? meta.resolution.replace(' Angstroms', ' Å') : '',
        revisionDate: meta.revisionDate ?? '',
        afdbVersion: label.match(/model_(v\d+)/)?.[1] ?? '',
        uniprot: Boolean(entry.missense || entry.report || entry.evidence) && entry.structure.uniprotSegments?.length > 0,
        uses: {
          dssp: model.residues.some((residue) => residue.ssSource === 'DSSP'),
          chemistry: model.residues.some((residue) => residue.kind === 'ligand' && (residue.chemistry === 'file' || residue.chemistry === 'ccd')),
          interactions: Boolean(entry.focus || (entry === state.active && state.interactions.list.length) || entry.interactions?.list?.length),
          sasa: Boolean(entry.sasa),
          electrostatics: entry.surface.kind !== 'off' && entry.surface.color === 'electrostatic',
          superposition: comparison ? { method: comparison.recipe?.correspondence ?? 'sequence', complex: (comparison.chainPairs?.length ?? 0) > 1 } : null,
          prediction: Boolean(entry.prediction),
          domains: Boolean(entry.domains),
          validation: Boolean(entry.validation),
          missense: Boolean(entry.missense),
          exposure: Boolean(entry.exposure),
          evidence: Boolean(entry.evidence),
          crosslinks: entry.proteomics.crosslinks.length ? { sasd: Boolean(entry.crosslinkSet?.sasd) } : null,
          hdx: entry.hdx ? { test: entry.hdx.result?.test ?? '' } : null,
          density: density ? {
            source: density.source.type,
            kind: density.source.kind,
            id: density.source.kind === 'em' ? density.emdb : density.source.label,
            name: density.source.name ?? '',
            levels: density.channels.filter((channel) => channel.visible).map((channel) => ({
              channel: mapChannelLabel(channel),
              kind: channel.kind,
              sigma: channel.sigmaLevel,
              absolute: mapLevel(channel),
              recommended: Number.isFinite(channel.recommended) && Math.abs(mapLevel(channel) - channel.recommended) < 1e-6 * Math.max(1, Math.abs(channel.recommended)),
            })),
            fit: density.fit ? { atomInclusion: density.fit.atomInclusion } : null,
          } : null,
          conservation: entry.conservation ? { method: entry.conservation.method, summaries: entry.conservation.summaries } : null,
          report: reportMethodsFields(entry),
          docking: entry.docking ? { count: entry.docking.molecules.length, name: entry.docking.name, fingerprints: Boolean(entry.docking.fingerprints) } : null,
        },
      };
    }),
  };
}

// What a search report contributed, for the methods text; kept in sessions, which do not keep the
// report itself.
function reportMethodsFields(entry) {
  const report = entry.report;
  if (!report) return entry.reportMethods ?? null;
  const statistics = report.settings.mode === 'ratio' ? currentStatistics(report) : null;
  return {
    label: report.label,
    name: report.name,
    kind: report.kind,
    qValue: report.settings.qValue,
    localization: report.settings.localization,
    qFiltered: report.kind !== 'sites' && report.format !== 'maxquant-evidence' && report.format !== 'maxquant-peptides',
    statistics: statistics ? { ...statistics.options, adjust: statistics.adjusted.size > 0 } : null,
  };
}

function restoreReportMethods(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const statistics = saved.statistics && typeof saved.statistics === 'object' ? {
    normalize: saved.statistics.normalize === 'none' ? 'none' : 'median',
    minValid: Math.max(2, Math.round(number(saved.statistics.minValid, 2))),
    impute: Boolean(saved.statistics.impute),
    adjust: Boolean(saved.statistics.adjust),
    qLimit: number(saved.statistics.qLimit, 0.05),
  } : null;
  return {
    label: String(saved.label ?? 'Search report'),
    name: String(saved.name ?? ''),
    kind: saved.kind === 'sites' ? 'sites' : 'peptides',
    qValue: number(saved.qValue, 0.01),
    localization: number(saved.localization, 0.75),
    qFiltered: saved.qFiltered !== false,
    statistics,
  };
}

async function openMethodsDialog() {
  if (!state.entries.length) throw new Error('Open a structure first.');
  const { methodsText, formatReference, bibtex } = await import('./lib/provenance.js');
  const { text, references } = methodsText(methodsContext());
  state.methods = { text, references, bibtex: bibtex(references) };
  els.methodsText.value = text;
  document.querySelector('#methods-status').textContent = '';
  els.methodsReferences.innerHTML = references.map((key) => `<li>${escapeHTML(formatReference(key))}</li>`).join('');
  els.methodsDialog.showModal();
}

// Copies text, reporting in `target` when given (a dialog's own status line), else in a toast.
async function copyText(text, message, target = null) {
  const report = (note, warn) => (target ? (target.textContent = note) : showToast(note, warn));
  try {
    await navigator.clipboard.writeText(text);
    report(message, false);
  } catch {
    report('The clipboard is not available here; select the text and copy it.', true);
  }
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
    applicationVersion: state.startup?.version ?? '',
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
  } else if (origin.type === 'model') {
    source = { type: 'model', url: origin.url, name: entry.name };
  } else if (origin.type === 'molecules') {
    source = { type: 'molecules', name: origin.name };
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
    reportMethods: reportMethodsFields(entry),
    proteomics: {
      coverage: proteomics.coverage ? [...proteomics.coverage] : null,
      data: proteomics.data ? [...proteomics.data] : null,
      dataLabel: proteomics.dataLabel,
      sites: proteomics.sites.map((site) => ({ residue: site.residue.key, label: site.label, mismatch: Boolean(site.mismatch) })),
      crosslinks: proteomics.crosslinks.map((link) => ({ ...linkFields(link), atomA: atomRef(link.atomA), atomB: atomRef(link.atomB) })),
    },
    // Recomputed or refetched on restore rather than stored.
    sasa: Boolean(entry.sasa),
    exposure: Boolean(entry.exposure),
    validation: entry.validation ? { clashes: Boolean(entry.validation.showClashes) } : null,
    missense: entry.missense ? { accessions: entry.missense.accessions } : null,
    domains: Boolean(entry.domains),
    msa: entry.msa ? { values: [...entry.msa.values], source: entry.msa.source } : null,
    conservation: entry.conservation ? {
      values: [...entry.conservation.values].map(([key, value]) => [key, Number(value.toFixed(4))]),
      grades: [...entry.conservation.grades],
      summaries: entry.conservation.summaries,
      method: entry.conservation.method,
    } : null,
    pae: options.link ? null : await serializePAE(entry),
    prediction: entry.prediction ? predictionSessionFields(entry) : null,
    docking: entry.docking ? await serializeDocking(entry.docking, options) : null,
    density: entry.density ? densitySessionFields(entry.density) : null,
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
  const set = { id: `prediction-${state.nextPredictionId++}`, tool: saved.tool, toolLabel: saved.toolLabel, name: saved.name, models: [model], files: [], affinityResult: saved.affinity, restored: true };
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
    if (item.conservation?.grades) {
      const model = activeModelOf(entry);
      const known = (pairs) => new Map((pairs ?? []).filter(([key, value]) => model.residueMap.has(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]));
      const summaries = (item.conservation.summaries ?? []).filter((summary) => summary && typeof summary === 'object').map((summary) => ({
        source: String(summary.source ?? ''),
        chains: Array.isArray(summary.chains) ? summary.chains.map(String) : [],
        sequences: Number(summary.sequences) || 0,
        neff: Number(summary.neff) || 0,
        method: summary.method === 'entropy' ? 'entropy' : 'jsd',
      }));
      const grades = new Map([...known(item.conservation.grades)].filter(([, grade]) => Number.isInteger(grade) && grade >= 1 && grade <= 9));
      entry.conservation = { values: known(item.conservation.values), grades, summaries, method: item.conservation.method === 'entropy' ? 'entropy' : 'jsd', problems: [] };
    }
    if (item.pae) await restorePAE(entry, item.pae);
    if (item.domains && entry.pae) computePAEDomains(entry);
    if (item.sasa) await runSASA(entry);
    // After the PAE, which part-sphere exposure uses.
    if (item.exposure || entry.color.scheme === 'ppse') computeExposure(entry);
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
    if (item.density) await restoreDensity(entry, item.density, problems);
  } catch (error) {
    problems.push(`${entry.name}: ${error.message}`);
  }
}

// Maps from the volume server are fetched again with the saved settings; map files are not
// embedded in sessions and must be opened again.
function densitySessionFields(density) {
  return {
    source: density.source.type === 'server' ? { type: 'server' } : { type: 'file', name: density.source.name },
    channels: density.channels.map((channel) => ({ index: channel.index, sigmaLevel: Number(channel.sigmaLevel.toFixed(3)), visible: channel.visible })),
    style: density.style,
    opacity: density.opacity,
    region: density.region,
    radius: density.radius,
    zone: density.zone,
    fit: Boolean(density.fit),
  };
}

async function restoreDensity(entry, saved, problems) {
  if (saved.source?.type !== 'server') {
    problems.push(`${entry.name}: open the map file ${saved.source?.name ?? ''} again (map files are not stored in sessions)`);
    return;
  }
  await loadDensity(entry);
  const density = entry.density;
  for (const item of saved.channels ?? []) {
    const channel = density.channels.find((candidate) => candidate.index === item.index);
    if (!channel) continue;
    if (Number.isFinite(item.sigmaLevel) && item.sigmaLevel > 0) channel.sigmaLevel = item.sigmaLevel;
    channel.visible = item.visible !== false;
  }
  if (['mesh', 'surface'].includes(saved.style)) density.style = saved.style;
  if (Number.isFinite(saved.opacity)) density.opacity = Math.min(1, Math.max(0.05, saved.opacity));
  if (['focus', 'view', 'all'].includes(saved.region)) density.region = saved.region;
  if (Number.isFinite(saved.radius)) density.radius = Math.min(30, Math.max(4, saved.radius));
  if (Number.isFinite(saved.zone)) density.zone = Math.min(10, Math.max(0, saved.zone));
  renderDensityPanel();
  await updateDensity(entry);
  if (saved.fit) await fitDensity(entry);
}

function linkFields(link) {
  const { atomA, atomB, ...fields } = link;
  return fields;
}

// A cross-link from a session: the known fields only, with their types, because a session file or
// link can come from anyone. Distances are measured again on the model.
function restoredCrosslink(link, model) {
  if (!link || typeof link !== 'object') return null;
  const atomOf = (ref) => model.residueMap.get(String(ref?.residue))?.atomByName.get(String(ref?.atom)) ?? null;
  const atomA = atomOf(link.atomA);
  const atomB = atomOf(link.atomB);
  if (!atomA || !atomB) return null;
  const number = (value) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
  const text = (value) => (value === null || value === undefined ? null : String(value).slice(0, 200));
  const sasd = number(link.sasd);
  return {
    raw: text(link.raw) ?? '',
    proteinA: text(link.proteinA),
    residueA: number(link.residueA),
    proteinB: text(link.proteinB),
    residueB: number(link.residueB),
    score: number(link.score),
    fdr: number(link.fdr),
    count: number(link.count) ?? 1,
    atomA,
    atomB,
    residueKeyA: atomA.residueKey,
    residueKeyB: atomB.residueKey,
    distance: Math.hypot(atomA.x - atomB.x, atomA.y - atomB.y, atomA.z - atomB.z),
    sasd,
    sasdStatus: ['ok', 'buried', 'far'].includes(link.sasdStatus) ? link.sasdStatus : '',
    satisfied: Boolean(link.satisfied),
  };
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
    if (entry && item.docking) {
      try {
        await restoreDocking(entry, item.docking);
      } catch (error) {
        problems.push(`${item.name}: docking poses: ${error.message}`);
      }
    }
  }
  // Positions first, then comparisons (whose fits are then near-identity), then the rest.
  items.forEach((item, index) => {
    const entry = entries[index];
    if (entry && item.transform) applyEntryTransform(entry, item.transform);
  });
  for (const [index, item] of items.entries()) {
    const entry = entries[index];
    const reference = entries[item.comparison?.reference];
    if (!entry || !reference) continue;
    try {
      const { reference: ignored, ...recipe } = item.comparison;
      const fitKeys = recipe.fitKeys ? new Set(recipe.fitKeys) : null;
      const result = recipe.correspondence === 'structure'
        ? await structuralComparison(reference, entry, recipe)
        : compareStructures(pairOf(reference), pairOf(entry), { ...recipe, fitKeys });
      applyComparison(reference, entry, result, recipe);
      if (item.trimmed) trimToAligned(entry, true);
    } catch (error) {
      problems.push(`${item.name}: ${error.message}`);
    }
  }
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
    const sample = findSample(source.id);
    if (!sample) throw new Error(`the bundled example ${source.id} is not available`);
    return openSample(sample, { add: options.add, activate: false, select: false });
  }
  if (source?.type === 'model') {
    const entry = await openModelURL(source.url, { add: options.add, activate: false });
    if (source.name) entry.name = uniqueName(source.name);
    return entry;
  }
  if (source?.type === 'molecules') {
    return createPoseHost({ name: source.name ?? options.name ?? 'poses', format: '' }, { add: options.add, activate: false });
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
  entry.reportMethods = restoreReportMethods(item.reportMethods);
  const proteomics = item.proteomics ?? {};
  entry.proteomics = {
    ...emptyProteomics(),
    coverage: proteomics.coverage ? new Map(proteomics.coverage) : null,
    data: proteomics.data ? new Map(proteomics.data) : null,
    dataLabel: proteomics.dataLabel ?? '',
    sites: (proteomics.sites ?? []).map((site) => ({ residue: model.residueMap.get(site.residue), label: site.label, mismatch: site.mismatch })).filter((site) => site.residue),
    crosslinks: (Array.isArray(proteomics.crosslinks) ? proteomics.crosslinks : []).map((link) => restoredCrosslink(link, model)).filter(Boolean),
  };
  const overrides = new Map();
  for (const site of entry.proteomics.sites) overrides.set(site.residue.key, site.mismatch ? [1, 0.7, 0.2] : [1, 0.28, 0.72]);
  entry.proteomics.siteOverrides = overrides.size ? overrides : null;
  // The cross-link panel comes back with the links (surface distances included when computed).
  const links = entry.proteomics.crosslinks;
  if (links.length) {
    const withSASD = links.some((link) => link.sasd !== null);
    entry.crosslinkSet = { links: links.map(linkFields), info: { source: 'Saved session' }, missing: 0, maxDistance: Number(els.xlMax.value) || 30, sasd: withSASD, sasdCutoff: withSASD ? 33 : undefined };
  }
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
    const sample = findSample(entry.origin.id);
    if (sample) return (await fetch(sample.url)).text();
  }
  if (entry.origin?.type === 'fetch') {
    const request = normalizeFetchQuery(entry.origin.id);
    if (request) return (await fetch(request.url)).text();
  }
  if (entry.origin?.type === 'model') return (await fetch(`/api/fetch/model?url=${encodeURIComponent(entry.origin.url)}`)).text();
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
  const polymer = model.residues.filter((residue) => (residue.kind === 'protein' || residue.kind === 'nucleic') && residueShown(entry, residue));
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
  const ligands = model.residues.filter((residue) => (residue.kind === 'ligand' || residue.kind === 'ion') && residueShown(entry, residue) && !display.residueStyles?.has(residue.key));
  addAtomic(ligands, display.ligand === 'spacefill' ? 'spacefill' : display.ligand === 'none' ? null : 'ball-stick');
  if (display.showWater) addAtomic(model.residues.filter((residue) => residue.kind === 'water' && residueShown(entry, residue)), 'ball-stick');
  for (const style of ['sticks', 'ball-stick', 'spacefill']) {
    addAtomic(model.residues.filter((residue) => display.residueStyles?.get(residue.key) === style && residueShown(entry, residue)), style);
  }
  const focus = entry.focus?.neighborhood;
  if (focus) addAtomic(model.residues.filter((residue) => focus.has(residue.key) && residue.kind === 'protein' && !display.residueStyles?.has(residue.key) && residueShown(entry, residue)), 'sticks');
  if (entry.surface.kind !== 'off') {
    const surfaceResidues = model.residues.filter((residue) => residue.kind !== 'water' && residueShown(entry, residue) && (!entry.surface.keys || entry.surface.keys.has(residue.key)));
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

/* ---------- Find structures ---------- */

// Searches public databases through the server (search.go): proteins by gene or name (UniProt),
// entries by keyword or sequence (RCSB PDB), and every experimental structure (PDBe) and model
// (3D-Beacons) of a protein. Results open, or join the scene superposed on the active structure.

const DISCOVER_PAGE = 12;

async function getJSON(url, fallback) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseError(response, fallback));
  return response.json();
}

async function runDiscovery(text, options = {}) {
  const query = classifyQuery(text);
  if (query.kind === 'empty') {
    showToast('Type a gene, protein, UniProt accession, keywords or a sequence.', true);
    return null;
  }
  if (state.startup?.offline) {
    showToast('Searching needs network access; Proteoscope was started with --offline.', true);
    return null;
  }
  if (options.show) {
    activateTab('structure');
    els.discoverInput.value = text;
  }
  const discovery = { query: query.value, kind: query.kind, loading: true, proteins: [], protein: null, search: null, errors: [] };
  state.discovery = discovery;
  renderDiscovery();
  const organism = els.discoverOrganism.value;
  const settle = async (promise, label) => {
    try {
      return await promise;
    } catch (error) {
      discovery.errors.push(`${label}: ${error.message}`);
      return null;
    }
  };
  let kind = query.kind;
  if (kind === 'accession') {
    const [proteins] = await Promise.all([
      settle(getJSON(`/api/search/uniprot?q=${encodeURIComponent(query.value.replace(/-\d+$/, ''))}`, 'UniProt search failed'), 'UniProt'),
      showDiscoveredProtein(query.value, null, { render: false, discovery }),
    ]);
    const exact = (proteins?.results ?? []).filter((item) => item.accession === query.value.replace(/-\d+$/, ''));
    if (proteins && !exact.length) {
      // Gene symbols such as P2RY12 or B3GAT1 have the shape of an accession; when UniProt
      // answers but has no such entry, the query is searched as text.
      discovery.protein = null;
      kind = 'text';
      discovery.kind = kind;
    } else {
      discovery.proteins = exact;
    }
  }
  if (kind === 'sequence') {
    discovery.search = await settle(getJSON(`/api/search/sequence?seq=${encodeURIComponent(query.value)}`, 'Sequence search failed'), 'RCSB sequence search');
    if (discovery.search) discovery.search.label = 'Similar sequences';
  } else if (kind === 'pdb') {
    discovery.search = await settle(getJSON(`/api/search/text?q=${encodeURIComponent(query.value)}&rows=10`, 'Search failed'), 'RCSB search');
  } else if (kind === 'text') {
    const [proteins, entries] = await Promise.all([
      settle(getJSON(`/api/search/uniprot?q=${encodeURIComponent(query.value)}${organism ? `&organism=${organism}` : ''}`, 'UniProt search failed'), 'UniProt'),
      settle(getJSON(`/api/search/text?q=${encodeURIComponent(query.value)}&rows=25`, 'Search failed'), 'RCSB search'),
    ]);
    discovery.proteins = proteins?.results ?? [];
    discovery.search = entries;
    // A gene symbol that names the top protein opens that protein's structures right away.
    const top = discovery.proteins[0];
    if (top && top.gene && top.gene.toUpperCase() === query.value.toUpperCase()) await showDiscoveredProtein(top.accession, top, { render: false, discovery });
  }
  if (state.discovery !== discovery) return null;
  discovery.loading = false;
  renderDiscovery();
  const found = [
    discovery.proteins.length ? `${discovery.proteins.length} protein${discovery.proteins.length === 1 ? '' : 's'}` : '',
    discovery.protein ? `${formatNumber(discovery.protein.groups.length)} structures and ${discovery.protein.data.models.length} models of ${discovery.protein.accession}` : '',
    discovery.search ? `${formatNumber(discovery.search.total)} entries` : '',
  ].filter(Boolean);
  return {
    message: found.length ? `Found ${found.join(', ')}.` : 'Nothing found.',
    data: {
      proteins: discovery.proteins,
      structures: discovery.protein?.groups.map((group) => ({ pdb: group.pdb, chains: group.chains, method: group.method, resolution: group.resolution, coverage: group.coverage, range: [group.unpStart, group.unpEnd] })),
      models: discovery.protein?.data.models,
      entries: discovery.search?.entries,
    },
  };
}

// Lists a protein's structures and models in a search (the current one unless options.discovery
// names the search that asked, which a newer search may have replaced in the meantime).
async function showDiscoveredProtein(accession, candidate = null, options = {}) {
  const discovery = options.discovery ?? state.discovery;
  if (!discovery || state.discovery !== discovery) return;
  discovery.protein = { accession, candidate, loading: true, data: null, groups: [], sort: 'rank', shown: DISCOVER_PAGE, modelsShown: 6 };
  if (options.render !== false) renderDiscovery();
  try {
    const data = await getJSON(`/api/search/protein/${encodeURIComponent(accession)}`, 'Could not list the structures of this protein');
    if (discovery.protein?.accession !== accession) return;
    discovery.protein.data = data;
    discovery.protein.groups = groupStructures(data.structures, data.entries);
  } catch (error) {
    if (discovery.protein?.accession === accession) discovery.protein.error = error.message;
  }
  if (discovery.protein?.accession === accession) discovery.protein.loading = false;
  if (options.render !== false) renderDiscovery();
}

// The UniProt accession of the active structure: its protein chains' references, or its AlphaFold
// DB model's accession.
function activeAccession() {
  const structure = state.structure;
  if (!structure) return null;
  const chain = els.sequenceChain.value;
  const chains = [structure.sequences.get(chain), ...structure.sequences.values()].filter((info) => info?.kind === 'protein');
  for (const info of chains) {
    const reference = uniprotReference(info);
    if (reference?.accession) return reference.accession.toUpperCase();
  }
  return findSample(state.active.origin?.id)?.accession ?? null;
}

async function discoverActiveProtein() {
  const accession = activeAccession();
  if (!accession) {
    showToast(`${state.active?.name ?? 'This structure'} has no UniProt reference; search by gene or name instead.`, true);
    return null;
  }
  els.discoverInput.value = accession;
  return runDiscovery(accession);
}

async function discoverSimilarSequences() {
  const info = state.structure?.sequences.get(els.sequenceChain.value) ?? polymerSequenceChains()[0];
  const sequence = info?.kind === 'protein' ? info.sequence.replace(/[^A-Z]/g, '') : '';
  if (sequence.length < 20) {
    showToast('Choose a protein chain of at least 20 residues in the sequence panel.', true);
    return null;
  }
  // The header makes even a short chain a sequence query; the one-line field shows the sequence.
  els.discoverInput.value = sequence;
  return runDiscovery(`>${state.active.name} chain ${info.chain}\n${sequence}`);
}

function renderDiscovery() {
  const discovery = state.discovery;
  els.discoverResult.hidden = !discovery;
  if (!discovery) return;
  const parts = [];
  if (discovery.loading) parts.push(`<div class="discover-status">Searching for ${escapeHTML(discovery.kind === 'sequence' ? `a ${discovery.query.length}-residue sequence` : `“${discovery.query}”`)}…</div>`);
  for (const error of discovery.errors) parts.push(`<div class="warn">${escapeHTML(error)}</div>`);
  if (discovery.proteins.length && discovery.kind !== 'accession') {
    parts.push(`<section><h4>Proteins <small>UniProt${els.discoverOrganism.value ? ` · ${escapeHTML(els.discoverOrganism.selectedOptions[0]?.textContent ?? '')}` : ''}</small></h4><div class="discover-proteins">${discovery.proteins.slice(0, 6).map((protein) => `
      <button type="button" data-protein="${escapeHTML(protein.accession)}" class="${discovery.protein?.accession === protein.accession ? 'is-active' : ''}">
        <span><strong>${escapeHTML(protein.gene || protein.id)}</strong> ${escapeHTML(protein.name)}</span>
        <em>${escapeHTML([protein.accession, protein.organism, protein.length ? `${protein.length} aa` : '', protein.reviewed ? 'Swiss-Prot' : 'TrEMBL'].filter(Boolean).join(' · '))}</em>
      </button>`).join('')}</div></section>`);
  }
  if (discovery.protein) parts.push(discoveredProteinHTML(discovery));
  if (discovery.search) parts.push(discoveredEntriesHTML(discovery.search, discovery.kind));
  if (!discovery.loading && !discovery.proteins.length && !discovery.protein && !discovery.search?.entries?.length && !discovery.errors.length) {
    parts.push('<div class="discover-status">Nothing found. Try a gene symbol (KRAS), a protein name, a UniProt accession or other keywords.</div>');
  }
  els.discoverResult.innerHTML = parts.join('');
}

function discoveredProteinHTML(discovery) {
  const view = discovery.protein;
  const candidate = view.candidate ?? discovery.proteins.find((item) => item.accession === view.accession);
  const heading = candidate ? `${escapeHTML(candidate.name)}${candidate.gene ? ` (${escapeHTML(candidate.gene)})` : ''}` : escapeHTML(view.accession);
  const length = view.data?.length || candidate?.length || 0;
  const header = `<h4>${heading} <small>${escapeHTML([view.accession, candidate?.organism, length ? `${length} aa` : ''].filter(Boolean).join(' · '))}</small></h4>`;
  if (view.loading) return `<section>${header}<div class="discover-status">Listing structures and models…</div></section>`;
  if (view.error) return `<section>${header}<div class="warn">${escapeHTML(view.error)}</div></section>`;
  const groups = sortStructures(view.groups, view.sort);
  const chainCount = view.data.structures.length;
  const structures = groups.length
    ? `${coverageTrackHTML(view.groups, length)}
      <h4>Experimental structures <small>${formatNumber(groups.length)} entries${chainCount >= 400 ? ' among PDBe’s top 400 chains' : ''}</small>
        <select data-discover-sort aria-label="Sort structures">${Object.entries(STRUCTURE_SORTS).map(([key, sort]) => `<option value="${key}"${key === view.sort ? ' selected' : ''}>${escapeHTML(sort.label)}</option>`).join('')}</select></h4>
      <div class="discover-list">${groups.slice(0, view.shown).map((group) => structureRowHTML(group)).join('')}</div>
      ${groups.length > view.shown ? `<button type="button" class="discover-more" data-more="structures">Show ${Math.min(DISCOVER_PAGE, groups.length - view.shown)} more</button>` : ''}`
    : '<div class="discover-status">No experimental structures in the PDB.</div>';
  const models = view.data.models;
  const modelList = models.length
    ? `<h4>Models <small>3D-Beacons · ${models.length}</small></h4>
      <div class="discover-list">${models.slice(0, view.modelsShown).map((model, index) => modelRowHTML(model, index, view.accession)).join('')}</div>
      ${models.length > view.modelsShown ? `<button type="button" class="discover-more" data-more="models">Show ${models.length - view.modelsShown} more</button>` : ''}`
    : '<div class="discover-status">No models listed by 3D-Beacons.</div>';
  const problems = (view.data.problems ?? []).map((problem) => `<div class="warn">${escapeHTML(problem)}</div>`).join('');
  return `<section>${header}${problems}${structures}</section><section>${modelList}</section>`;
}

function structureRowHTML(group) {
  const summary = group.summary;
  const resolution = Number.isFinite(group.resolution) ? `${group.resolution.toFixed(2)} Å` : '';
  const range = Number.isFinite(group.unpStart) ? `${group.unpStart}–${group.unpEnd}` : '';
  const ligands = (summary?.ligands ?? []).map((ligand) => ligand.id).slice(0, 6).join(', ');
  const meta = [`chain${group.chains.length > 1 ? 's' : ''} ${group.chains.slice(0, 6).join(', ')}${group.chains.length > 6 ? '…' : ''}`, ligands, summary?.molecules?.length > 1 ? `${summary.molecules.length} molecule types` : ''].filter(Boolean).join(' · ');
  return `<div class="discover-row">
    <div class="head"><strong>${escapeHTML(group.pdb)}</strong><span>${escapeHTML([shortMethod(group.method), resolution].filter(Boolean).join(' '))}</span>${summary?.released ? `<span>${escapeHTML(summary.released.slice(0, 4))}</span>` : ''}<span title="UniProt residues covered">${escapeHTML(range)}</span></div>
    <div class="actions"><button type="button" data-open-entry="${escapeHTML(group.pdb)}">Open</button><button type="button" data-add-entry="${escapeHTML(group.pdb)}" title="Add to the scene, superposed on the active structure">Add</button></div>
    ${summary?.title ? `<div class="title" title="${escapeHTML(summary.title)}">${escapeHTML(summary.title)}</div>` : ''}
    <div class="meta" title="${escapeHTML(meta)}">${escapeHTML(meta)}</div>
  </div>`;
}

function modelRowHTML(model, index, accession) {
  const request = modelRequest(model, accession);
  const range = model.unpStart ? `${model.unpStart}–${model.unpEnd}` : '';
  const meta = [titleCase(String(model.category ?? '').toLowerCase()), model.oligomer ? titleCase(model.oligomer.toLowerCase()) : '', model.created, (model.molecules ?? []).slice(0, 3).join('; ')].filter(Boolean).join(' · ');
  const actions = request
    ? `<button type="button" data-open-model="${index}">Open</button><button type="button" data-add-model="${index}" title="Add to the scene, superposed on the active structure">Add</button>`
    : (model.page ? `<a href="${escapeHTML(model.page)}" target="_blank" rel="noopener noreferrer">Page ↗</a>` : '');
  return `<div class="discover-row">
    <div class="head"><strong>${escapeHTML(model.provider)}</strong><span>${escapeHTML(modelConfidence(model))}</span><span>${escapeHTML(range)}</span></div>
    <div class="actions">${actions}</div>
    <div class="title" title="${escapeHTML(model.id)}">${escapeHTML(model.id)}</div>
    ${meta ? `<div class="meta" title="${escapeHTML(meta)}">${escapeHTML(meta)}</div>` : ''}
  </div>`;
}

function discoveredEntriesHTML(search, kind) {
  const entries = search.entries ?? [];
  const label = search.label ?? (kind === 'pdb' ? 'Entry' : 'Entries');
  if (!entries.length) return `<section><h4>${escapeHTML(label)} <small>RCSB PDB</small></h4><div class="discover-status">No PDB entries matched.</div></section>`;
  const rows = entries.map((entry) => {
    const resolution = Number.isFinite(entry.resolution) ? `${entry.resolution.toFixed(2)} Å` : '';
    const match = entry.match ? `${Math.round(entry.match.identity * 100)}% identity · E ${entry.match.evalue.toExponential(0)} · query ${entry.match.queryFrom}–${entry.match.queryTo}` : '';
    const meta = [match, (entry.organisms ?? []).slice(0, 2).join(', '), (entry.ligands ?? []).map((ligand) => ligand.id).slice(0, 5).join(', ')].filter(Boolean).join(' · ');
    return `<div class="discover-row">
      <div class="head"><strong>${escapeHTML(entry.id)}</strong><span>${escapeHTML([shortMethod(entry.method), resolution].filter(Boolean).join(' '))}</span>${entry.released ? `<span>${escapeHTML(entry.released.slice(0, 4))}</span>` : ''}</div>
      <div class="actions"><button type="button" data-open-entry="${escapeHTML(entry.id)}">Open</button><button type="button" data-add-entry="${escapeHTML(entry.id)}" title="Add to the scene, superposed on the active structure">Add</button></div>
      ${entry.title ? `<div class="title" title="${escapeHTML(entry.title)}">${escapeHTML(entry.title)}</div>` : ''}
      ${meta ? `<div class="meta" title="${escapeHTML(meta)}">${escapeHTML(meta)}</div>` : ''}
    </div>`;
  }).join('');
  return `<section><h4>${escapeHTML(label)} <small>RCSB PDB · ${entries.length < search.total ? `${entries.length} of ${formatNumber(search.total)}` : formatNumber(search.total)}</small></h4><div class="discover-list">${rows}</div></section>`;
}

// How many entries cover each residue of the protein: darker gaps are the regions no structure has.
function coverageTrackHTML(groups, length) {
  if (!length) return '';
  const depth = coverageDepth(groups, length);
  const bands = [];
  let start = 1;
  const level = (value) => (value <= 0 ? 0 : value < 3 ? 1 : value < 10 ? 2 : value < 30 ? 3 : 4);
  for (let position = 2; position <= length + 1; position += 1) {
    if (position > length || level(depth[position]) !== level(depth[start])) {
      bands.push({ start, end: position - 1, level: level(depth[start]) });
      start = position;
    }
  }
  const opacity = [0, 0.3, 0.5, 0.75, 1];
  const rects = bands.map((band) => `<rect x="${((band.start - 1) / length) * 100}" y="0" width="${((band.end - band.start + 1) / length) * 100}" height="10" fill="${band.level ? 'var(--mint)' : 'rgba(248,245,238,0.08)'}" fill-opacity="${band.level ? opacity[band.level] : 1}"><title>${band.start}–${band.end}: ${band.level ? `${band.level === 4 ? '30 or more' : ['', '1–2', '3–9', '10–29'][band.level]} entries` : 'no structure'}</title></rect>`).join('');
  // The bar stretches to the panel width; the axis labels are HTML so they keep their shape.
  return `<div class="coverage-track"><svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="Structural coverage of residues 1 to ${length}">${rects}</svg><div class="coverage-axis"><span>1</span><span>${length}</span></div></div>`;
}

async function onDiscoveryClick(event) {
  const target = event.target.closest('button');
  if (!target || !state.discovery) return;
  const { protein, openEntry, addEntry, openModel, addModel, more } = target.dataset;
  if (protein) {
    const candidate = state.discovery.proteins.find((item) => item.accession === protein) ?? null;
    await showDiscoveredProtein(protein, candidate);
    return;
  }
  if (more) {
    const view = state.discovery.protein;
    if (more === 'structures') view.shown += DISCOVER_PAGE;
    else view.modelsShown = view.data.models.length;
    renderDiscovery();
    return;
  }
  if (openEntry || addEntry) {
    await openDiscovered({ kind: 'fetch', id: openEntry || addEntry }, { add: Boolean(addEntry) });
    return;
  }
  const index = Number(openModel ?? addModel);
  const view = state.discovery.protein;
  const model = view?.data?.models?.[index];
  const request = model ? modelRequest(model, view.accession) : null;
  if (request) await openDiscovered(request, { add: addModel !== undefined, model });
}

// Opens a search result, or adds it and superposes it on the structure that was active.
async function openDiscovered(request, options = {}) {
  const reference = options.add ? state.active : null;
  let entry = null;
  if (request.kind === 'fetch') {
    entry = await fetchStructure(request.id, { add: options.add });
  } else {
    await guardedLoad(async () => {
      entry = await openModelURL(request.url, { add: options.add, model: options.model });
    });
  }
  if (!entry || !reference || reference === entry || !state.entries.includes(reference)) return entry;
  const [result] = runSuperposition({ reference, mobiles: [entry] });
  if (result?.result) {
    const stats = result.result.stats;
    showToast(`${entry.name} superposed on ${reference.name}: ${stats.rmsd.toFixed(2)} Å over ${stats.keptCount} pairs, TM-score ${stats.tmScore.toFixed(2)}.`);
  } else {
    showToast(`${entry.name} was added; it shares no chain with ${reference.name} to superpose on.`);
  }
  return entry;
}

// A model listed by 3D-Beacons (SWISS-MODEL, ModelArchive, PED, AlphaFill …), downloaded through
// the server's allowlist.
async function openModelURL(url, options = {}) {
  const model = options.model;
  showLoading(`Downloading ${model?.provider ?? 'the'} model`);
  const response = await fetch(`/api/fetch/model?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(await responseError(response, 'Could not download the model'));
  const text = await response.text();
  const filename = response.headers.get('X-Proteoscope-Filename') || 'model.cif';
  const predicted = model ? ['TEMPLATE-BASED', 'AB-INITIO', 'DEEP-LEARNING'].includes(String(model.category ?? '').toUpperCase()) : undefined;
  const entry = await loadStructureFromText(text, filename, {
    source: model?.provider ?? 'Model',
    add: options.add,
    activate: options.activate,
    predicted,
    origin: { type: 'model', url, name: model ? `${model.provider} ${model.id}` : filename },
  });
  if (model?.id) {
    entry.name = uniqueName(model.id.length > 32 ? `${model.id.slice(0, 31)}…` : model.id);
    renderStructureList();
  }
  if (!options.add) setSampleSelection(null);
  return entry;
}

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
  renderDocking();
  renderDensityPanel();
  renderConservation();
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
    renderExposureResult();
  } else if (tab === 'proteomics') {
    renderProtParam();
    renderMissense();
    renderReport();
    renderEvidence();
    renderCrosslinks();
    renderHDX();
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
  renderLigandCard();
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
  return list.length;
}

// CSV with quoting as needed. Text that a spreadsheet would run as a formula (=, +, - or @ first,
// from a file's titles or tags) is prefixed with an apostrophe; numbers are left alone.
function csvText(rows) {
  const cellText = (cell) => {
    let text = String(cell ?? '');
    if (typeof cell !== 'number' && /^[=+\-@\t\r]/.test(text) && !Number.isFinite(Number(text))) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cellText).join(',')).join('\n');
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
  downloadText(`${fileStem()}-interactions.csv`, csvText(rows), 'text/csv');
}

/* ---------- Surfaces and SASA ---------- */

// A module worker behind a promise per request. terminate() stops a long task (its requests
// fail) and the next request starts a fresh worker.
function createWorkerClient(url, name) {
  let worker = null;
  let counter = 0;
  const pending = new Map();
  const fail = (message) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  const start = () => {
    worker = new Worker(url, { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { id, result, error } = event.data;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    worker.addEventListener('error', (event) => fail(event.message || `The ${name} failed.`));
  };
  return {
    run(type, payload, transfer = []) {
      if (!worker) start();
      counter += 1;
      const id = counter;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload }, transfer);
      });
    },
    terminate(message = `The ${name} was stopped.`) {
      worker?.terminate();
      worker = null;
      fail(message);
    },
  };
}

function surfaceWorker() {
  state.workers ??= createWorkerClient(new URL('./lib/surface-worker.js', import.meta.url), 'surface worker');
  return state.workers;
}

// Structure alignment runs in its own copy of the surface worker, so a long MM-align of large
// complexes does not hold up surfaces and SASA.
let alignWorkerClient = null;
function alignWorker() {
  alignWorkerClient ??= createWorkerClient(new URL('./lib/surface-worker.js', import.meta.url), 'alignment worker');
  return alignWorkerClient;
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
  if (metric === 'ppse') {
    if (!state.active.exposure) return { label: 'pPSE', series: [], options: { emptyText: 'Compute part-sphere exposure above' } };
    return {
      label: 'Part-sphere exposure (pPSE, 12 Å, 70°)',
      series: residues.map((residue) => ({ residue, value: state.active.exposure.get(residue.key)?.ppse ?? NaN })),
      options: { min: 0, bands: [{ from: 0, to: PPSE_EXPOSED, color: 'rgba(76,201,240,0.14)' }] },
    };
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
  if (metric === 'conservation') {
    const conservation = state.active?.conservation;
    if (!conservation) return { label: 'Conservation', series: [], options: { emptyText: 'Compute conservation above from an alignment' } };
    return { label: conservation.method === 'entropy' ? 'Conservation (1 − normalized entropy)' : 'Conservation (Jensen–Shannon divergence)', series: residues.map((residue) => ({ residue, value: conservation.values.get(residue.key) ?? NaN })), options: { min: 0 } };
  }
  if (metric === 'mapfit') {
    const fit = state.active?.density?.fit;
    if (!fit) return { label: 'Fit to the map', series: [], options: { emptyText: 'Load a density map and run Map fit above' } };
    return fit.kind === 'sigma'
      ? { label: '2Fo-Fc density at atoms (σ)', series: residues.map((residue) => ({ residue, value: fit.values.get(residue.key) ?? NaN })), options: { bands: [{ from: -99, to: 1, color: 'rgba(224,71,76,0.16)' }] } }
      : { label: 'Atom inclusion', series: residues.map((residue) => ({ residue, value: fit.values.get(residue.key) ?? NaN })), options: { min: 0, max: 1, bands: [{ from: 0, to: 0.5, color: 'rgba(224,71,76,0.16)' }] } };
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

async function loadPAEFromURL(url, entry = state.active, source = 'AlphaFold DB') {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    loadPAEFromJSON(await response.json(), source, entry);
  } catch (error) {
    console.warn('PAE fetch failed', error);
  }
}

function loadPAEFromJSON(json, source, entry = state.active) {
  if (!entry) return;
  const document0 = Array.isArray(json) ? json[0] : json;
  // AlphaFold and ColabFold, AlphaFold 3 and OpenFold3, and Protenix name the matrix differently.
  const square = flatSquare(document0?.predicted_aligned_error ?? document0?.pae ?? document0?.token_pair_pae, MISSING_PAE);
  if (!square) {
    showToast(`${source}: no square PAE matrix found (expected predicted_aligned_error, pae or token_pair_pae).`, true);
    return;
  }
  const { size, matrix: flat } = square;
  let max = 0;
  for (const value of flat) if (value > max) max = value;
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

// Reads the scores of every model, ranks them and computes interface metrics from each model's
// PAE and coordinates. The alignment is read when a model opens.
async function scorePredictionSet(set, progress = '') {
  set.id = `prediction-${state.nextPredictionId++}`;
  // Kept when its first model replaces the scene; the opener clears the mark.
  set.incoming = true;
  showLoading(`${progress}Reading ${set.toolLabel} scores for ${set.name}`);
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
  if (set.affinity) {
    try {
      set.affinityResult = parseBoltzAffinity(JSON.parse(await set.affinity.text()));
    } catch (error) {
      console.warn('Affinity not read', error);
    }
  }
  for (const [index, model] of set.models.entries()) {
    showLoading(`${progress}Scoring ${set.name}: model ${index + 1} of ${set.models.length}`);
    await nextFrame();
    try {
      await scorePredictionModel(set, model);
    } catch (error) {
      console.warn(error);
      model.problem = error.message;
    }
  }
  state.predictionSets.push(set);
}

// One prediction: its models are scored and the top-ranked one opens; others open on demand.
async function openPredictionSet(set, options = {}) {
  let entry;
  try {
    await scorePredictionSet(set);
    entry = await loadPredictionModel(set, set.models[0], { add: options.add });
  } finally {
    delete set.incoming;
  }
  hideLoading();
  const complex = set.models[0].metrics?.pairs.length;
  showToast(`Opened ${set.toolLabel} prediction ${set.name}: ${set.models.length} model${set.models.length === 1 ? '' : 's'}, ranked by ${rankingScoreLabel(set)}${complex ? '; interface scores in the Structure tab' : ''}.`);
  return entry;
}

function rankingScoreLabel(set) {
  return { af3: 'ranking score', server: 'ranking score', boltz: 'confidence score', chai: 'aggregate score', colabfold: set.models.some((model) => Number.isFinite(model.scores?.iptm)) ? '0.8·ipTM + 0.2·pTM' : 'mean pLDDT', protenix: 'ranking score', openfold3: 'sample ranking score' }[set.tool] ?? 'score';
}

async function readJSONFile(file) {
  return parsePredictionJSON(await file.text());
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
    case 'protenix':
      return parseProtenixSummary(await readJSONFile(files.summary));
    case 'openfold3':
      return parseOpenFold3Aggregated(await readJSONFile(files.summary));
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
  if (set.tool === 'protenix' && files.confidences) {
    const parsed = parseProtenixFullData(await readJSONFile(files.confidences));
    return { pae: parsed.pae, contacts: parsed.contactProbs };
  }
  if (set.tool === 'openfold3' && files.confidences) {
    if (/\.npz$/i.test(files.confidences.name)) return { pae: await readPAEArray(files.confidences) };
    return { pae: parseOpenFold3Confidences(await readJSONFile(files.confidences)).pae };
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
  // BinaryCIF was converted to mmCIF text; ColabFold, OpenFold3 and some Boltz runs write PDB.
  const fileName = model.files.structure.name.replace(/\.bcif$/i, '.cif');
  const extension = /\.(pdb|ent)$/i.test(fileName) ? '.pdb' : '.cif';
  const entry = await loadStructureFromText(text, `${set.name}_${model.id}${extension}`, { source: `${set.toolLabel} · ${model.label}`, add, predicted: true, origin: { type: 'file', name: fileName, text } });
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
  if (options.msa !== false) {
    set.msaPromise ??= readPredictionMSA(set);
    set.msa = await set.msaPromise;
    applyPredictionMSA(set, entry);
  }
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
  if (!entry.msa) {
    // An experimental structure lacks residues or has tags: align the query to the chains.
    const values = new Map();
    for (const depth of results.filter(Boolean)) {
      for (const { chain, pairs } of mapQueryToChains(entry, depth.query.replace(/-/g, ''))) {
        for (const [query, residue] of pairs) values.set(chain.residues[residue].key, depth.depth[query]);
      }
    }
    if (values.size) entry.msa = { values, source, summary: depthSummary([...values.values()]) };
  }
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
  renderTriage();
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
  // Chain-pair scores follow the chain order of the file unless the predictor names the chains.
  const reportedChains = model.scores?.chainIds ?? model.chains ?? chains;
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
  downloadText(`${set.name}_ranking.csv`, csvText(triageCSVRows([set], { crosslinks: crosslinkCounter() })), 'text/csv');
}

function crosslinkCounter() {
  const request = state.crosslinkRequest;
  return request ? (model) => crosslinkSatisfaction(model, request) : null;
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

/* ---------- Batch triage ---------- */

// Several prediction jobs at once (a design campaign, a screen of partners): every model of every
// job is scored, the best model of the best job opens, and the triage table ranks them all.
async function openPredictionBatch(sets, options = {}) {
  try {
    for (const [index, set] of sets.entries()) await scorePredictionSet(set, `Job ${index + 1} of ${sets.length} · `);
    state.triage = { ...state.triage, metric: null, pair: null, filter: '', gallery: [] };
    // The best of these jobs opens, whatever else is open.
    const best = rankTriage(triageRows(sets, { crosslinks: crosslinkCounter() }))[0];
    const target = best ? triageTarget(best) : { set: sets[0], model: sets[0].models[0] };
    const entry = await loadPredictionModel(target.set, target.model, { add: options.add });
    entry.fromTriage = true;
  } finally {
    for (const set of sets) delete set.incoming;
  }
  const { metric } = rankedTriage();
  hideLoading();
  renderTriage();
  const models = sets.reduce((sum, set) => sum + set.models.length, 0);
  showToast(`Scored ${sets.length} prediction jobs (${formatNumber(models)} models) and ranked them by ${triageMetricLabel(metric)}; the best is open.`);
  if (options.table) openTriageDialog();
}

function triageMetricLabel(id) {
  return TRIAGE_METRICS.find((metric) => metric.id === id)?.label ?? id;
}

// The rows of every opened prediction, ranked with the table's settings (or overrides).
function rankedTriage(overrides = {}) {
  const settings = { ...state.triage, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) };
  const all = triageRows(state.predictionSets, { pair: settings.pair, crosslinks: crosslinkCounter() });
  const metric = settings.metric ?? defaultTriageMetric(all);
  return { metric, settings, total: all.length, rows: rankTriage(all, { metric, level: settings.level, filter: settings.filter }) };
}

// The gallery and a model opening from the table each change the scene for a while.
function checkTriageIdle() {
  if (state.triage.busy === 'gallery') throw new CommandError('The gallery is being rendered; try again when it is done.');
  if (state.triage.busy) throw new CommandError('A model is still opening; try again in a moment.');
}

// A model restored from a session has no files to open it again once its structure is closed.
function canOpenTriageModel(set, model) {
  return !set.restored || Boolean(model.entryId && entryById(model.entryId));
}

function isActiveTriageRow(row) {
  const prediction = state.active?.prediction;
  return Boolean(prediction && prediction.setId === row.setId && prediction.modelId === row.modelId);
}

// Click, or Enter or Space from the keyboard.
function onActivate(element, action) {
  element.addEventListener('click', action);
  element.addEventListener('keydown', (event) => {
    if (event.target !== element || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    action();
  });
}

function triageTarget(row) {
  const set = state.predictionSets.find((item) => item.id === row.setId);
  return { set, model: set?.models.find((model) => model.id === row.modelId) };
}

// Opens a row's model in place of the other prediction models (other structures stay as they
// were) and frames it. Models opened earlier are let go after a while, to keep memory in check.
async function showTriageRow(row) {
  checkTriageIdle();
  const { set, model } = triageTarget(row);
  if (!set || !model) throw new CommandError('That model is no longer open; open its folder again.');
  if (!canOpenTriageModel(set, model)) throw new CommandError('That model came from a saved session and is no longer in the scene; open its prediction folder again.');
  state.triage.busy = 'model';
  let entry;
  try {
    entry = await loadPredictionModel(set, model, { add: true, showOnly: false });
  } finally {
    state.triage.busy = false;
  }
  for (const item of state.entries) if (item.prediction) item.visible = item === entry;
  if (!set.restored) entry.fromTriage = true;
  entry.lastShown = performance.now();
  setActiveEntry(entry);
  // Models the table opened are let go after six; other structures stay.
  const stale = state.entries.filter((item) => item.fromTriage && item !== entry).sort((a, b) => (b.lastShown ?? 0) - (a.lastShown ?? 0)).slice(6);
  for (const item of stale) removeEntry(item);
  renderStructureList();
  renderPrediction();
  fitView(true);
  markSceneDirty();
  return entry;
}

function triageScore(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '–';
}

const TRIAGE_COLUMNS = [
  ['ipsae', 'ipSAE', 2], ['pdockq2', 'pDockQ2', 2], ['lis', 'LIS', 2], ['iptm', 'ipTM', 2], ['plddt', 'pLDDT', 1], ['ranking', 'Score', 2],
];

function populateTriageMetrics(select, metric) {
  if (!select.options.length) {
    select.innerHTML = TRIAGE_METRICS.map((item) => `<option value="${item.id}" title="${escapeHTML(item.title)}">${escapeHTML(item.label)}</option>`).join('');
  }
  select.value = metric;
}

// The Triage group in the Structure tab: shown when more than one prediction job is open.
function renderTriage() {
  const sets = state.predictionSets;
  els.triageGroup.hidden = sets.length < 2;
  if (sets.length < 2) return;
  const { rows, metric, total } = rankedTriage({ filter: '', level: 'jobs' });
  populateTriageMetrics(els.triageMetric, metric);
  els.triageCount.textContent = String(sets.length);
  els.triageSummary.textContent = `${sets.length} jobs · ${formatNumber(total)} models · each job by its best model under ${triageMetricLabel(metric)}${state.triage.pair ? ` · chains ${state.triage.pair.join('–')}` : ''}`;
  const shown = rows.slice(0, 8);
  els.triageTop.innerHTML = `<table class="prediction-table"><thead><tr><th>#</th><th>Job</th><th>${escapeHTML(triageMetricLabel(metric))}</th></tr></thead><tbody>${shown.map((row) => `<tr class="${isActiveTriageRow(row) ? 'is-active' : ''}" tabindex="0" data-position="${row.position}" title="${escapeHTML(`${row.job} · ${row.tool} · ${row.model}`)}"><td>${row.position}</td><td>${escapeHTML(row.job)}</td><td>${triageScore(row[metric], metric === 'plddt' ? 1 : 2)}</td></tr>`).join('')}</tbody></table>${rows.length > shown.length ? `<p class="hint">…and ${rows.length - shown.length} more in the table.</p>` : ''}`;
  for (const tr of els.triageTop.querySelectorAll('[data-position]')) {
    onActivate(tr, () => guardedLoad(() => showTriageRow(rows[Number(tr.dataset.position) - 1])));
  }
  if (els.triageDialog.open) renderTriageTable();
}

function openTriageDialog() {
  if (state.predictionSets.length < 2) return;
  if (!els.triageDialog.open) els.triageDialog.showModal();
  renderTriageTable();
}

function renderTriageTable() {
  const { rows, metric, settings, total } = rankedTriage();
  populateTriageMetrics(els.triageDialogMetric, metric);
  els.triageLevel.value = settings.level;
  if (document.activeElement !== els.triagePair) els.triagePair.value = settings.pair ? settings.pair.join(' ') : '';
  if (document.activeElement !== els.triageFilter) els.triageFilter.value = settings.filter;
  const links = Boolean(state.crosslinkRequest);
  els.triageDialogSummary.textContent = `${state.predictionSets.length} jobs and ${formatNumber(total)} models, ranked by ${triageMetricLabel(metric)}${settings.pair ? ` of chains ${settings.pair.join('–')}` : ' of each model’s best interface'}.`;
  const columns = [...TRIAGE_COLUMNS, ...(links ? [['crosslinks', 'XL', 0]] : [])];
  // The metric ranked by is always a column (pDockQ and pTM are not shown otherwise).
  if (!columns.some(([id]) => id === metric)) columns.unshift([metric, triageMetricLabel(metric), 2]);
  els.triageHead.innerHTML = `<tr><th>#</th><th>Job</th><th>Tool</th><th>Model</th><th>Chains</th>${columns.map(([id, label]) => `<th data-metric="${id}" class="num${id === metric ? ' is-sorted' : ''}" tabindex="0" aria-sort="${id === metric ? 'descending' : 'none'}" title="${escapeHTML(TRIAGE_METRICS.find((item) => item.id === id)?.title ?? '')}; click to rank by it">${escapeHTML(label)}${id === metric ? ' ▾' : ''}</th>`).join('')}</tr>`;
  const limit = 500;
  els.triageBody.innerHTML = rows.slice(0, limit).map((row) => `<tr class="${isActiveTriageRow(row) ? 'is-active' : ''}" tabindex="0" data-position="${row.position}" title="${escapeHTML(row.problem ?? 'Show this model')}">
    <td>${row.position}</td><td class="job">${escapeHTML(row.job)}${row.problem ? ' <span class="warn" role="img" aria-label="Problem">⚠</span>' : ''}</td><td>${escapeHTML(row.tool)}</td><td>${escapeHTML(row.model)}${row.models > 1 ? ` <span class="hint">#${row.rank}/${row.models}</span>` : ''}</td><td>${row.chains ? escapeHTML(row.chains.join('–')) : '–'}</td>
    ${columns.map(([id, , digits]) => `<td class="num${id === metric ? ' is-sorted' : ''}">${id === 'crosslinks' ? (row.crosslinkCounts ? `${row.crosslinkCounts.satisfied}/${row.crosslinkCounts.total}` : '–') : triageScore(row[id], digits)}</td>`).join('')}</tr>`).join('');
  els.triageMore.textContent = rows.length > limit ? `Showing ${limit} of ${formatNumber(rows.length)} rows; export the CSV for all of them.` : rows.length ? '' : 'No job matches the filter.';
  for (const th of els.triageHead.querySelectorAll('[data-metric]')) {
    onActivate(th, () => {
      state.triage.metric = th.dataset.metric;
      renderTriage();
      renderTriageTable();
    });
  }
  for (const tr of els.triageBody.querySelectorAll('[data-position]')) {
    onActivate(tr, () => guardedLoad(async () => {
      await showTriageRow(rows[Number(tr.dataset.position) - 1]);
      renderTriageTable();
    }));
  }
  renderTriageGalleryGrid();
}

function renderTriageGalleryGrid() {
  const images = state.triage.gallery ?? [];
  els.triageGalleryGrid.hidden = !images.length;
  els.triageGalleryGrid.replaceChildren(...images.map((item) => {
    const figure = document.createElement('figure');
    figure.innerHTML = `<img alt="${escapeHTML(`${item.row.job}, ${item.row.model}`)}" src="${item.url}" /><figcaption><strong>#${item.row.position} ${escapeHTML(item.row.job)}</strong><br />${escapeHTML(`${item.row.model} · ${triageMetricLabel(item.metric)} ${triageScore(item.row[item.metric], item.metric === 'plddt' ? 1 : 2)}`)}</figcaption>`;
    figure.title = 'Show this model';
    figure.tabIndex = 0;
    figure.setAttribute('role', 'button');
    onActivate(figure, () => guardedLoad(async () => {
      await showTriageRow(item.row);
      renderTriageTable();
    }));
    return figure;
  }));
}

// Images of the best models, each superposed on the first so they share a view. The models are
// opened for the images and closed again; the scene is left as it was.
async function renderTriageGallery(count = 12, overrides = {}) {
  checkTriageIdle();
  const { rows, metric } = rankedTriage(overrides);
  const picks = rows.filter((row) => {
    const { set, model } = triageTarget(row);
    return set && model && canOpenTriageModel(set, model);
  }).slice(0, count);
  if (!picks.length) throw new CommandError('No prediction models can be opened; open the prediction folders again.');
  // Clicks in the table would open models in the middle of the gallery's scene.
  state.triage.busy = 'gallery';
  els.triageDialog.inert = true;
  const spinning = state.spin;
  if (spinning) setSpin(false);
  const before = new Set(state.entries.map((entry) => entry.id));
  const visibility = new Map(state.entries.map((entry) => [entry, entry.visible]));
  const previous = state.active;
  const camera = cloneCamera(state.camera);
  const exportSettings = { size: els.exportSize.value, transparent: els.exportTransparent.checked, legend: els.exportLegend.checked, labels: els.exportLabels.checked };
  const images = [];
  try {
    const opened = [];
    for (const [index, row] of picks.entries()) {
      showLoading(`Gallery: opening model ${index + 1} of ${picks.length}`);
      const { set, model } = triageTarget(row);
      opened.push(await loadPredictionModel(set, model, { add: true, showOnly: false, msa: false }));
    }
    // Models that were already in the scene keep their place.
    const mobiles = opened.slice(1).filter((entry) => !before.has(entry.id));
    if (mobiles.length) {
      try {
        runSuperposition({ reference: opened[0], mobiles, quiet: true });
      } catch (error) {
        console.warn('Gallery superposition failed', error);
      }
    }
    for (const entry of state.entries) entry.visible = entry === opened[0];
    setActiveEntry(opened[0]);
    fitView(false, true);
    els.exportSize.value = '1';
    els.exportTransparent.checked = false;
    els.exportLegend.checked = false;
    els.exportLabels.checked = false;
    for (const [index, entry] of opened.entries()) {
      showLoading(`Gallery: rendering ${index + 1} of ${opened.length}`);
      for (const item of state.entries) item.visible = item === entry;
      // Each image frames its model; superposed models share the first one's orientation. The
      // view is fitted between the panels, but the image covers the whole canvas.
      fitView(false, false, activeModelOf(entry).atoms);
      const region = viewportRegion();
      state.camera.distance *= Math.max(region.width / window.innerWidth, region.height / window.innerHeight) * 1.08;
      markSceneDirty();
      await nextFrame();
      const canvas = await renderImageCanvas();
      images.push({ row: picks[index], metric, url: thumbnailURL(canvas, 480) });
    }
  } finally {
    els.exportSize.value = exportSettings.size;
    els.exportTransparent.checked = exportSettings.transparent;
    els.exportLegend.checked = exportSettings.legend;
    els.exportLabels.checked = exportSettings.labels;
    for (const entry of state.entries.filter((item) => !before.has(item.id))) removeEntry(entry);
    for (const [entry, visible] of visibility) if (state.entries.includes(entry)) entry.visible = visible;
    if (previous && state.entries.includes(previous)) setActiveEntry(previous);
    Object.assign(state.camera, camera);
    state.cameraAnimation = null;
    if (spinning) setSpin(true);
    state.triage.busy = false;
    els.triageDialog.inert = false;
    renderStructureList();
    markSceneDirty();
    hideLoading();
  }
  state.triage.gallery = images;
  return images;
}

function thumbnailURL(canvas, width) {
  const scale = Math.min(1, width / canvas.width);
  const thumbnail = document.createElement('canvas');
  thumbnail.width = Math.round(canvas.width * scale);
  thumbnail.height = Math.round(canvas.height * scale);
  thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.toDataURL('image/jpeg', 0.85);
}

function exportTriageCSV() {
  if (!state.predictionSets.length) return;
  downloadText('prediction_triage.csv', csvText(triageCSVRows(state.predictionSets, { crosslinks: crosslinkCounter() })), 'text/csv');
}

function parseTriagePair(text) {
  const chains = String(text ?? '').trim().split(/[\s,:/–-]+/).filter(Boolean);
  if (!chains.length || /^best$/i.test(chains[0])) return null;
  return chains.length === 2 ? chains : undefined;
}

function bindTriageEvents() {
  const rerender = () => {
    renderTriage();
    renderTriageTable();
  };
  els.triageMetric.addEventListener('change', () => {
    state.triage.metric = els.triageMetric.value;
    renderTriage();
  });
  els.triageDialogMetric.addEventListener('change', () => {
    state.triage.metric = els.triageDialogMetric.value;
    rerender();
  });
  els.triageLevel.addEventListener('change', () => {
    state.triage.level = els.triageLevel.value;
    renderTriageTable();
  });
  els.triagePair.addEventListener('change', () => {
    const pair = parseTriagePair(els.triagePair.value);
    if (pair === undefined) {
      showToast('Name two chains, such as "A B", or leave the field empty for each model’s best interface.', true);
      return;
    }
    state.triage.pair = pair;
    rerender();
  });
  // Enter in a text field would submit the dialog's form, which closes it.
  for (const input of [els.triagePair, els.triageFilter]) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.dispatchEvent(new Event('change'));
    });
  }
  els.triageFilter.addEventListener('input', () => {
    state.triage.filter = els.triageFilter.value;
    renderTriageTable();
  });
  els.triageOpen.addEventListener('click', openTriageDialog);
  els.triageExport.addEventListener('click', exportTriageCSV);
  els.triageDialogExport.addEventListener('click', exportTriageCSV);
  const gallery = () => guardedLoad(async () => {
    await renderTriageGallery(12);
    openTriageDialog();
    els.triageGalleryGrid.scrollIntoView({ block: 'nearest' });
  });
  els.triageGallery.addEventListener('click', gallery);
  els.triageDialogGallery.addEventListener('click', gallery);
}

// "triage": rank the jobs (and return them to scripts), show one, render a gallery or export.
async function triageCommand(parsed, options) {
  if (!state.predictionSets.length) throw new CommandError('Open prediction folders first: drop them on the window, name them on the command line, or open them from a script.');
  if (parsed.action === 'export') {
    const rows = triageCSVRows(state.predictionSets, { crosslinks: crosslinkCounter() });
    if (options.remote) return { message: `${rows.length - 1} rows of scores.`, data: { csv: csvText(rows) } };
    exportTriageCSV();
    return '';
  }
  if (parsed.action === 'gallery') {
    const images = await renderTriageGallery(parsed.count, { filter: '' });
    if (!options.remote) openTriageDialog();
    return { message: `Rendered ${images.length} models, each superposed on the best.`, data: options.remote ? images.map((item) => ({ position: item.row.position, job: item.row.job, model: item.row.model, metric: triageMetricLabel(item.metric), score: Number.isFinite(item.row[item.metric]) ? Number(item.row[item.metric].toFixed(4)) : null, image: item.url })) : undefined };
  }
  if (parsed.action === 'show') {
    const { rows } = rankedTriage({ filter: '' });
    const row = rows[parsed.position - 1];
    if (!row) throw new CommandError(`The table has ${rows.length} rows.`);
    const entry = await showTriageRow(row);
    return { message: `Showing #${row.position}: ${row.job}, ${row.model} (${entry.name}).`, data: triageRecords([row])[0] };
  }
  if (parsed.metric) state.triage.metric = parsed.metric === 'auto' ? null : parsed.metric;
  if (parsed.level) state.triage.level = parsed.level;
  if (parsed.pair !== undefined) state.triage.pair = parsed.pair;
  // The dialog's job filter is for reading the table; commands rank every job.
  const { rows, metric, settings } = rankedTriage({ filter: '' });
  renderTriage();
  if (!options.remote && state.predictionSets.length > 1) openTriageDialog();
  const limit = parsed.limit ?? 20;
  const top = rows.slice(0, limit);
  const best = top[0];
  return {
    message: best
      ? `${rows.length} ${settings.level === 'models' ? 'models' : 'jobs'} ranked by ${triageMetricLabel(metric)}; best: ${best.job} ${best.model} (${triageScore(best[metric], metric === 'plddt' ? 1 : 2)}).`
      : 'No models to rank.',
    data: { metric, level: settings.level, pair: settings.pair, total: rows.length, rows: triageRecords(top) },
  };
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

/* ---------- Conservation ---------- */

// Conservation from a multiple sequence alignment (conservation.js: Capra & Singh's
// Jensen–Shannon divergence with ConSurf-style grades): the MSA of an opened prediction, of an
// AlphaFold DB model, or an alignment file dropped onto the structure. The alignment's query is
// aligned to each protein chain, so structures with gaps, tags or other numbering map correctly.

const ALIGNMENT_FILE = /\.(sto|stockholm|aln|clustal|afa|mfa|msa)$/i;
const MIN_CONSERVATION_SEQUENCES = 10;

async function conservationModule() {
  lazyModules.conservation ??= await import('./lib/conservation.js');
  return lazyModules.conservation;
}

// The alignments known for an entry: its prediction's MSAs (AlphaFold 3 unpaired MSA per chain,
// ColabFold .a3m, Boltz tables) or AlphaFold DB's.
async function knownAlignments(entry) {
  const set = predictionSetOf(entry);
  if (set?.tool === 'af3' && set.data) {
    const data = await readJSONFile(set.data);
    const items = [];
    for (const item of data.sequences ?? []) {
      const protein = item.protein;
      if (protein?.unpairedMsa) items.push({ text: protein.unpairedMsa, source: `${set.name}_data.json (chain ${[].concat(protein.id).join(', ')})` });
    }
    if (items.length) return items;
  }
  if (set?.msas?.length) {
    const items = [];
    for (const file of set.msas) {
      const text = await file.text();
      items.push({ text: /\.csv$/i.test(file.name) ? csvToA3M(text) : text, source: file.name });
    }
    return items;
  }
  if (entry.msaURL) {
    const response = await fetch(entry.msaURL);
    if (!response.ok) {
      const message = await responseError(response, 'AlphaFold DB did not send its MSA');
      throw new CommandError(`${message} AlphaFold DB currently refuses MSA downloads; open an alignment file (A3M, FASTA, Stockholm or Clustal) of this protein instead.`);
    }
    return [{ text: await response.text(), source: 'AlphaFold DB MSA' }];
  }
  return [];
}

async function openAlignmentFiles(refs, entry = state.active) {
  if (!entry) throw new Error('Open a structure before an alignment.');
  const alignments = [];
  for (const ref of refs) alignments.push({ text: await ref.text(), source: ref.name });
  // A3M files (AlphaFold-style MSAs) also give MSA depth.
  const a3m = alignments.filter((item) => /\.a[23]m$/i.test(item.source));
  if (a3m.length) applyMSA(entry, a3m.map((item) => msaDepth(item.text)), a3m.map((item) => item.source).join(', '), { quiet: true });
  try {
    showToast(await computeConservation(entry, { alignments }));
  } catch (error) {
    if (!a3m.length) throw error;
    showToast(`MSA depth from ${a3m.map((item) => item.source).join(', ')}: median ${formatNumber(entry.msa.summary.median)} sequences. Conservation: ${error.message}`, true);
  }
}

function isAlignmentFile(name) {
  return ALIGNMENT_FILE.test(name) || /\.(a3m|a2m|fasta|fa|faa)$/i.test(name);
}

async function computeConservation(entry = state.active, options = {}) {
  if (!entry) throw new CommandError('Open a structure first.');
  // Alignments given, else those the scores came from (so another method rescores an opened
  // file), else the MSAs the structure's predictions or AlphaFold DB provide.
  const alignments = options.alignments ?? entry.conservation?.alignments ?? await knownAlignments(entry);
  if (!alignments.length) {
    throw new CommandError('No alignment is known for this structure. Open an alignment file (A3M, aligned FASTA, Stockholm or Clustal) whose first sequence is the protein, or a prediction folder with its MSA.');
  }
  const { parseAlignment, conservationScores } = await conservationModule();
  const values = new Map();
  const grades = new Map();
  const summaries = [];
  const problems = [];
  for (const item of alignments) {
    const alignment = parseAlignment(item.text, item.source);
    if (!alignment || alignment.rows.length < 2) {
      problems.push(`${item.source}: not an alignment of several sequences`);
      continue;
    }
    const result = conservationScores(alignment, { method: options.method ?? 'jsd' });
    const mapped = mapConservation(entry, alignment, result);
    if (!mapped.chains.length) {
      problems.push(`${item.source}: its first sequence matches no chain`);
      continue;
    }
    for (const [key, value] of mapped.values) values.set(key, value);
    for (const [key, value] of mapped.grades) grades.set(key, value);
    summaries.push({ source: item.source, chains: mapped.chains, sequences: result.sequences, neff: result.effectiveSequences, method: result.method });
  }
  if (!values.size) throw new CommandError(problems.join('; ') || 'The alignment matched no chain.');
  entry.conservation = { values, grades, summaries, method: summaries[0].method, problems, alignments };
  setColorScheme('conservation', [entry]);
  renderConservation();
  if (entry === state.active) renderProfile();
  const sequences = summaries.reduce((sum, item) => sum + item.sequences, 0);
  return `Conservation of ${formatNumber(values.size)} residues from ${summaries.map((item) => item.source).join(', ')} (${formatNumber(sequences)} sequences).`;
}

// Scores follow the query of each alignment segment (a ColabFold complex MSA has one per chain)
// onto every protein chain whose sequence it matches.
function mapConservation(entry, alignment, result) {
  const segments = result.segments?.length ? result.segments : [{ start: 0, end: alignment.query.length }];
  const values = new Map();
  const grades = new Map();
  const used = new Set();
  for (const segment of segments) {
    for (const { chain, pairs } of mapQueryToChains(entry, alignment.query.slice(segment.start, segment.end))) {
      for (const [q, c] of pairs) {
        const score = result.scores[segment.start + q];
        const grade = result.grades[segment.start + q];
        const key = chain.residues[c].key;
        if (Number.isFinite(score)) values.set(key, score);
        if (grade) grades.set(key, grade);
      }
      used.add(chain.id);
    }
  }
  return { values, grades, chains: [...used] };
}

// The protein chains an alignment's query sequence belongs to (≥ 90% identity over at least 20
// aligned residues, or half the chain), with the aligned (query index, chain residue index) pairs.
function mapQueryToChains(entry, query) {
  if (!query || query.length < 10) return [];
  const model = activeModelOf(entry);
  const matches = [];
  for (const chain of polymerChainResidues(model).values()) {
    if (chain.kind !== 'protein') continue;
    const sequence = chain.residues.map((residue) => (residue.code?.length === 1 ? residue.code : 'X')).join('');
    const aligned = alignSequences(query, sequence, { kind: 'protein' });
    if (aligned.truncated || aligned.identity < 0.9 || aligned.pairs.length < Math.min(20, chain.residues.length * 0.5)) continue;
    matches.push({ chain, pairs: aligned.pairs });
  }
  return matches;
}

function renderConservation() {
  const entry = state.active;
  const conservation = entry?.conservation;
  els.conservationResult.hidden = !conservation;
  if (!conservation) return;
  const model = activeModelOf(entry);
  const top = [...conservation.grades].filter(([, grade]) => grade === 9).map(([key]) => model.residueMap.get(key)).filter(Boolean).slice(0, 14);
  const low = conservation.summaries.some((item) => item.sequences < MIN_CONSERVATION_SEQUENCES);
  els.conservationResult.innerHTML = `${conservation.summaries.map((item) => `<div>${escapeHTML(item.source)} → chain ${escapeHTML(item.chains.join(', '))}: ${formatNumber(item.sequences)} sequences, diversity ${item.neff.toFixed(1)} of 20 (HH-suite Neff)</div>`).join('')}
    ${low ? `<div class="warn">Fewer than ${MIN_CONSERVATION_SEQUENCES} sequences: grades are not reliable.</div>` : ''}
    ${top.length ? `<div class="hint">Grade 9: ${top.map((residue) => `<button type="button" class="link" data-focus-residue="${escapeHTML(residue.key)}">${escapeHTML(shortResidueLabel(residue))}</button>`).join(', ')}${[...conservation.grades.values()].filter((grade) => grade === 9).length > top.length ? ', …' : ''}</div>` : ''}
    ${conservation.problems.length ? `<div class="hint">${escapeHTML(conservation.problems.join('; '))}</div>` : ''}`;
  for (const button of els.conservationResult.querySelectorAll('[data-focus-residue]')) {
    button.addEventListener('click', () => focusResidues([button.dataset.focusResidue]));
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

/* ---------- Density maps ---------- */

// The map of the entry's own experiment: X-ray 2Fo-Fc and Fo-Fc maps and EMDB maps come from
// the PDBe volume server (RCSB's copy as a fallback), and CCP4/MRC files open from disk. A worker
// holds the map and returns the isosurface inside a region (around the focus, around the view
// center, or the whole map); the page draws it as a mesh or a surface in the structure's frame.

const MAP_COLORS = { '2fo-fc': [0.33, 0.58, 1], 'fo-fc+': [0.2, 0.82, 0.3], 'fo-fc-': [1, 0.3, 0.25], em: [0.55, 0.75, 0.92], map: [0.55, 0.75, 0.92] };
// Voxels per request, the volume server's levels: a box around the focus, and a whole map (or,
// for X-ray entries, a box around the model). Map fits use full-resolution tiles.
const MAP_BOX_BUDGET = 2 ** 21;
const MAP_WHOLE_BUDGET = 2 ** 23;
const MAP_BOX_GRID = 2;
let volumeWorkerClient = null;

function volumeWorker() {
  volumeWorkerClient ??= createWorkerClient(new URL('./lib/volume-worker.js', import.meta.url), 'map worker');
  return volumeWorkerClient;
}

function volumeServerQuery(density) {
  return density.source.server ? `&server=${encodeURIComponent(density.source.server)}` : '';
}

function mapChannelKind(name, source) {
  const lower = String(name).toLowerCase().replace(/\s/g, '');
  if (lower.includes('2fo')) return '2fo-fc';
  if (lower.includes('fo-fc') || lower.includes('fofc')) return 'fo-fc';
  return source === 'em' ? 'em' : 'map';
}

function mapChannelLabel(channel) {
  return { '2fo-fc': '2Fo-Fc', 'fo-fc': 'Fo-Fc', em: 'Cryo-EM map' }[channel.kind] ?? channel.name;
}

// Contour levels are kept in σ above the map's mean, as Mol* does; cryo-EM maps start at EMDB's
// recommended level, 2Fo-Fc at 1.5σ and Fo-Fc at ±3σ.
function mapLevel(channel) {
  return channel.stats.mean + channel.sigmaLevel * channel.stats.rms;
}

async function loadDensity(entry = state.active, options = {}) {
  if (!entry) throw new CommandError('Open a structure first.');
  const meta = entry.structure.meta;
  const method = String(meta.method).toUpperCase();
  const code = validationCode(entry);
  let source;
  if (method.includes('ELECTRON MICROSCOPY') || method.includes('CRYO')) {
    if (!meta.emdb) throw new CommandError(`${code || entry.name} names no EMDB map. Open the map file instead.`);
    source = { type: 'server', kind: 'em', id: meta.emdb.toLowerCase(), label: meta.emdb };
  } else if (code && (method.includes('X-RAY') || method.includes('NEUTRON') || method.includes('ELECTRON CRYSTALLOGRAPHY'))) {
    source = { type: 'server', kind: 'x-ray', id: code.toLowerCase(), label: code };
  } else {
    throw new CommandError(`${entry.name} has no map at the PDBe volume server (X-ray and cryo-EM entries do). Open a CCP4/MRC map file instead.`);
  }
  showLoading(`Loading the ${source.kind === 'em' ? 'cryo-EM' : 'X-ray'} map of ${source.label}`);
  try {
    const response = await fetch(`/api/fetch/volume/${source.kind}/${encodeURIComponent(source.id)}${options.refresh ? '?refresh=1' : ''}`);
    if (!response.ok) throw new CommandError(await responseError(response, `The map of ${source.label} could not be loaded`));
    const header = await response.json();
    // Map data come from the server that sent the header, whose statistics set the levels.
    source.server = response.headers.get('X-Proteoscope-Volume-Server') || '';
    let recommended = NaN;
    if (source.kind === 'em') {
      try {
        const emdb = await fetch(`/api/fetch/emdb/${encodeURIComponent(meta.emdb)}`);
        if (emdb.ok) {
          const contours = (await emdb.json())?.map?.contour_list?.contour ?? [];
          recommended = Number((contours.find((item) => item.primary) ?? contours[0])?.level);
        }
      } catch {
        // The map still opens, at 3σ.
      }
    }
    const info = header.sampling?.[0]?.valuesInfo ?? [];
    const channels = (header.channels ?? []).map((name, index) => {
      const kind = mapChannelKind(name, source.kind);
      const stats = { mean: Number(info[index]?.mean) || 0, rms: Number(info[index]?.sigma) || 1 };
      let sigmaLevel = kind === 'fo-fc' ? 3 : kind === 'em' ? 3 : 1.5;
      if (kind === 'em' && Number.isFinite(recommended)) sigmaLevel = (recommended - stats.mean) / stats.rms;
      return { name, kind, index, stats, sigmaLevel, recommended: kind === 'em' ? recommended : NaN, visible: true };
    });
    if (!channels.length) throw new CommandError(`The volume server lists no map channels for ${source.label}.`);
    setDensity(entry, { source, header, channels, emdb: meta.emdb });
  } finally {
    hideLoading();
  }
}

async function openMapFile(ref, entry = state.active) {
  if (!entry) throw new Error(`Open a structure before the map ${ref.name}.`);
  showLoading(`Reading ${ref.name}`);
  try {
    const bytes = await ref.read();
    const key = `${entry.id}:file`;
    // A member of an uncompressed ZIP is a view into the whole archive; the worker gets its own copy.
    const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    const [summary] = await volumeWorker().run('parse-mrc', { key, name: ref.name, bytes: buffer }, [buffer]);
    const fofc = /fo-?fc/i.test(ref.name) && !/2fo/i.test(ref.name);
    const channel = { name: ref.name, kind: fofc ? 'fo-fc' : 'map', index: 0, stats: summary.stats, sigmaLevel: fofc ? 3 : 2, visible: true, key };
    setDensity(entry, { source: { type: 'file', name: ref.name, label: ref.name }, channels: [channel], summary });
  } finally {
    hideLoading();
  }
}

function setDensity(entry, fields) {
  if (entry.density) entry.density.updateToken += 1;
  clearDensityGeometry(entry);
  // The other kind of source's volumes are no longer needed.
  for (const suffix of fields.source.type === 'server' ? ['file'] : ['view', 'fit']) volumeWorker().run('drop', { key: `${entry.id}:${suffix}` }).catch(() => {});
  const em = fields.source.kind === 'em';
  const whole = em || (fields.summary && fields.summary.dims.reduce((total, count) => total * count, 1) <= MAP_WHOLE_BUDGET && fields.channels[0].kind === 'map');
  entry.density = {
    ...fields,
    // The Canvas fallback draws lines but no surfaces.
    style: em && !state.canvasFallback ? 'surface' : 'mesh',
    opacity: em ? 0.45 : 1,
    width: 1.2,
    region: whole ? 'all' : 'focus',
    radius: 10,
    zone: 0,
    loadedKey: '',
    drawn: new Set(),
    geometry: new Map(),
    fit: null,
    spacing: fields.summary?.spacing ?? NaN,
    updateToken: 0,
  };
  if (entry === state.active) activateTab('analysis');
  renderDensityPanel();
  updateDensity(entry);
}

function removeDensity(entry = state.active) {
  if (!entry?.density) return;
  entry.density.updateToken += 1;
  clearDensityGeometry(entry);
  volumeWorker().run('drop', { key: String(entry.id) }).catch(() => {});
  if (entry.color.scheme === 'mapfit') entry.color.scheme = 'chain';
  entry.density = null;
  renderDensityPanel();
  renderLigandCard();
  markColorsDirty();
  requestRender();
}

function clearDensityGeometry(entry) {
  for (const id of new Set([...(entry.density?.drawn ?? []), ...(entry.density?.geometry.keys() ?? [])])) {
    state.renderer.setLines?.(id, null);
    state.renderer.setMesh(id, null);
  }
  if (entry.density) {
    entry.density.drawn = new Set();
    entry.density.geometry = new Map();
  }
}

// The region to contour, in the map's (deposited) frame: around the focused or selected
// residues, or around the view center; null for the whole map. Boxes snap to a 2 Å grid so a
// small move reuses the box already fetched.
function densityRegion(entry) {
  const density = entry.density;
  // An X-ray map is periodic, and its unit cell need not contain the model: "whole map" is then
  // the model's box, which the server fills by symmetry.
  if (density.region === 'all') return density.source.kind === 'x-ray' ? modelBox(entry, 5) : null;
  const model = activeModelOf(entry);
  const keys = density.region === 'focus' && entry === state.active ? [...(state.focus?.residues ?? state.selection)] : [];
  const atoms = keys.flatMap((key) => model.residueMap.get(key)?.atoms ?? []).filter((atom) => !atom.isHydrogen);
  let min;
  let max;
  if (atoms.length) {
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    for (const atom of atoms) {
      const point = [atom.x, atom.y, atom.z];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis] - density.radius);
        max[axis] = Math.max(max[axis], point[axis] + density.radius);
      }
    }
  } else {
    const target = state.camera.target;
    min = target.map((value) => value - density.radius);
    max = target.map((value) => value + density.radius);
  }
  if (entry.transform) [min, max] = transformedBox(invertTransform(entry.transform), min, max);
  return {
    min: min.map((value) => Math.floor(value / MAP_BOX_GRID) * MAP_BOX_GRID),
    max: max.map((value) => Math.ceil(value / MAP_BOX_GRID) * MAP_BOX_GRID),
  };
}

// The box around the model's heavy atoms plus a margin, in the map's (deposited) frame, on the
// 2 Å grid.
function modelBox(entry, margin) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const atom of activeModelOf(entry).atoms) {
    if (atom.isHydrogen || atom.isWater) continue;
    const point = [atom.x, atom.y, atom.z];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis] - margin);
      max[axis] = Math.max(max[axis], point[axis] + margin);
    }
  }
  if (!Number.isFinite(min[0])) return null;
  const [low, high] = entry.transform ? transformedBox(invertTransform(entry.transform), min, max) : [min, max];
  return {
    min: low.map((value) => Math.floor(value / MAP_BOX_GRID) * MAP_BOX_GRID),
    max: high.map((value) => Math.ceil(value / MAP_BOX_GRID) * MAP_BOX_GRID),
    whole: true,
  };
}

function transformedBox(transform, min, max) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const point = transformPoint(transform, corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]);
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  }
  return [low, high];
}

// Atoms that carve the map ("near atoms"): the focused or selected residues, else the model.
function densityZone(entry) {
  const density = entry.density;
  if (!(density.zone > 0)) return null;
  const model = activeModelOf(entry);
  const keys = entry === state.active ? [...(state.focus?.residues ?? state.selection)] : [];
  const atoms = (keys.length ? keys.flatMap((key) => model.residueMap.get(key)?.atoms ?? []) : model.atoms).filter((atom) => !atom.isHydrogen && !atom.isWater);
  const inverse = entry.transform ? invertTransform(entry.transform) : null;
  const points = new Float32Array(atoms.length * 3);
  atoms.forEach((atom, index) => points.set(inverse ? transformPoint(inverse, atom.x, atom.y, atom.z) : [atom.x, atom.y, atom.z], index * 3));
  return { points, radius: density.zone };
}

async function updateDensity(entry = state.active) {
  const density = entry?.density;
  if (!density || !state.entries.includes(entry)) return;
  const token = (density.updateToken += 1);
  const current = () => token === density.updateToken && entry.density === density && state.entries.includes(entry);
  const { detailForBudget } = await import('./lib/volume.js');
  const region = densityRegion(entry);
  const regionKey = region ? `${region.min.join(',')}/${region.max.join(',')}` : 'all';
  try {
    let keyOf = () => `${entry.id}:file`;
    if (density.source.type === 'server') {
      const base = `/api/fetch/volume/${density.source.kind}/${encodeURIComponent(density.source.id)}`;
      if (density.loadedKey !== regionKey) {
        const budget = region && !region.whole ? MAP_BOX_BUDGET : MAP_WHOLE_BUDGET;
        const url = region
          ? `${base}/box?min=${region.min.join(',')}&max=${region.max.join(',')}&detail=${detailForBudget(density.header, budget)}${volumeServerQuery(density)}`
          : `${base}/cell?detail=${detailForBudget(density.header, budget)}${volumeServerQuery(density)}`;
        density.status = 'Loading the map…';
        renderDensityStatus(entry);
        const response = await fetch(url);
        if (!response.ok) throw new Error(await responseError(response, 'The map region could not be loaded'));
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!current()) return;
        // Whatever region the worker ends up holding is the one loadedKey names, even when a
        // later update supersedes this one while it parses.
        density.loadedKey = '';
        const summaries = await volumeWorker().run('parse-server', { key: `${entry.id}:view`, bytes: bytes.buffer }, [bytes.buffer]);
        if (entry.density !== density) return;
        density.loadedKey = regionKey;
        density.spacing = summaries[0]?.spacing ?? NaN;
        density.sampleRate = summaries[0]?.sampleRate ?? 1;
        if (!current()) return;
      }
      keyOf = (channel) => `${entry.id}:view:${channel.index}`;
    }
    const zone = densityZone(entry);
    // New geometry is committed only when every channel is contoured and the update is current,
    // so a superseded update never leaves meshes behind.
    const geometry = new Map();
    for (const channel of density.channels) {
      if (!channel.visible) continue;
      const request = { key: keyOf(channel), levels: contourLevels(density, channel), zone };
      if (density.source.type === 'file') {
        const voxels = density.summary.dims.reduce((total, count) => total * count, 1);
        if (region) {
          Object.assign(request, region);
          // A large region of a fine map is contoured at a coarser stride.
          const spacing = density.summary.spacing || 1;
          const regionVoxels = [0, 1, 2].reduce((total, axis) => total * Math.max(1, (region.max[axis] - region.min[axis]) / spacing), 1);
          request.stride = Math.max(1, Math.ceil(Math.cbrt(Math.min(voxels, regionVoxels) / MAP_BOX_BUDGET)));
        } else {
          request.stride = Math.max(1, Math.ceil(Math.cbrt(voxels / MAP_WHOLE_BUDGET)));
        }
      }
      const { meshes, spacing } = await volumeWorker().run('contour', request);
      if (!current()) return;
      if (density.source.type === 'file') density.spacing = spacing;
      meshes.forEach((mesh, index) => {
        const id = `map:${entry.id}:${channel.index}:${index}`;
        const color = channel.kind === 'fo-fc' ? MAP_COLORS[index === 0 ? 'fo-fc+' : 'fo-fc-'] : channel.color ?? MAP_COLORS[channel.kind];
        geometry.set(id, { mesh, color });
      });
    }
    for (const id of new Set([...density.drawn, ...density.geometry.keys()])) {
      if (geometry.has(id)) continue;
      state.renderer.setLines?.(id, null);
      state.renderer.setMesh(id, null);
    }
    density.geometry = geometry;
    density.drawn = new Set(geometry.keys());
    density.status = '';
    drawDensity(entry);
  } catch (error) {
    if (token !== density.updateToken) return;
    density.status = error.message;
    console.warn(error);
  }
  renderDensityStatus(entry);
}

// Contour levels in the values the worker holds. The server downsamples large regions, which
// narrows the values, so there a level keeps its σ (from the header's statistics at that rate)
// rather than its value.
function contourLevels(density, channel) {
  const rate = density.source.type === 'server' ? density.sampleRate ?? 1 : 1;
  const info = rate > 1 ? density.header?.sampling?.find((item) => item.rate === rate)?.valuesInfo?.[channel.index] : null;
  const mean = info && Number.isFinite(Number(info.mean)) ? Number(info.mean) : channel.stats.mean;
  const rms = info && Number(info.sigma) > 0 ? Number(info.sigma) : channel.stats.rms;
  const level = mean + channel.sigmaLevel * rms;
  return channel.kind === 'fo-fc' ? [{ level, below: false }, { level: mean - channel.sigmaLevel * rms, below: true }] : [{ level, below: false }];
}

// Uploads the contoured geometry in the structure's current frame (after any superposition).
function drawDensity(entry) {
  const density = entry.density;
  if (!density || !state.entries.includes(entry)) return;
  density.shown = entry.visible;
  const transform = entry.transform;
  for (const [id, { mesh, color }] of density.geometry) {
    if (!entry.visible) {
      state.renderer.setLines?.(id, null);
      state.renderer.setMesh(id, null);
      continue;
    }
    const positions = transform ? transformedPositions(transform, mesh.positions) : mesh.positions;
    if (density.style === 'mesh') {
      state.renderer.setMesh(id, null);
      const segments = new Float32Array(mesh.edges.length * 3);
      for (let index = 0; index < mesh.edges.length; index += 1) {
        const vertex = mesh.edges[index] * 3;
        segments[index * 3] = positions[vertex];
        segments[index * 3 + 1] = positions[vertex + 1];
        segments[index * 3 + 2] = positions[vertex + 2];
      }
      state.renderer.setLines?.(id, { segments, color, opacity: density.opacity, width: density.width });
    } else {
      state.renderer.setLines?.(id, null);
      const vertices = new ArrayBuffer(mesh.vertexCount * MESH_VERTEX_STRIDE);
      const floats = new Float32Array(vertices);
      const words = new Uint32Array(vertices);
      const packed = packColor(color);
      for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
        const offset = vertex * 8;
        floats[offset] = positions[vertex * 3];
        floats[offset + 1] = positions[vertex * 3 + 1];
        floats[offset + 2] = positions[vertex * 3 + 2];
        const normal = transform ? transformDirection(transform, mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]) : [mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]];
        floats[offset + 3] = normal[0];
        floats[offset + 4] = normal[1];
        floats[offset + 5] = normal[2];
        words[offset + 6] = 0;
        words[offset + 7] = packed;
      }
      state.renderer.setMesh(id, { vertices: new Uint8Array(vertices), indices: mesh.indices, opacity: density.opacity, noPick: true });
    }
  }
  requestRender();
}

function transformedPositions(transform, positions) {
  const out = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) out.set(transformPoint(transform, positions[index], positions[index + 1], positions[index + 2]), index);
  return out;
}

// Regions that follow the view or the focus are refetched once the camera or focus settles.
function followDensity() {
  const following = state.entries.filter((entry) => entry.density && entry.visible && entry.density.region !== 'all');
  if (!following.length) return;
  const target = state.camera.target;
  const last = state.densityTarget;
  if (last && Math.hypot(target[0] - last[0], target[1] - last[1], target[2] - last[2]) < 1) return;
  state.densityTarget = [...target];
  clearTimeout(state.densityTimer);
  state.densityTimer = setTimeout(() => {
    for (const entry of following) {
      const focused = entry === state.active && (state.focus || state.selection.size) && entry.density.region === 'focus';
      if (!focused) updateDensity(entry);
    }
  }, 300);
}

function densityFocusChanged() {
  clearTimeout(state.densityFocusTimer);
  state.densityFocusTimer = setTimeout(() => {
    const entry = state.active;
    if (entry?.density && (entry.density.region === 'focus' || entry.density.zone > 0)) updateDensity(entry);
  }, 120);
}

// Map values at the model's heavy atoms: atom inclusion at the contour level for cryo-EM maps,
// the mean 2Fo-Fc density in σ for X-ray maps; per residue for the "Fit to the loaded map" colors.
async function fitDensity(entry = state.active) {
  const density = entry?.density;
  if (!density) throw new CommandError('Load a density map first.');
  const model = activeModelOf(entry);
  const channel = density.channels.find((item) => item.kind !== 'fo-fc') ?? density.channels[0];
  const atoms = model.atoms.filter((atom) => !atom.isHydrogen && !atom.isWater);
  if (!atoms.length) throw new CommandError('The structure has no atoms to fit.');
  const inverse = entry.transform ? invertTransform(entry.transform) : null;
  const positions = new Float32Array(atoms.length * 3);
  const groups = new Int32Array(atoms.length);
  atoms.forEach((atom, index) => {
    positions.set(inverse ? transformPoint(inverse, atom.x, atom.y, atom.z) : [atom.x, atom.y, atom.z], index * 3);
    groups[index] = model.atomResidue[atom.id];
  });
  const kind = channel.kind === '2fo-fc' ? 'sigma' : 'inclusion';
  // Levels of the full-resolution map: the fit samples full-resolution data.
  const level = kind === 'sigma' ? channel.stats.mean + channel.stats.rms : mapLevel(channel);
  const groupCount = model.residues.length;
  showLoading('Fitting the model to the map');
  let fit;
  try {
    fit = density.source.type === 'server'
      ? await fitServerMap(entry, density, channel, positions, groups, groupCount, level)
      : await volumeWorker().run('fit', { key: `${entry.id}:file`, positions, groups, groupCount, level });
  } finally {
    hideLoading();
  }
  if (entry.density !== density) return;
  const values = new Map();
  model.residues.forEach((residue, index) => {
    const value = kind === 'sigma' ? fit.sigma[index] : fit.inclusion[index];
    if (Number.isFinite(value) && residue.kind !== 'water') values.set(residue.key, value);
  });
  const worst = [...values].filter(([key]) => {
    const residue = model.residueMap.get(key);
    return residue && (residue.kind === 'protein' || residue.kind === 'nucleic' || residue.kind === 'ligand');
  }).sort((a, b) => a[1] - b[1]).slice(0, 10);
  density.fit = { kind, level, channel: mapChannelLabel(channel), atomInclusion: fit.atomInclusion, atoms: fit.atoms, outside: fit.outside, downsampled: fit.downsampled, values, worst };
  setColorScheme('mapfit', [entry]);
  renderDensityPanel();
  if (entry === state.active) renderProfile();
}

// The model's box in tiles the volume server sends at full resolution (sample rate 1), each at
// most its largest request, with a two-voxel margin for interpolation. σ values and EMDB's
// contour level refer to the full map, which downsampling would shift. `cellOf(point)` gives
// the tile a point falls in; each tile's core is its box without the margin.
function serverMapTiles(density, positions, pad) {
  const header = density.header ?? {};
  const precisions = header.availablePrecisions ?? [];
  let top = precisions[0];
  for (const item of precisions) if (!top || item.maxVoxels > top.maxVoxels) top = item;
  // Full-resolution voxel size along each axis (Å): cell edge × fractional extent / samples.
  const counts = header.sampling?.find((item) => item.rate === 1)?.sampleCount ?? [];
  let step = 0;
  (header.axisOrder ?? []).forEach((axis, index) => {
    const size = Number(header.spacegroup?.size?.[axis]) * Number(header.dimensions?.[index]) / Number(counts[index]);
    if (Number.isFinite(size)) step = Math.max(step, size);
  });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let atom = 0; atom < positions.length / 3; atom += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[atom * 3 + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.floor(min[axis] - pad);
    max[axis] = Math.ceil(max[axis] + pad);
  }
  // Tiles per axis until each (with its margin) fits the request limit.
  const margin = 2 * (step || 1);
  const tiles = [1, 1, 1];
  const voxelsOf = (axis) => ((max[axis] - min[axis]) / tiles[axis] + 2 * margin) / (step || 1);
  if (step > 0 && top) {
    while (voxelsOf(0) * voxelsOf(1) * voxelsOf(2) > top.maxVoxels * 0.9 && tiles[0] * tiles[1] * tiles[2] < 512) {
      const axis = [0, 1, 2].reduce((best, candidate) => (voxelsOf(candidate) > voxelsOf(best) ? candidate : best), 0);
      tiles[axis] += 1;
    }
  }
  const size = [0, 1, 2].map((axis) => (max[axis] - min[axis]) / tiles[axis]);
  const round = (value) => Math.round(value * 1000) / 1000;
  const tile = (key) => {
    const cell = key.split(',').map(Number);
    return {
      key,
      low: [0, 1, 2].map((axis) => round(min[axis] + cell[axis] * size[axis] - margin)),
      high: [0, 1, 2].map((axis) => round(min[axis] + (cell[axis] + 1) * size[axis] + margin)),
      core: { min: [0, 1, 2].map((axis) => min[axis] + cell[axis] * size[axis]), max: [0, 1, 2].map((axis) => min[axis] + (cell[axis] + 1) * size[axis]) },
    };
  };
  const cellOf = (x, y, z) => [x, y, z].map((value, axis) => Math.max(0, Math.min(tiles[axis] - 1, Math.floor((value - min[axis]) / size[axis])))).join(',');
  return { top, tile, cellOf };
}

// Fetches one tile at full resolution into the worker (`${entry.id}:fit:<channel>`).
async function fetchServerTile(entry, density, tile, top) {
  const url = `/api/fetch/volume/${density.source.kind}/${encodeURIComponent(density.source.id)}/box?min=${tile.low.join(',')}&max=${tile.high.join(',')}&detail=${top?.precision ?? 0}${volumeServerQuery(density)}`;
  const response = await fetch(url);
  if (!response.ok) throw new CommandError(await responseError(response, 'The map could not be loaded at full resolution'));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return volumeWorker().run('parse-server', { key: `${entry.id}:fit`, bytes: bytes.buffer }, [bytes.buffer]);
}

// A fit on server data: the model's box in full-resolution tiles, with the fits of the tiles
// added up.
async function fitServerMap(entry, density, channel, positions, groups, groupCount, level) {
  const { top, tile, cellOf } = serverMapTiles(density, positions, 4);
  const members = new Map();
  for (let atom = 0; atom < groups.length; atom += 1) {
    const key = cellOf(positions[atom * 3], positions[atom * 3 + 1], positions[atom * 3 + 2]);
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(atom);
  }
  const total = { sums: new Float64Array(groupCount), sampled: new Int32Array(groupCount), counts: new Int32Array(groupCount), insideCounts: new Int32Array(groupCount), inside: 0, outside: 0, atoms: groups.length, downsampled: false };
  let done = 0;
  for (const [key, list] of members) {
    done += 1;
    if (members.size > 1) setLoading(`Fitting the model to the map · tile ${done} of ${members.size}`);
    const summaries = await fetchServerTile(entry, density, tile(key), top);
    if ((summaries[0]?.sampleRate ?? 1) > 1) total.downsampled = true;
    const tilePositions = new Float32Array(list.length * 3);
    const tileGroups = new Int32Array(list.length);
    list.forEach((atom, index) => {
      tilePositions.set(positions.subarray(atom * 3, atom * 3 + 3), index * 3);
      tileGroups[index] = groups[atom];
    });
    const fit = await volumeWorker().run('fit', { key: `${entry.id}:fit:${channel.index}`, positions: tilePositions, groups: tileGroups, groupCount, level });
    for (let group = 0; group < groupCount; group += 1) {
      total.sums[group] += fit.sums[group];
      total.sampled[group] += fit.sampled[group];
      total.counts[group] += fit.counts[group];
      total.insideCounts[group] += fit.insideCounts[group];
    }
    total.inside += fit.inside;
    total.outside += fit.outside;
  }
  const sigma = new Float64Array(groupCount).fill(NaN);
  const inclusion = new Float64Array(groupCount).fill(NaN);
  for (let group = 0; group < groupCount; group += 1) {
    if (total.sampled[group]) sigma[group] = total.sums[group] / total.sampled[group];
    if (total.counts[group]) inclusion[group] = total.insideCounts[group] / total.counts[group];
  }
  return { ...total, sigma, inclusion, atomInclusion: total.atoms ? total.inside / total.atoms : NaN };
}

// Peaks of the difference map near the model, from full-resolution tiles: every tile that has
// model atoms in or near its core.
async function serverMapPeaks(entry, density, channel, positions, threshold) {
  const { top, tile, cellOf } = serverMapTiles(density, positions, PEAK_REACH);
  const cells = new Set();
  for (let atom = 0; atom < positions.length / 3; atom += 1) {
    for (const dx of [-PEAK_REACH, 0, PEAK_REACH]) {
      for (const dy of [-PEAK_REACH, 0, PEAK_REACH]) {
        for (const dz of [-PEAK_REACH, 0, PEAK_REACH]) cells.add(cellOf(positions[atom * 3] + dx, positions[atom * 3 + 1] + dy, positions[atom * 3 + 2] + dz));
      }
    }
  }
  const peaks = [];
  let done = 0;
  for (const key of cells) {
    done += 1;
    if (cells.size > 1) setLoading(`Finding difference-map peaks · tile ${done} of ${cells.size}`);
    const part = tile(key);
    await fetchServerTile(entry, density, part, top);
    peaks.push(...await volumeWorker().run('peaks', { key: `${entry.id}:fit:${channel.index}`, threshold, core: part.core }));
  }
  return peaks;
}

function renderDensityPanel() {
  const entry = state.active;
  const density = entry?.density;
  els.densityControls.hidden = !density;
  els.densityRemove.disabled = !density;
  els.densityLoad.textContent = density ? 'Reload map' : 'Load map';
  els.densityPeaks.hidden = !density?.channels.some((channel) => channel.kind === 'fo-fc');
  renderPeakList(entry);
  if (!density) {
    els.densityResult.hidden = true;
    return;
  }
  els.densityRegion.value = density.region;
  els.densityRadius.value = String(density.radius);
  els.densityRadiusValue.textContent = `${density.radius} Å`;
  els.densityStyle.value = density.style;
  els.densityZone.value = String(density.zone);
  els.densityChannels.innerHTML = density.channels.map((channel) => {
    const max = channel.kind === 'em' || channel.kind === 'map' ? Math.max(12, Math.ceil(channel.sigmaLevel * 2)) : 6;
    return `<div class="map-channel" data-channel="${channel.index}">
      <label class="check"><input type="checkbox" data-map-visible ${channel.visible ? 'checked' : ''} /> <span class="swatch" style="background:${colorToHex(channel.kind === 'fo-fc' ? MAP_COLORS['fo-fc+'] : channel.color ?? MAP_COLORS[channel.kind])}"></span>${escapeHTML(mapChannelLabel(channel))}</label>
      <input type="range" data-map-level min="0.3" max="${max}" step="0.1" value="${channel.sigmaLevel.toFixed(1)}" aria-label="${escapeHTML(mapChannelLabel(channel))} contour level" />
      <output data-map-level-value>${mapLevelText(channel)}</output>
    </div>`;
  }).join('');
  for (const row of els.densityChannels.querySelectorAll('[data-channel]')) {
    const channel = density.channels[Number(row.dataset.channel)];
    row.querySelector('[data-map-visible]').addEventListener('change', (event) => {
      channel.visible = event.target.checked;
      updateDensity(entry);
    });
    const slider = row.querySelector('[data-map-level]');
    slider.addEventListener('input', () => {
      channel.sigmaLevel = Number(slider.value);
      row.querySelector('[data-map-level-value]').textContent = mapLevelText(channel);
      clearTimeout(state.densityLevelTimer);
      state.densityLevelTimer = setTimeout(() => updateDensity(entry), 60);
    });
  }
  renderDensityStatus(entry);
}

function mapLevelText(channel) {
  const absolute = mapLevel(channel);
  const sign = channel.kind === 'fo-fc' ? '±' : '';
  return `${sign}${channel.sigmaLevel.toFixed(1)}σ · ${sign}${formatSignificant(channel.kind === 'fo-fc' ? channel.sigmaLevel * channel.stats.rms : absolute)}`;
}

function formatSignificant(value) {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  return magnitude >= 100 ? value.toFixed(0) : magnitude >= 1 ? value.toFixed(2) : value.toPrecision(3);
}

function renderDensityStatus(entry) {
  if (entry !== state.active) return;
  const density = entry.density;
  if (!density) return;
  const channel = density.channels[0];
  const facts = [
    density.source.type === 'server' ? `${density.source.kind === 'em' ? density.emdb : `${density.source.label} (PDBe volume server)`}` : density.source.name,
    Number.isFinite(density.spacing) ? `grid ${density.spacing.toFixed(2)} Å${density.source.type === 'server' && density.sampleRate > 1 ? ` (downsampled ${density.sampleRate}×, levels matched in σ)` : ''}` : '',
    Number.isFinite(channel?.recommended) ? `EMDB recommended level ${formatSignificant(channel.recommended)}` : '',
  ].filter(Boolean);
  const fit = density.fit;
  const fitNotes = fit ? [fit.outside ? `${formatNumber(fit.outside)} outside the map count as outside` : '', fit.downsampled ? 'the server sent downsampled data for part of the model' : ''].filter(Boolean).join('; ') : '';
  const fitText = fit ? (fit.kind === 'sigma'
    ? `<div>Map fit (${escapeHTML(fit.channel)}): <strong>${formatPercent(fit.atomInclusion)}</strong> of ${formatNumber(fit.atoms)} atoms above 1σ.</div>`
    : `<div>Atom inclusion: <strong>${formatPercent(fit.atomInclusion)}</strong> of ${formatNumber(fit.atoms)} atoms inside the contour at ${formatSignificant(fit.level)}.</div>`)
    + (fitNotes ? `<div class="hint">${escapeHTML(fitNotes)}.</div>` : '') : '';
  const model = activeModelOf(entry);
  const worst = fit?.worst?.length ? `<div class="hint">Worst fit: ${fit.worst.map(([key, value]) => {
    const residue = model.residueMap.get(key);
    return residue ? `<button type="button" class="link" data-focus-residue="${escapeHTML(key)}">${escapeHTML(shortResidueLabel(residue))}</button> ${fit.kind === 'sigma' ? `${value.toFixed(1)}σ` : formatPercent(value)}` : '';
  }).filter(Boolean).join(', ')}</div>` : '';
  els.densityResult.hidden = false;
  els.densityResult.innerHTML = `<div>${escapeHTML(facts.join(' · '))}</div>${density.status ? `<div class="${/fail|could not|error|no map/i.test(density.status) ? 'warn' : 'hint'}">${escapeHTML(density.status)}</div>` : ''}${fitText}${worst}`;
  for (const button of els.densityResult.querySelectorAll('[data-focus-residue]')) {
    button.addEventListener('click', () => focusResidues([button.dataset.focusResidue]));
  }
}

async function mapCommand(parsed) {
  const entry = state.active;
  if (parsed.action === 'load' || parsed.action === 'refresh') {
    await loadDensity(entry, { refresh: parsed.action === 'refresh' });
    const channels = entry.density.channels.map((channel) => `${mapChannelLabel(channel)} at ${mapLevelText(channel)}`).join(', ');
    return `Loaded the map of ${entry.density.source.label}: ${channels}.`;
  }
  if (parsed.action === 'off') {
    removeDensity(entry);
    return 'Map removed.';
  }
  if (!entry.density) await loadDensity(entry);
  const density = entry.density;
  switch (parsed.action) {
    case 'peaks': {
      const peaks = await findDifferencePeaks(entry, parsed.value);
      if (!peaks) return '';
      const top = peaks.list[0] ? peakText(peaks.list[0]) : null;
      return {
        message: `${peaks.positive} positive and ${peaks.negative} negative Fo-Fc peaks past ±${peaks.threshold}σ near the model${top ? `; the highest, ${top.sigma}, ${top.where} (${top.hint})` : ''}.`,
        data: {
          threshold: peaks.threshold,
          positive: peaks.positive,
          negative: peaks.negative,
          peaks: peaks.list.map((peak) => {
            const text = peakText(peak);
            return { sigma: Number(peak.sigma.toFixed(2)), position: peak.position.map((value) => Number(value.toFixed(2))), atom: shortAtomLabel(peak.atom), distance: Number(peak.distance.toFixed(2)), hint: text.hint };
          }),
        },
      };
    }
    case 'fit': {
      await fitDensity(entry);
      const fit = density.fit;
      return fit.kind === 'sigma'
        ? `${formatPercent(fit.atomInclusion)} of ${formatNumber(fit.atoms)} atoms are above 1σ in the 2Fo-Fc map. Colored by density at the atoms.`
        : `Atom inclusion ${formatPercent(fit.atomInclusion)} at ${formatSignificant(fit.level)} (${formatNumber(fit.atoms)} atoms). Colored by inclusion per residue.`;
    }
    case 'level': {
      const wanted = { '2fofc': '2fo-fc', fofc: 'fo-fc', em: 'em', map: 'map' }[parsed.channel];
      const channels = density.channels.filter((channel) => (wanted ? channel.kind === wanted : channel.kind !== 'fo-fc'));
      if (!channels.length) throw new CommandError(`This map has no ${parsed.channel} channel.`);
      for (const channel of channels) channel.sigmaLevel = parsed.value;
      break;
    }
    case 'style':
      density.style = parsed.value;
      density.opacity = parsed.value === 'surface' ? 0.45 : 1;
      renderDensityPanel();
      drawDensity(entry);
      return '';
    case 'region':
      density.region = parsed.value;
      break;
    case 'radius':
      density.radius = Math.min(30, Math.max(4, parsed.value));
      break;
    case 'zone':
      density.zone = Math.min(10, parsed.value);
      break;
    default:
      break;
  }
  renderDensityPanel();
  await updateDensity(entry);
  return '';
}

async function poseCommand(parsed) {
  const entry = state.active;
  const docking = dockingOf(entry);
  if (!docking) throw new CommandError('Open docking poses first: drop an SDF, MOL2 or PDBQT file onto the structure.');
  switch (parsed.action) {
    case 'list':
      return docking.molecules.slice(0, 20).map((molecule, index) => {
        const column = docking.columns[0];
        return `#${index + 1} ${molecule.title}${column ? ` ${shortScoreName(column.key)} ${molecule.properties.get(column.key) ?? '–'}` : ''}`;
      }).join(', ');
    case 'next':
    case 'previous':
      stepPose(parsed.action === 'next' ? 1 : -1);
      return '';
    case 'fingerprints':
      await computePoseFingerprints(entry);
      return `Interaction fingerprints for ${Math.min(docking.molecules.length, MAX_FINGERPRINT_POSES)} poses.`;
    case 'off':
      await clearPoses(entry);
      return 'Poses removed.';
    default:
      if (parsed.index > docking.molecules.length) throw new CommandError(`There are ${docking.molecules.length} poses.`);
      await showPose(entry, parsed.index - 1);
      return '';
  }
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '–';
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

// Marks sites on an entry (the active one by default; imports pass the entry they started on).
function setSites(sites, entry = state.active) {
  entry.proteomics.sites = sites;
  const overrides = new Map();
  for (const site of sites) overrides.set(site.residue.key, site.mismatch ? [1, 0.7, 0.2] : [1, 0.28, 0.72]);
  entry.proteomics.siteOverrides = overrides.size ? overrides : null;
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
    showToast('Enter cross-links such as A:K123-B:K45, or open a cross-link report.', true);
    return;
  }
  applyCrosslinks(state.active, links, { source: 'Entered links', skipped: parsed.skipped });
}

// A search-engine export of cross-links (xiFDR, xiVIEW, pLink, MeroX, XlinkX, MS Annika, MaxLynx).
async function importCrosslinkReport(ref) {
  const { parseCrosslinkReport } = await import('./lib/crosslinks.js');
  const parsed = parseCrosslinkReport(await ref.text(), ref.name);
  if (!parsed) return false;
  if (!state.active) throw new Error(`Open a structure before ${ref.name}.`);
  await proteomicsModule();
  applyCrosslinks(state.active, parsed.links, { source: `${parsed.label} · ${ref.name}`, total: parsed.total, decoys: parsed.decoys });
  activateTab('proteomics');
  return true;
}

function applyCrosslinks(entry, links, info) {
  entry.crosslinkSet = { links, info, sasd: false };
  mapCrosslinkSet(entry);
}

// The residues a link end may be on, preferring those drawn: when a crystal holds two copies of a
// complex and one is hidden, links map onto the one shown.
function crosslinkCandidates(entry, protein, residueNumber) {
  const candidates = crosslinkResidues(entry, protein, residueNumber);
  const shown = candidates.filter((residue) => residueShown(entry, residue));
  return shown.length ? shown : candidates;
}

// Resolves a link's protein to chains: a chain ID, a UniProt accession (then UniProt numbering),
// or part of a molecule name; no protein means any protein chain.
function crosslinkResidues(entry, protein, residueNumber) {
  const model = activeModelOf(entry);
  const structure = entry.structure;
  const chainIds = structure.chains.filter((chain) => chain.polymerKind === 'protein').map((chain) => chain.id);
  const byNumber = (chainId) => model.residues.find((item) => item.chain === chainId && item.kind === 'protein' && item.resSeq === residueNumber && !item.iCode);
  if (!protein) return chainIds.map(byNumber).filter(Boolean);
  if (chainIds.includes(protein)) return [byNumber(protein)].filter(Boolean);
  const accession = protein.toUpperCase().replace(/-\d+$/, '');
  const references = [...chainAccessions(entry)].filter(([chain, reference]) => chainIds.includes(chain) && reference.accession.replace(/-\d+$/, '') === accession);
  if (references.length) {
    return references.map(([chain, reference]) => residuesForUniprotRange(structure.sequences.get(chain), residueNumber, residueNumber, reference)[0]).filter(Boolean);
  }
  const needle = protein.toLowerCase();
  return structure.chains.filter((chain) => chainIds.includes(chain.id) && chain.description?.toLowerCase().includes(needle)).map((chain) => byNumber(chain.id)).filter(Boolean);
}

function mapCrosslinkSet(entry = state.active) {
  const set = entry.crosslinkSet;
  if (!set) return;
  const maxDistance = Number(els.xlMax.value) || 30;
  const mapped = [];
  let missing = 0;
  for (const link of set.links) {
    let best = null;
    for (const a of crosslinkCandidates(entry, link.proteinA, link.residueA)) {
      for (const b of crosslinkCandidates(entry, link.proteinB ?? link.proteinA, link.residueB)) {
        const atomA = a.backbone.CA;
        const atomB = b.backbone.CA;
        if (!atomA || !atomB || a === b) continue;
        const distance = Math.hypot(atomA.x - atomB.x, atomA.y - atomB.y, atomA.z - atomB.z);
        if (!best || distance < best.distance) best = { atomA, atomB, residueKeyA: a.key, residueKeyB: b.key, distance };
      }
    }
    if (!best) {
      missing += 1;
      continue;
    }
    mapped.push({ ...link, ...best, sasd: null, sasdStatus: '', satisfied: best.distance <= maxDistance });
  }
  set.missing = missing;
  set.maxDistance = maxDistance;
  set.sasd = false;
  entry.proteomics.crosslinks = mapped;
  // Kept for ranking the models of an opened prediction by cross-link satisfaction.
  state.crosslinkRequest = { links: set.links, maxDistance };
  renderPrediction();
  renderCrosslinks();
  markSceneDirty();
}

// Surface distances for the mapped links, in slices so the page stays responsive.
async function computeCrosslinkSASD(entry = state.active) {
  const set = entry.crosslinkSet;
  const links = entry.proteomics.crosslinks;
  if (!set || !links.length) return;
  const { SASD_CUTOFF, surfaceGrid } = await import('./lib/crosslinks.js');
  const model = activeModelOf(entry);
  const chains = new Set(links.flatMap((link) => [link.atomA.chain, link.atomB.chain]));
  const atoms = model.atoms.filter((atom) => !atom.isHydrogen && atom.kind !== 'water' && chains.has(atom.chain));
  showLoading(`Surface distances for ${links.length} cross-links`);
  await nextFrame();
  try {
    const pairs = links.map((link) => ({ a: { key: link.residueKeyA, ca: link.atomA }, b: { key: link.residueKeyB, ca: link.atomB } }));
    const grid = surfaceGrid(atoms, pairs.flatMap((pair) => [pair.a.key, pair.b.key]));
    const results = [];
    for (const [index, pair] of pairs.entries()) {
      results.push(grid.distance(pair));
      if (index % 10 === 9) {
        setLoading(`Surface distances · ${index + 1} of ${links.length}`);
        await nextFrame();
      }
    }
    set.sasdCutoff ??= SASD_CUTOFF;
    links.forEach((link, index) => {
      link.sasd = results[index].sasd;
      link.sasdStatus = results[index].status;
      link.satisfied = link.sasd !== null && link.sasd <= set.sasdCutoff;
    });
    set.sasd = true;
  } finally {
    hideLoading();
  }
  renderCrosslinks();
  markSceneDirty();
}

function renderCrosslinks() {
  const entry = state.active;
  const set = entry?.crosslinkSet;
  const links = entry?.proteomics.crosslinks ?? [];
  els.xlResult.hidden = !set;
  if (!set) {
    els.xlResult.replaceChildren();
    return;
  }
  const withinCa = links.filter((link) => link.distance <= set.maxDistance).length;
  const withinSASD = links.filter((link) => link.sasd !== null && link.sasd <= (set.sasdCutoff ?? 33)).length;
  const buried = links.filter((link) => link.sasdStatus === 'buried').length;
  const sorted = links.slice().sort((a, b) => (b.sasd ?? b.distance) - (a.sasd ?? a.distance));
  const label = (link) => `${link.atomA.chain}:${link.atomA.resName}${link.atomA.resSeq} – ${link.atomB.chain}:${link.atomB.resName}${link.atomB.resSeq}`;
  const info = set.info ?? {};
  els.xlResult.innerHTML = `
    <div>${escapeHTML(info.source ?? '')}${info.total ? ` · ${formatNumber(info.total)} matches` : ''}${info.decoys ? ` · ${formatNumber(info.decoys)} decoys left out` : ''}${info.skipped ? ` · ${formatNumber(info.skipped)} lines skipped` : ''}</div>
    <div><strong>${links.length}</strong> of ${set.links.length} residue pairs mapped${set.missing ? ` · <span class="warn">${set.missing} not in the structure</span>` : ''}</div>
    <div>Cα–Cα: <span class="good">${withinCa} within ${set.maxDistance} Å</span> · <span class="bad">${links.length - withinCa} beyond</span>${set.sasd ? `<br>Surface (SASD): <span class="good">${withinSASD} within ${set.sasdCutoff} Å</span> · <span class="bad">${links.length - withinSASD - buried} beyond</span>${buried ? ` · ${buried} buried` : ''}` : ''}</div>
    <canvas class="plot wide xl-histogram" width="640" height="200" aria-label="Distance histogram"></canvas>
    <div class="hint">${set.sasd ? 'Bars: SASD; outlines: Cα–Cα. Lines are colored by the SASD cutoff.' : 'Cα–Cα distances; for homo-oligomers the shortest chain pairing is used.'}</div>
    <div class="button-row">
      ${set.sasd ? `<label class="mini">SASD ≤ <input type="number" data-xl-sasd-cutoff min="5" max="80" step="1" value="${set.sasdCutoff}" /> Å</label>` : `<button type="button" data-xl-action="sasd" title="Solvent-accessible surface distance (Jwalk): the shortest path around the protein between the Cα atoms">Surface distances (SASD)</button>`}
      <button type="button" data-xl-action="export">Export CSV</button>
      <button type="button" data-xl-action="clear">Clear</button>
    </div>
    <table><thead><tr><th>Link</th><th>Cα–Cα</th>${set.sasd ? '<th>SASD</th>' : ''}<th title="Matches reported for the pair">n</th></tr></thead><tbody>${sorted.slice(0, 60).map((link) => `<tr class="clickable" data-xl-link="${links.indexOf(link)}"><td>${escapeHTML(label(link))}</td><td class="${link.distance <= set.maxDistance ? 'good' : 'bad'}">${link.distance.toFixed(1)} Å</td>${set.sasd ? `<td class="${link.satisfied ? 'good' : 'bad'}">${link.sasd !== null ? `${link.sasd.toFixed(1)} Å` : escapeHTML(link.sasdStatus === 'buried' ? 'buried' : `> 60 Å`)}</td>` : ''}<td>${Number.isFinite(link.count) ? formatNumber(link.count) : ''}</td></tr>`).join('')}</tbody></table>
    ${links.length > 60 ? `<div class="hint">Showing the 60 longest of ${links.length}.</div>` : ''}`;
  const canvas = els.xlResult.querySelector('.xl-histogram');
  import('./lib/crosslinks.js').then(({ distanceHistogram }) => {
    const ca = distanceHistogram(links.map((link) => link.distance));
    if (set.sasd) drawHistogram(canvas, distanceHistogram(links.map((link) => link.sasd ?? 60)), { cutoff: set.sasdCutoff, overlay: ca, label: 'SASD (bars) and Cα–Cα (outlines), Å' });
    else drawHistogram(canvas, ca, { cutoff: set.maxDistance, label: 'Cα–Cα distance (Å)' });
  });
}

async function onCrosslinkClick(event) {
  const entry = state.active;
  const set = entry?.crosslinkSet;
  if (!set) return;
  const action = event.target.closest('[data-xl-action]')?.dataset.xlAction;
  if (action === 'sasd') {
    await guardedLoad(() => computeCrosslinkSASD(entry));
    return;
  }
  if (action === 'clear') {
    entry.crosslinkSet = null;
    entry.proteomics.crosslinks = [];
    state.crosslinkRequest = null;
    renderPrediction();
    renderCrosslinks();
    markSceneDirty();
    return;
  }
  if (action === 'export') {
    const rows = [['residue_a', 'residue_b', 'protein_a', 'position_a', 'protein_b', 'position_b', 'ca_ca', 'sasd', 'count', 'score']];
    for (const link of entry.proteomics.crosslinks) {
      rows.push([`${link.atomA.chain}:${link.atomA.resName}${link.atomA.resSeq}`, `${link.atomB.chain}:${link.atomB.resName}${link.atomB.resSeq}`, link.proteinA ?? '', link.residueA, link.proteinB ?? '', link.residueB,
        link.distance.toFixed(2), link.sasd !== null && link.sasd !== undefined ? link.sasd.toFixed(2) : link.sasdStatus ?? '', link.count ?? '', link.score ?? '']);
    }
    downloadText(`${fileStem()}-crosslinks.csv`, csvText(rows), 'text/csv');
    return;
  }
  const row = event.target.closest('[data-xl-link]');
  if (row) {
    const link = entry.proteomics.crosslinks[Number(row.dataset.xlLink)];
    if (link) selectResidues([link.residueKeyA ?? link.atomA.residueKey, link.residueKeyB ?? link.atomB.residueKey], { frame: true });
  }
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

/* ---------- Search reports ---------- */

// A report keeps the rows of this structure's proteins with the entry, so thresholds, the value
// shown and the sample groups can change without reading the file again.

async function reportsModule() {
  lazyModules.reports ??= await import('./lib/reports.js');
  await proteomicsModule();
  return lazyModules.reports;
}

async function importReport(file, entry = state.active) {
  if (!entry) throw new Error('Open a structure before a search report.');
  const { readReport, summarizeReport } = await reportsModule();
  const accessions = [...new Set([...chainAccessions(entry).values()].map((item) => item.accession))];
  const sequences = [...entry.structure.sequences.values()].filter((info) => info.kind === 'protein').map((info) => info.sequence.replace(/[^A-Z]/g, ''));
  showLoading(`Reading ${file.name}`);
  const size = file.size || 1;
  let lastUpdate = 0;
  const report = await readReport(file, {
    accessions,
    sequences,
    onProgress: (read) => {
      const now = performance.now();
      if (now - lastUpdate < 250) return;
      lastUpdate = now;
      setLoading(`Reading ${file.name} · ${Math.min(99, Math.round((read / size) * 100))}%`);
    },
  });
  hideLoading();
  const settings = { qValue: 0.01, localization: 0.75, mode: report.kind === 'sites' ? 'intensity' : 'count', groupA: [], groupB: [], statistics: { ...DEFAULT_STATISTICS } };
  // The file stays at hand: statistics read all of it (every protein) when asked for.
  entry.report = { ...report, size: file.size, accessions, sequences, file, settings };
  const summary = summarizeReport(report, settings);
  // Two conditions (Spectronaut R.Condition) make the default comparison.
  const conditions = [...new Set(summary.samples.map((sample) => summary.conditions.get(sample)).filter(Boolean))];
  if (conditions.length === 2) {
    settings.groupA = summary.samples.filter((sample) => summary.conditions.get(sample) === conditions[0]);
    settings.groupB = summary.samples.filter((sample) => summary.conditions.get(sample) === conditions[1]);
  }
  applyReport(entry);
  activateTab('proteomics');
  if (!report.rows.length) {
    showToast(`${file.name}: none of its ${formatNumber(report.total)} rows belong to ${accessions.length ? accessions.join(', ') : 'this structure'}.`, true);
  }
}

// Peptide reports map by sequence (coverage, per-residue values, localized sites); site tables
// map by UniProt position.
function applyReport(entry = state.active) {
  const report = entry.report;
  if (!report) return;
  const { summarizeReport, quantValue } = lazyModules.reports;
  const settings = report.settings;
  const summary = summarizeReport(report, settings);
  report.summary = summary;
  const { groupA, groupB, mode } = settings;
  const sites = [];
  const values = new Map();
  const coverage = new Map();
  const chainSummaries = [];
  const proteomics = lazyModules.proteomics;
  if (report.kind === 'peptides' && proteomics?.mapPeptides) {
    const peptides = summary.peptides.map((peptide) => ({ sequence: peptide.sequence, modifications: [], value: mode === 'count' ? peptide.count : quantValue(peptide, mode, groupA, groupB) }));
    const chains = [...entry.structure.sequences.values()].filter((info) => info.kind === 'protein');
    const result = proteomics.mapPeptides(peptides, chains.map((info) => ({ id: info.chain, sequence: info.sequence })), { ilEquivalent: true });
    const siteMap = new Map();
    for (const chainResult of result.chains) {
      const info = entry.structure.sequences.get(chainResult.id);
      const items = info.items.filter((item) => !item.gap);
      items.forEach((item, index) => {
        if (!item.residue) return;
        const count = chainResult.coverage[index] ?? 0;
        if (!count) return;
        coverage.set(item.residue.key, count);
        const value = chainResult.values[index];
        if (Number.isFinite(value)) values.set(item.residue.key, value);
      });
      chainSummaries.push({ id: chainResult.id, fraction: chainResult.coverageFraction, coverage: chainResult.coverage, matches: chainResult.matches.length });
      for (const match of chainResult.matches) {
        const peptide = summary.peptides[match.peptide];
        const trim = peptide.sequence.length - (match.end - match.start + 1);
        for (const site of peptide.sites) {
          // N-terminal modifications (−1) sit on the first residue, C-terminal ones (the peptide
          // length) on the last.
          const offset = Math.min(Math.max(site.position, 0), peptide.sequence.length - 1) - trim;
          if (offset < 0 && site.position >= 0) continue;
          const residue = items[match.start + Math.max(offset, 0)]?.residue;
          if (!residue) continue;
          const key = `${residue.key}|${site.label}`;
          let merged = siteMap.get(key);
          if (!merged) {
            merged = { residue, label: site.label, terminal: site.position < 0, probability: NaN, count: 0, quantities: {}, peptides: [], features: [] };
            siteMap.set(key, merged);
          }
          merged.features.push(`${peptide.sequence}|${site.position}${site.label}`);
          if (Number.isFinite(site.probability) && !(site.probability <= merged.probability)) merged.probability = site.probability;
          merged.count += site.localized;
          if (!merged.peptides.includes(peptide.sequence)) merged.peptides.push(peptide.sequence);
          for (const [sample, value] of Object.entries(site.quantities)) merged.quantities[sample] = (merged.quantities[sample] ?? 0) + value;
        }
      }
    }
    sites.push(...siteMap.values());
  } else if (report.kind === 'sites') {
    const accessions = chainAccessions(entry);
    for (const site of summary.sites) {
      for (const [chain, reference] of accessions) {
        if (reference.accession.replace(/-\d+$/, '') !== site.protein.replace(/-\d+$/, '')) continue;
        if (site.protein.includes('-') && site.protein !== reference.accession) continue;
        const info = entry.structure.sequences.get(chain);
        const [residue] = residuesForUniprotRange(info, site.position, site.position, reference);
        if (!residue) continue;
        sites.push({ residue, label: site.label, probability: site.probability, count: site.count, quantities: site.quantities, peptides: [], uniprot: site.position, protein: site.protein, mismatch: Boolean(site.residue) && residue.code !== site.residue });
      }
    }
  }
  const statistics = mode === 'ratio' ? currentStatistics(report) : null;
  for (const site of sites) site.stats = statistics ? siteStatistics(report, statistics, site) : null;
  // With a test, only significant sites are colored, by their moderated (or protein-adjusted)
  // change; without one, peptide reports color residues from their peptides.
  if (statistics) values.clear();
  for (const site of sites) {
    site.value = mode === 'count' ? site.count : quantValue(site, mode, groupA, groupB);
    if (site.stats) {
      const result = site.stats.adjusted ?? site.stats;
      if (Number.isFinite(result.logFC) && result.q <= statistics.options.qLimit) values.set(site.residue.key, result.logFC);
    } else if (!statistics && report.kind === 'sites' && Number.isFinite(site.value)) {
      values.set(site.residue.key, site.value);
    }
  }
  sites.sort((a, b) => a.residue.chain.localeCompare(b.residue.chain) || a.residue.resSeq - b.residue.resSeq);
  const previousMarks = report.mapped?.marks ?? null;
  report.mapped = { sites, chains: chainSummaries, coverage, values };

  entry.proteomics.coverage = coverage.size ? coverage : null;
  // After a test the values are the significant sites, possibly none (all gray).
  entry.proteomics.data = (values.size || statistics) && mode !== 'count' ? values : null;
  entry.proteomics.dataLabel = mode === 'ratio' ? 'log2 fold change (B / A)' : mode === 'intensity' ? 'log10 intensity' : '';
  const labelFor = (site) => `${site.residue.code}${uniprotNumber(entry, site.residue) ?? site.residue.resSeq} ${site.label}`;
  report.mapped.marks = sites.map((site) => ({ residue: site.residue, label: labelFor(site), mismatch: site.mismatch }));
  // A report without sites leaves the sites entered by hand alone.
  if (report.mapped.marks.length || entry.proteomics.sites === previousMarks) setSites(report.mapped.marks, entry);
  // Fold changes read best on a diverging map centered on 0; counts and intensities keep the
  // scheme's own map.
  entry.color.colormap = mode === 'ratio' ? 'bwr' : '';
  const scheme = mode === 'count' ? (coverage.size ? 'coverage' : entry.color.scheme) : entry.proteomics.data ? 'data' : entry.color.scheme;
  if (entry === state.active) {
    els.dataSymmetric.checked = mode === 'ratio';
    setColorScheme(scheme, [entry]);
    renderReport();
    renderProfile();
  }
}

// The samples of the structure's rows, then those only the whole report has (known after a test).
function reportSamples(report) {
  const samples = [...report.summary.samples];
  for (const sample of report.allSamples ?? []) if (!samples.includes(sample)) samples.push(sample);
  return samples;
}

// Two groups from sample names that differ only in a replicate suffix ("DMSO-R1", "MZ1-R2"), the
// control-like one first; none when the names do not tell.
function defaultGroups(samples) {
  const stems = new Map();
  for (const sample of samples) {
    const stem = sample.replace(/[-_. ]?(r|rep|replicate|run)?[-_ ]?\d+$/i, '') || sample;
    if (!stems.has(stem)) stems.set(stem, []);
    stems.get(stem).push(sample);
  }
  const groups = [...stems.values()];
  if (groups.length !== 2 || groups.some((group) => group.length < 2)) return null;
  const control = /dmso|control|ctrl|vehicle|untreated|mock|wild.?type|\bwt\b|baseline|naive|placebo/i;
  const [first, second] = [...stems.keys()];
  return control.test(second) && !control.test(first) ? [groups[1], groups[0]] : groups;
}

function reportSampleOptions(samples, chosen) {
  return samples.map((sample) => `<option value="${escapeHTML(sample)}"${chosen.includes(sample) ? ' selected' : ''}>${escapeHTML(sample)}</option>`).join('');
}

function renderReport() {
  const entry = state.active;
  const report = entry?.report?.mapped ? entry.report : null;
  els.reportResult.hidden = !report;
  if (!report) {
    els.reportResult.replaceChildren();
    return;
  }
  const { settings, summary, mapped } = report;
  const peptides = report.kind === 'peptides';
  const quantified = summary.samples.length > 0 && (peptides ? summary.peptides.some((peptide) => Object.keys(peptide.quantities).length) : summary.sites.some((site) => Object.keys(site.quantities).length));
  const exposure = entry.exposure;
  const siteRows = mapped.sites.slice(0, 150).map((site, index) => {
    const context = exposure?.get(site.residue.key);
    const tested = site.stats ? site.stats.adjusted ?? site.stats : null;
    const value = tested ? tested.logFC.toFixed(2) : Number.isFinite(site.value) ? (settings.mode === 'count' ? String(site.value) : site.value.toFixed(2)) : '–';
    const qCell = report.statistics && settings.mode === 'ratio' ? `<td class="q${tested && tested.q <= settings.statistics.qLimit ? ' good' : ''}">${tested ? formatQ(tested.q) : '–'}</td>` : '';
    const position = uniprotNumber(entry, site.residue) ?? site.residue.resSeq;
    return `<tr data-report-site="${index}" class="clickable">
      <td>${escapeHTML(`${site.residue.code}${position}`)}${state.structure.chains.length > 1 ? ` <small>${escapeHTML(site.residue.chain)}</small>` : ''}</td>
      <td>${escapeHTML(site.label)}</td>
      <td class="${site.mismatch ? 'bad' : ''}">${Number.isFinite(site.probability) ? site.probability.toFixed(2) : '–'}</td>
      <td>${escapeHTML(value)}</td>${qCell}
      <td>${context ? `${context.ppse}${context.exposed ? ' ◦' : ''}` : '–'}</td>
      <td>${context ? (context.idr ? 'IDR' : '') : '–'}</td>
      ${entry.evidence ? `<td>${publicCell(entry, site)}</td>` : ''}
    </tr>`;
  }).join('');
  const idrShare = exposure && mapped.sites.length ? mapped.sites.filter((site) => exposure.get(site.residue.key)?.idr).length : null;
  const exposedShare = exposure && mapped.sites.length ? mapped.sites.filter((site) => exposure.get(site.residue.key)?.exposed).length : null;
  const modeButton = (mode, label, disabled = false) => `<button type="button" data-report-mode="${mode}" class="${settings.mode === mode ? 'is-active' : ''}"${disabled ? ' disabled' : ''}>${label}</button>`;
  els.reportResult.innerHTML = `
    <div><strong>${escapeHTML(report.label)}</strong> · ${escapeHTML(report.name)}</div>
    <div>${formatNumber(report.total)} rows · ${formatNumber(report.rows.length)} for ${escapeHTML(report.accessions.join(', ') || 'this structure')}${summary.filtered ? ` · ${formatNumber(summary.filtered)} filtered (decoy, contaminant or q-value)` : ''}</div>
    <div>${peptides ? `<strong>${formatNumber(summary.peptides.length)}</strong> peptides · ` : ''}<strong>${formatNumber(mapped.sites.length)}</strong> localized sites${summary.samples.length ? ` · ${summary.samples.length} sample${summary.samples.length === 1 ? '' : 's'}` : ''}</div>
    ${mapped.chains.filter((chain) => chain.matches).map((chain) => `<div>Chain ${escapeHTML(chain.id)}: <strong>${(chain.fraction * 100).toFixed(1)}%</strong> sequence coverage${coverageBar(chain.coverage)}</div>`).join('')}
    <div class="field-grid report-thresholds">
      ${peptides ? `<label class="field"><span>q-value ≤</span><input type="number" data-report-setting="qValue" min="0" max="1" step="0.005" value="${settings.qValue}" /></label>` : ''}
      <label class="field"><span>Localization ≥</span><input type="number" data-report-setting="localization" min="0" max="1" step="0.05" value="${settings.localization}" /></label>
    </div>
    <div class="segmented three report-modes" role="group" aria-label="Value shown">
      ${modeButton('count', peptides ? 'Peptides' : 'Sites')}${modeButton('intensity', 'Intensity', !quantified)}${modeButton('ratio', 'Fold change', summary.samples.length < 2)}
    </div>
    ${settings.mode !== 'count' && summary.samples.length ? `<div class="field-grid report-groups">
      <label class="field"><span>${settings.mode === 'ratio' ? 'Group A (reference)' : 'Samples'}</span><select multiple size="4" data-report-group="groupA">${reportSampleOptions(reportSamples(report), settings.groupA)}</select></label>
      ${settings.mode === 'ratio' ? `<label class="field"><span>Group B</span><select multiple size="4" data-report-group="groupB">${reportSampleOptions(reportSamples(report), settings.groupB)}</select></label>` : ''}
    </div>
    <p class="hint">${settings.mode === 'ratio' ? 'log2 of mean B over mean A per peptide, averaged per residue; blue lower in B, red higher.' : 'log10 of the mean intensity over the chosen samples (all when none is chosen).'}</p>` : ''}
    ${settings.mode === 'ratio' ? statisticsControls(report) : ''}
    ${mapped.sites.length ? `<table class="report-sites"><thead><tr><th>Site</th><th>Modification</th><th title="Best localization probability">Loc.</th><th>${settings.mode === 'ratio' ? 'log2 FC' : settings.mode === 'intensity' ? 'log10 int.' : 'PSMs'}</th>${report.statistics && settings.mode === 'ratio' ? `<th title="Benjamini–Hochberg q-value of the moderated t-test${report.statistics.adjusted?.size ? ', after adjusting for the protein’s change where it is known' : ''}">q</th>` : ''}<th title="Part-sphere exposure (StructureMap): Cα neighbors in a 12 Å, 70° cone; ◦ marks 5 or fewer (highly exposed)">pPSE</th><th title="Intrinsically disordered region from smoothed full-sphere exposure">IDR</th>${entry.evidence ? '<th title="Reported in public data (PTMeXchange confidence when known); new: not in public data">Public</th>' : ''}</tr></thead><tbody>${siteRows}</tbody></table>
      ${mapped.sites.length > 150 ? `<div class="hint">Showing 150 of ${formatNumber(mapped.sites.length)} sites.</div>` : ''}
      ${exposure ? `<div class="hint">${idrShare} of ${mapped.sites.length} sites lie in disordered regions and ${exposedShare} are highly exposed (pPSE ≤ ${PPSE_EXPOSED}).</div>` : '<div class="button-row"><button type="button" data-report-action="exposure" title="Compute part-sphere exposure and disorder (StructureMap) for the sites">Add structural context</button></div>'}` : ''}
    <div class="button-row"><button type="button" data-report-action="export">Export sites CSV</button><button type="button" data-report-action="clear">Clear</button></div>`;
  drawReportVolcano(entry);
}

// Removes a report and what it put on the structure (coverage, values and site marks), leaving
// cross-links, HDX, custom data and hand-entered sites alone.
function clearReport(entry) {
  entry.reportMethods = null;
  const mapped = entry.report?.mapped;
  const proteomics = entry.proteomics;
  if (mapped) {
    if (proteomics.coverage && proteomics.coverage === mapped.coverage) proteomics.coverage = null;
    if (proteomics.data && proteomics.data === mapped.values) {
      proteomics.data = null;
      proteomics.dataLabel = '';
    }
    if (proteomics.sites === mapped.marks) setSites([], entry);
  }
  entry.report = null;
  resetImportedColors(entry);
  markSceneDirty();
  if (entry === state.active) {
    renderReport();
    renderProfile();
  }
}

// After an import is cleared: the colormap it chose goes back to the scheme's own, and a coverage
// or data scheme with nothing left to show goes back to the default.
function resetImportedColors(entry) {
  entry.color.colormap = '';
  const empty = (entry.color.scheme === 'coverage' && !entry.proteomics.coverage) || (entry.color.scheme === 'data' && !entry.proteomics.data);
  if (empty) setColorScheme(entry.structure.meta.isPredicted ? 'plddt' : 'chain', [entry]);
  else markColorsDirty();
  if (entry === state.active) {
    els.dataSymmetric.checked = false;
    syncStyleControls();
  }
}

function publicCell(entry, site) {
  const known = publicSiteFor(entry, site.residue, site.label);
  if (known === undefined) return '';
  return known ? `✓${known.confidence ? ` ${escapeHTML(known.confidence)}` : ''}` : '<span class="good">new</span>';
}

function onReportControl(event) {
  const report = state.active?.report;
  if (!report) return;
  const target = event.target;
  if (target.dataset.statSetting) {
    const key = target.dataset.statSetting;
    const options = report.settings.statistics;
    if (target.type === 'checkbox') options[key] = target.checked;
    else if (key === 'normalize') options[key] = target.value;
    else if (key === 'minValid') {
      const value = Math.round(Number(target.value));
      if (!(value >= 2)) {
        target.value = String(options.minValid);
        return;
      }
      options.minValid = Math.min(12, value);
    } else if (Number.isFinite(Number(target.value))) options[key] = Number(target.value);
    // A changed option makes the last test stale; it runs again on request.
    report.statistics = null;
    applyReport(state.active);
    return;
  }
  if (target.dataset.reportSetting) {
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    report.settings[target.dataset.reportSetting] = Math.min(1, Math.max(0, value));
    // The test read the report with the old thresholds.
    report.statistics = null;
  } else if (target.dataset.reportGroup) {
    report.settings[target.dataset.reportGroup] = [...target.selectedOptions].map((option) => option.value);
    report.statistics = null;
  } else return;
  applyReport(state.active);
}

async function onReportClick(event) {
  const entry = state.active;
  const report = entry?.report;
  if (!report) return;
  const mode = event.target.closest('[data-report-mode]')?.dataset.reportMode;
  if (mode) {
    report.settings.mode = mode;
    if (mode === 'ratio' && !report.settings.groupA.length && !report.settings.groupB.length) {
      const groups = defaultGroups(reportSamples(report));
      if (groups) [report.settings.groupA, report.settings.groupB] = groups;
      else showToast('Choose the samples of groups A and B under Fold change.');
    }
    applyReport(entry);
    return;
  }
  const action = event.target.closest('[data-report-action]')?.dataset.reportAction;
  if (action === 'test') {
    await guardedLoad(async () => showToast(await runReportStatistics(entry)));
    return;
  }
  if (action === 'exposure') {
    await runCommand('exposure', { quiet: true });
    renderReport();
    return;
  }
  if (action === 'clear') {
    clearReport(entry);
    return;
  }
  if (action === 'export') {
    const tested = Boolean(report.statistics);
    const statColumns = tested ? ['log2fc', 'p', 'q', 'df', 'n_a', 'n_b', 'feature', 'protein_log2fc', 'adjusted_log2fc', 'adjusted_p', 'adjusted_q'] : [];
    const rows = [['chain', 'residue', 'uniprot', 'modification', 'localization', 'value', ...statColumns, 'ppse', 'idr', 'peptides', ...report.summary.samples]];
    const number = (value) => (Number.isFinite(value) ? Number(value.toPrecision(6)) : '');
    for (const site of report.mapped.sites) {
      const context = entry.exposure?.get(site.residue.key);
      const stats = site.stats;
      const statCells = tested ? [number(stats?.logFC), number(stats?.p), number(stats?.q), number(stats?.df), stats?.nA ?? '', stats?.nB ?? '', stats?.feature ?? '',
        number(stats?.protein?.logFC), number(stats?.adjusted?.logFC), number(stats?.adjusted?.p), number(stats?.adjusted?.q)] : [];
      rows.push([site.residue.chain, `${site.residue.resName}${site.residue.resSeq}${site.residue.iCode}`, uniprotNumber(entry, site.residue) ?? '', site.label,
        Number.isFinite(site.probability) ? site.probability : '', Number.isFinite(site.value) ? site.value : '', ...statCells, context?.ppse ?? '', context ? (context.idr ? 1 : 0) : '',
        site.peptides.join(';'), ...report.summary.samples.map((sample) => site.quantities[sample] ?? '')]);
    }
    downloadText(`${fileStem()}-sites.csv`, csvText(rows), 'text/csv');
    return;
  }
  const row = event.target.closest('[data-report-site]');
  if (row) {
    const site = report.mapped.sites[Number(row.dataset.reportSite)];
    if (site) focusResidues([site.residue.key]);
  }
}

/* ---------- Differential statistics ---------- */

// Moderated t-tests for a report's two sample groups (stats.js, limma's eBayes): every feature of
// the whole report (modified peptides, or sites of site tables) is normalized and tested, so the
// variance prior and the Benjamini–Hochberg q-values come from the experiment rather than from
// the few features of one protein. A site takes the result of its best-quantified modified
// peptide; with "adjust", its change is corrected for the change of its protein (the median of the
// protein's unmodified peptides per sample), as MSstatsPTM does.

const DEFAULT_STATISTICS = { normalize: 'median', minValid: 2, impute: false, adjust: true, qLimit: 0.05, foldChange: 1 };

function currentStatistics(report) {
  return report.statistics && report.statistics.groups === `${report.settings.groupA.join('\n')}|${report.settings.groupB.join('\n')}` ? report.statistics : null;
}

async function runReportStatistics(entry = state.active) {
  const report = entry?.report;
  if (!report) throw new CommandError('Open a search report first.');
  const settings = report.settings;
  const options = settings.statistics;
  const shared = settings.groupA.filter((sample) => settings.groupB.includes(sample));
  if (shared.length) throw new CommandError(`A sample cannot be in both groups: ${shared.join(', ')}.`);
  if (settings.groupA.length < 2 || settings.groupB.length < 2) {
    throw new CommandError('A moderated t-test needs at least two samples in each group: choose them under Fold change.');
  }
  const { readReport } = await reportsModule();
  const stats = await import('./lib/stats.js');
  lazyModules.stats = stats;
  const key = `${settings.qValue}|${settings.localization}`;
  if (!report.features || report.featuresKey !== key) {
    if (!report.file) throw new CommandError('The report file is no longer available; open it again.');
    const size = report.file.size || 1;
    let lastUpdate = 0;
    showLoading(`Reading all of ${report.name} for statistics`);
    try {
      const full = await readReport(report.file, {
        accessions: report.accessions,
        sequences: report.sequences,
        collect: { qValue: settings.qValue, localization: settings.localization },
        onProgress: (read) => {
          const now = performance.now();
          if (now - lastUpdate < 250) return;
          lastUpdate = now;
          setLoading(`Reading all of ${report.name} for statistics · ${Math.min(99, Math.round((read / size) * 100))}%`);
        },
      });
      report.features = full.features;
      report.featuresKey = key;
    } finally {
      hideLoading();
    }
  }
  const features = report.features;
  // The whole report can have samples in which this structure's proteins were not seen.
  report.allSamples = features.samples;
  const column = new Map(features.samples.map((sample, index) => [sample, index]));
  const groupA = settings.groupA.map((sample) => column.get(sample)).filter((index) => index !== undefined);
  const groupB = settings.groupB.map((sample) => column.get(sample)).filter((index) => index !== undefined);
  if (groupA.length < 2 || groupB.length < 2) throw new CommandError('Fewer than two samples of a group have quantities in the report.');
  const minValid = Math.max(2, Math.round(options.minValid) || 2);
  let matrix = stats.log2Matrix(features.values, features.rows, features.columns);
  if (options.normalize === 'median') matrix = stats.normalizeMedians(matrix).matrix;
  const observed = observedValues(matrix, groupA, groupB);
  if (options.impute) {
    // As in Perseus, a feature observed at least minValid times in either group is imputed and
    // tested; the others are left out.
    matrix = stats.imputeDownshifted(matrix, { seed: 1 }).matrix;
    for (let row = 0; row < matrix.rows; row += 1) {
      if (observed.a[row] < minValid && observed.b[row] < minValid) matrix.values.fill(NaN, row * matrix.columns, (row + 1) * matrix.columns);
    }
  }
  const test = stats.moderatedTTest(matrix, groupA, groupB, { minValid });
  // Modified peptides by (sequence, position, modification), to find each site's peptides.
  const bySite = new Map();
  features.keys.forEach((featureKey, row) => {
    const [kind, sequence, mods] = featureKey.split('|');
    if (kind !== 'pep' || !mods) return;
    for (const mod of mods.split(',')) {
      if (mod.startsWith('?')) continue;
      const index = `${sequence}|${mod}`;
      if (!bySite.has(index)) bySite.set(index, []);
      bySite.get(index).push(row);
    }
  });
  const proteins = proteinChanges(report, features, matrix, groupA, groupB, test, stats, minValid);
  const adjusted = adjustedChanges(features, test, proteins, stats);
  // A feature is significant by its protein-adjusted q-value when it has one.
  let significant = 0;
  let pLimit = 0;
  test.results.forEach((result, row) => {
    if (!result) return;
    const shown = adjusted.get(row) ?? { p: result.p, q: test.q[row] };
    if (!(shown.q <= options.qLimit)) return;
    significant += 1;
    pLimit = Math.max(pLimit, shown.p);
  });
  const inGroups = new Set([...settings.groupA, ...settings.groupB]);
  report.statistics = {
    groups: `${settings.groupA.join('\n')}|${settings.groupB.join('\n')}`,
    test,
    options: { ...options, minValid },
    rowOf: new Map(features.keys.map((featureKey, row) => [featureKey, row])),
    bySite,
    observed,
    matrix,
    groupA,
    groupB,
    pLimit,
    proteins,
    adjusted,
    significant,
    unused: features.samples.filter((sample) => !inGroups.has(sample)),
  };
  applyReport(entry);
  const mapped = report.mapped.sites.filter((site) => site.stats);
  const local = mapped.filter((site) => (site.stats.adjusted ?? site.stats).q <= options.qLimit).length;
  return `Moderated t-test on ${formatNumber(test.tested)} features: ${formatNumber(significant)} with q ≤ ${options.qLimit}; ${local} of ${mapped.length} tested sites of this structure${local ? '' : ' (none significant, so the structure is gray)'}.`;
}

// Values observed (before any imputation) in each group per feature, and their mean.
function observedValues(matrix, groupA, groupB) {
  const { rows, columns, values } = matrix;
  const a = new Int32Array(rows);
  const b = new Int32Array(rows);
  const mean = new Float64Array(rows).fill(NaN);
  for (let row = 0; row < rows; row += 1) {
    let sum = 0;
    for (const column of groupA) {
      const value = values[row * columns + column];
      if (Number.isFinite(value)) {
        a[row] += 1;
        sum += value;
      }
    }
    for (const column of groupB) {
      const value = values[row * columns + column];
      if (Number.isFinite(value)) {
        b[row] += 1;
        sum += value;
      }
    }
    if (a[row] + b[row]) mean[row] = sum / (a[row] + b[row]);
  }
  return { a, b, mean };
}

function bareAccession(accession) {
  return String(accession ?? '').replace(/-\d+$/, '');
}

// The change of every protein in the report with at least two unmodified peptides: per sample,
// the median of its unmodified peptides (normalized log2), tested with the experiment's prior.
// MSstatsPTM subtracts it from the changes of the protein's modified peptides.
function proteinChanges(report, features, matrix, groupA, groupB, test, stats, minValid) {
  const changes = new Map();
  if (report.kind !== 'peptides' || !report.settings.statistics.adjust) return changes;
  const rowsOf = new Map();
  features.keys.forEach((featureKey, row) => {
    if (!featureKey.startsWith('pep|') || !featureKey.endsWith('|')) return;
    const protein = bareAccession(features.proteins?.[row]);
    if (!protein) return;
    if (!rowsOf.has(protein)) rowsOf.set(protein, []);
    rowsOf.get(protein).push(row);
  });
  const proteins = [...rowsOf].filter(([, rows]) => rows.length >= 2);
  if (!proteins.length) return changes;
  const { columns } = matrix;
  const values = new Float64Array(proteins.length * columns).fill(NaN);
  const present = [];
  proteins.forEach(([, rows], index) => {
    for (let column = 0; column < columns; column += 1) {
      present.length = 0;
      for (const row of rows) {
        const value = matrix.values[row * columns + column];
        if (Number.isFinite(value)) present.push(value);
      }
      if (!present.length) continue;
      present.sort((first, second) => first - second);
      const middle = present.length >> 1;
      values[index * columns + column] = present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2;
    }
  });
  const result = stats.moderatedTTest({ values, rows: proteins.length, columns }, groupA, groupB, { minValid, prior: test.prior });
  proteins.forEach(([protein, rows], index) => {
    if (result.results[index]) changes.set(protein, { ...result.results[index], peptides: rows.length });
  });
  return changes;
}

// Every tested modified peptide whose protein has a change, adjusted for it, with
// Benjamini–Hochberg q-values over all of them (MSstatsPTM adjusts over the whole experiment).
function adjustedChanges(features, test, proteins, stats) {
  const adjusted = new Map();
  if (!proteins.size) return adjusted;
  const rows = [];
  const pValues = [];
  features.keys.forEach((featureKey, row) => {
    const result = test.results[row];
    if (!result || !featureKey.startsWith('pep|') || featureKey.endsWith('|')) return;
    const protein = proteins.get(bareAccession(features.proteins?.[row]));
    if (!protein) return;
    const value = stats.adjustForProtein(result, protein);
    if (!value.adjusted) return;
    adjusted.set(row, value);
    rows.push(row);
    pValues.push(value.p);
  });
  const q = stats.adjustBH(pValues);
  rows.forEach((row, index) => {
    adjusted.get(row).q = q[index];
  });
  return adjusted;
}

// A site's test result: its own row (site tables) or that of its best-quantified modified peptide:
// most observed values, then the highest intensity; never the p-value, which would favor chance.
function siteStatistics(report, statistics, site) {
  const { test, observed } = statistics;
  let row = -1;
  if (report.kind === 'sites') {
    row = statistics.rowOf.get(`site|${site.protein}|${site.uniprot}|${site.label}`) ?? -1;
  } else {
    let best = null;
    for (const feature of site.features ?? []) {
      for (const candidate of statistics.bySite.get(feature) ?? []) {
        if (!test.results[candidate]) continue;
        const count = observed.a[candidate] + observed.b[candidate];
        const mean = observed.mean[candidate];
        if (!best || count > best.count || (count === best.count && mean > best.mean)) best = { row: candidate, count, mean };
      }
    }
    row = best?.row ?? -1;
  }
  const result = row >= 0 ? test.results[row] : null;
  if (!result) return null;
  const stats = { ...result, q: test.q[row], feature: report.features.keys[row] };
  const adjusted = statistics.adjusted.get(row);
  if (adjusted) {
    stats.adjusted = adjusted;
    stats.protein = statistics.proteins.get(bareAccession(report.features.proteins?.[row]));
  }
  return stats;
}

function formatQ(value) {
  if (!Number.isFinite(value)) return '–';
  return value < 0.001 ? value.toExponential(1) : value.toFixed(3);
}

function statisticsControls(report) {
  const options = report.settings.statistics;
  const statistics = currentStatistics(report);
  let summary = '';
  if (statistics) {
    const own = report.accessions.map(bareAccession).filter((accession) => statistics.proteins.has(accession));
    const adjustment = statistics.adjusted.size
      ? ` Modified peptides are adjusted for their protein's change (${formatNumber(statistics.proteins.size)} proteins with unmodified peptides), with q-values over all ${formatNumber(statistics.adjusted.size)} adjusted features${own.length ? `; ${own.map((accession) => `${escapeHTML(accession)} ${statistics.proteins.get(accession).logFC.toFixed(2)} (${statistics.proteins.get(accession).peptides} peptides)`).join(', ')}` : ''}.`
      : '';
    const unused = statistics.unused.length ? `<div class="hint">In neither group: ${escapeHTML(statistics.unused.join(', '))}.</div>` : '';
    summary = `<div>Moderated t-test (limma eBayes): <strong>${formatNumber(statistics.test.tested)}</strong> features of the whole report, d₀ ${Number.isFinite(statistics.test.prior.d0) ? statistics.test.prior.d0.toFixed(1) : '∞'}; <strong>${formatNumber(statistics.significant)}</strong> with q ≤ ${options.qLimit}.${adjustment}</div>${unused}<canvas class="plot volcano" width="640" height="300" data-volcano></canvas>`;
  }
  return `<div class="field-grid report-statistics">
      <label class="field"><span>Normalization</span><select data-stat-setting="normalize"><option value="median"${options.normalize === 'median' ? ' selected' : ''}>Median</option><option value="none"${options.normalize === 'none' ? ' selected' : ''}>None (already normalized)</option></select></label>
      <label class="field" title="Without imputation, each group needs this many values; with it, at least one group does (as in Perseus)"><span>Values per group ≥</span><input type="number" data-stat-setting="minValid" min="2" max="12" step="1" value="${options.minValid}" /></label>
      <label class="check"><input type="checkbox" data-stat-setting="impute"${options.impute ? ' checked' : ''} /> Impute missing (Perseus)</label>
      ${report.kind === 'peptides' ? `<label class="check" title="Subtract the protein's change (median of its unmodified peptides) from each site's, as MSstatsPTM does"><input type="checkbox" data-stat-setting="adjust"${options.adjust ? ' checked' : ''} /> Adjust sites for protein</label>` : ''}
    </div>
    <div class="button-row"><button type="button" data-report-action="test" title="Moderated t-test of every feature in the report (all proteins), with Benjamini–Hochberg q-values">${statistics ? 'Test again' : 'Test B vs A'}</button></div>
    ${summary}`;
}

function drawReportVolcano(entry) {
  const report = entry?.report;
  const statistics = report ? currentStatistics(report) : null;
  const canvas = els.reportResult.querySelector('[data-volcano]');
  if (!statistics || !canvas) return;
  const { test } = statistics;
  const local = new Map();
  for (const site of report.mapped.sites) if (site.stats) local.set(site.stats.feature, site);
  const points = [];
  test.results.forEach((result, row) => {
    if (!result) return;
    const site = local.get(report.features.keys[row]);
    const adjusted = statistics.adjusted.get(row);
    const shown = adjusted ?? result;
    points.push({ x: shown.logFC, y: -Math.log10(Math.max(shown.p, 1e-300)), highlight: Boolean(site), significant: (adjusted ? adjusted.q : test.q[row]) <= statistics.options.qLimit, site });
  });
  const hits = drawVolcano(canvas, points, { pLimit: statistics.pLimit || undefined, foldChange: statistics.options.foldChange });
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    let nearest = null;
    for (const hit of hits) {
      const distance = Math.hypot(hit.x - x, hit.y - y);
      if (distance < 14 && (!nearest || distance < nearest.distance)) nearest = { distance, hit };
    }
    if (nearest) focusResidues([nearest.hit.point.site.residue.key]);
  };
}

/* ---------- HDX-MS ---------- */

// HDX peptides are matched to the chain sequences (so their numbering can differ from the
// structure's); every chain that contains them gets the values.
async function importHDX(ref) {
  const hdx = await import('./lib/hdx.js');
  const data = hdx.parseHDX(await ref.text(), ref.name);
  if (!data) return false;
  const entry = state.active;
  if (!entry) throw new Error(`Open a structure before ${ref.name}.`);
  lazyModules.hdx = hdx;
  const module = await proteomicsModule();
  const sequences = [...new Set(data.peptides.map((peptide) => peptide.sequence.toUpperCase()))];
  const chains = [...entry.structure.sequences.values()].filter((info) => info.kind === 'protein');
  const result = module.mapPeptides(sequences, chains.map((info) => ({ id: info.chain, sequence: info.sequence })), { ilEquivalent: false });
  const positions = new Map();
  for (const chainResult of result.chains) {
    const map = new Map();
    for (const match of chainResult.matches) if (!map.has(sequences[match.peptide])) map.set(sequences[match.peptide], { start: match.start, end: match.end });
    if (map.size) positions.set(chainResult.id, { map, coverage: chainResult.coverageFraction });
  }
  if (!positions.size) throw new Error(`${ref.name}: none of its ${sequences.length} peptides occur in the chains of ${entry.name}.`);
  const states = data.states.filter((name) => !/full[- ]?deut|^fd$|^max$/i.test(name));
  const difference = states.length > 1;
  entry.hdx = {
    data,
    positions,
    unmatched: sequences.filter((sequence) => ![...positions.values()].some((chain) => chain.map.has(sequence))).length,
    settings: { view: difference ? 'difference' : 'uptake', reference: states[0] ?? data.states[0], state: states[1] ?? states[0] ?? data.states[0], exposure: 'all', alpha: 0.01, threshold: null },
  };
  applyHDX(entry);
  activateTab('proteomics');
  return true;
}

function applyHDX(entry = state.active) {
  const hdx = entry.hdx;
  if (!hdx) return;
  const { peptideDifferences, residueValues } = lazyModules.hdx;
  const settings = hdx.settings;
  const difference = settings.view === 'difference';
  const result = peptideDifferences(hdx.data, {
    state: settings.state,
    reference: difference ? settings.reference : null,
    exposure: settings.exposure,
    alpha: settings.alpha,
    threshold: settings.threshold,
  });
  hdx.result = result;
  const values = new Map();
  for (const [chain, mapped] of hdx.positions) {
    const info = entry.structure.sequences.get(chain);
    const items = info.items.filter((item) => !item.gap);
    const rowPositions = new Map();
    result.rows.forEach((row, index) => {
      const position = mapped.map.get(row.sequence.toUpperCase());
      if (position) rowPositions.set(index, position);
    });
    const chainValues = residueValues(result.rows, rowPositions, info.sequence.toUpperCase(), { value: 'relative', significantOnly: difference });
    for (const [index, value] of chainValues) {
      const residue = items[index]?.residue;
      if (residue) values.set(residue.key, value * 100);
    }
  }
  hdx.values = values.size ? values : null;
  entry.proteomics.data = hdx.values;
  entry.proteomics.dataLabel = difference ? `ΔD ${settings.state} − ${settings.reference} (% of max)` : `D uptake, ${settings.state} (% of max)`;
  entry.color.colormap = difference ? 'bwr' : 'viridis';
  if (entry === state.active) {
    els.dataSymmetric.checked = difference;
    setColorScheme('data', [entry]);
    renderHDX();
    renderProfile();
  }
}

function hdxExposureLabel(seconds) {
  if (seconds >= 3600) return `${Number((seconds / 3600).toFixed(2))} h`;
  if (seconds >= 60) return `${Number((seconds / 60).toFixed(2))} min`;
  return `${Number(seconds.toFixed(2))} s`;
}

function renderHDX() {
  const box = document.querySelector('#hdx-result');
  const hdx = state.active?.hdx;
  box.hidden = !hdx?.result;
  if (!hdx?.result) {
    box.replaceChildren();
    return;
  }
  const { data, settings, result } = hdx;
  const difference = settings.view === 'difference';
  const peptides = new Set(data.peptides.map((peptide) => `${peptide.start}-${peptide.end}-${peptide.sequence}`)).size;
  const significant = result.rows.filter((row) => row.significant);
  const protectedCount = significant.filter((row) => row.delta < 0).length;
  const stateOptions = (chosen) => data.states.map((name) => `<option value="${escapeHTML(name)}"${name === chosen ? ' selected' : ''}>${escapeHTML(name)}</option>`).join('');
  const exposures = data.exposures.filter((value) => value > 0);
  box.innerHTML = `
    <div><strong>${escapeHTML(data.label)}</strong> · ${escapeHTML(data.name)}</div>
    <div>${formatNumber(peptides)} peptides · ${data.states.length} state${data.states.length === 1 ? '' : 's'} · ${exposures.length} exposures (${exposures.length ? `${hdxExposureLabel(exposures[0])} – ${hdxExposureLabel(exposures.at(-1))}` : '–'})${hdx.unmatched ? ` · <span class="warn">${hdx.unmatched} peptide${hdx.unmatched === 1 ? '' : 's'} not in the structure</span>` : ''}</div>
    ${[...hdx.positions].map(([chain, mapped]) => `<div>Chain ${escapeHTML(chain)}: <strong>${(mapped.coverage * 100).toFixed(1)}%</strong> of the sequence covered</div>`).join('')}
    <div class="segmented two" role="group" aria-label="HDX view">
      <button type="button" data-hdx-view="difference" class="${difference ? 'is-active' : ''}"${data.states.length < 2 ? ' disabled' : ''}>Difference</button>
      <button type="button" data-hdx-view="uptake" class="${difference ? '' : 'is-active'}">Uptake</button>
    </div>
    <div class="field-grid">
      <label class="field"><span>${difference ? 'State' : 'State'}</span><select data-hdx-setting="state">${stateOptions(settings.state)}</select></label>
      ${difference ? `<label class="field"><span>Reference</span><select data-hdx-setting="reference">${stateOptions(settings.reference)}</select></label>` : ''}
      <label class="field"><span>Exposure</span><select data-hdx-setting="exposure"><option value="all"${settings.exposure === 'all' ? ' selected' : ''}>All (summed)</option>${exposures.map((value) => `<option value="${value}"${settings.exposure === value ? ' selected' : ''}>${escapeHTML(hdxExposureLabel(value))}</option>`).join('')}</select></label>
      ${difference ? `<label class="field"><span>${result.test === 'hybrid' ? 'Hybrid test <span class="keep-case">α</span>' : 'Threshold (D)'}</span><input type="number" data-hdx-setting="${result.test === 'hybrid' ? 'alpha' : 'threshold'}" min="0" step="${result.test === 'hybrid' ? 0.005 : 0.1}" value="${result.test === 'hybrid' ? settings.alpha : Number(result.limit.toFixed(2))}" /></label>` : ''}
    </div>
    <canvas class="plot wide hdx-woods" width="640" height="220" aria-label="Woods plot"></canvas>
    <div class="hint">${difference
      ? `Woods plot: each peptide's ΔD over its residues; dashed: ±${result.limit.toFixed(2)} D (${result.test === 'hybrid' ? `hybrid test, α = ${settings.alpha}` : 'fixed threshold, no replicate statistics'}). <strong>${significant.length}</strong> of ${result.rows.length} peptides differ: ${protectedCount} protected (blue), ${significant.length - protectedCount} deprotected (red). Only significant peptides color the structure.`
      : 'Relative uptake per peptide (fraction of exchangeable amides); the structure shows it per residue.'}</div>
    <div class="button-row"><button type="button" data-hdx-action="clear">Clear</button></div>`;
  drawWoods(box.querySelector('.hdx-woods'), result.rows, difference ? { value: 'delta', limit: result.limit, label: 'ΔD (D)' } : { value: 'relative', limit: 0, range: [0, 1], label: 'Relative uptake' });
}

function onHDXControl(event) {
  const hdx = state.active?.hdx;
  const key = event.target.dataset.hdxSetting;
  if (!hdx || !key) return;
  const value = event.target.value;
  if (key === 'exposure') hdx.settings.exposure = value === 'all' ? 'all' : Number(value);
  else if (key === 'alpha') hdx.settings.alpha = Math.min(0.5, Math.max(1e-6, Number(value) || 0.01));
  else if (key === 'threshold') hdx.settings.threshold = Math.max(0, Number(value) || 0.5);
  else hdx.settings[key] = value;
  applyHDX(state.active);
}

function onHDXClick(event) {
  const entry = state.active;
  const hdx = entry?.hdx;
  if (!hdx) return;
  const view = event.target.closest('[data-hdx-view]')?.dataset.hdxView;
  if (view) {
    hdx.settings.view = view;
    applyHDX(entry);
    return;
  }
  if (event.target.closest('[data-hdx-action="clear"]')) {
    if (entry.proteomics.data && entry.proteomics.data === hdx.values) {
      entry.proteomics.data = null;
      entry.proteomics.dataLabel = '';
    }
    entry.hdx = null;
    resetImportedColors(entry);
    renderHDX();
  }
}

/* ---------- Public evidence ---------- */

// Proteins API modification names, and the names search engines use for the same chemistry.
const EVIDENCE_NAMES = {
  Phosphorylation: ['Phospho'],
  Acetylation: ['Acetyl'],
  Ubiquitinylation: ['GlyGly'],
  Methylation: ['Methyl', 'Dimethyl', 'Trimethyl'],
  SUMOylation: [],
};

async function loadEvidence(entry = state.active) {
  const accessions = [...new Set([...chainAccessions(entry).values()].map((item) => item.accession))];
  if (!accessions.length) throw new CommandError(`${entry.name} has no UniProt reference, so its public evidence cannot be found.`);
  if (state.startup?.offline) throw new CommandError('Public evidence needs network access; Proteoscope was started with --offline.');
  showLoading('Loading public proteomics evidence');
  try {
    const results = await Promise.all(accessions.slice(0, 6).map(async (accession) => {
      const response = await fetch(`/api/fetch/proteomics/${encodeURIComponent(accession)}`);
      if (!response.ok) return { accession, error: await responseError(response, 'Could not load evidence') };
      return response.json();
    }));
    mapEvidence(entry, results);
  } finally {
    hideLoading();
  }
  if (entry === state.active) {
    activateTab('proteomics');
    renderEvidence();
    renderReport();
  }
  return { accessions, peptides: entry.evidence.peptideCount, sites: entry.evidence.sites.length };
}

function mapEvidence(entry, results) {
  const coverage = new Map();
  const sites = [];
  const summaries = [];
  let peptideCount = 0;
  const references = chainAccessions(entry);
  for (const result of results) {
    if (result.error) {
      summaries.push({ accession: result.accession, error: result.error });
      continue;
    }
    const chains = [...references].filter(([, reference]) => reference.accession === result.accession);
    const covered = new Set();
    for (const [chain, reference] of chains) {
      const info = entry.structure.sequences.get(chain);
      for (const peptide of result.peptides) {
        for (const residue of residuesForUniprotRange(info, peptide.begin, peptide.end, reference)) coverage.set(residue.key, (coverage.get(residue.key) ?? 0) + 1);
        for (let position = peptide.begin; position <= peptide.end; position += 1) covered.add(position);
      }
      for (const site of result.sites) {
        const [residue] = residuesForUniprotRange(info, site.position, site.position, reference);
        if (residue) sites.push({ ...site, residue, accession: result.accession, mismatch: Boolean(site.residue) && residue.code !== site.residue });
      }
    }
    peptideCount += result.peptides.length;
    summaries.push({ accession: result.accession, length: result.length, peptides: result.peptides.length, covered: covered.size, sites: result.sites.length, problems: result.problems ?? [] });
  }
  entry.evidence = { coverage, sites, summaries, peptideCount, type: entry.evidence?.type ?? 'all' };
}

function evidenceSitesOfType(evidence) {
  return evidence.type === 'all' ? evidence.sites : evidence.sites.filter((site) => site.name === evidence.type);
}

// The public site matching a site of the imported report, if any: same residue, same chemistry.
function publicSiteFor(entry, residue, label) {
  const evidence = entry.evidence;
  if (!evidence) return undefined;
  return evidence.sites.find((site) => site.residue.key === residue.key && (EVIDENCE_NAMES[site.name]?.includes(label) || site.name.toLowerCase().startsWith(String(label).toLowerCase()))) ?? null;
}

function renderEvidence() {
  const entry = state.active;
  const evidence = entry?.evidence;
  els.evidenceResult.hidden = !evidence;
  if (!evidence) {
    els.evidenceResult.replaceChildren();
    return;
  }
  const types = new Map();
  for (const site of evidence.sites) types.set(site.name, (types.get(site.name) ?? 0) + 1);
  const shown = evidenceSitesOfType(evidence);
  const rows = shown.slice(0, 120).map((site, index) => `<tr class="clickable" data-evidence-site="${evidence.sites.indexOf(site)}">
      <td>${escapeHTML(`${site.residue.code}${site.position}`)}${state.structure.chains.length > 1 ? ` <small>${escapeHTML(site.residue.chain)}</small>` : ''}</td>
      <td>${escapeHTML(site.name)}</td>
      <td>${Number.isFinite(site.probability) ? site.probability.toFixed(2) : '–'}</td>
      <td>${escapeHTML(site.confidence || '')}</td>
      <td title="${escapeHTML(site.datasets.join(', '))}">${site.datasets.length}</td>
    </tr>`).join('');
  els.evidenceResult.innerHTML = `
    ${evidence.summaries.map((summary) => (summary.error
      ? `<div class="warn">${escapeHTML(summary.accession)}: ${escapeHTML(summary.error)}</div>`
      : `<div><strong>${escapeHTML(summary.accession)}</strong> · ${formatNumber(summary.peptides)} public peptides cover ${summary.length ? pct(summary.covered, summary.length) : '–'} · ${formatNumber(summary.sites)} modification sites${summary.problems.length ? ` <span class="warn">(${escapeHTML(summary.problems.join('; '))})</span>` : ''}</div>`)).join('')}
    <div class="inline-form compact">
      <select data-evidence-type aria-label="Modification type"><option value="all">All modifications (${evidence.sites.length})</option>${[...types].sort((a, b) => b[1] - a[1]).map(([name, count]) => `<option value="${escapeHTML(name)}"${evidence.type === name ? ' selected' : ''}>${escapeHTML(name)} (${count})</option>`).join('')}</select>
    </div>
    <div class="button-row">
      <button type="button" data-evidence-action="coverage">Color public coverage</button>
      <button type="button" data-evidence-action="sites">Mark ${formatNumber(Math.min(shown.length, 300))} sites</button>
    </div>
    ${shown.length ? `<table><thead><tr><th>Site</th><th>Modification</th><th title="Best site probability">Prob.</th><th title="PTMeXchange confidence">Conf.</th><th title="PRIDE datasets">Sets</th></tr></thead><tbody>${rows}</tbody></table>${shown.length > 120 ? `<div class="hint">Showing 120 of ${formatNumber(shown.length)}.</div>` : ''}` : '<div class="hint">No public modification sites of this type on the modeled residues.</div>'}
    <div class="hint">Sources: PeptideAtlas, ProteomicsDB, PRIDE and PTMeXchange through the EBI Proteins API.</div>`;
}

function showEvidenceCoverage(entry = state.active) {
  if (!entry.evidence) return;
  entry.proteomics.coverage = entry.evidence.coverage.size ? entry.evidence.coverage : null;
  setColorScheme('coverage', [entry]);
}

function onEvidenceClick(event) {
  const entry = state.active;
  const evidence = entry?.evidence;
  if (!evidence) return;
  const action = event.target.closest('[data-evidence-action]')?.dataset.evidenceAction;
  if (action === 'coverage') {
    showEvidenceCoverage(entry);
    return;
  }
  if (action === 'sites') {
    const sites = evidenceSitesOfType(evidence).slice(0, 300);
    setSites(sites.map((site) => ({ residue: site.residue, label: `${site.residue.code}${site.position} ${site.name}`, mismatch: site.mismatch })));
    focusResidues(sites.map((site) => site.residue.key));
    return;
  }
  const row = event.target.closest('[data-evidence-site]');
  if (row) {
    const site = evidence.sites[Number(row.dataset.evidenceSite)];
    if (site) focusResidues([site.residue.key]);
  }
}

/* ---------- Part-sphere exposure ---------- */

// StructureMap's pPSE and disorder for the active model, with its PAE when there is one.
function computeExposure(entry = state.active) {
  const model = activeModelOf(entry);
  const atom = (residue, name) => residue.atoms.find((item) => item.name === name) ?? null;
  const residues = model.residues.filter((residue) => residue.kind === 'protein').map((residue) => ({
    key: residue.key, chain: residue.chain, ca: atom(residue, 'CA'), cb: atom(residue, 'CB'), n: atom(residue, 'N'), c: atom(residue, 'C'),
  }));
  let pae = null;
  if (entry.pae?.residues?.length) {
    const index = new Map();
    entry.pae.residues.forEach((residue, row) => {
      if (residue && !index.has(residue.key)) index.set(residue.key, row);
    });
    pae = { matrix: entry.pae.matrix, size: entry.pae.size, index };
  }
  entry.exposure = partSphereExposure(residues, { pae });
  entry.exposureWithPAE = Boolean(pae);
  return entry.exposure;
}

function renderExposureResult(entry = state.active) {
  const exposure = entry?.exposure;
  els.ppseResult.hidden = !exposure;
  if (!exposure) return;
  const values = [...exposure.values()];
  const idr = values.filter((value) => value.idr).length;
  const exposed = values.filter((value) => value.exposed).length;
  els.ppseResult.innerHTML = `<strong>${formatNumber(values.length)}</strong> residues · ${pct(exposed, values.length)} highly exposed (pPSE ≤ ${PPSE_EXPOSED}) · ${pct(idr, values.length)} in disordered regions${entry.exposureWithPAE ? ' · PAE-aware' : ' · no PAE (structure taken as rigid)'}
    <div class="hint">Select with <code>ppse &lt; 6</code> or <code>idr</code>; the profile plot shows pPSE.</div>`;
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
  els.bondOrders.value = display.bondOrders ?? 'ligands';
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
  // Part-sphere exposure is quick, so it follows the model rather than going stale.
  if (entry.exposure) {
    computeExposure(entry);
    renderExposureResult(entry);
    renderReport();
    if (entry.color.scheme === 'ppse') markColorsDirty();
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
  // Map mesh lines keep their on-screen width relative to the image.
  settings.lineScale = factor;
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

// Bundled examples, grouped by the manifest's categories.
function populateSamples() {
  els.sampleSelect.replaceChildren(new Option('Choose an example…', ''));
  const groups = new Map();
  for (const sample of state.samples) {
    const category = sample.category || 'Other files';
    if (!groups.has(category)) {
      const group = document.createElement('optgroup');
      group.label = category;
      groups.set(category, group);
      els.sampleSelect.appendChild(group);
    }
    const option = new Option(sampleSummary(sample), sample.id);
    option.title = sample.description || sample.title;
    groups.get(category).appendChild(option);
  }
}

function sampleSummary(sample) {
  if (sample.label) return `${sample.name} · ${sample.label}`;
  const title = (sample.title || '').replace(/^[0-9A-Z]{4}:\s*/, '');
  const short = title.length > 46 ? `${title.slice(0, 45)}…` : title;
  return `${sample.name} · ${titleCase(short)}`;
}

// Finds an example by id; sessions and links saved when the examples were PDB files name them
// "1m17.pdb", which resolves through the stem.
function findSample(id) {
  const value = String(id ?? '').trim().toLowerCase();
  if (!value) return null;
  const stem = value.replace(/\.gz$/, '').replace(/\.(pdb|ent|cif|mmcif|bcif)$/, '');
  return state.samples.find((sample) => sample.id === value) ?? state.samples.find((sample) => sample.id === stem) ?? null;
}

// Opens an example (with its PAE, when it has one). options.view runs its opening view;
// options.select (default: unless adding) shows it in the menu with its description.
async function openSample(sample, options = {}) {
  const template = options.view && !options.add ? state.defaults : undefined;
  const entry = await loadStructureFromURL(sample.url, sample.name, { add: options.add, activate: options.activate, template, origin: { type: 'sample', id: sample.id } });
  if (sample.pae) await loadPAEFromURL(sample.pae, entry, 'AlphaFold DB');
  if (options.select ?? !options.add) setSampleSelection(sample);
  if (options.view) await runSampleView(sample);
  return entry;
}

async function runSampleView(sample) {
  for (const command of sample.view ?? []) {
    const result = await runCommand(command, { quiet: true, history: false });
    if (!result.ok) throw new Error(`${sample.name}: "${command}" failed: ${result.message}`);
  }
}

function setSampleSelection(sample) {
  els.sampleSelect.value = sample?.id ?? '';
  els.sampleInfo.hidden = !sample?.description;
  if (!sample?.description) {
    els.sampleInfo.replaceChildren();
    return;
  }
  const source = sampleSourceURL(sample);
  els.sampleInfo.innerHTML = `<p>${escapeHTML(sample.description)}</p>
    <p class="sample-credit">${escapeHTML(sample.credit ?? '')}</p>
    <div class="button-row">${sample.view?.length ? `<button type="button" data-sample-view="${escapeHTML(sample.id)}" title="${escapeHTML(sample.view.join('; '))}">Show view</button>` : ''}${source ? `<a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.label)} ↗</a>` : ''}</div>`;
}

function sampleSourceURL(sample) {
  if (sample.accession) return { url: `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(sample.accession)}`, label: 'AlphaFold DB' };
  if (/^[0-9][A-Z0-9]{3}$/i.test(sample.name)) return { url: `https://www.rcsb.org/structure/${encodeURIComponent(sample.name.toUpperCase())}`, label: 'RCSB PDB' };
  return null;
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
    const summarize = (results) => results.map((item) => ({ name: item.mobile.name, stats: item.result?.stats, error: item.error?.message }));
    if (options.method === 'structure') return runStructuralSuperposition({ ...options, reference: referenceEntry, mobiles }).then(summarize);
    return summarize(runSuperposition({ ...options, reference: referenceEntry, mobiles }));
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
