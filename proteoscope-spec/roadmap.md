# Proteoscope Review and Roadmap

This document records a review of Proteoscope v0.4, the state of the field it
competes in (researched September 2026), what the `wave1` branch changes, the
first slice of wave 2 (structure comparison, `wave2` branch), and a
prioritized plan for later waves.

## 1. Where v0.4 stood

### Strengths worth keeping

- **Distribution model.** One binary, no install, no build step, runs offline.
  No mainstream viewer offers this; Mol* needs a web page, ChimeraX and PyMOL
  need installers.
- **Local-first privacy.** Files are parsed in the browser and never leave the
  machine. This matters for unpublished structures and proteomics data.
- **WebGPU.** As of September 2026 none of the major viewers (Mol* 5.11,
  ChimeraX 1.12, PyMOL 3.1, iCn3D 3.53, NGL 2.5, 3Dmol.js 2.5) ships a WebGPU
  renderer. Mol* lists it as future work. This is an open niche.
- Clean mmCIF biological-assembly support and a readable codebase.

### Problems found

Rendering and interaction:

- Sphere impostors were flat billboards that did not write per-pixel depth,
  so intersecting atoms and bonds overlapped incorrectly.
- Bonds were 0.04 Å camera-facing strips colored with the average of the two
  atom colors, which muddied element coloring.
- There was no ambient occlusion, outline, anti-aliasing, or depth cueing: the
  standard ingredients of publication-quality molecular images.
- The projection matrix used OpenGL depth conventions under WebGPU. It worked
  only because objects rarely came within twice the near-plane distance.
- The scene re-rendered every frame even when nothing changed, which costs
  battery on laptops.
- The clip slider rebuilt all geometry on every camera move while active.
- The yaw/pitch camera clamped pitch at ±85°, so users could not tumble a
  molecule over its poles.
- PNG export was a screen grab: no supersampling, no transparency, and no
  legend.

Scientific correctness (all fixed in wave 1, with regression tests):

- **Alpha carbons became calcium.** For PDB files without an element column,
  the atom name `CA` was inferred as calcium. Heme nitrogens `NA` became
  sodium, and ATP's `PB` became lead.
- **Modified residues became ligands.** Selenomethionine (MSE), common in
  SAD-phased crystal structures, and phosphoresidues (SEP, TPO, PTR) were
  classified as ligands, which broke the cartoon at every occurrence.
- **Hydrogen bonds drawn as covalent bonds.** Every `_struct_conn` record,
  including hydrogen bonds (`hydrog`), was drawn as a covalent bond.
- **Missing bonds:**
  - Inter-chain disulfides were never inferred, for example antibody
    heavy-light links and insulin A-B links.
  - PDB `SSBOND` records were ignored.
  - Metal-coordination bonds up to 2.85 Å were requested, but the 2.35 Å
    spatial-hash cell size missed some of them.
- **Parser bugs:**
  - The CIF tokenizer ended quoted values at the first matching quote, so
    `'N,N'-dimethyl…'` split into two tokens.
  - Chain sorting was case-insensitive, which interleaves chains `A` and `a`
    in large complexes.
  - The hydrophobic residue set contained a typo (`'LE'`).
- **Secondary structure.** Without file annotations, the fallback was a
  C-alpha distance heuristic rather than DSSP.

Missing capabilities relative to the tools researchers use daily:

- Molecular surfaces and electrostatics.
- A sequence panel linked to 3D.
- Non-covalent interaction analysis and a binding-site focus.
- Angle and dihedral measurements.
- Fetching structures by ID.
- AlphaFold confidence (pLDDT and PAE).
- SEQRES and UniProt numbering.
- Nucleic-acid cartoons.
- Color legends.
- Solvent accessibility.
- A Ramachandran plot.

## 2. The landscape (research summary)

