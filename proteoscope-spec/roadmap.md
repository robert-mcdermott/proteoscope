# Proteoscope Review and Roadmap

This document records a review of Proteoscope v0.4, the state of the field it
competes in (researched September 2026), what each wave of work delivered
(`wave1`: the rebuild; `wave2`: structure comparison; `wave3`: selections,
commands, sessions and scripting; `wave4`: predicted complexes, validation and
variants; `wave5`: bring your data, find public data; `wave6`: maps, ligand
chemistry and statistics), a review of the bundled
examples and of the public databases Proteoscope can use without API keys, and
a prioritized plan for what comes next.

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
| Ligand interactions | Yes | Yes (hbonds, contacts) | Polar contacts | Yes | PLIP criteria, 8 types; bond orders and charges from the CCD, docking poses with fingerprints (wave 6) |
| pLDDT and PAE linked to 3D | Yes | Yes | pLDDT via B-factor | Yes | Yes (AFDB, AF3, ColabFold, Boltz), with PAE domains and contact probabilities (wave 4) |
| Predicted-complex triage (AF3, Boltz, Chai-1, ColabFold outputs) | Partial (loads files) | PAE, `alphafold contacts`, interface PAE | No | No | Ranked models, chain-pair ipTM, ipSAE, pDockQ, pDockQ2, LIS, MSA depth, cross-link satisfaction per model (wave 4) |
| wwPDB validation overlays | Yes (validation report plugin) | No (MolProbity via Phenix) | No | Partial | Outliers per residue, clashes, RSRZ / Q-score, percentiles, Top8000 Ramachandran (wave 4) |
| Variant effect predictions | No | No | No | AlphaMissense track | AlphaMissense per residue and per substitution (wave 4) |
| Proteomics overlays (peptides, PTMs, cross-links) | No | Plugins (XMAS) | Plugins (PyXlinkViewer) | PTM annotations | **Built in, local-only** |
| Superposition | TM-align | Matchmaker | align/super | VAST+/TM-align | Sequence-based with pruning; RMSD, TM-score, lDDT (wave 2); TM-align and MM-align (wave 6) |
| Density maps | Yes | Yes | Yes | Yes | X-ray and cryo-EM maps from the PDBe volume server or files; atom inclusion and per-residue fit (wave 6) |
| Sessions, shareable state | MolViewSpec | Sessions | Sessions | Short URLs | Session files, links, MolViewSpec export (wave 3) |
| Selection language, command line | Selection scripts (MolScript, PyMOL, VMD, Jmol syntax) | Command line | Command line | Commands | PyMOL/ChimeraX-style, in the search box (wave 3) |
| Scripting from notebooks | JavaScript API; MolViewSpec Python builder | Python; REST remote control | Python API; XML-RPC | icn3dpy | Console API; REST remote control (wave 3) |

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

## 4. Wave 2: comparing structures

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

## 5. Wave 3: selections, commands, sessions and scripting

Wave 2 made Proteoscope useful for comparisons; wave 3 makes work
reproducible and scriptable, which serious projects and figure revisions need.

### Selection language (`web/lib/select.js`)

- PyMOL-style keywords (`chain`, `resi` with insertion codes, `resn`, `name`,
  `elem`, `ss`, `entity`, `uniprot`, `model`), classes (`protein`, `ligand`,
  `water`, `backbone`, `sidechain`, `helix`, …), Boolean logic with implicit
  AND, and wildcards.
- ChimeraX-style atom specs: `#2/A:40-80@CA`.
- Neighborhoods (`within`, `around`, `beyond`) measured across structures, and
  `byres` / `bychain` expansion.
- Value predicates over per-residue data from earlier waves: B-factor,
  occupancy, pLDDT, superposition deviation, lDDT, RMSF and relative SASA;
  sets for the selection, focus, proteomics sites, peptide coverage and
  aligned residues.
- Errors name the offending word and its position.

### Command line (`web/lib/commands.js`, search box)

- The search box previews selections with live counts and runs commands:
  selection, framing, focus, per-residue show/hide/color/label, loading,
  superposition, AlphaFold comparison, overlays, presets, lighting,
  background, distances, rotation, sessions, links, MolViewSpec and images.
- History (↑/↓), completion (Tab), and a generated command reference in the
  help dialog.
- Per-residue representations and colors in the scene (side-chain sticks on
  the cartoon, spheres, hidden residues, restricted surfaces), also available
  as buttons on the selection card.

### Sessions and sharing

- **Session files** (`.proteoscope.json`, versioned) record each structure's
  source (fetched ID, bundled example, or the embedded, gzip-compressed local
  file), styles and per-residue styling, transforms, comparison recipes
  (refitted on open), overlays, selections, focus, labels, proteomics overlays,
  measurements and the view.
- **Links** carry the same document, deflate-compressed, in `#session=` when
  every structure can be fetched again.
- **MolViewSpec** export for Mol*: `.mvsj` with RCSB and AlphaFold DB URLs, or
  `.mvsx` (a ZIP with the structure files) for local files. Colors are grouped
  into residue ranges and per-element atom selectors; superpositions become
  `transform` nodes (column-major rotation); the camera is converted to MVS's
  60° reference camera. A two-structure export was checked in the public Mol*
  viewer: the superposition, colors and ligands matched Proteoscope.

### Remote control (`remote.go`)

- `--remote-control` exposes `POST /api/remote/command`; the page receives
  commands over Server-Sent Events and posts results back, so Python or
  Jupyter can fetch, superpose, select (getting residue keys back), measure,
  and render PNGs or sessions.
- Off by default; loopback Host headers only; browsers on other origins are
  refused by the existing guard.

### Validation

- 21 new JavaScript tests (the selection language on hemoglobin and on
  insertion codes, command parsing, compression and links, ZIP archives, the
  MolViewSpec tree, and per-residue styling in the scene), for 136 in total.
- 5 Go tests for remote control, run behind the same request guard as the real
  server: off by default, a full round trip through a simulated page,
  timeouts, stale results, and cross-site refusal.
- In the browser: session save and restore, a `#session=` link opened in a
  fresh page (and in a background tab), and a script driving the page through
  the REST API, including a returned PNG.

## 6. Wave 4: predicted complexes, validation and variants

