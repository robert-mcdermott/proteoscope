# Requirements Document: Proteoscope

## Introduction

Proteoscope is a local, single-binary molecular visualization application for
interactive exploration of Protein Data Bank (`.pdb`) structures. The system is
intended for life science researchers who need a scientifically competent,
visually compelling way to inspect protein, nucleic-acid, ligand, and multi-model
PDB structures without installing a complex desktop molecular viewer.

The application runs as a small Go executable that serves an embedded browser UI
on localhost. It includes default PDB structures, allows users to load their own
PDB files, renders interactive 3D molecular scenes with WebGPU when available,
and provides practical research workflows such as chain isolation, search,
representation switching, B-factor coloring, NMR model inspection, atom
selection, distance measurement, and PNG export.

## Glossary

- **System**: The Proteoscope application.
- **PDB**: Protein Data Bank coordinate file format using fixed-column records
  such as `ATOM`, `HETATM`, `MODEL`, `HELIX`, `SHEET`, and `CONECT`.
- **Structure**: A parsed molecular coordinate dataset loaded from a PDB file.
- **Model**: One coordinate model in a PDB file. NMR ensembles often contain
  many models.
- **Atom**: A parsed `ATOM` or `HETATM` coordinate record.
- **Residue**: A group of atoms sharing chain ID, residue name, residue number,
  and insertion code.
- **Chain**: A polymer or molecular chain identified by the PDB chain ID.
- **Ligand**: A non-water `HETATM` residue such as a cofactor, ion, inhibitor,
  substrate, or crystallization component.
- **Water**: Solvent residues such as `HOH`, `WAT`, `H2O`, or `DOD`.
- **Representation**: A rendering style such as ball-and-stick, spacefill, or
  backbone.
- **Color Scheme**: The rule used to assign atom colors, such as chain, element,
  B-factor, or residue class.
- **B-factor**: Temperature factor or atomic displacement parameter from the PDB
  atom record.
- **WebGPU Renderer**: Hardware-accelerated browser renderer using WebGPU.
- **Canvas Preview**: Compatibility renderer used when WebGPU is unavailable.
- **Measurement**: A point-to-point distance calculation between two selected
  atoms, reported in Angstroms.

## Requirements

### Requirement 1: Single-Binary Local Application

**User Story:** As a researcher, I want to run Proteoscope as a single executable, so that I can use the viewer without installing a server stack or frontend toolchain.

#### Acceptance Criteria

1. WHEN a user starts the executable, THE System SHALL start an HTTP server bound to localhost
2. WHEN the server starts successfully, THE System SHALL print the local URL to the terminal
3. WHEN possible, THE System SHALL attempt to open the local URL in the user's browser
4. WHEN a preferred port is unavailable, THE System SHALL find a nearby available port
5. WHEN the binary is distributed, THE System SHALL include the web UI assets and bundled PDB files inside the executable

### Requirement 2: Bundled PDB Structure Library

**User Story:** As a researcher, I want Proteoscope to include default structures, so that I can immediately explore the application without finding my own data first.

#### Acceptance Criteria

1. WHEN the application starts, THE System SHALL discover embedded `.pdb` files from the bundled data directory
2. WHEN bundled files are found, THE System SHALL expose them through a sample manifest API
3. WHEN a bundled structure is selected, THE System SHALL load the corresponding PDB file into the viewer
4. WHEN a bundled file contains metadata, THE System SHALL display title, structure ID, method, resolution, atom count, chain count, residue count, and model count where available
5. WHEN a bundled file is a multi-model ensemble, THE System SHALL distinguish atoms per model from total coordinate records

### Requirement 3: Local PDB Upload

**User Story:** As a researcher, I want to open a PDB file from my computer, so that I can inspect structures that are not bundled with the application.

#### Acceptance Criteria

1. WHEN a user chooses `Open local PDB`, THE System SHALL accept a local `.pdb` file
2. WHEN the file is selected, THE System SHALL parse it in the browser
3. WHEN a local file is loaded, THE System SHALL update the viewer, metadata, controls, chains, search index, and selection state
4. WHEN a local file is loaded, THE System SHALL NOT upload the file to an external service
5. WHEN the file does not contain atom coordinates, THE System SHALL show an error instead of rendering an empty scene

### Requirement 4: PDB Parsing and Scientific Metadata

**User Story:** As a structural biologist, I want Proteoscope to parse core PDB records correctly, so that the visualization reflects the scientific contents of the file.