| Capability | Mol* | ChimeraX | PyMOL | iCn3D | Proteoscope |
| --- | --- | --- | --- | --- | --- |
| Install-free | Web | No | No | Web | Single binary, offline |
| Renderer | WebGL2 | OpenGL | OpenGL / CPU ray tracing | WebGL | **WebGPU** |
| SSAO, outlines, fog | Yes | Yes (soft/full/silhouettes) | Ray-trace modes | Partial | Yes, plus "Illustrative" preset |
| Molecular surface, electrostatics | Yes | Yes (Coulombic) | Yes (APBS plugin) | DelPhi | SES/SAS/Gaussian + Coulombic |
| Sequence panel linked to 3D | Yes | Yes | Basic | Yes | Yes, SEQRES-aware with gaps |
| Ligand interactions | Yes | Yes (hbonds, contacts) | Polar contacts | Yes | PLIP criteria, 8 types |
| pLDDT and PAE linked to 3D | Yes | Yes | pLDDT via B-factor | Yes | Yes (AFDB, AF3, ColabFold) |
| Proteomics overlays (peptides, PTMs, cross-links) | No | Plugins (XMAS) | Plugins (PyXlinkViewer) | PTM annotations | **Built in, local-only** |
| Superposition | TM-align | Matchmaker | align/super | VAST+/TM-align | Sequence-based with pruning; RMSD, TM-score, lDDT (wave 2) |
| Density maps | Yes | Yes | Yes | Yes | Wave 3 |
| Sessions, shareable state | MolViewSpec | Sessions | Sessions | Short URLs | Wave 2 |

Recurring researcher pain points from papers, forums, and issue trackers:

- A steep learning curve (Mol*).
- Figure production is slow; a common workflow uses three tools: explore in
  Mol*, work maps in ChimeraX, render in PyMOL.
- Users expect a PAE plot linked to the 3D view.
- Proteomics data has to be pushed through separate tools (xiVIEW, AlphaMap,
  StructureMap, HDX-Viewer) before it can be seen on a structure.
- Unpublished data cannot be uploaded to web services.

Proteoscope's positioning follows from this:

- The fastest path from a file, PDB ID, or UniProt accession to a
  publication-ready figure, with a modern WebGPU look.
- Structural-proteomics overlays built in rather than bolted on.
- Private by construction.

## 3. What wave 1 delivers

### Rendering engine (`web/lib/renderer.js`)

- **Ray-cast impostors.** Spheres and cylinders are ray-cast in the fragment
  shader and write exact per-pixel depth, so atoms and bonds intersect
  correctly. Bonds are split-colored.
- **Frame pipeline.** A G-buffer (color, view normals, atom ID), then
  screen-space ambient occlusion with a depth-aware blur, then a composite
  pass (depth outlines, depth fog, gradient background), then FXAA.
- **Other rendering features:**
  - Reversed-Z projection on a float32 depth buffer.
  - Frames render only on demand.
  - Front and back clipping planes are applied in the shader and never
    rebuild geometry. Clipped atoms show caps.
  - Transparent surfaces render as a single clean layer (depth pre-pass).
- **GPU picking.** A 9×9-pixel window is read back from the ID buffer, so
  thin bonds are easy to click.
- **Lighting presets:** Standard, Soft (ChimeraX-like), Illustrative
  (Goodsell/Mol*-like flat shading with outlines), Glossy, Neon (the original
  glow look), and Flat.
- **Export:** supersampled 2× to 4× PNG with optional transparent background,
  legend, and labels. Also copy to clipboard, and a spin movie (WebM).
- **Performance.** The 99k-atom ribosome (1VQ5) renders at the display's
  120 Hz vsync cap with SSAO, in both cartoon and spacefill.
- **Canvas fallback** for browsers without WebGPU, now with depth cueing.
  `?renderer=canvas` forces it.

### Camera (`web/lib/camera.js`)

- **Controls.** Quaternion trackball with no gimbal lock; alt-drag rolls;
  pinch zooms.
- **Framing.** New structures are framed on their principal axes. Transitions
  are animated. Orthographic projection is available.
