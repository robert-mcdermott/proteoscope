# Implementation Plan: Proteoscope

## Current Status Summary

**Application Implementation: Complete for v0.1**

- Complete: Single-binary Go host with embedded web assets and PDB files
- Complete: Localhost server, port fallback, browser auto-open, and release-oriented
  documentation
- Complete: Bundled PDB manifest and sample loading
- Complete: Browser-side PDB parser for core coordinate, metadata, model, secondary
  structure, and connectivity records
- Complete: Derived molecular model with chains, residues, bonds, B-factor ranges,
  bounds, and search index
- Complete: WebGPU renderer with Canvas preview fallback
- Complete: Ball-and-stick, spacefill, and backbone representations
- Complete: Chain, element, B-factor, and residue coloring
- Complete: Chain isolation, ligand/water/hydrogen toggles, clipping, glow, and motion
  controls
- Complete: Search, atom picking, selection details, camera framing, distance
  measurement, model slider, and PNG export
- Complete: User documentation and release download instructions

## Overview

This implementation plan describes how Proteoscope would have been built using
spec-driven development. The plan proceeds from distribution and data-loading
infrastructure through parsing, derived molecular semantics, rendering,
interaction workflows, documentation, and release verification.

Tasks are marked as complete because this document is reverse-engineered from
the completed v0.1 application.

## Tasks

- [x] 1. Set up single-binary Go application host
  - Create Go module
  - Add `main.go` entry point
  - Embed `web/*` and `data/*.pdb` using Go `embed.FS`
  - Implement localhost HTTP server
  - Add host and port flags
  - Implement nearby-port fallback when preferred port is busy
  - Print local URL on startup
  - Attempt browser auto-open unless `--no-open` is specified
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement embedded PDB sample manifest
  - Discover embedded `.pdb` files from `data/`
  - Parse sample-level metadata from fixed-column PDB records
  - Count atoms, residues, chains, and models
  - Expose `/api/samples`
  - Serve embedded files under `/data/`
  - Sort samples deterministically
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Create browser application shell
  - Build `web/index.html` with viewport, structure panel, search panel,
    controls panel, chain panel, selection panel, toolbar, model strip, tooltip,
    and loading overlay
  - Build `web/styles.css` with responsive dark scientific UI
  - Add favicon
  - Ensure UI text fits across desktop and smaller layouts
  - _Requirements: 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 13.1, 15.3_

- [x] 4. Implement renderer initialization
  - Detect `navigator.gpu`
  - Request high-performance WebGPU adapter
  - Request WebGPU device with timeout
  - Configure WebGPU canvas context
  - Create uniform buffer and render pipelines
  - Fall back to Canvas preview when WebGPU is unavailable or times out
  - Display renderer badge as `WebGPU` or `Canvas preview`
  - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 5. Implement PDB parser
  - Parse `HEADER`, `TITLE`, `EXPDTA`, and resolution remarks
  - Parse `ATOM` and `HETATM` fixed-column fields
  - Infer missing element from atom name
  - Parse `MODEL` and `ENDMDL` blocks
  - Create implicit single model when no `MODEL` records exist
  - Parse `HELIX` and `SHEET` ranges
  - Parse `CONECT` connectivity
  - Apply alternate-location policy
  - Reject files with no atom coordinates
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 6. Build derived molecular structure model
  - Assign secondary structure labels to atoms
  - Group first-model atoms into chain summaries
  - Group first-model atoms into residue summaries
  - Compute model bounds and camera radius
  - Compute B-factor ranges per model
  - Classify waters, hydrogens, heteroatoms, proteins, nucleic acids, and
    ligands
  - Build residue and atom search items
  - Add ligand aliases for common names such as heme
  - _Requirements: 4.2, 4.5, 8.3, 8.4, 10.1, 10.2, 11.1, 11.2, 11.3_

- [x] 7. Implement bond construction
  - Convert `CONECT` records into explicit bonds
  - Build spatial hash for candidate covalent bonds
  - Infer covalent bonds from element radii and distance thresholds
  - Avoid invalid water-water and hydrogen-hydrogen bonds
  - Avoid ordinary cross-chain polymer bonds
  - Create backbone trace bonds for protein and nucleic-acid representations
  - Preserve ligand connectivity in backbone mode
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.3, 7.4_

