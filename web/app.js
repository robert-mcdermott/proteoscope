import { createRenderer, MESH_VERTEX_STRIDE, packColor, withTimeout } from './lib/renderer.js';
import { createCanvasRenderer } from './lib/renderer-canvas.js';
import { ASYMMETRIC_UNIT_ID, parseStructure } from './lib/parse.js';
import {
  MAX_ASSEMBLY_ATOMS,
  assignSecondary,
  buildSearchItems,
  deriveStructure,
  materializeAssemblyModels,
  prepareAssemblyEstimates,
  residueForUniprotPosition,
  uniprotPositionForResidue,
} from './lib/structure.js';
import { buildScene, focusNeighborhood } from './lib/scene.js';
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

const state = {
  samples: [],
  startup: null,
  structure: null,
  sourceLabel: '',
  activeModel: 0,
  display: {
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
  },
  color: { scheme: 'chain', palette: 'vivid', colormap: '', uniformColor: '#b8c4d0', heteroByElement: true },
  surface: { kind: 'off', color: 'scheme', opacity: 1, key: '', pending: 0, data: null },
  lighting: { preset: 'standard', ...LIGHTING_PRESETS.standard },
  background: 'dark',
  clip: { near: 0, far: 1 },
  secondaryMode: 'auto',
  camera: createCamera(),
  cameraAnimation: null,
  spin: false,
  selection: new Set(),
  selectedAtom: null,
  hover: { atom: -1, residueKey: null },
  focus: null,
  measureMode: null,
  measurePending: [],
  measurements: [],
  labels: new Set(),
  interactions: { list: [], title: '', enabled: new Set(INTERACTION_FALLBACK_TYPES.map((type) => type.id)) },
  interactionTypes: INTERACTION_FALLBACK_TYPES,
  sasa: null,
  proteomics: { coverage: null, data: null, dataLabel: '', sites: [], siteOverrides: null, crosslinks: [] },
  pae: null,
  paeSelection: null,
  legend: null,
  atomColors: null,
  atomFlags: null,
  sceneResult: null,
  cartoonKey: '',
  dirty: { scene: true, colors: true, flags: true, render: true, surface: false, panels: true },
  pointers: new Map(),
  drag: null,
  modelTimer: null,
  lastHoverPick: 0,
  pickPending: false,
  renderer: null,
  workers: null,
};

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
    await loadStructureFromURL(startup.files[0].url, startup.files[0].name);
  } else if (fetchRequest) {
    await fetchStructure(fetchRequest);
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
    await guardedLoad(() => loadStructureFromURL(sample.url, sample.name));
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
    state.surface.kind = els.surfaceKind.value;
    refreshSurface();
  });
  els.surfaceColor.addEventListener('change', () => {
    state.surface.color = els.surfaceColor.value;
    applySurfaceColors();
  });
  els.surfaceOpacity.addEventListener('input', () => {
    state.surface.opacity = Number(els.surfaceOpacity.value);
    els.surfaceOpacityValue.textContent = `${Math.round(state.surface.opacity * 100)}%`;
    state.renderer.setMeshOpacity('surface', state.surface.opacity);
    requestRender();
  });

  els.colorScheme.addEventListener('change', () => setColorScheme(els.colorScheme.value));
  els.chainPalette.addEventListener('change', () => {
    state.color.palette = els.chainPalette.value;
    markColorsDirty();
    renderChains();
  });
  els.colormap.addEventListener('change', () => {
    state.color.colormap = els.colormap.value;
    markColorsDirty();
  });
  els.uniformColor.addEventListener('input', () => {
    state.color.uniformColor = els.uniformColor.value;
    markColorsDirty();
  });
  els.heteroElement.addEventListener('change', () => {
    state.color.heteroByElement = els.heteroElement.checked;
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

  els.interfaceRun.addEventListener('click', runInterfaceAnalysis);
  els.interactionsClear.addEventListener('click', () => {
    state.interactions = { ...state.interactions, list: [], title: '' };
    renderInteractions();
    markSceneDirty();
  });
  els.interactionsExport.addEventListener('click', exportInteractionsCSV);
  els.sasaRun.addEventListener('click', runSASA);
  els.sasaColor.addEventListener('click', () => setColorScheme('exposure'));
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

async function fetchStructure(query) {
  const request = normalizeFetchQuery(query);
  if (!request) {
    showToast(`"${query}" is not a PDB ID (e.g. 4HHB) or UniProt accession (e.g. P69905).`, true);
    return;
  }
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
    await loadStructureFromText(text, filename, { source: request.label });
    applyRemoteMetadata(response.headers.get('X-Proteoscope-Meta-B64'));
    els.sampleSelect.value = '';
    history.replaceState(null, '', `#fetch=${encodeURIComponent(request.id)}`);
    const paeURL = response.headers.get('X-Proteoscope-Pae');
    if (paeURL) loadPAEFromURL(paeURL);
  });
}

