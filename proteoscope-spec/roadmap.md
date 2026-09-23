# Proteoscope Review and Roadmap

This document records a review of Proteoscope v0.4, the state of the field it
competes in (researched September 2026), what each wave of work delivered
(`wave1`: the rebuild; `wave2`: structure comparison; `wave3`: selections,
commands, sessions and scripting; `wave4`: predicted complexes, validation and
variants), a review of the bundled examples and of the public databases
Proteoscope can use without API keys, and a prioritized plan for what comes
next.

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
| pLDDT and PAE linked to 3D | Yes | Yes | pLDDT via B-factor | Yes | Yes (AFDB, AF3, ColabFold, Boltz), with PAE domains and contact probabilities (wave 4) |
| Predicted-complex triage (AF3, Boltz, Chai-1, ColabFold outputs) | Partial (loads files) | PAE, `alphafold contacts`, interface PAE | No | No | Ranked models, chain-pair ipTM, ipSAE, pDockQ, pDockQ2, LIS, MSA depth, cross-link satisfaction per model (wave 4) |
| wwPDB validation overlays | Yes (validation report plugin) | No (MolProbity via Phenix) | No | Partial | Outliers per residue, clashes, RSRZ / Q-score, percentiles, Top8000 Ramachandran (wave 4) |
| Variant effect predictions | No | No | No | AlphaMissense track | AlphaMissense per residue and per substitution (wave 4) |
| Proteomics overlays (peptides, PTMs, cross-links) | No | Plugins (XMAS) | Plugins (PyXlinkViewer) | PTM annotations | **Built in, local-only** |
| Superposition | TM-align | Matchmaker | align/super | VAST+/TM-align | Sequence-based with pruning; RMSD, TM-score, lDDT (wave 2) |
| Density maps | Yes | Yes | Yes | Yes | Planned |
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

## 7. The bundled examples

The 18 bundled structures (16 MB of uncompressed legacy PDB files) form a
coherent cancer-biology set:

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

## 8. Public databases without API keys

Everything Proteoscope fetches goes through its own server, which allows only
known hosts, caches downloads, and honors `--offline`. Services checked live
on 23 September 2026 that need no key (limits as documented):

**Used today.**

- RCSB files: structures and validation reports.
- AlphaFold DB: models, PAE, MSAs and AlphaMissense. The API has no key or
  security scheme.
- UniProt REST.

**Most valuable next**, because each extends a workflow Proteoscope already
has:

| Service | Use in Proteoscope |
| --- | --- |
| RCSB Search API (`search.rcsb.org`: text, sequence, structure similarity) and PDBe `mappings/best_structures/{acc}` | "Find structures of this protein", ranked by coverage and resolution; start from a gene name |
| 3D-Beacons (`/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/{acc}.json`) | Every model of a protein (AlphaFold DB, SWISS-MODEL, ModelArchive, PED, PDBe) in one list |
| EBI Proteins API (`/proteins/api/proteomics/{acc}`, `proteomics-ptm/{acc}`), 200 req/s | Peptides and PTM sites observed in public MS datasets, next to the user's own data |
| Chemical Component Dictionary (`files.rcsb.org/ligands/view/{id}.cif`) | Ligand bond orders, aromaticity and charges: better interaction typing and double bonds |
| PDBe volume server (`/pdbe/volume-server/…`, BinaryCIF) and EMDB (`/emdb/api/entry/…`, maps on the EBI FTP) | Density maps around a selection (wave 6) |
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
- The ColabFold MMseqs2 server (MSAs).
- ESMFold (`api.esmatlas.com`, POST only; history of certificate problems,
  best effort).

**Excluded.** These need a key, a license or registration: BioGRID, OMIM,
PhosphoSitePlus bulk data, COSMIC, DisGeNET and DrugBank.

Each new source is a small Go route (host allowlist, size limit, cache kind,
User-Agent) plus a page-side parser. The RCSB, NCBI, STRING and gnomAD limits
argue for caching and one request at a time.

## 9. Roadmap

Priorities are ordered by value to researchers, weighed against effort.

### Next: proteomics data at scale (wave 5)

1. **Importers.**
   - Whole search-engine reports rather than pasted tables: MaxQuant
     `evidence.txt`, DIA-NN reports (parquet), Spectronaut and FragPipe
     `psm.tsv`.
   - Filtered to the structure's UniProt entries, with conditions, fold
     changes and PTM localization thresholds.
   - Cross-links from xiSEARCH, MeroX and mzIdentML; HDX-MS time courses from
     HDExaminer and DynamX.
2. **Public evidence.** Peptides and PTM sites from the EBI Proteins API next
   to the user's data.
3. **Structure-based analysis.**
   - PTM accessibility and disorder (StructureMap's pPSE).
   - Structural-change mapping for LiP-MS.
   - Cross-link distance histograms, with solvent-accessible surface distances.
   - Cross-link restraints scored across prediction models, extending wave 4.
4. **Real prediction outputs.** Check AlphaFold 3, AlphaFold Server, Boltz-2,
   Chai-1 and ColabFold runs against `ipsae.py`. Add Protenix and OpenFold3
   layouts, and Zstandard-compressed AlphaFold 3 output.

### Then: maps and discovery

- **Density maps.**
  - Cryo-EM maps from EMDB, and X-ray 2Fo-Fc and Fo-Fc maps from the PDBe
    volume server, drawn as isosurfaces extracted by WebGPU compute. BinaryCIF,
    the server's format, now parses.
  - Contour sliders and zoning around a selection. Q-score and RSRZ from
    wave 4 already point at the regions to inspect.
- **Discovery.**
  - Search RCSB by text, sequence or structure; best structures and all
    models of a protein (PDBe, 3D-Beacons).
  - AlphaFold DB complexes and ModelArchive entries with PAE.
- **Examples.** The refreshed, compressed collection from section 7, with a
  described opening view for each.

### Later: analysis and data types

- **Ligand chemistry** from the Chemical Component Dictionary: bond orders,
  aromatic rings, charges, and double bonds in sticks.
- **Pocket detection** (cavities and druggability), to ask whether a PTM,
  variant or cross-linked residue lines a pocket.
- **Conservation** from an alignment (a prediction's MSA or a dropped one)
  rather than pasted values.
- **Comparison follow-ups:** structure-only alignment (TM-align or US-align)
  for remote homologs, and animated morphs between superposed conformations.
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

## 10. Known limitations

- **Superposition** pairs residues by sequence (or UniProt numbering), so
  remote homologs with little sequence identity need a structure-only aligner,
  which is not yet available.
- **Electrostatics** use formal charges with a distance-dependent dielectric.
  The map is qualitative, not a Poisson-Boltzmann solution.
- **Interactions** infer ligand chemistry from geometry; bond orders and pKa
  are not used. For example, both nitrogens of a piperazine are treated as
  charged.
- **Validation without a report.** Local and predicted models get Top8000
  Ramachandran classes but no rotamer outliers or clashscore, because those
  need hydrogens added by Reduce and contact dots from Probe. Cryo-EM residue
  inclusion is not shown.
- **Prediction folders** were tested with the documented layouts and
  synthetic files, not with real runs of every tool.
  - Chai-1 does not write PAE, so its models lack the PAE-based scores.
  - Boltz writes PAE only with `--write_full_pae`.
  - Zstandard-compressed AlphaFold 3 output must be decompressed first.
  - Protenix and OpenFold3 are not recognized yet.
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
  and the camera; lighting effects, measurements and interaction lines are not
  part of the format and are left out.
- **The fetch cache** refetches entries after 30 days. Headers cached by
  older versions lack newer hints, but those features work without them.