- [x] 8. Implement scene builder and filtering
  - Generate visible atom records from active model
  - Apply chain isolation filter
  - Apply ligand, water, and hydrogen visibility filters
  - Apply clipping based on current view direction
  - Apply atom radius by representation and scale
  - Apply color scheme
  - Generate bond render records by representation
  - Add measurement render lines
  - Rebuild GPU or canvas buffers after control changes
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 9. Implement WebGPU rendering pipelines
  - Write atom impostor WGSL shader
  - Write atom glow WGSL shader
  - Write bond billboard WGSL shader
  - Upload atom, glow, and bond storage buffers
  - Upload camera and lighting uniforms each frame
  - Use viewer-facing headlamp lighting
  - Render glow, bonds, and atoms with depth buffering
  - _Requirements: 14.1, 14.3, 14.5_

- [x] 10. Implement Canvas preview renderer
  - Project 3D atoms and bonds into screen space
  - Sort atoms and bonds by depth
  - Draw background
  - Draw bonds with line thickness based on projected radius
  - Draw glow with additive composition
  - Draw atoms with centered radial highlights
  - Draw selected atom outline
  - _Requirements: 14.2, 14.4, 14.5_

- [x] 11. Implement camera and viewport interactions
  - Create orbital camera state
  - Compute forward, right, up, and eye vectors
  - Implement drag rotation
  - Implement shift-drag panning
  - Implement wheel zoom
  - Implement automatic motion toggle
  - Implement reset view
  - Rebuild clipping when camera orientation changes and clip is active
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.4_

- [x] 12. Implement molecular picking and selection
  - Convert pointer position to camera ray
  - Test ray proximity against visible atom spheres
  - Select nearest visible atom
  - Update selection panel with atom metadata
  - Highlight selected atom
  - Implement `Frame` action
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 13. Implement distance measurement workflow
  - Track last selected atom for measurement sequence
  - Create measurement when two different atoms are selected in sequence
  - Compute Euclidean distance in PDB coordinate units
  - Draw measurement line
  - Display recent measurement distances in Angstroms
  - Implement `Clear measure`
  - _Requirements: 12.4, 12.5, 12.6_

- [x] 14. Implement search workflow
  - Build search index for residues and atoms
  - Match all query terms against lowercase haystack
  - Render result list
  - Support keyboard enter for first result
  - Support escape to clear search
  - Select and frame chosen search result
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 15. Implement structure loading workflows
  - Fetch `/api/samples`
  - Populate bundled-structure dropdown
  - Load initial bundled structure
  - Handle bundled structure selection changes
  - Handle local file input
  - Parse local PDB text in browser
  - Reset selection, measurement, model, and chain isolation on new structure
  - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4_

- [x] 16. Implement multi-model ensemble support
  - Detect model count
  - Show model slider only for multi-model structures
  - Switch active model on slider input
  - Recompute view and visible scene for selected model
  - Clear stale selection and measurement state on model change
  - Show atoms/model and total atoms for ensembles
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 17. Implement chain panel
  - Render chain list with swatch, chain ID, residue count, and atom count
  - Toggle chain isolation on row click
  - Highlight active chain
  - Implement `All` clear action
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 18. Implement PNG export
  - Capture current canvas as PNG blob
  - Generate structure-based filename
  - Trigger browser download
  - Preserve current viewport and visual state in export
  - _Requirements: 15.1, 15.2_

- [x] 19. Write user and developer documentation
  - Document release downloads for macOS, Linux, and Windows
  - Document OS-specific executable and unblock steps
  - Document browser recommendations and WebGPU compatibility
  - Document PDB acquisition from RCSB downloads
  - Document viewer controls, representations, color schemes, toggles, search,
    selection, measurement, model slider, chain isolation, PNG export, parser
    notes, limitations, troubleshooting, and build instructions
  - _Requirements: 14.6, 15.3, 15.4_

- [x] 20. Verify build and release workflows
  - Run JavaScript syntax check
  - Run Go test suite
  - Build local executable
  - Cross-compile macOS, Linux, and Windows binaries
  - Verify app loads bundled samples in browser
  - Verify local rendering fallback behavior
  - Verify representative workflows: sample switch, NMR model slider, heme
    search, ligand selection, and measurement-ready selection panel
  - _Requirements: 1.5, 2.3, 3.3, 11.5, 12.1, 13.1, 14.1, 14.2, 15.4_