- **View offset.** The molecule centers in the region not covered by panels.

### Structure science (`parse.js`, `structure.js`, `dssp.js`)

- **Parsing:**
  - mmCIF uses a charCode tokenizer that follows CIF quoting rules, and
    columnar loop storage. The 12 MB ribosome mmCIF parses in about 0.35 s.
  - Metadata now includes R-free, R-work, organism, and deposition date.
  - Entities: from mmCIF, and from PDB `COMPND` records.
  - Full sequences: `SEQRES` and `entity_poly_seq`.
  - UniProt mappings from `DBREF`/`DBREF1/2` and `_struct_ref_seq`.
  - Biological assemblies from PDB `REMARK 350`.
  - `SSBOND` records and formal charges.
  - ModelCIF per-residue pLDDT, with detection of predicted models.
- **Residue typing:**
  - Protein, nucleic acid, ligand, ion, and water are distinguished.
  - More than 100 modified and nonstandard residues are recognized, including
    AMBER/CHARMM names from MD runs.
  - Unknown residues are promoted into the polymer when they carry a linked
    peptide or sugar-phosphate backbone.
- **Bonds.** Typed-array spatial hashing. Disulfide and metal-coordination
  bonds are detected, and metal coordination draws as dashed lines.
- **Secondary structure.** A DSSP implementation (Kabsch and Sander).
  - Strand assignments match 100% of PDB `SHEET` records.
  - Helix assignments match 92 to 100% once the PDB's ±1-residue helix
    convention is accounted for.
  - Runtime is about 2 ms per protein.
  - A source switch offers Auto, File, or DSSP.
- **Derived data.** φ/ψ angles, and SEQRES-to-model alignment
  (Needleman-Wunsch).

### Representations and color (`cartoon.js`, `scene.js`, `coloring.js`)

- **Cartoon:**
  - One morphing cross-section: elliptical helices, flat sheets with sharp
    arrowheads, and round coils, with smooth transitions between them.
  - Ribbons are oriented by the carbonyl guide, as in PyMOL and Mol*.
  - Nucleic acids get a backbone tube, base slabs, and connectors.
- **Per-component representations** for polymer, ligands and ions, and
  water. Side chains can be shown around the focus or everywhere.
- **Fifteen color schemes:**
  - Chain, entity, rainbow N→C, secondary structure, molecule type.
  - Element, residue class, Kyte-Doolittle hydrophobicity, nucleotide.
  - B-factor, and AlphaFold pLDDT in the standard AFDB colors.
  - Solvent exposure, peptide coverage, custom data, uniform.
- **Palettes and legends.** Colorblind-safe palettes (Okabe-Ito, Tol), and
  viridis, magma, and blue-white-red colormaps. Every scheme shows a legend.

### Analysis

- **Focus.** Double-clicking a ligand or residue frames its binding site,
  shows side chains within 5 Å, and draws its interactions.
  - Interactions follow PLIP's published criteria. There are 8 types: H-bond,
    salt bridge, π-stacking, cation-π, hydrophobic, halogen bond, metal
    coordination, and water bridge.
  - Chain-interface analysis and CSV export are also available.
  - Validated contacts:
    - Erlotinib to Met769 (1M17).
    - Imatinib to Met318, Thr315, Glu286, and Asp381 (2HYY).
    - Vemurafenib to Cys532 (3OG7).
    - Heme iron to the proximal His (4HHB).
    - The PD-1/PD-L1 Arg113–Glu136 salt bridge (4ZQK).
- **Surfaces.** Molecular (SES), solvent-accessible, Gaussian, and van der
  Waals surfaces, built in a Web Worker.
  - A 5k-atom protein takes 0.2 s; the ribosome takes 1.1 s.
  - Coloring can follow the scheme, Coulombic electrostatics (ε = 4r,
    ChimeraX-style ±10 kcal/mol·e), or hydrophobicity. Opacity is adjustable.
