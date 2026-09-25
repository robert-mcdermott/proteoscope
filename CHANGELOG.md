# Changelog

## Unreleased

- Batch triage: open many prediction jobs at once (a design campaign, a
  screen of partners) and rank every model of every job on one table by
  ipSAE, pDockQ2, pDockQ, LIS, ipTM, pTM, the tool's own score, mean pLDDT or
  satisfied cross-links, for each model's best interface or a named chain
  pair. Show any model, render a gallery of the best, or export every model
  and interface as CSV. The `triage` command does the same from the command
  line.
- An MCP server for AI agents: `proteoscope mcp` lets an agent such as Claude
  open structures and prediction folders, rank predictions, list
  interactions and interface contacts, superpose, load validation reports,
  render images and run any command, in the page you see.
  [docs/MCP.md](docs/MCP.md) covers the setup for Claude Code, Claude Desktop,
  Collomia and other clients.
- Scripts can open files and folders by path (`POST /api/remote/open`, with
  the token Proteoscope prints at startup), and the new `info` and
  `interactions` commands, and `interface`, `validate` and `triage`, return
  their results as data; `help` returns the command list.
- Remote control also refuses requests whose Host header does not name this
  computer, which blocks DNS rebinding when `--host` shares Proteoscope, and
  the page runs one remote request at a time.
- Folders named on the command line can hold up to 20,000 files, and a
  prediction's alignment is read only when one of its models opens.

## 0.6.1 (2026-09-23) 

- Installers for macOS and Linux (`install.sh`) and Windows (`install.ps1`).
  They download the release for the computer, verify its SHA-256 checksum and
  version, and install it without administrator rights. Downloaded this way,
  the program is not flagged by Gatekeeper or SmartScreen.
  [docs/INSTALLING.md](docs/INSTALLING.md) covers versions, manual downloads,
  upgrades and uninstalling.

## 0.6.0 (2026-09-23)

The first release since 0.4. It collects six waves of work, described in
detail in [the roadmap](proteoscope-spec/roadmap.md), sections 3 to 8. There
was no 0.5 release.

### Viewer

- A new WebGPU renderer with ray-cast spheres and cylinders, ambient
  occlusion, outlines, depth fog, clipping planes, GPU picking and lighting
  presets. A Canvas renderer remains for browsers without WebGPU.
- Cartoons with DSSP secondary structure, surfaces (molecular, solvent
  accessible, Gaussian, van der Waals), fifteen color schemes with
  colorblind-safe palettes and legends, and per-component representations.
- A trackball camera, framing on the principal axes, PNG export at up to 4×
  with a transparent background, and spin movies (WebM).
- Several structures in one scene, each with its own style.

### Structures and comparison

- PDB, PDBx/mmCIF and BinaryCIF, with biological assemblies, ensembles and
  modified residues in the polymer.
- Sequence superposition with RMSD, TM-score and lDDT, comparison with the
  AlphaFold DB model, and ensemble overlays.
- Structure-only superposition: TM-align and MM-align, ported from US-align.
- Finding structures: RCSB, UniProt, PDBe and 3D-Beacons searches, and
  bundled examples.

### Predicted complexes and validation

- Output folders of AlphaFold 3, AlphaFold Server, Boltz, Chai-1, ColabFold,
  Protenix and OpenFold3, ranked by each tool's score, with PAE, interface
  scores (ipSAE, ipTM, pDockQ, pDockQ2, LIS), PAE domains and MSA depth.
- wwPDB validation reports on the structure, Top8000 Ramachandran classes for
  any model, and AlphaMissense variant effects.

### Maps, ligands and docking

- Density maps from the PDBe volume server (2Fo−Fc, Fo−Fc and cryo-EM) or
  from CCP4/MRC files, with levels in σ and a map fit (atom inclusion) per
  residue.
- Ligand bond orders, aromaticity and charges from the Chemical Component
  Dictionary, and interaction typing that uses them.
- Docking poses from SDF, MOL2 and PDBQT files, with their scores, a pose
  table and interaction fingerprints.

### Proteomics

- Search-engine reports: MaxQuant, DIA-NN (TSV and Parquet), Spectronaut,
  FragPipe, mzTab and Proteome Discoverer, with site localization.
- Differential statistics: limma's moderated t-test with optional imputation,
  PTM sites adjusted for their protein's change as in MSstatsPTM, and a
  volcano plot linked to the structure.
- Cross-links with surface distances, HDX-MS with the hybrid significance
  test, part-sphere exposure, public proteomics evidence, and conservation
  from alignments.

### Sessions, scripting and reproducibility

- A selection language, a command line, session files and links, MolViewSpec
  export for Mol*, and a remote-control API for scripts.
- A methods paragraph with numbered references and BibTeX, and
  `CITATION.cff`.
- Continuous integration, and a validation suite that checks the analyses
  against limma, MSstatsPTM, US-align, Capra and Singh's scorer, EMDB and
  MolProbity ([validation/](validation/README.md)).

### Releases

- Binaries for macOS, Linux and Windows on both x64 and ARM64, with SHA-256
  checksums, built by a release workflow.

### Fixed since the wave 6 review

- Residues that share a number keep file order. Chains whose insertion codes
  run backwards, such as thrombin's light chain (1H … 1A, 1) and
  IMGT-numbered antibody loops (112B, 112A, 112), were scrambled in the
  cartoon and the sequence.
- FragPipe `psm.tsv`: a precursor identified by several spectra in one run
  counts once, at its largest intensity, as MSstats' converters do by
  default. Before, the intensities of all its PSMs were summed.

## 0.4 (2026-06-03)

- Cartoon and ribbon representation.

## 0.3 (2026-05-19)

- Chains can be shown and hidden one by one.
- Fixed the dropdown menu background in some browsers.

## 0.2 (2026-05-10)

- PDBx/mmCIF files (`.cif`, `.mmcif`), with biological assemblies.
- A metadata strip: format, method, resolution, entry ID and assembly.

## 0.1 (2026-05-09)

- The first release: a single Go binary that serves a 3D viewer for PDB
  files.