Running AlphaFold 3, Boltz or Chai-1 on complexes is now routine, and the hard
part has moved from getting a model to deciding which predicted interfaces to
believe. Wave 4 makes Proteoscope a place to make that call without uploading
anything, and adds the checks researchers apply to experimental structures
(the wwPDB validation report) and to variants (AlphaMissense).

### Predicted complexes (`predictions.js`, `interface-scores.js`, `pae-domains.js`, `msa.js`, `npy.js`)

- **Output folders.** AlphaFold 3 run folders (per-seed, per-sample
  subfolders, prefixed or not), AlphaFold Server `.zip` downloads, Boltz-1/2
  (`confidence_*.json`, `pae_*.npz`, `plddt_*.npz`, Boltz-2 affinity), Chai-1
  (`scores.model_idx_*.npz`) and ColabFold (`*_scores_rank_*.json`, relaxed
  models preferred) are recognized by file name. They open from a dropped
  folder, the folder picker, a `.zip`, or a folder named on the command line,
  which the Go server walks and serves.
- **Ranking.** Models are ranked by each tool's own score (AF3 ranking score,
  Boltz confidence score, Chai aggregate score, ColabFold 0.8·ipTM + 0.2·pTM or
  mean pLDDT). The top model opens; clicking another swaps it in; *Superpose
  all models* overlays them on the top-ranked one; *Export CSV* writes every
  model and chain pair.
- **Interface scores**, computed from each model's PAE, pLDDT and coordinates
  with the definitions of Dunbrack's `ipsae.py` (version 4, January 2026):
  - ipSAE, with d0 from the number of confidently aligned residues;
  - ipTM recomputed from the PAE;
  - pDockQ and pDockQ2 (d0 = 10 Å, pLDDT of interface residues of both chains);
  - LIS (PAE below 12 Å, both directions averaged).

  PAE cutoffs are 10 Å, or 15 Å for AlphaFold 2 / ColabFold as in Dunbrack's
  examples. Tokens follow AlphaFold 3: one per standard residue, one per heavy
  atom of ligands and modified residues, masked as in `ipsae.py`. A chain-pair
  matrix shows reported ipTM (chain pTM on the diagonal), ipSAE or pDockQ2;
  clicking a cell selects that interface.
- **More confidence data.** AlphaFold 3 contact probabilities as a second
  heat map; per-atom pLDDT on ligands; rigid domains clustered from the PAE as
  ChimeraX does (symmetrized PAE floored at 0.2 Å, edges below 5 Å weighted
  1/PAE, greedy modularity at resolution 0.5, domains of at least 10
  residues); MSA depth from AF3 `data.json`, ColabFold `.a3m`, Boltz `msa/`
  tables, AlphaFold DB's per-model MSA, or a dropped alignment.
- **Cross-links as evidence.** Links mapped in the Proteomics tab are checked
  against every model, and the ranking table gains a satisfied/total column.

### wwPDB validation reports (`validation.go`, `validation.js`, `ramachandran.js`)

- The Go server fetches `{id}_validation.xml.gz` from RCSB, streams it through
  `encoding/xml`, and returns compact JSON: entry attributes (all percentiles
  included), each residue's identity, Ramachandran and rotamer class, numeric
  attributes (RSRZ, RSCC, Q-score, EDIAm, Mogul RMSZ …) and outlier counts,
  and clash pairs matched by clash id.
- The page colors residues by the number of failed criteria, as the report's
  residue plot does (clashes, geometry, Ramachandran, rotamer, RSRZ > 2), or
  by density fit (RSRZ, or Q-score for cryo-EM); draws clashes, mapping the
  hydrogens Reduce adds onto their heavy atoms (amino-acid, nucleotide and
  ligand naming); lists ligand fit and the worst residues; and exposes
  `outliers`, `rsrz`, `rscc` and `qscore` to the selection language.
- The Ramachandran plot now draws MolProbity's Top8000 contours (CC BY 4.0,
  Richardson Lab) for six residue categories and classifies residues with
  ramalyze's cutoffs and bilinear interpolation, for any structure. The
  tables ship as a 75 KB module loaded on first use.

### Variants (`missense.js`)

AlphaMissense scores for all substitutions of human proteins come from
AlphaFold DB (CC BY 4.0). Residues are mapped through SIFTS/UniProt numbering,
and residues whose wild type disagrees are skipped. The structure is colored
by the mean score at each position. Sites such as `R175H` show their own
score. The selection card lists the most damaging substitutions, and `am` joins
the selection language.

### Smaller fixes

- **BinaryCIF** is decoded in the browser (MessagePack plus all seven column
  encodings) and converted to mmCIF text, so every later step works unchanged.
- **Sessions** now keep PAE matrices opened by hand (0.125 Å steps), contact
  probabilities, prediction scores and MSA depth, and rebuild SASA, PAE
  domains, validation and AlphaMissense on open.
- **Fetch cache** entries are refetched after 30 days (`--cache-max-age`) and
  served stale when the network is down; `?refresh=1` and the `refresh`
  command bypass the cache.
- **AlphaFold DB** renamed `entryId` to `modelEntityId` in October 2025; both
  are read, and the new `msaUrl` feeds MSA depth.

### Validation

- **Tests.** 12 new JavaScript tests, 148 in total. They cover:
  - ZIP archives with data descriptors, NumPy arrays (float16, Fortran order)
    and archives.
  - All BinaryCIF encodings; MSA depth; PAE domains.
  - Prediction-folder detection for all five layouts, confidence parsing and
    tokenization.
  - Interface scores against their formulas; validation mapping, including
    hydrogen-to-heavy-atom clashes.
  - AlphaMissense parsing; Top8000 classes.
- **Go tests.** 6 new tests: validation XML parsing and fetching,
  AlphaMissense, cache expiry, stale fallback and refresh, AlphaFold DB
  `modelEntityId` and MSA, and command-line folders.
- **Checks on real data:**