- **Solvent accessibility.** Shrake-Rupley SASA per atom and residue, relative
  exposure (Tien 2013 maximum ASA), and buried surface area per chain and for
  interfaces.
- **Measurements.** Distance, angle, and torsion rulers with 3D labels.
- **Ramachandran plot**, linked to the selection.
- **Per-residue profile** of B-factor or pLDDT, relative SASA, hydrophobicity,
  or custom data.
- **AlphaFold.** Fetching a UniProt accession loads the current AlphaFold DB
  model with its PAE matrix. A PAE heatmap supports drag-to-select, which
  highlights the residues in 3D. PAE JSON files from AlphaFold DB, AlphaFold 3,
  and ColabFold can also be opened directly.

### Proteomics (`proteomics.js`, Proteomics tab)

- **ProtParam-equivalent sequence properties.** Average and monoisotopic mass,
  Bjellqvist pI, net charge, ε280, GRAVY, aliphatic and instability indices.
  These reproduce ExPASy exactly for ubiquitin.
- **Peptide coverage and quantitation:**
  - Reads MaxQuant, Spectronaut, DIA-NN, ProForma, Comet, and FragPipe
    notation.
  - Leucine and isoleucine can be treated as equivalent, and coverage is
    mapped onto every chain.
  - Modified sites are extracted from the peptides.
  - In-silico digestion with 8 proteases.
- **Sites and variants** (R175H, p.Arg248Gln, pS15, A:K120ac, …) in
  structure or UniProt numbering, with a wild-type residue check that flags
  numbering offsets.
- **Cross-links.** Cα–Cα validation against presets for common cross-linkers
  (DSS/BS3, DSSO, DSBU, BS2G, EDC, PhoX, sulfo-SDA). For homo-oligomers the
  shortest chain pairing is used.
- **Custom per-residue data** such as HDX uptake, conservation, or deep
  mutational scanning scores, with a colormap and legend.
- **UniProt annotations.** Domains, functional sites, PTMs, disease variants,
  and mutagenesis data fetched from UniProtKB and mapped through SIFTS/DBREF.
  The list is filterable (for example R175, LFS, phospho), and entries can be
  marked as sites.

### Data access and application host (Go)

- **Fetch proxy:**
  - `/api/fetch/pdb/{id}` for RCSB, including extended `pdb_` IDs.
  - `/api/fetch/afdb/{accession}`, with PAE, for AlphaFold DB v6.
  - `/api/fetch/uniprot/{accession}`.
  - Responses are cached on disk.
- **Flags.** `--offline`, `--cache-dir`, `--no-cache`, `--dev`, and
  `--version`.
- **Command line.** `proteoscope file.cif` opens local files; gzip input is
  supported.
- **Security:**
  - Host-header protection against DNS rebinding.
  - `Origin` and `Sec-Fetch-Site` checks on the API.
  - A Content Security Policy (CSP) and other security headers.
- **Loading in the browser.** Drag-and-drop, `.gz` decompression, and
  `#fetch=` deep links.

### UI

- **Layout.** A top bar with search; a tabbed left sidebar (Structure, Style,
  Analysis, Proteomics); and right-hand cards for chains, selection,
  interactions, and measurements.
- **Sequence panel.** Shows secondary-structure underlines and unmodeled
  residues. It supports click, shift-click, drag, and double-click to focus,
  and it synchronizes hover with 3D.
- **Other controls.** Toolbar, keyboard shortcuts and help dialog, toast
  notifications, a collapsible legend, and model playback for ensembles.
- **Console API.** `window.proteoscope` for scripting and automated figures.

### Validation

- 91 JavaScript tests.
  - Parsing, structure derivation, cartoon, scene, color, DSSP, surfaces,
    electrostatics, interactions, and proteomics.
  - A regression test runs over every bundled structure.
- Go tests cover the fetch proxy, cache, offline mode, local files, security
  checks, and dev mode.