## Wave 1 (branch `wave1`)

- [x] 21. Modularize the browser client into testable ES modules under `web/lib/`
  - Parse, structure, DSSP, cartoon, scene, coloring, renderer, camera, plots and sequence view
  - Port the existing tests and add regression tests over all bundled structures
  - _Requirements: 18, 23_

- [x] 22. Replace the renderer
  - Ray-cast sphere and cylinder impostors with `frag_depth`, and indexed meshes
  - G-buffer, SSAO with depth-aware blur, composite (outlines, fog, background), FXAA
  - Reversed-Z depth, shader clipping with caps, transparent surfaces, GPU picking with tolerance
  - On-demand rendering, supersampled and transparent capture, canvas fallback with depth cueing
  - _Requirements: 14, 16_

- [x] 23. Replace the camera with a quaternion trackball, principal-axes framing, orthographic mode and a panel-aware projection offset
  - _Requirements: 6_

- [x] 24. Fix parsing correctness issues and extend metadata
  - Element inference; modified-residue promotion; `_struct_conn` bond filtering; SSBOND; CIF quoting; case-sensitive chain order
  - R-free, organism, entities, SEQRES, `entity_poly_seq`, DBREF, `struct_ref_seq`, HETNAM, `chem_comp`, ModelCIF pLDDT, REMARK 350
  - _Requirements: 4, 21, 23_

- [x] 25. DSSP secondary structure with Auto, File and DSSP modes
  - _Requirements: 18_

- [x] 26. Cartoon rewrite: superellipse cross-sections, carbonyl-guided ribbons, sheet arrowheads, nucleic-acid tube and base slabs
  - _Requirements: 7_

- [x] 27. Per-component representations, 15 color schemes with legends, colorblind-safe palettes, lighting presets
  - _Requirements: 7, 8, 16_

- [x] 28. Surfaces, SASA and Coulombic electrostatics in a Web Worker
  - _Requirements: 17_

- [x] 29. Focus mode, PLIP-style interactions, interface analysis, CSV export
  - _Requirements: 19_

- [x] 30. Sequence panel, selection model, labels, distance, angle and torsion measurements
  - _Requirements: 12, 20_

- [x] 31. Go fetch proxy with cache and `--offline`, command-line files, security hardening, `--dev`
  - _Requirements: 1, 21_

- [x] 32. AlphaFold confidence: pLDDT coloring and summary, PAE heatmap linked to 3D
  - _Requirements: 21_

- [x] 33. Analysis plots: Ramachandran, per-residue profile
  - _Requirements: 16, 21_

- [x] 34. Proteomics toolkit: sequence properties, peptides, sites and variants, cross-links, custom data, UniProt annotations
  - _Requirements: 22_

- [x] 35. Documentation: README, design, requirements, review and roadmap
  - _Requirements: 15_

## Wave 2, first slice: structure comparison

- [x] 36. Multiple structures per scene: entries with per-structure state, add-to-scene loading, structures list, style scope, shared atom buffers with per-mesh offsets, cross-structure picking and measurements
  - _Requirements: 24_

- [x] 37. Sequence alignment (BLOSUM62 + secondary structure, affine and free end gaps) and chain pairing for complexes and homo-oligomers
  - _Requirements: 24_

- [x] 38. Least-squares superposition with pruning, TM-score search, lDDT, RMSF, per-chain statistics, and tests on synthetic and real structures
  - _Requirements: 24_

- [x] 39. Comparison views: deviation, lDDT, structure and RMSF color schemes; mirrored selection, hover and focus; aligned sequence row; trimming to the aligned span
  - _Requirements: 24_

- [x] 40. Compare with AlphaFold (UniProt numbering) and ensemble overlay
  - _Requirements: 21, 24_

- [x] 41. Documentation: README comparison section, design, roadmap, screenshots
  - _Requirements: 15, 24_

## Wave 3: selections, commands, sessions and scripting