| Check | Result |
| --- | --- |
| Top8000 classes vs the wwPDB report (MolProbity), 1M17 | 310 of 310 residues agree (275 favored, 26 allowed, 7 outliers among 308 classified) |
| Clashes in the 1M17 report | All 57 pairs drawn, including the 8 on erlotinib hydrogens |
| BinaryCIF 1M17 from RCSB's model server vs mmCIF | 2,546 atoms with identical coordinates, B-factors, names, metadata, secondary structure and UniProt mapping; decoded in 25 ms |
| Cryo-EM report 8GUB | Q-score 0.531 (78th percentile); density fit colored by Q-score |
| AlphaMissense, EGFR hotspots on 1M17 | L858R 0.997, T790M 0.966, G719S 0.998, C797S 0.740 |
| AlphaMissense, p53 hotspots on 1TUP | R175H 0.986, G245S 0.973, R248Q 0.996, R249S 1.000, R273H 0.989, R282W 0.946 |
| PAE domains, AlphaFold DB p53 | DNA-binding domain 93–295 (pLDDT 95), N-terminal region 1–92 (pLDDT 48), C-terminal region 296–393 |

The prediction-folder pipeline was exercised end to end in the browser with
an AlphaFold Server–style `.zip` and an AlphaFold 3–style run folder built
from 4ZQK (PD-1/PD-L1) with synthetic confidence files. That covered
detection, ranking, scores, model switching, superposition, cross-link
columns, command-line folders and session round trips. No real AlphaFold 3,
Boltz, Chai-1 or ColabFold output was available here; checking each against
`ipsae.py` on real runs is the first follow-up (see Known limitations).

## 7. Wave 5: bring your data, find public data

Waves 1–4 made Proteoscope good at examining a structure once it was open.
Wave 5 connects it to data: finding a protein's structures and models in
public databases, reading mass spectrometry results in the formats the search
engines write, putting them next to public evidence and structural context,
and reading the output of every widely used structure predictor.

### Bundled examples (`examples.go`, `data/examples.json`)

- The 18 legacy PDB files (16 MB) became 27 gzipped mmCIF entries (6.2 MB,
  anisotropic records removed), following the review in section 9: 108D
  dropped, 5DS3 replaced by 7KK4, and the AlphaFold model of p53 with its PAE,
  1HHO, 4AKE, 1AKE, 5T35, 5FQD, 4OO8, 8EF5, 1LP3 and 6VXX added. 1LP3 (AAV2)
  was chosen over 1STM for its relevance to gene therapy.
- The server serves `name.cif` from `name.cif.gz`, passing the gzip stream
  through with `Content-Encoding: gzip` when the browser accepts it. Listed
  examples are described by the manifest rather than parsed, so the server
  starts in about 30 ms; a test parses every example instead.
- The manifest gives each example a label, category, description, credit and
  opening view, a list of commands such as `superpose 1ake onto 4ake fit
  /A:1-29+60-121+160-214` and `color deviation`. The menu groups examples by
  category and shows the description; `example [add] <id>` opens one from the
  command line. An example opened with its view starts from the default
  style, so the previous example's styling does not carry over.

### Finding structures (`search.go`, `discover.js`)

- New Go routes proxy keyless services and cache their answers for a day:
  - `/api/search/text` and `/api/search/sequence`: the RCSB Search API, with
    entry summaries from RCSB's GraphQL API (title, method, resolution,
    release date, organisms, and ligands without crystallization additives).
  - `/api/search/uniprot`: UniProt REST, exact gene matches first, optionally
    for one organism.
  - `/api/search/protein/{accession}`: PDBe's best structures and the
    3D-Beacons summary. It answers when either service does.
  - `/api/fetch/model`: a model file listed by 3D-Beacons, only from known
    provider hosts.

  When one of the services behind a route fails, the answer carries the
  problem and is not cached, so the next request asks again. A sequence
  search reports the number of matching entries from a separate count query,
  since its hits are the best 250 chains.
- The panel classifies the query (accession, PDB ID, sequence or text). It
  lists proteins, experimental structures grouped by entry with a coverage
  track and four sort orders, and models, AlphaFold DB first. **Open**
  replaces the scene and **Add** superposes onto the active structure; the
  `search` command runs the same search.
- ModelCIF confidences on a 0–1 scale (SWISS-MODEL) are rescaled to 0–100.

### Search-engine reports (`reports.js`, `parquet.js`, `zstd.js`, `snappy.js`)

- **Formats.** MaxQuant evidence, peptides and site tables; DIA-NN TSV and
  Parquet reports, precursor matrices and site reports; Spectronaut normal and PTM site reports;
  FragPipe PSM, peptide and site tables; mzTab (the PEP section when it has
  abundances, otherwise PSM); Proteome Discoverer exports.
- **Localization** comes from each tool's notation: MaxQuant `S(0.95)`,
  DIA-NN `{0.95}`, Spectronaut `[Phospho (STY): 99.6%]`, ptmRS, and mzTab
  (FLR read as 1 − FLR). Fixed modifications are not sites; decoys and
  contaminants are dropped by flag and prefix.
- **Streaming.** Text reports are read line by line, gzip decompressed on the
  fly. Parquet row groups are read by byte range and filtered on the protein
  column. Only the structure's proteins are kept, matched by accession or by
  sequence.
- **Decoders written from the specifications.** A Parquet reader for flat
  tables (Thrift compact footer, PLAIN, dictionary and RLE/bit-packed
  encodings, data pages v1 and v2, optional columns) with ZSTD, Snappy or
  gzip pages. A Zstandard decoder (RFC 8878: FSE and Huffman tables, repeat
  offsets, several and skippable frames) and a raw Snappy decoder.
- **Summaries.** Peptides and sites per sample, filtered by q-value and
  localization probability, shown as counts, log10 intensity over chosen
  samples, or log2 fold change between two groups; per-residue coverage; a
  site table with CSV export.

### Public evidence (`evidence.go`)

`/api/fetch/proteomics/{accession}` merges the EBI Proteins API's peptide
(PeptideAtlas, ProteomicsDB and others) and PTM-proteomics (PRIDE
reprocessing, PTMeXchange) entries into peptides with their sources, and
sites with their best probability, confidence and datasets. The panel colors
public coverage, marks sites by modification type, and flags each site of the
user's report as known or new.

### Structural context (`exposure.js`)

Part-sphere exposure (pPSE) and disorder as StructureMap computes them, with
the same constants (module header), PAE-aware for predicted models; glycine
gets a pseudo-Cβ direction. Results feed the `ppse` color scheme, the profile
plot, the `ppse` and `idr` selection keywords, and the pPSE and IDR columns of
the report's site table.