function applyRemoteMetadata(encoded) {
  if (!encoded || !state.structure) return;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const meta = JSON.parse(new TextDecoder().decode(bytes));
    const structureMeta = state.structure.meta;
    if (meta.uniprotDescription) {
      structureMeta.title = `${meta.entryId || structureMeta.code}: ${meta.uniprotDescription}${meta.gene ? ` (${meta.gene})` : ''}`;
    }
    if (meta.organismScientificName) structureMeta.organism = meta.organismScientificName;
    if (!structureMeta.method) structureMeta.method = `AlphaFold DB v${meta.latestVersion ?? ''} prediction`.replace(' v prediction', ' prediction');
    updateStructureUI();
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
    if (structures.length) {
      const file = structures[0];
      showLoading(`Reading ${file.name}`);
      const text = await readFileText(file);
      await loadStructureFromText(text, file.name.replace(/\.gz$/i, ''), { source: 'Local file' });
      els.sampleSelect.value = '';
      history.replaceState(null, '', location.pathname);
      if (structures.length > 1) showToast(`Opened ${file.name}. Proteoscope shows one structure at a time; the other ${structures.length - 1} file(s) were skipped.`);
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

async function loadStructureFromURL(url, label) {
  showLoading(`Loading ${label}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  const text = await response.text();
  const filename = response.headers.get('X-Proteoscope-Filename') || url.split('/').pop() || label;
  await loadStructureFromText(text, filename, { source: label });
}

async function loadStructureFromText(text, label, options = {}) {
  showLoading(`Parsing ${label}`);
  await nextFrame();
  const structure = parseStructure(text, label);
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  showLoading('Deriving residues, bonds and secondary structure');
  await nextFrame();
  deriveStructure(structure, { secondaryMode: state.secondaryMode });
  resetStructureState();
  state.structure = structure;
  state.sourceLabel = options.source || '';
  state.legendCollapsed = structure.chains.filter((chain) => chain.polymerKind).length > 8;
  if (structure.meta.isPredicted && state.color.scheme === 'chain') {
    state.color.scheme = 'plddt';
    els.colorScheme.value = 'plddt';
  } else if (!structure.meta.isPredicted && state.color.scheme === 'plddt') {
    state.color.scheme = 'chain';
    els.colorScheme.value = 'chain';
  }
  updateStructureUI();
  fitView(false, true);
  markSceneDirty();
  refreshSurface();
  hideLoading();
}

function resetStructureState() {
  state.activeModel = 0;
  state.selection = new Set();
  state.selectedAtom = null;
  state.hover = { atom: -1, residueKey: null };
  state.focus = null;
  state.measurePending = [];
  state.measurements = [];
  state.labels = new Set();
  state.display.visibleChains = null;
  state.interactions = { ...state.interactions, list: [], title: '' };
  state.sasa = null;
  state.proteomics = { coverage: null, data: null, dataLabel: '', sites: [], siteOverrides: null, crosslinks: [] };
  state.pae = null;
  state.paeSelection = null;
  state.surface.data = null;
  state.surface.key = '';
  state.renderer?.setMesh('surface', null);
  stopModelPlayback();
  if (['coverage', 'data', 'exposure'].includes(state.color.scheme)) {
    state.color.scheme = 'chain';
    els.colorScheme.value = 'chain';
  }
  for (const box of [els.interfaceResult, els.sasaResult, els.peptideResult, els.siteResult, els.xlResult, els.dataResult]) {
    box.hidden = true;
    box.replaceChildren();
  }
  els.sasaColor.disabled = true;
}

async function activateAssembly(assemblyID) {
  const structure = state.structure;
  if (!structure || structure.activeAssemblyId === assemblyID) return;
  const previous = { id: structure.activeAssemblyId, models: structure.models };
  showLoading(assemblyID === ASYMMETRIC_UNIT_ID ? 'Restoring asymmetric unit' : `Building assembly ${assemblyID}`);
  await nextFrame();
  try {
    structure.activeAssemblyId = assemblyID;
    structure.models = materializeAssemblyModels(structure, assemblyID);
    deriveStructure(structure, { secondaryMode: state.secondaryMode });
    resetStructureState();
    updateStructureUI();
    fitView(false, true);
    markSceneDirty();
    refreshSurface();
  } catch (error) {
    structure.activeAssemblyId = previous.id;
    structure.models = previous.models;
    showToast(error.message, true);
    updateStructureUI();
  }
  hideLoading();
}

function reassignSecondary() {
  const structure = state.structure;
  if (!structure) return;
  for (const model of structure.models) {
    assignSecondary(model, structure, state.secondaryMode);
    model.cartoonCache = new Map();
  }
  state.cartoonKey = '';
  updateSecondarySummary();
  markSceneDirty();
  markColorsDirty();
  renderSequence();
  refreshTabPanels();
}

/* ---------- Scene ---------- */

function activeModel() {
  return state.structure.models[state.activeModel] ?? state.structure.models[0];
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
  Object.assign(state.display, patch);
  if ('polymer' in patch || 'ligand' in patch) {
    const preset = Object.entries(REPRESENTATION_PRESETS).find(([, value]) => value.polymer === state.display.polymer && value.ligand === state.display.ligand && (value.surface === 'off') === (state.surface.kind === 'off'));
    document.querySelectorAll('[data-preset]').forEach((button) => button.classList.toggle('is-active', preset?.[0] === button.dataset.preset));
  }
  markSceneDirty();
}

function applyRepresentationPreset(name) {
  const preset = REPRESENTATION_PRESETS[name];
  if (!preset) return;
  setActiveButton('[data-preset]', document.querySelector(`[data-preset="${name}"]`));
  state.display.polymer = preset.polymer;
  state.display.ligand = preset.ligand;
  els.polymerRep.value = preset.polymer;
  els.ligandRep.value = preset.ligand;
  if (preset.surface !== state.surface.kind) {
    state.surface.kind = preset.surface;
    els.surfaceKind.value = preset.surface;
    refreshSurface();
  }
  markSceneDirty();
}

function cartoonFor(model) {
  const chains = state.display.visibleChains ? [...state.display.visibleChains].sort().join(',') : '*';
  const key = [model.number, chains, state.display.cartoonWidth.toFixed(2), state.display.cartoonQuality, state.secondaryMode].join('|');
  const cached = model.cartoonCache.get(key);
  if (cached) return cached;
  const cartoon = buildCartoon(model, {
    include: (residue) => !state.display.visibleChains || state.display.visibleChains.has(residue.chain),
    widthScale: state.display.cartoonWidth,
    quality: state.display.cartoonQuality,
  });
  if (model.cartoonCache.size > 6) model.cartoonCache.clear();
  model.cartoonCache.set(key, cartoon);
  return cartoon;
}

function rebuildScene() {
  if (!state.structure) return;
  const model = activeModel();
  const cartoon = state.display.polymer === 'cartoon' ? cartoonFor(model) : null;
  const scene = buildScene(model, state.structure, state.display, {
    cartoon,
    focusResidues: state.focus?.neighborhood,
    emphasisResidues: siteResidueKeys(),
    lines: sceneLines(model),
  });
  state.sceneResult = scene;
  state.renderer.setSpheres(scene.spheres.data, scene.spheres.count);
  state.renderer.setCylinders(scene.cylinders.data, scene.cylinders.count);
  if (cartoon) {
    state.renderer.setMesh('cartoon', { vertices: cartoon.vertices, indices: cartoon.indices, opacity: 1 });
  } else {
    state.renderer.setMesh('cartoon', null);
  }
  state.renderer.setCanvasShapes?.(cartoon?.canvasShapes ?? []);
  state.dirty.scene = false;
}

function sceneLines(model) {
  const lines = [];
  for (const measurement of state.measurements) {
    const atoms = measurement.atoms.map((id) => model.atoms[id]).filter(Boolean);
    for (let index = 0; index + 1 < atoms.length; index += 1) {
      lines.push({ from: point(atoms[index]), to: point(atoms[index + 1]), color: [1, 0.84, 0.3], radius: 0.07, atomA: atoms[index].id, atomB: atoms[index + 1].id });
    }
  }
  for (const pending of state.measurePending.length > 1 ? [state.measurePending] : []) {
    for (let index = 0; index + 1 < pending.length; index += 1) {
      const a = model.atoms[pending[index]];
      const b = model.atoms[pending[index + 1]];
      if (a && b) lines.push({ from: point(a), to: point(b), color: [1, 0.84, 0.3], radius: 0.06 });
    }
  }
  const typeColors = new Map(state.interactionTypes.map((type) => [type.id, hexColor(type.color)]));
  for (const interaction of state.interactions.list) {
    if (!state.interactions.enabled.has(interaction.type)) continue;
    lines.push({
      from: interaction.pointA,
      to: interaction.pointB,
      color: typeColors.get(interaction.type) ?? [0.8, 0.8, 0.8],
      radius: interaction.type === 'hydrophobic' ? 0.07 : 0.11,
    });
  }
  for (const link of state.proteomics.crosslinks) {
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

function updateColors() {
  if (!state.structure) return;
  const model = activeModel();
  const extras = colorExtras();
  const { colors, legend } = computeAtomColors(model, state.structure, state.color, extras);
  state.atomColors = colors;
  state.legend = legend;
  if (!state.atomFlags || state.atomFlags.length !== model.atoms.length) state.atomFlags = new Uint32Array(model.atoms.length);
  state.renderer.setAtomData(colors, state.atomFlags);
  state.dirty.colors = false;
  state.dirty.flags = true;
  applySurfaceColors(false);
  renderLegend();
  renderChains();
  sequenceView?.recolor(residueColor);
}

function colorExtras() {
  const scheme = state.color.scheme;
  const extras = { overrides: state.proteomics.siteOverrides };
  if (scheme === 'coverage' && state.proteomics.coverage) extras.residueValues = state.proteomics.coverage;
  if (scheme === 'data' && state.proteomics.data) {
    extras.residueValues = state.proteomics.data;
    extras.dataLabel = state.proteomics.dataLabel;
    extras.symmetric = els.dataSymmetric.checked;
  }
  if (scheme === 'exposure' && state.sasa?.relative) extras.residueValues = state.sasa.relative;
  return extras;
}

function residueColor(key) {
  if (!state.atomColors || !state.structure) return null;
  const residue = activeModel().residueMap.get(key);
  const atom = residue?.representative;
  if (!atom) return null;
  const offset = atom.id * 4;
  return [state.atomColors[offset], state.atomColors[offset + 1], state.atomColors[offset + 2]];
}

function updateFlags() {
  if (!state.structure || !state.atomFlags) return;
  const model = activeModel();
  const flags = state.atomFlags;
  flags.fill(0);
  for (const key of state.selection) {
    const residue = model.residueMap.get(key);
    if (residue) for (const atom of residue.atoms) flags[atom.id] |= 1;
  }
  if (state.hover.residueKey) {
    const residue = model.residueMap.get(state.hover.residueKey);
    if (residue) for (const atom of residue.atoms) flags[atom.id] |= 2;
  }
  for (const id of state.measurePending) flags[id] |= 1;
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
  const model = activeModel();
  const radius = Math.max(4, model.bounds.radius);
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
  const model = activeModel();
  const source = atoms ?? model.atoms.filter((atom) => atom.kind !== 'water' && (!state.display.visibleChains || state.display.visibleChains.has(atom.chain)));
  const points = new Float32Array(source.length * 3);
  source.forEach((atom, index) => {
    points[index * 3] = atom.x;
    points[index * 3 + 1] = atom.y;
    points[index * 3 + 2] = atom.z;
  });
  const target = cloneCamera(state.camera);
  target.sceneRadius = model.bounds.radius;
  fitCameraToPoints(target, points, viewportRegion(), { keepRotation: !principal, padding: atoms ? 4 : 2, sceneRadius: model.bounds.radius });
  animateCamera(target, animate ? 450 : 0);
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
  const atomIndex = await pickAt(event);
  const model = activeModel();
  const atom = atomIndex >= 0 ? model.atoms[atomIndex] : null;
  if (state.measureMode) {
    if (atom) addMeasureAtom(atom);
    return;
  }
  if (!atom) {
    if (!event.shiftKey) clearSelection(false);
    return;
  }
  state.selectedAtom = atom;
  selectResidues([atom.residueKey], { additive: event.shiftKey || event.metaKey || event.ctrlKey, toggle: true });
}

async function onDoubleClick(event) {
  const atomIndex = await pickAt(event);
  const atom = atomIndex >= 0 ? activeModel().atoms[atomIndex] : null;
  if (atom && !state.measureMode) focusResidues([atom.residueKey]);
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
  const model = activeModel();
  const atom = atomIndex >= 0 ? model.atoms[atomIndex] : null;
  const residueKey = atom?.residueKey ?? null;
  if (atom) {
    els.tooltip.innerHTML = tooltipHTML(atom);
    const x = Math.min(window.innerWidth - 300, clientX + 14);
    els.tooltip.style.transform = `translate(${x}px, ${clientY + 14}px)`;
    els.tooltip.classList.add('is-visible');
  } else {
    els.tooltip.classList.remove('is-visible');
  }
  state.hover.atom = atomIndex;
  if (state.hover.residueKey !== residueKey) {
    state.hover.residueKey = residueKey;
    sequenceView?.setHover(residueKey);
    markFlagsDirty();
  }
}

function setHoverResidue(key) {
  if (state.hover.residueKey === key) return;
  state.hover.residueKey = key;
  sequenceView?.setHover(key);
  markFlagsDirty();
}

function componentNameOf(residue) {
  if (!residue || (residue.kind !== 'ligand' && residue.kind !== 'ion')) return '';
  const name = state.structure.componentNames?.get(residue.resName);
  return name ? titleCase(name) : '';
}

function tooltipHTML(atom) {
  const residue = residueOf(atom);
  const parts = [`${atom.name} · ${atom.element}`];
  const componentName = componentNameOf(residue);
  if (componentName) parts.unshift(componentName);
  if (residue?.kind === 'protein') parts.push(secondaryText(residue));
  if (Number.isFinite(residue?.confidence) && state.structure.meta.isPredicted) parts.push(`pLDDT ${residue.confidence.toFixed(1)}`);
  else parts.push(`B ${atom.bFactor.toFixed(1)}`);
  const extra = residueDataText(residue);
  if (extra) parts.push(extra);
  return `<strong>${escapeHTML(residueLabel(residue ?? atom))}</strong><span>${escapeHTML(parts.join(' · '))}</span>`;
}

function residueDataText(residue) {
  if (!residue) return '';
  const parts = [];
  const coverage = state.proteomics.coverage?.get(residue.key);
  if (coverage) parts.push(`${coverage} peptide${coverage === 1 ? '' : 's'}`);
  const data = state.proteomics.data?.get(residue.key);
  if (Number.isFinite(data)) parts.push(`${state.proteomics.dataLabel || 'value'} ${formatNumberShort(data)}`);
  const relative = state.sasa?.relative?.get(residue.key);
  if (Number.isFinite(relative)) parts.push(`RSA ${(relative * 100).toFixed(0)}%`);
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

function addMeasureAtom(atom) {
  const needed = { distance: 2, angle: 3, dihedral: 4 }[state.measureMode];
  if (state.measurePending.at(-1) === atom.id) return;
  state.measurePending.push(atom.id);
  if (state.measurePending.length >= needed) {
    const model = activeModel();
    const atoms = state.measurePending.map((id) => model.atoms[id]);
    state.measurements.push({ type: state.measureMode, atoms: [...state.measurePending], value: measureValue(state.measureMode, atoms) });
    state.measurePending = [];
    renderMeasurements();
  }
  markSceneDirty();
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
  const model = state.structure ? activeModel() : null;
  const fragment = document.createDocumentFragment();
  state.measurements.forEach((measurement, index) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const atoms = measurement.atoms.map((id) => model?.atoms[id]).filter(Boolean);
    row.innerHTML = `<i style="background:#ffd166"></i><span>${escapeHTML(atoms.map(shortAtomLabel).join(' – '))}</span><strong>${formatMeasurement(measurement)}</strong><button type="button" title="Remove">×</button>`;
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
  const model = activeModel();
  const view = currentView();
  const width = els.canvas.clientWidth;
  const height = els.canvas.clientHeight;
  const labels = collectLabels(model);
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

function collectLabels(model) {
  const labels = [];
  for (const key of state.labels) {
    const residue = model.residueMap.get(key);
    if (residue?.representative) labels.push({ position: point(residue.representative), text: residueLabel(residue), kind: 'residue' });
  }
  for (const site of state.proteomics.sites) {
    if (site.residue?.representative) labels.push({ position: point(site.residue.representative), text: site.label, kind: 'site' });
  }
  for (const measurement of state.measurements) {
    const atoms = measurement.atoms.map((id) => model.atoms[id]).filter(Boolean);
    if (atoms.length < 2) continue;
    let position;
    if (measurement.type === 'distance') position = scale(add(point(atoms[0]), point(atoms[1])), 0.5);
    else if (measurement.type === 'angle') position = point(atoms[1]);
    else position = scale(add(point(atoms[1]), point(atoms[2])), 0.5);
    labels.push({ position, text: formatMeasurement(measurement), kind: 'measure' });
  }
  return labels;
}

/* ---------- Structure UI ---------- */

function updateStructureUI() {
  const structure = state.structure;
  const meta = structure.meta;
  els.title.textContent = meta.title;
  els.title.title = meta.title;
  els.subtitle.textContent = [state.sourceLabel, structure.format === 'mmcif' ? 'PDBx/mmCIF' : 'PDB'].filter(Boolean).join(' · ');
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
  state.cartoonKey = '';
  renderChains();
  markSceneDirty();
  refreshSurface();
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
  sequenceView.render(info, residueColor);
  const uniprot = info.uniprot?.[0];
  const missing = info.items.filter((item) => !item.residue && !item.gap).length;
  els.sequenceInfo.textContent = [
    `${info.items.filter((item) => !item.gap).length} residues`,
    missing ? `${missing} not modeled` : '',
    info.source === 'model' ? 'from coordinates' : `from ${info.source}`,
    uniprot?.accession ? `UniProt ${uniprot.accession}` : '',
  ].filter(Boolean).join(' · ');
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

function surfaceAtoms(model) {
  return model.atoms.filter((atom) => atom.kind !== 'water' && !atom.isHydrogen && (!state.display.visibleChains || state.display.visibleChains.has(atom.chain)));
}

async function refreshSurface() {
  if (!state.structure) return;
  const kind = state.surface.kind;
  if (kind === 'off') {
    state.surface.data = null;
    state.surface.key = '';
    state.renderer.setMesh('surface', null);
    els.surfaceStatus.textContent = '';
    requestRender();
    return;
  }
  if (state.renderer.kind !== 'webgpu') {
    els.surfaceStatus.textContent = 'Surfaces need WebGPU.';
    return;
  }
  const model = activeModel();
  const atoms = surfaceAtoms(model);
  const key = [state.structure.label, state.structure.activeAssemblyId, model.number, kind, state.display.visibleChains ? [...state.display.visibleChains].sort().join(',') : '*'].join('|');
  if (key === state.surface.key && state.surface.data) return;
  state.surface.key = key;
  const ticket = (state.surface.pending += 1);
  const positions = new Float32Array(atoms.length * 3);
  const radii = new Float32Array(atoms.length);
  atoms.forEach((atom, index) => {
    positions[index * 3] = atom.x;
    positions[index * 3 + 1] = atom.y;
    positions[index * 3 + 2] = atom.z;
    radii[index] = elementInfo(atom.element).vdw;
  });
  els.surfaceStatus.textContent = `Computing ${els.surfaceKind.selectedOptions[0]?.textContent ?? kind} surface for ${formatNumber(atoms.length)} atoms…`;
  const started = performance.now();
  try {
    const result = await surfaceWorker().run('surface', { positions, radii, options: { kind } }, [positions.buffer, radii.buffer]);
    if (ticket !== state.surface.pending) return;
    const atomIds = new Uint32Array(result.atoms.length);
    for (let index = 0; index < result.atoms.length; index += 1) atomIds[index] = atoms[result.atoms[index]]?.id ?? 0;
    state.surface.data = { positions: result.positions, normals: result.normals, indices: result.indices, atoms: atomIds, potential: null };
    const triangles = result.indices.length / 3;
    els.surfaceStatus.textContent = `${formatNumber(triangles)} triangles · ${((performance.now() - started) / 1000).toFixed(1)} s${result.spacing ? ` · grid ${result.spacing.toFixed(2)} Å` : ''}`;
    await applySurfaceColors(true);
  } catch (error) {
    console.error(error);
    if (ticket === state.surface.pending) els.surfaceStatus.textContent = `Surface failed: ${error.message}`;
  }
}

async function applySurfaceColors(force = true) {
  const data = state.surface.data;
  if (!data || !state.structure) return;
  const model = activeModel();
  const mode = state.surface.color;
  const vertexCount = data.positions.length / 3;
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
      els.surfaceStatus.textContent = 'Computing Coulombic potential…';
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
      els.surfaceStatus.textContent = `${formatNumber(data.indices.length / 3)} triangles · Coulombic potential from ${formatNumber(charged.length)} charged atoms`;
      if (data !== state.surface.data) return;
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
      const residue = residueOf(atom);
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
  state.renderer.setMesh('surface', { vertices: buffer, indices: data.indices, opacity: state.surface.opacity });
  if (mode === 'electrostatic') {
    state.surfaceLegend = { type: 'gradient', title: 'Coulombic potential (kcal/mol·e)', colormap: 'electrostatic', minLabel: String(data.range[0]), maxLabel: `+${data.range[1]}`, note: 'Formal charges, ε = 4r, 1.4 Å offset' };
  } else if (mode === 'hydrophobicity') {
    state.surfaceLegend = { type: 'gradient', title: 'Surface hydropathy', colormap: 'hydrophobicity', minLabel: 'Hydrophilic', maxLabel: 'Hydrophobic' };
  } else {
    state.surfaceLegend = null;
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

async function loadPAEFromURL(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    loadPAEFromJSON(await response.json(), 'AlphaFold DB');
  } catch (error) {
    console.warn('PAE fetch failed', error);
  }
}

function loadPAEFromJSON(json, source) {
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
  const residues = paeResidues(size, document0);
  state.pae = {
    size,
    matrix: flat,
    max: Number(document0.max_predicted_aligned_error ?? document0.max_pae) || Math.max(31.75, max),
    residues,
    chainBoundaries: chainBoundaries(residues),
    source,
  };
  if (Array.isArray(document0.plddt) && state.structure && !state.structure.meta.isPredicted) {
    state.structure.meta.isPredicted = true;
  }
  renderPAE();
  showToast(`Loaded PAE matrix (${size} × ${size}) from ${source}.`);
}

function paeResidues(size, document0) {
  if (!state.structure) return [];
  const model = activeModel();
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
  setColorScheme('coverage');
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

function siteResidueKeys() {
  return new Set(state.proteomics.sites.map((site) => site.residue.key));
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
  setColorScheme('data');
  renderProfile();
}

/* ---------- Color scheme and legend ---------- */

function setColorScheme(scheme) {
  state.color.scheme = scheme;
  els.colorScheme.value = scheme;
  const categorical = ['chain', 'entity'].includes(scheme);
  const continuous = ['bfactor', 'exposure', 'coverage', 'data'].includes(scheme);
  els.paletteField.hidden = !categorical;
  els.colormapField.hidden = !continuous;
  els.uniformField.hidden = scheme !== 'uniform';
  if (scheme === 'exposure' && !state.sasa) showToast('Compute SASA in the Analysis tab to color by solvent exposure.');
  if (scheme === 'coverage' && !state.proteomics.coverage) showToast('Map peptides in the Proteomics tab to color by coverage.');
  if (scheme === 'data' && !state.proteomics.data) showToast('Load residue values in the Proteomics tab first.');
  markColorsDirty();
}

function renderLegend() {
  const legends = [state.legend, state.surface.kind !== 'off' ? state.surfaceLegend : null].filter(Boolean);
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
  state.activeModel = Math.max(0, Math.min(state.structure.models.length - 1, index));
  els.modelSlider.value = String(state.activeModel + 1);
  state.measurePending = [];
  state.measurements = [];
  state.interactions = { ...state.interactions, list: [] };
  state.atomFlags = null;
  if (state.sasa) {
    state.sasa = null;
    els.sasaColor.disabled = true;
    els.sasaResult.hidden = true;
    if (state.color.scheme === 'exposure') markColorsDirty();
  }
  renderMeasurements();
  renderInteractions();
  updateModelLabel();
  markSceneDirty();
  if (state.focus) computeFocusInteractions([...state.focus.residues]);
  if (state.surface.kind !== 'off') refreshSurface();
}

function updateModelLabel() {
  const total = state.structure?.models.length ?? 1;
  els.modelLabel.textContent = `${state.activeModel + 1} / ${total}`;
  const model = state.structure ? activeModel() : null;
  els.atomsLabel.textContent = total > 1 ? 'Atoms/model' : 'Atoms';
  els.atomsMetric.textContent = formatNumber(model?.atoms.length ?? 0);
}

function toggleModelPlayback() {
  if (state.modelTimer) {
    stopModelPlayback();
    return;
  }
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
  const labels = collectLabels(activeModel());
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
  const legends = [state.legend, state.surface.kind !== 'off' ? state.surfaceLegend : null].filter(Boolean);
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

function residueOf(atom) {
  if (!atom || !state.structure) return null;
  const model = activeModel();
  return model.residues[model.atomResidue[atom.id]] ?? null;
}

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