- The 12 MB ribosome mmCIF and PDB files parse to identical models.

## 4. Wave 2, first slice: comparing structures

Comparison was the largest gap left after wave 1: researchers constantly set a
prediction against an experiment, apo against holo, wild type against mutant,
or one conformational state against another, and had to leave Proteoscope for
it.

### Several structures in one scene (`web/app.js`)

- **Entries.** Each loaded structure is an entry with its own style, color
  scheme, surface, selection, focus, labels, interactions, SASA, proteomics
  overlays, PAE and rigid transform. One entry is active; the panels, the
  sequence and the Analysis and Proteomics tabs follow it.
- **Loading.** *Add to the scene instead of replacing*, several dropped files,
  several command-line files, and `#fetch=ID,ID&superpose` links.
- **Structures list.** Activate, hide or remove structures. Clicking an atom
  of another structure activates it. Style changes apply to all structures or
  only the active one.
- **Rendering.** All rendered models share the renderer's per-atom color and
  flag buffers: each gets a contiguous slice, and meshes carry a per-mesh atom
  offset. Picking maps the global index back to the structure, model and atom.
  Measurements can join atoms of different structures.

### Superposition and scores (`align.js`, `superpose.js`, `compare.js`)

- **Pairing.** Gotoh global alignment with free end gaps, BLOSUM62 blended
  with a secondary-structure term (ChimeraX matchmaker defaults). Chains are
  paired by sequence; near-identical subunits are paired by position after a
  seed superposition, trying several seeds and keeping the pairing that fits
  best. UniProt numbering pairs a PDB chain with an AlphaFold DB model.
- **Fit.** Horn's quaternion least-squares fit (never a reflection) on Cα or
  C4′ atoms, with ChimeraX-style pruning of pairs beyond 2 Å. Candidate fits on
  all chains and on each chain pair compete, so copies packed differently in
  two crystals (4AKE and 1AKE) do not collapse the fit.
- **Scores.** RMSD of the fitted core and of all pairs, TM-score with the
  TM-score program's fragment search, superposition-free lDDT, identity, pairs
  within 2 Å, and per-chain RMSD and TM-score.
- **Views.** Deviation and lDDT color schemes on both structures, a
  "Structure" scheme, tooltips with per-residue deviation, selection, hover
  and focus mirrored onto aligned residues, an aligned sequence row with
  substitutions marked, and trimming to the aligned span.
- **Compare with AlphaFold.** Fetches the model for each UniProt accession of
  the active entry, superposes it by UniProt numbering, trims it to the
  aligned span, and grays the experimental structure so it cannot be confused
  with pLDDT colors.
- **Ensembles.** *Overlay models* superposes every model on the shared core
  and reports mean RMSD and per-residue RMSF, with an RMSF color scheme.

### Validation

24 new tests (115 JavaScript tests in total) cover BLOSUM62, alignment of
fragments, deletions and point mutations, exact recovery of rigid transforms,
rejection of reflections, pruning of displaced pairs, TM-score search and
normalization, lDDT and RMSF on analytic cases, chain pairing of relabeled
subunits, fitting on a selection, UniProt pairing, and NMR ensembles.
Checks on real structures:

| Comparison | Result |
| --- | --- |
| Adenylate kinase 1AKE onto 4AKE, chain A | 1.08 Å over 112 of 214 pairs (the CORE domain); all pairs 8.2 Å; TM-score 0.68 |
| α- vs β-globin, 4HHB chains A and B | 44.6% identity with the known D-helix gap; 1.10 Å over 120 pairs; TM-score 0.89 |
| EGFR 1M17 vs AlphaFold P00533 (UniProt numbering) | 0.78 Å over 249 of 312 pairs; TM-score 0.89; lDDT 0.92 |
| ABL 2HYY vs AlphaFold P00519 | 0.58 Å over 232 of 263 pairs; TM-score 0.92 |
| BRAF V600E 3OG7 vs wild type 1UWH | 0.69 Å over 459 pairs; TM-score 0.97; the construct's surface mutations are flagged |
| Hemoglobin R (1HHO assembly) onto T (4HHB) | One αβ dimer within 1.1–1.5 Å, the other rotated (2.7–4.5 Å): the T→R quaternary change |
| NMR ensemble 1JM7, 14 models | Mean core RMSD 0.86 Å; median RMSF 0.63 Å; termini up to 10.7 Å |