### Cross-links (`crosslinks.js`)

- Importers for xiFDR (residue pairs and matches), xiVIEW, pLink 2 and 3,
  MeroX, XlinkX, MS Annika and MaxLynx. Decoys are counted and left out, both
  orientations of a pair merge, and protein names are normalized
  (`sp|P04637|…`, `>Cas9`, MeroX's alternative proteins).
- Solvent-accessible surface distance after Jwalk: one 1 Å grid per
  structure for all pairs, bulk solvent found by a flood fill from the grid
  border, and an A* search bounded by the straight line. Buried and
  out-of-range pairs are reported as such.
- A histogram of SASD over Cα–Cα distances against the cutoff; CSV export.

### HDX-MS (`hdx.js`)

- DynamX state and cluster data (masses from charge states, uptake against
  the undeuterated mass, replicate SD), HDExaminer results and uptake
  summaries, and the table format of Masson et al. 2019.
- Significance by the hybrid test (a pooled-SD limit at t(1 − α/2, 2n − 2)
  and Welch's t-test) or, without replicates, fixed thresholds (0.5 D per
  exposure, 1.1 D summed). Residue values are weighted by 1/n over the
  exchanging residues of each peptide, without its first two residues and
  prolines.
- A Woods plot with difference and uptake views, per exposure or summed.

### Real prediction outputs (`predictions.js`)

- **Protenix** (`seed_*/predictions/…_sample_N.cif` with summary and full-data
  JSON) and **OpenFold3** (`…_seed_S_sample_N_model.cif` or `.pdb`, with
  aggregated and full confidences as JSON or NPZ, chain-pair ipTM keyed by
  chain ID) are recognized. Samples of several seeds form one ranked set.
- **AlphaFold 3 `--compress_large_output_files`** output (`.zst`) opens as it
  is. Local files, archive members and command-line files are decompressed in
  the page.
- Python's bare `NaN` in confidence JSON is read as missing, and a missing PAE
  entry counts as 31.75 Å.
- **Fixed.** Prediction models saved as PDB (ColabFold, OpenFold3, Boltz with
  `--output_format pdb`) were parsed as mmCIF when opened, a bug since wave 4;
  a file named `.cif` that holds PDB records is now read as PDB. Files in a
  prediction folder that belong to no model (logs, settings, AlphaFold Server
  templates) are no longer opened as structures or annotations.

### Smaller changes

- Ligand codes that start with a digit (`:032`) select the ligand, not
  residue 32.
- `assembly` builds a biological assembly from the command line, and
  `interface A B` lists the contacts between two chains.
- Protenix models are recognized as predictions by their data block name.

### Validation

- **Tests.** 37 new JavaScript tests, 185 in total, and 11 new Go tests, 54
  in total. They cover:
  - Example loading and gzip serving; every search route against a fake
    remote; evidence merging.
  - Each report format and localization notation; Parquet variants written by
    pyarrow; Zstandard against Node's encoder and the zstd CLI; Snappy.
  - pPSE against half-sphere exposure; cross-link importers and SASD
    geometry; HDX parsing, the t distribution, the hybrid test and residue
    averaging.
  - Protenix and OpenFold3 detection and parsing, and interface scores
    against `ipsae.py` output.
- **Review.** A review of the wave by four independent reviewers (server,
  decoders, importers, page) found and fixed, among others:
  - HDX sums over time points only one state had.
  - Spectronaut fragment rows counted as precursors.
  - Decimal commas read as thousands.
  - Parquet files that could hang the reader.
  - Unsigned and decimal Parquet columns decoded as signed or unscaled.
  - A script injection through a crafted session.
  - Cached partial answers.
  - A startup slowed by parsing every example.
- **Checks on real data:**

| Check | Result |
| --- | --- |
| ipSAE, ipTM, pDockQ and pDockQ2 against `ipsae.py` (version 4): AlphaFold 3 Aurora A–TPX2 at 10 Å, AlphaFold 2 multimer RAF1–KSR1–MEK1 at 15 Å (three chain pairs), Boltz-2 p53–MDM2 at 10 Å | Identical to the printed digits. LIS identical for Boltz-2; the two older example outputs count PAE = 12 Å and differ in the fourth decimal |
| An AlphaFold 3 run folder with `.zst` models and confidences, and Protenix and OpenFold3 p53–MDM2 runs, opened from the command line | Ranked and scored end to end |
| DIA-NN 2.0.2 `report.parquet` (52,986 rows) | Identical to pyarrow; pT514 of DPYSL2 mapped on its AlphaFold model, in a disordered region |
| Zstandard | Identical to Node's encoder at levels 1–22; the zstd CLI's `--long=27` output (8.6 MB) decodes in 85 ms |
| pPSE neighbor counts against Biopython's HSExposureCB (12 Å, 90°), O15552 | 330 of 330 residues agree |
| Public evidence for p53 | 82 peptides covering 97% of the sequence and 53 sites; S15 and S392 known |
| Cross-link importers on each tool's published examples | xiFDR 225 pairs, xiVIEW 141, pLink 251, MeroX 47, XlinkX 236, MS Annika 263, MaxLynx 226 |
| RNA polymerase II cross-links (xiVIEW) on 1WCM | 111 of 141 pairs mapped; 104 within 30 Å Cα–Cα, 98–99 within 33 Å SASD; all pairs in about 250 ms |
| HDX-MS of CD160 with and without HVEM (HaDeX data) on 6NG3 | Hybrid-test limit 0.58 D; 21 of 41 peptides differ, 20 of them protected |
| The 27 examples' opening views | All run; 1HHO fits onto 4HHB at 0.81 Å; the AAV2 capsid (249,120 atoms) opens in 6.6 s |

## 8. Wave 6: maps, ligand chemistry and statistics

Wave 6 brings in the experimental evidence behind a model (density maps) and
the chemistry of its ligands (bond orders, charges and docking poses). It adds
structure-only comparison, statistics for proteomics reports and
conservation. It also adds what is needed to report and trust the results: a
methods paragraph with citations, continuous integration, and a validation
suite that checks the new analyses against their reference tools.

### Density maps (`volume.js`, `volume-worker.js`, `maps.go`)

- **Sources.** The PDBe volume server (with RCSB's copy as a fallback)
  provides the 2Fo-Fc and Fo-Fc maps of X-ray entries and the maps of cryo-EM
  entries, as BinaryCIF. It sends the box around the region shown or, for
  cryo-EM, the whole map, at the finest detail within a voxel budget. EMDB's
  API gives the recommended contour level. CCP4 and MRC files (modes 0, 1, 2,
  6 and 12, either byte order, gzipped or not) open from disk.
- **Drawing.** A worker extracts isosurfaces with Surface Nets, in the
  structure's frame. The region can be around the focus, around the view
  center as it moves, or the whole map.
  - Meshes are drawn as screen-space wide lines, a new WebGPU pipeline that
    also scales with supersampled captures. Surfaces are transparent.
  - Levels are set in σ: 2Fo-Fc at 1.5σ, Fo-Fc at ±3σ in green and red, and
    cryo-EM maps at EMDB's recommended level.
  - For figures, the map can be limited to within 1.6–3 Å of the focused
    atoms.
- **Fit.** *Map fit* samples the full-resolution map at every atom, fetched
  in tiles. It reports atom inclusion at the contour as EMDB does, and per
  residue the mean density in σ and the fraction of atoms inside. These come as a color scheme, in
  tooltips, as a profile metric, and as the selection keyword `mapfit`.
- The `map` command loads, contours, restyles and fits maps. Sessions keep
  the map settings and fetch the map again.

### Ligand chemistry (`chemistry.js`, `ligands.go`)

- **Sources.** Bond orders, aromatic bonds and formal charges come from the
  wwPDB Chemical Component Dictionary, in this order:
  - the `chem_comp_atom` and `chem_comp_bond` tables of mmCIF files that
    carry them;
  - a built-in table for standard residues;
  - otherwise one small CCD file per ligand from `files.rcsb.org`, cached.

  A component applies to a residue only when every heavy atom matches it by
  name and element. The duplicated CONECT records of PDB files give bond
  orders too.
- **Drawing.** In sticks, double bonds are drawn as two lines and triple
  bonds as three. Ring bonds get an inner line, dashed when aromatic. This is
  on for ligands by default.
- **Interaction typing** uses the chemistry:
  - donors and acceptors from bond orders and implicit hydrogens;
  - aromatic rings from the dictionary or planar sp2 geometry;
  - charged groups from rules: one protonated nitrogen per piperazine-like
    cluster, carboxylates, acylsulfonamides, tetrazoles and permanent
    charges.

  Imatinib in 2HYY now has one charged nitrogen, in the methylpiperazine,
  instead of two.

### Docking poses (`molfile.js`)

- **Opening.** SDF (V2000 and V3000), MOL2 and PDBQT files open in the active
  structure as poses of one ligand, placed in the receptor and following its
  superposition.
- **Scores** are read from SDF properties, MOL2 comments (DOCK), PDBQT
  `REMARK VINA RESULT` lines and DiffDock's file names
  (`rank1_confidence-0.52.sdf`). Known scores come first.
- **The pose table** sorts by any score, and `[` and `]` step through the
  poses. Each pose shows its interactions with the receptor and its RMSD to
  the first pose.
- **Interaction fingerprints** type every pose's interactions with the
  receptor residues within 9 Å into a pose × residue table. They are
  computed on a small model of the pocket, so many poses stay fast, and
  export as CSV.
- Poses never bond to the crystal ligand they overlap, and sessions keep
  them.

### Structure-only comparison (`tmalign.js`)

- A port of US-align pairs residues by structure alone, in a worker:
  TM-align for chains (Cα for proteins, C3′ for nucleic acids) and MM-align
  for complexes.
- Choose *Pair residues by → Structure* or the `tmalign` command. The
  superposition, colors and report are the same as for the sequence-based
  method.
- For SUMO-1 (1A5R) onto ubiquitin (1UBQ), it pairs 71 residues at 2.36 Å
  with TM-score 0.654, where the sequence alignment reaches 0.625.

### Differential statistics (`stats.js`)

- **Test.** A two-group moderated t-test runs on every feature of a search
  report, for all proteins, reading the file again in full:
  - log2 intensities with median normalization;
  - optional Perseus-style imputation from a down-shifted normal;
  - limma's empirical Bayes, with the moment estimate of the prior when all
    residual df are equal and the likelihood estimate otherwise, as limma
    3.62 and later do;
  - Benjamini–Hochberg q-values.
- **PTM sites.** The protein's change (the median of its unmodified
  peptides) is subtracted from each site's, as MSstatsPTM does, with
  Welch–Satterthwaite df.
- **Results.** A volcano plot is linked to the sites on the structure. Sites
  are colored by their fold change when significant, and the report CSV
  includes the statistics.

### Conservation (`conservation.js`)

- **Scores.** Jensen–Shannon divergence (Capra & Singh 2007) or Shannon
  entropy per residue, with Henikoff weights, a BLOSUM62 background, a gap
  penalty and a window, as the reference script computes them.
- **Alignments.** The MSA of an opened prediction, or an A3M, aligned FASTA,
  Stockholm or Clustal file whose first sequence is the protein. It is
  mapped to the chains by sequence.
- **Display.** ConSurf's nine colors, graded by equal-frequency ninths of
  the protein's scores (ConSurf's own binning is an option). Scores and
  grades are also shown in tooltips, as a profile metric, and as the
  selection keywords `conservation` and `grade`.