#### Acceptance Criteria

1. WHEN parsing a PDB file, THE System SHALL read `HEADER`, `TITLE`, `EXPDTA`, and resolution remarks for metadata
2. WHEN parsing coordinate records, THE System SHALL read `ATOM` and `HETATM` fields for serial, atom name, alternate location, residue name, chain ID, residue number, insertion code, coordinates, occupancy, B-factor, and element
3. WHEN parsing multi-model files, THE System SHALL create separate model objects for `MODEL` and `ENDMDL` blocks
4. WHEN no explicit `MODEL` records exist, THE System SHALL treat the coordinates as a single model
5. WHEN parsing secondary-structure records, THE System SHALL read `HELIX` and `SHEET` ranges where present
6. WHEN parsing connectivity, THE System SHALL read `CONECT` records where present
7. WHEN alternate locations are present, THE System SHALL accept blank, `A`, and `1` conformers for the default view and skip other alternate locations

### Requirement 5: Bond Construction

**User Story:** As a researcher, I want atoms to be connected with chemically plausible bonds, so that ball-and-stick and backbone views are meaningful even when PDB connectivity is incomplete.

#### Acceptance Criteria

1. WHEN `CONECT` records exist, THE System SHALL create explicit bonds from those records
2. WHEN standard polymer bonds are not explicitly listed, THE System SHALL infer covalent bonds using element radii and interatomic distances
3. WHEN inferring bonds, THE System SHALL avoid creating water-water and hydrogen-hydrogen bonds
4. WHEN inferring polymer bonds, THE System SHALL avoid connecting ordinary atoms across chains unless heteroatoms are involved
5. WHEN rendering backbone mode, THE System SHALL construct trace bonds from representative protein or nucleic-acid backbone atoms

### Requirement 6: Interactive 3D Navigation

**User Story:** As a researcher, I want to rotate, pan, and zoom the molecule, so that I can inspect it from any orientation.

#### Acceptance Criteria

1. WHEN a user drags the viewport, THE System SHALL rotate the camera around the structure
2. WHEN a user shift-drags the viewport, THE System SHALL pan the camera target
3. WHEN a user scrolls, THE System SHALL zoom toward or away from the structure
4. WHEN a user presses `R`, THE System SHALL reset the view to frame the active model
5. WHEN automatic motion is enabled, THE System SHALL gently rotate the structure
6. WHEN automatic motion is disabled, THE System SHALL stop camera auto-rotation

### Requirement 7: Molecular Representations

**User Story:** As a researcher, I want multiple molecular representations, so that I can choose the visual style that best supports my analysis.

#### Acceptance Criteria

1. WHEN `Ball + Stick` is selected, THE System SHALL render atoms as spheres and bonds as visible connectors
2. WHEN `Spacefill` is selected, THE System SHALL render atoms closer to their van der Waals size
3. WHEN `Backbone` is selected, THE System SHALL render a simplified polymer trace
4. WHEN `Backbone` is selected, THE System SHALL preserve visible ligands so cofactors and bound molecules remain inspectable
5. WHEN the representation changes, THE System SHALL rebuild the molecular scene without reloading the PDB file

### Requirement 8: Scientific Color Schemes

**User Story:** As a researcher, I want scientifically meaningful color schemes, so that visual patterns correspond to molecular properties.

#### Acceptance Criteria

1. WHEN `Chain` coloring is selected, THE System SHALL assign stable distinct colors to chains
2. WHEN `Element` coloring is selected, THE System SHALL color atoms by chemical element
3. WHEN `B-factor` coloring is selected, THE System SHALL map low and high B-factors to a continuous color scale
4. WHEN `Residue` coloring is selected, THE System SHALL color protein residues by chemical class and distinguish nucleic acids, ligands, and solvent
5. WHEN the color scheme changes, THE System SHALL update visible atoms and bonds without reparsing the file

### Requirement 9: Display and Visibility Controls

**User Story:** As a researcher, I want to adjust visual density and molecular subsets, so that I can reduce clutter and focus on relevant parts of the structure.

#### Acceptance Criteria

1. WHEN the atom scale changes, THE System SHALL update atom radii
2. WHEN the bond scale changes, THE System SHALL update bond thickness
3. WHEN the glow control changes, THE System SHALL adjust atom glow intensity
4. WHEN the clip control changes, THE System SHALL hide atoms beyond the current view-depth threshold
5. WHEN the ligand toggle changes, THE System SHALL show or hide non-water heteroatoms
6. WHEN the water toggle changes, THE System SHALL show or hide water residues
7. WHEN the hydrogen toggle changes, THE System SHALL show or hide hydrogen atoms