## 5. Roadmap

Priorities are ordered by value to researchers, weighed against effort.

### Wave 2: comparison, reproducibility, confidence

1. **Multiple structures and superposition.** Delivered in the first slice
   (§4). Still open: structure-only alignment (TM-align or US-align) for
   remote homologs, and animated morphs between superposed conformations.
2. **Sessions and shareable state.**
   - Save and restore camera, styles, selections, and proteomics overlays as
     JSON.
   - Import and export MolViewSpec for interoperability with Mol*.
3. **Selection language.**
   - A PyMOL/ChimeraX-style grammar, such as
     `chain A and resi 40-80 and not solvent` or `within 5 of resn STI`.
   - A command palette.
   - Documented use of the console API from Jupyter and other notebooks.
4. **Prediction confidence beyond single chains:**
   - AlphaFold 3 and Boltz `chain_pair_iptm` matrices.
   - Contact-probability maps.
   - PAE-based domain clustering, as in ChimeraX's `alphafold pae`.
   - Per-atom pLDDT for ligands.
5. **Validation.**
   - Accurate Top8000 Ramachandran and rotamer contours.
   - Clashscore.
   - wwPDB validation report overlays: RSRZ and geometry outliers.

### Wave 3: data types

- **Density maps.** Cryo-EM maps (MRC/CCP4, fetched from EMDB) and X-ray
  2Fo-Fc and Fo-Fc maps (from PDBe/RCSB), rendered as isosurfaces extracted by
  WebGPU compute.
- **Molecular dynamics.** Trajectory playback (DCD and XTC), RMSF coloring,
  and contact persistence.
- **Proteomics file importers:**
  - Search results: MaxQuant `evidence.txt`, DIA-NN parquet reports,
    Spectronaut, and FragPipe `psm.tsv`.
  - Cross-links: xiSEARCH, MeroX, and mzIdentML.
  - HDX-MS time courses from HDExaminer and DynamX.
  - PTM site localization probabilities.
- **Structure-based proteomics analysis:**
  - PTM accessibility and disorder (StructureMap's pPSE).
  - Structural-change mapping for limited-proteolysis (LiP-MS) data.
  - Cross-link distance histograms.

### Wave 4: scale and reach

- **Large structures.**
  - Typed-array atom storage and BinaryCIF parsing.
  - Level-of-detail rendering and GPU-computed Gaussian surfaces, to handle
    ten million atoms.
- **Export.** glTF, OBJ, and STL for 3D printing and AR; MP4 via WebCodecs;
  scripted figure batches.
- **Other.** WebXR, localization, and accessibility audits.

## 6. Known limitations

- **Superposition** pairs residues by sequence (or UniProt numbering), so
  remote homologs with little sequence identity need a structure-only aligner,
  which is not yet available.
- **Electrostatics** use formal charges with a distance-dependent dielectric.
  The map is qualitative, not a Poisson-Boltzmann solution.
- **Interactions** infer ligand chemistry from geometry; bond orders and pKa
  are not used. For example, both nitrogens of a piperazine are treated as
  charged.
- **Ramachandran regions** are an approximate Gaussian-mixture guide, not
  MolProbity contours.
- **Canvas fallback** does not draw surfaces, ambient occlusion, or outlines.
  WebGPU is still missing on Firefox for Linux and Intel Macs, and on Chrome
  with AMD GPUs on Linux.
- **Fetch cache** entries never expire; clear the cache directory to refresh
  them.