### Methods, citation and quality

- **Methods.** The session menu writes a methods paragraph from what the
  session used:
  - data sources with IDs, experimental method, resolution, revision dates
    and model versions;
  - each analysis with its parameters;
  - the Proteoscope version.

  References are numbered, with DOIs checked against Crossref, and can be
  copied or downloaded as BibTeX. `CITATION.cff` describes how to cite
  Proteoscope.
- **Continuous integration.** GitHub Actions run gofmt, `go vet`, the Go
  tests with the race detector, and cross-compilation for the four release
  targets. They also syntax-check every module and run the JavaScript tests
  and the offline validation suites. A weekly workflow runs the whole
  validation suite.
- **Validation suite.** `validation/` recomputes numbers produced by
  reference tools and compares them: limma, MSstatsPTM, US-align, Capra &
  Singh's scorer, EMDB's validation pipeline, and MolProbity through the
  wwPDB reports. The tools are not in the repository; only their numbers
  are.

### Smaller changes

- AlphaFold DB now answers MSA requests with HTTP 403. The server says so
  clearly. MSA depth and conservation for AlphaFold DB models now need a
  dropped alignment.
- BinaryCIF files with several data blocks decode.
- Performance tests scale their time limits by `PROTEOSCOPE_TIME_SCALE`, for
  slower CI machines.

