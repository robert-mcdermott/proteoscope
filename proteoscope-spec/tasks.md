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