### Requirement 10: Chain Isolation

**User Story:** As a researcher, I want to isolate individual chains, so that I can inspect subunits and complexes without visual interference.

#### Acceptance Criteria

1. WHEN a structure is loaded, THE System SHALL list all chains detected in the first model
2. WHEN displaying a chain, THE System SHALL show chain identifier, residue count, atom count, and chain color
3. WHEN a user clicks a chain, THE System SHALL isolate that chain in the viewport
4. WHEN a user clicks the isolated chain again, THE System SHALL restore all chains
5. WHEN a user clicks `All`, THE System SHALL clear chain isolation

### Requirement 11: Search

**User Story:** As a researcher, I want to search for residues, ligands, chains, atom names, elements, and serial numbers, so that I can quickly locate molecular features.

#### Acceptance Criteria

1. WHEN a user types in the search box, THE System SHALL filter a search index built from residues and atoms
2. WHEN terms are entered, THE System SHALL match all query terms against searchable atom and residue metadata
3. WHEN ligand aliases are known, THE System SHALL support common names such as `heme` for `HEM`
4. WHEN search results appear, THE System SHALL show both residue-level and atom-level matches
5. WHEN a user selects a search result, THE System SHALL select and frame the corresponding atom or residue representative

### Requirement 12: Selection and Measurement

**User Story:** As a researcher, I want to select atoms and measure distances, so that I can inspect contacts, active sites, coordination geometry, and molecular interactions.

#### Acceptance Criteria

1. WHEN a user clicks an atom, THE System SHALL select that atom
2. WHEN an atom is selected, THE System SHALL display atom name, residue, chain, element, serial, occupancy, and B-factor
3. WHEN `Frame` is clicked, THE System SHALL center the camera on the selected atom
4. WHEN a user selects two atoms in sequence, THE System SHALL create a distance measurement between them
5. WHEN a measurement is created, THE System SHALL draw a measurement line and report the distance in Angstroms
6. WHEN `Clear measure` is clicked, THE System SHALL remove measurement lines and reset the measurement sequence

### Requirement 13: Multi-Model Ensemble Inspection

**User Story:** As a researcher, I want to inspect NMR ensembles one model at a time, so that I can evaluate conformational variation without overlay clutter.

#### Acceptance Criteria

1. WHEN a loaded PDB contains multiple models, THE System SHALL display a model slider
2. WHEN a model is selected, THE System SHALL render only that model
3. WHEN the active model changes, THE System SHALL update atoms, bonds, bounds, selection, and measurement state
4. WHEN reporting atom counts for multi-model files, THE System SHALL show atoms per model and total coordinate records
5. WHEN a single-model PDB is loaded, THE System SHALL hide the model slider

### Requirement 14: Rendering Performance and Browser Compatibility

**User Story:** As a researcher, I want high-performance rendering in modern browsers with a fallback path, so that Proteoscope remains usable across common systems.

#### Acceptance Criteria

1. WHEN WebGPU is available, THE System SHALL use the WebGPU renderer
2. WHEN WebGPU initialization fails or times out, THE System SHALL fall back to the canvas preview renderer
3. WHEN rendering atoms in WebGPU, THE System SHALL use GPU buffers and shader-based billboards for atom impostors
4. WHEN rendering in canvas preview, THE System SHALL project atoms and bonds into a 2D compatibility view
5. WHEN lighting atoms, THE System SHALL use viewer-facing headlamp-style lighting without fixed left/right molecule bias
6. WHEN browser compatibility is documented, THE System SHALL recommend Chrome, Edge, or Brave for best WebGPU performance

### Requirement 15: Export and Documentation

**User Story:** As a researcher, I want to export images and understand how to use the application, so that I can communicate structural observations and onboard new users.

#### Acceptance Criteria

1. WHEN a user clicks PNG export, THE System SHALL download an image of the current viewport
2. WHEN exporting, THE System SHALL reflect the current camera, representation, coloring, visibility, clipping, glow, and selection state
3. WHEN documentation is provided, THE System SHALL explain release downloads, browser recommendations, PDB acquisition, controls, representations, measurement, and build instructions
4. WHEN release binaries are provided, THE documentation SHALL explain macOS, Linux, and Windows run/unblock steps