### Validation

- **Tests.** 63 new JavaScript tests, 248 in total, and 6 new Go
  tests, 60 in total. They cover:
  - CCD parsing, bond orders and aromaticity of erlotinib's quinazoline,
    implicit hydrogens, CONECT orders, and components rejected when their
    atom names do not match;
  - the protonation of imatinib (2HYY) and heme's carboxylates (4HHB);
  - SDF (V2000 and V3000), MOL2 and PDBQT readers, and a pose over the
    1M17 crystal ligand that keeps its hinge hydrogen bond to Met769;
  - CCP4/MRC axis orders, start indices, modes and byte orders;
    volume-server BinaryCIF; Surface Nets on analytic shapes; map fit;
  - TM-align and MM-align, the moderated t-test and its special functions,
    conservation scores and parsers, the report feature collector, and the
    methods text;
  - the CCD and volume-server routes: fallbacks, errors sent with HTTP 200,
    regions too large, the pruned region cache, and AlphaFold DB's MSA
    refusal;
  - checks added with the review's fixes: dictionary entries that match by
    name but not by bonds, old atom names, glycosidic oxygens in 6VXX,
    CONECT orders per model, tetrazoles and nitro groups, PDBQT typing,
    per-feature localization, and the methods text.
- **Review.** Five independent reviewers (server, maps and rendering,
  chemistry and poses, the numerical modules, page integration) found and
  fixed, among others:
  - map regions cached without checking the answer, including errors the
    volume server sends with HTTP 200, and map data taken from another server
    than its header;
  - map fits and whole cryo-EM maps computed on downsampled data but judged
    against full-resolution levels, and "whole map" for X-ray entries
    showing a unit cell that missed the model;
  - docking poses left at their file coordinates after a superposition, and
    a pose's dictionary entry replacing that of a receptor ligand with the
    same name;
  - fetched dictionary entries applied to ligands that match them by atom
    names only (MOL, CPD), and glycosidic oxygens taken for hydroxyls;
  - imputation that bypassed the minimum-values filter, protein-adjusted
    q-values corrected over one structure's sites instead of the whole
    experiment, and features split by per-run localization;
  - TM-align reading residues out of chain order where insertion codes come
    before their number, and hanging on missing coordinates;
  - malformed BibTeX author names, and a methods text that described steps
    that did not run.
- **Validation suite.** `node validation/run.mjs` passes all 54 checks
  (`validation/README.md`):
  - limma 3.68.5 to 9e-11;
  - MSstatsPTM 2.14.0 to 7e-14;
  - US-align on 17 chain pairs and 16 complex pairs, identical;
  - Capra & Singh on two Pfam seeds with 7 option sets, to 5e-13;
  - EMDB's atom inclusion for 8GUB, identical for 1,234 of 1,254 residues;
  - MolProbity's Ramachandran classes for 1M17, 308 of 308.
- **Checks on real data:**

| Check | Result |
| --- | --- |
| US-align in complex mode | When the first complex has more chains, US-align 20260920 reads its chain-score matrix out of bounds, and its results vary from run to run. With the matrix transposed, it matches the port in all 16 cases |
| limma, 12 simulated experiments up to 50,000 features | Agree to 3e-10 in t, except where limma leaves a constant feature at exactly 0 residual SD |
| Capra & Singh, 175 runs (OpenProteinSet A3Ms, Pfam seeds in four layouts, rare letters) | Largest difference 5.0e-13 |
| 1M17 2Fo-Fc from the PDBe volume server | 2.53σ on average at atom positions, 0.13σ at random points |
| EMD-34272 with 8GUB | Atom inclusion 0.8935 (EMDB: 0.896). The whole map, at 2.14 Å sampling, makes a 40,000-triangle surface |
| Conservation on 1TUP from a UniRef90 A3M of the p53 DNA-binding domain (1,384 sequences) | The most conserved residues are the zinc ligands C176, H179, C238 and C242, then S241, R175, R248 and R273 |
| DIA-NN report of MZ1 vs DMSO (the MSstatsPTM example data) on 5T35 | 38 GlyGly features tested with imputation, 20 significant, including BRD4 K362, K404, K431 and K445 (log2FC 4.1–6.2, q ≤ 1e-5) |
| Erlotinib (1M17) with CCD chemistry | 17 aromatic bonds (8 double in the Kekulé form) and 1 triple bond; chemistry adds 10–15% to structure derivation |

## 9. The bundled examples

**Done in wave 5** (section 7): the recommendations below were followed, with
1LP3 as the capsid and 8EF5 as the GPCR complex. The review is kept for the
reasoning.

The 18 structures bundled before wave 5 (16 MB of uncompressed legacy PDB
files) formed a coherent cancer-biology set:

- **Drug–target complexes:** erlotinib–EGFR (1M17), imatinib–ABL (2HYY),
  vemurafenib–BRAF V600E (3OG7), sotorasib–KRAS G12C (6OIM),
  alpelisib–PI3Kα (8GUB), IDH1 R132H (6VEI), PARP-1 (5DS3).
- **Immune complexes:** PD-1/PD-L1 (4ZQK), atezolizumab–PD-L1 (5XXY),
  trastuzumab–HER2 (1N8Z), TCR–HLA with a KRAS peptide (7OW6).
- **Protein–DNA and signaling complexes:** p53–DNA (1TUP), MDM2–p53 peptide
  (1YCR), BRCA1 BRCT with a phosphopeptide (1T29), the nucleosome with
  BRCA1–BARD1 (7LYB).
- **NMR ensembles:** 1JM7 and 108D.
- **Classic:** hemoglobin (4HHB).

It is a good demo set for ligand interactions, antibodies and PTMs, but it
has gaps for the features added since.

