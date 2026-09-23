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


## Wave 1 Requirements

### Requirement 16: Publication-Quality Rendering

**User Story:** As a researcher preparing figures, I want correct, depth-rich molecular rendering, so that images read clearly in 3D and meet journal standards.

#### Acceptance Criteria

1. WHEN atoms and bonds are rendered, THE System SHALL ray-cast spheres and cylinders and write per-pixel depth so intersections are exact
2. WHEN ambient occlusion, outlines or depth fog are enabled, THE System SHALL apply them as screen-space post-processing
3. WHEN a lighting preset (Standard, Soft, Illustrative, Glossy, Neon, Flat) is chosen, THE System SHALL update material, occlusion, outline, fog and glow settings together
4. WHEN clipping is adjusted, THE System SHALL clip in the shaders without rebuilding geometry
5. WHEN an image is exported, THE System SHALL render off screen at 1× to 4× viewport resolution, with optional 2× supersampling, transparent background, legend and labels
6. WHEN nothing changes, THE System SHALL NOT re-render frames

### Requirement 17: Surfaces and Electrostatics

**User Story:** As a structural biologist, I want molecular surfaces colored by chemistry, so that I can see pockets, interfaces and charge distribution.

#### Acceptance Criteria

1. WHEN a surface type (SES, SAS, Gaussian or van der Waals) is selected, THE System SHALL compute it in a background worker for the visible chains
2. WHEN electrostatic coloring is selected, THE System SHALL color by Coulombic potential (formal charges, ε = 4r, 1.4 Å offset, ±10 kcal/mol·e) and show a legend describing the method
3. WHEN surface opacity is below 100%, THE System SHALL render a single transparent layer over the underlying representation
4. WHEN SASA is requested, THE System SHALL report per-chain totals, per-residue relative exposure and buried surface area

### Requirement 18: Secondary Structure Assignment

**User Story:** As a researcher working with predicted or modeled structures, I want secondary structure without file annotations, so that cartoons are correct for any input.

#### Acceptance Criteria

1. WHEN a structure lacks HELIX/SHEET or struct_conf annotations, THE System SHALL assign secondary structure with DSSP
2. WHEN the user selects File, DSSP or Auto mode, THE System SHALL reassign secondary structure and rebuild the cartoon
3. WHEN chains contain only C-alpha atoms, THE System SHALL fall back to a C-alpha geometry estimate and label the source

### Requirement 19: Binding Sites and Interactions

**User Story:** As a medicinal chemist, I want to focus a ligand and see its non-covalent contacts, so that I can reason about binding.

#### Acceptance Criteria

1. WHEN a residue or ligand is focused, THE System SHALL frame it, show side chains within 5 Å and detect interactions using PLIP criteria
2. WHEN interactions are shown, THE System SHALL draw typed dashed lines and list each contact with its distance
3. WHEN two chains are chosen, THE System SHALL analyze their interface and, if SASA is available, report buried surface area
4. WHEN interactions are exported, THE System SHALL write a CSV table

### Requirement 20: Sequence Panel

**User Story:** As a researcher, I want a sequence view linked to 3D, so that I can navigate by sequence and see what is not modeled.

#### Acceptance Criteria

1. WHEN a polymer chain is shown, THE System SHALL display its full declared sequence with unmodeled residues marked and helices and strands underlined
2. WHEN residues are clicked, shift-clicked or dragged, THE System SHALL update the 3D selection, and hovering SHALL highlight in both views
3. WHEN UniProt cross-references exist, THE System SHALL map author numbering to UniProt numbering

### Requirement 21: Remote Structures and Prediction Confidence

**User Story:** As a researcher, I want to open structures by identifier and judge prediction confidence, so that I can work with PDB entries and AlphaFold models without manual downloads.

#### Acceptance Criteria

1. WHEN a PDB ID or UniProt accession is entered, THE System SHALL fetch the RCSB mmCIF or current AlphaFold DB model through the local server
2. WHEN `--offline` is set, THE System SHALL refuse remote fetches and still serve cached entries
3. WHEN a predicted model is loaded, THE System SHALL color by pLDDT with the AlphaFold DB scheme and summarize confidence
4. WHEN a PAE matrix is available (AlphaFold DB, AlphaFold 3, ColabFold), THE System SHALL show an interactive heatmap whose rectangle selections highlight residues in 3D

### Requirement 22: Proteomics Overlays

**User Story:** As a proteomics researcher, I want to map my MS results onto structures locally, so that I can interpret coverage, modifications and cross-links in 3D without uploading unpublished data.

#### Acceptance Criteria

1. WHEN a protein chain is selected, THE System SHALL report ExPASy-ProtParam-equivalent sequence properties
2. WHEN peptides are pasted in common proteomics notations, THE System SHALL parse modifications, map peptides to all chains (optionally treating I and L as equal), and color coverage
3. WHEN sites or variants are entered, THE System SHALL locate them in structure or UniProt numbering and flag wild-type mismatches
4. WHEN cross-links are entered, THE System SHALL measure Cα–Cα distances against the chosen cross-linker's maximum and color satisfied and violated links
5. WHEN per-residue values are pasted, THE System SHALL color by them with a selectable colormap
6. WHEN UniProt annotations are requested, THE System SHALL fetch UniProtKB features and map them onto the structure

### Requirement 23: Scientific Correctness of Parsing

**User Story:** As a structural biologist, I want residues, elements and bonds interpreted correctly, so that the visualization is trustworthy.

#### Acceptance Criteria

1. WHEN element columns are missing, THE System SHALL infer elements from PDB atom-name alignment (for example, alpha carbons are not calcium)
2. WHEN modified residues carry a linked backbone, THE System SHALL keep them in the polymer
3. WHEN `_struct_conn` records are read, THE System SHALL create bonds only for covalent, disulfide and metal-coordination records
4. WHEN geometry indicates inter-chain disulfides or metal coordination, THE System SHALL add those bonds
5. WHEN legacy PDB files define REMARK 350 assemblies, THE System SHALL offer them like mmCIF assemblies