- [x] 42. Selection language: parser, evaluator across structures, distance and expansion operators, value predicates, tests
  - _Requirements: 25_

- [x] 43. Command parser and executor; search box with live previews, history and completion; help reference
  - _Requirements: 25_

- [x] 44. Per-residue sticks, spheres, hiding, colors and surface restriction in the scene; selection card buttons
  - _Requirements: 25_

- [x] 45. Session files, restore, `#session=` links, and restoring in background tabs
  - _Requirements: 26_

- [x] 46. MolViewSpec export (.mvsj and .mvsx) with a ZIP writer, checked in the Mol* viewer
  - _Requirements: 26_

- [x] 47. Remote control API (`--remote-control`) with Server-Sent Events and Go tests
  - _Requirements: 27_

- [x] 48. Documentation: README sections for selections, commands, sessions and scripting; design, requirements, roadmap
  - _Requirements: 15, 25, 26, 27_

## Wave 4: predicted complexes, validation and variants

- [x] 49. Prediction folders: AlphaFold 3, AlphaFold Server, Boltz, Chai-1 and ColabFold detection and parsing; ZIP (central directory) and NumPy readers; folder drops, folder picker and command-line folders
  - _Requirements: 28_

- [x] 50. Interface scores (ipSAE, ipTM from PAE, pDockQ, pDockQ2, LIS) with AlphaFold 3 tokenization; ranking table, chain-pair matrix, interface selection, superpose all, CSV export, `ranking` command
  - _Requirements: 28_

- [x] 51. Contact probabilities, per-atom ligand pLDDT, PAE domains (ChimeraX algorithm), MSA depth (prediction folders, AlphaFold DB, dropped alignments), cross-link satisfaction per model
  - _Requirements: 28_

- [x] 52. wwPDB validation reports: Go XML reducer and route, outlier and density-fit coloring, clashes, ligand and worst-residue lists, selection keywords, `validate` command
  - _Requirements: 29_

- [x] 53. MolProbity Top8000 Ramachandran contours and classification for any structure
  - _Requirements: 29_

- [x] 54. AlphaMissense: route, mapping, coloring, per-variant scores, `missense` command
  - _Requirements: 30_

- [x] 55. BinaryCIF, cache expiry and refresh, session completeness, AlphaFold DB field renames
  - _Requirements: 31_

- [x] 56. Documentation: README sections and screenshots, design, requirements, roadmap (wave 4, examples review, keyless databases)
  - _Requirements: 15, 28, 29, 30, 31_

## Wave 5: bring your data, find public data

- [x] 57. Bundled examples: 27 gzipped mmCIF entries, manifest with descriptions and opening views, gzip passthrough, grouped menu, `example` command, test data helper
  - _Requirements: 33_

- [x] 58. Discovery: RCSB text and sequence search, UniProt search, PDBe best structures and 3D-Beacons routes; Find structures panel with coverage track, sorting, Open and Add; model downloads from known providers; `search` command
  - _Requirements: 32_

- [x] 59. Search-report importers for MaxQuant, DIA-NN, Spectronaut, FragPipe, mzTab and Proteome Discoverer; Parquet, Zstandard and Snappy decoders; streaming; summaries, quantification modes and site table
  - _Requirements: 34_

- [x] 60. Public evidence route and panel (EBI Proteins API); known and new sites in reports; `evidence` command
  - _Requirements: 34, 35_

- [x] 61. Part-sphere exposure and disorder (StructureMap), PAE-aware; `ppse` scheme, profile and selection keywords; `exposure` command
  - _Requirements: 35_

- [x] 62. Cross-link importers for seven tools; solvent-accessible surface distances; distance histogram
  - _Requirements: 36_

- [x] 63. HDX-MS importers (DynamX, HDExaminer, community format), hybrid significance test, residue values, Woods plot
  - _Requirements: 37_

- [x] 64. Protenix and OpenFold3 prediction layouts, Zstandard-compressed AlphaFold 3 output, prediction folders' bookkeeping files, PDB-format prediction models; interface scores checked against `ipsae.py` on real outputs
  - _Requirements: 28_

- [x] 65. Documentation: README sections and screenshots, design, requirements, roadmap (wave 5)
  - _Requirements: 15, 32, 33, 34, 35, 36, 37_