**Keep.** The drug complexes, antibody complexes, p53–DNA, the nucleosome and
4HHB. Keep 5XXY next to 4ZQK: superposing PD-L1 shows that atezolizumab
covers the PD-1 site, which is a good comparison demo.

**Drop or replace:**

- **108D** (a DNA duplex with the TOTO dye: 40 NMR models with hydrogens,
  2 MB). It is the most niche entry, and 1JM7 already covers ensembles.
- **5DS3** (constitutively active PARP-1). Replace it with **7KK4** (the PARP1
  catalytic domain with olaparib, 1.96 Å), which is a clearer drug–target
  story.

**Add**, each chosen for a feature that has no offline demo today:

| Entry | Why |
| --- | --- |
| AF-P04637-F1 with its PAE (AlphaFold DB, CC BY 4.0) | pLDDT, PAE, PAE domains and disorder, offline; pairs with 1TUP and 1YCR for *Compare with AlphaFold* |
| 1HHO | Oxyhemoglobin; with 4HHB, the T→R comparison works offline |
| 4AKE + 1AKE | Open and closed adenylate kinase, the textbook hinge motion used in the README |
| 5T35 | The PROTAC MZ1 bridging BRD4 BD2 and VHL: targeted degradation, a ligand at an interface |
| 5FQD | Lenalidomide gluing CK1α to CRBN: a molecular glue |
| 4OO8 | Cas9 with guide RNA and target DNA: protein–RNA–DNA, striking cartoons |
| 8EF5 or 3SN6 | A GPCR–G protein complex (fentanyl-bound μ-opioid receptor, cryo-EM; or β2AR–Gs): membrane proteins |
| 1STM or 1LP3 | A capsid from a small asymmetric unit (satellite panicum mosaic virus, or AAV2 for gene therapy): assemblies and big scenes |
| 6VXX | The SARS-CoV-2 spike, closed: cryo-EM, glycans, a trimer |

**Format.**

- Store the examples as gzipped mmCIF (or BinaryCIF), which cuts the embedded
  data from about 16 MB to about 4–5 MB even with the additions. This
  exercises the modern format, and keeps entity and UniProt records that PDB
  files lose. `loadSamples` needs to read `.gz` for that.
- Add a small manifest (`data/examples.json`) with a one-line description and
  an opening view for each example (for example "focus erlotinib"), so the
  menu teaches as well as loads.

A predicted-complex example would be ideal but needs openly licensed output.
AlphaFold DB's complex entries (`/api/complex/…`) or a ModelArchive entry with
PAE (for example `ma-dm-prc-171`, EZH2–PCGF5 from ColabFold) are the
candidates. Both are better fetched than bundled; see the next section.

## 10. Public databases without API keys

Everything Proteoscope fetches goes through its own server, which allows only
known hosts, caches downloads, and honors `--offline`. Services checked live
on 23 September 2026 that need no key (limits as documented):

**Used today.**

- RCSB files: structures and validation reports.
- AlphaFold DB: models, PAE, MSAs and AlphaMissense. The API has no key or
  security scheme.
- UniProt REST: annotations, and protein search by gene or name (wave 5).
- RCSB Search and GraphQL APIs: text and sequence search and entry summaries
  (wave 5).
- PDBe best structures and 3D-Beacons: every structure and model of a
  protein, with model files from the providers' hosts (wave 5).
- EBI Proteins API (`proteomics/nonPtm` and `proteomics/ptm`, 200 req/s):
  public peptides and PTM sites (wave 5).
- Chemical Component Dictionary (`files.rcsb.org/ligands/view/{id}.cif`):
  ligand bond orders, aromaticity and charges (wave 6).
- PDBe volume server (`/pdbe/volume-server/…`, BinaryCIF; RCSB's
  `maps.rcsb.org` as a fallback) and EMDB's API: density maps and
  recommended contour levels (wave 6).

**Most valuable next**, because each extends a workflow Proteoscope already
has:

| Service | Use in Proteoscope |
| --- | --- |
| RCSB structure similarity search | "Similar structures" next to the sequence search |
| PDB-REDO (`pdb-redo.eu/db/{id}/{id}_final.cif`) | The re-refined model, superposed on the deposited one with validation of both |
| AlphaFold DB complexes and ModelArchive (`/doi/10.5452/{id}.cif`, PAE in the accompanying zip) | Predicted complexes to open without running a predictor |

**Useful later:**

- InterPro domains; CATH and ECOD domain boundaries.
- MobiDB disorder; GlyGen glycosylation sites.
- ChEMBL and PubChem ligand data (PubChem: at most 5 req/s).
- STRING interaction partners (1 request/s; partners to predict with) and the
  Complex Portal.
- SWISS-MODEL Repository. Its terms allow only the documented API.
- OPM membrane orientation (undocumented backend).
- Human Protein Atlas.
- Variant sources: gnomAD GraphQL (about 30 requests/min), Ensembl VEP
  (15 req/s), and ClinVar through NCBI E-utilities (3 req/s without a key).

**Only on explicit request.** Services that receive the user's sequence or
structure conflict with local-first privacy, so they belong behind a clear
notice:

- Foldseek (structure search).
- The ColabFold MMseqs2 server (MSAs, for conservation of any protein now that
  AlphaFold DB no longer serves its MSAs).
- ESMFold (`api.esmatlas.com`, POST only; history of certificate problems,
  best effort).

**Excluded.** These need a key, a license or registration: BioGRID, OMIM,
PhosphoSitePlus bulk data, COSMIC, DisGeNET and DrugBank.

Each new source is a small Go route (host allowlist, size limit, cache kind,
User-Agent) plus a page-side parser. The RCSB, NCBI, STRING and gnomAD limits
argue for caching and one request at a time.

## 11. Roadmap

Priorities are ordered by value to researchers, weighed against effort.
Wave 6 delivered density maps, ligand chemistry, docking poses, structure-only
alignment, differential statistics, conservation, the methods paragraph,
continuous integration and the validation suite (section 8).

### Next: follow-ups to wave 6

- **Predicted complexes to fetch.** AlphaFold DB complexes and ModelArchive
  entries with PAE, listed next to the 3D-Beacons models.
- **Alignments on request.** AlphaFold DB no longer serves its MSAs, so
  conservation needs a prediction's MSA or a dropped alignment. An opt-in
  search on the ColabFold MMseqs2 server would close the gap, behind a notice
  that the sequence leaves the computer.
- **Maps.** Maps in MolViewSpec exports; Q-score for any model and map; a
  list of difference-map peaks, for checking ligands and waters.
- **Ligands.** A ligand card with the CCD name, formula, identifiers and
  links to PubChem and ChEMBL.
- **Statistics.** More than two groups, paired designs and protein-level
  summarization.

### Then: proteomics follow-ups

- **Structural-change mapping for LiP-MS**, reusing the report importers.
- **Cross-link restraints across prediction models** with surface distances,
  and SASD for homo-oligomer pairings.
- **More formats:** mzIdentML cross-links and Scout exports; nested Parquet
  columns.

### Later: analysis and data types

- **Pocket detection** (cavities and druggability), to ask whether a PTM,
  variant or cross-linked residue lines a pocket.
- **Morphs:** animated transitions between superposed conformations.
- **Molecular dynamics:** trajectory playback (DCD and XTC), RMSF coloring
  and contact persistence.
- **Glycans:** SNFG symbols, for glycoproteomics.
- **Undo and redo** for commands and styling.

### Later: scale and reach

- **Large structures.**
  - Typed-array atom storage.
  - Level-of-detail rendering and GPU-computed Gaussian surfaces, to handle
    ten million atoms.
- **Export.** glTF, OBJ, and STL for 3D printing and AR; MP4 via WebCodecs;
  scripted figure batches.
- **Other.** WebXR, localization, and accessibility audits.

## 12. Known limitations

- **Structure-only superposition** is rigid: in a hinge motion it fits one
  domain, as TM-align does. MM-align switches to US-align's faster, slightly
  less thorough search above 500 residues in the smaller complex.
- **Electrostatics** use formal charges with a distance-dependent dielectric.
  The map is qualitative, not a Poisson-Boltzmann solution.
- **Interactions** type a ligand from the Chemical Component Dictionary when
  its atom names match, and from geometry otherwise. Protonation follows
  rules (one charged nitrogen per amine cluster, acids charged), not computed
  pKa values, so unusual tautomers and charge states can be missed.
- **Density maps.**
  - The volume server sends 8-bit values sampled to fit a voxel budget
    (about 2 million around the focus, 8 million for a whole map), so large
    regions come at coarser sampling; their levels are matched in σ. Map
    fits use full-resolution tiles.
  - Isosurfaces are computed on the CPU, in a worker.
  - Map files are not stored in sessions; maps from the server are fetched
    again.
- **Docking poses** go into one rigid receptor; flexible residues from PDBQT
  are not applied. PDBQT has no bond orders, so bonds are inferred from
  distances. The RMSD between poses compares atoms in file order, without
  symmetry correction.
- **Differential statistics** compare two groups, unpaired and without
  covariates. Features (precursors, peptides or sites, per report) are tested
  on summed intensities; proteins are not summarized as MSstats does.
  Imputation assumes that values are missing because they are low.
- **Conservation** is only as good as the alignment. Grades are ninths of the
  protein's own score distribution, not ConSurf's evolutionary rates, so they
  rank residues within a protein, not across proteins. AlphaFold DB refuses
  MSA downloads (HTTP 403), so its models need a dropped alignment, and MSA
  depth is not shown for them.
- **Validation without a report.** Local and predicted models get Top8000
  Ramachandran classes but no rotamer outliers or clashscore, because those
  need hydrogens added by Reduce and contact dots from Probe. Cryo-EM atom
  inclusion needs the map loaded (*Map fit*).
- **Prediction folders.** AlphaFold 3, AlphaFold Server, Boltz-2, ColabFold,
  Protenix and OpenFold3 were checked with real outputs; Chai-1 only with the
  documented layout.
  - Chai-1 does not write PAE, so its models lack the PAE-based scores.
  - Boltz writes PAE only with `--write_full_pae`, and Protenix only with
    `--need_atom_confidence`.
  - The Zstandard decoder does not verify frame checksums and does not
    support dictionaries (neither AlphaFold 3 nor DIA-NN uses them).
- **Search reports** keep only the rows of the structure's proteins, matched
  by accession or sequence, and place peptides by sequence on the chains, so
  peptides outside the modeled sequence add no coverage. The Parquet reader
  handles flat tables (no lists or maps) and ZSTD, Snappy and gzip pages, not
  LZ4 or Brotli.
- **Cross-links.** Scout and mzIdentML exports are not read yet. SASD is
  computed on a 1 Å grid with fixed atom radii and a 4 Å start shell, as
  Jwalk does; it treats the structure as rigid, and flexible loops can make a
  violated link acceptable in reality.
- **HDX-MS.** Residue values assume uniform exchange within a peptide (after
  the first two residues and prolines). Uptake is not corrected for
  back-exchange; fully deuterated controls are left out. The hybrid test needs
  replicate statistics; otherwise fixed thresholds decide.
- **Discovery and public evidence** depend on RCSB, UniProt, PDBe, 3D-Beacons
  and the EBI Proteins API being reachable, and cache answers for a day.
  3D-Beacons model files come from the providers, whose terms apply.
- **PAE domains** follow ChimeraX's algorithm. Ties in greedy modularity, and
  coarse-graining above 1,000 residues, can move boundaries slightly.
- **AlphaMissense** covers canonical human UniProt sequences. Residues map
  only through UniProt numbering (SIFTS, DBREF or an AlphaFold DB model), and
  residues whose wild type differs are skipped.
- **Canvas fallback** does not draw surfaces, ambient occlusion, or outlines.
  WebGPU is still missing on Firefox for Linux and Intel Macs, and on Chrome
  with AMD GPUs on Linux.
- **Sessions** store PAE matrices at 0.125 Å and contact probabilities at
  1/255 resolution. Links only work for fetched structures and bundled
  examples, and do not carry PAE.
- **MolViewSpec export** covers representations, colors, labels, transforms
  and the camera. Lighting effects, measurements, interaction lines, density
  maps and docking poses are left out.
- **The fetch cache** refetches entries after 30 days. Headers cached by
  older versions lack newer hints, but those features work without them.
