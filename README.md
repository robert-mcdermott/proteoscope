# Proteoscope

![proteoscope](proteoscope.png)

Proteoscope is an application for interactive
3D visualization of Protein Data Bank (`.pdb`) structures. It is written as a
single Go binary that embeds the browser UI, static assets, and bundled PDB
files, then serves the application on a local URL.

Proteoscope is designed for exploratory structural biology work: load a PDB,
inspect chains and ligands, switch molecular representations, color by
scientific properties, search atoms or residues, measure distances, and export
publication-prep screenshots.

## Quick Start

```sh
go run .
```

Proteoscope prints a local URL, usually:

```text
http://127.0.0.1:8765
```

Open that URL in a browser. By default, Proteoscope also tries to open the URL
for you.

To start the server without opening a browser:

```sh
go run . --no-open
```

## Getting PDB Files

Proteoscope reads standard `.pdb` coordinate files.

You can download more structures from the RCSB PDB download service:

[https://www.rcsb.org/downloads](https://www.rcsb.org/downloads)

The RCSB download page supports downloading multiple files from the PDB archive
and points users to individual data files from each structure's summary page.
For use in Proteoscope, choose PDB coordinate files (`.pdb`) rather than PDFs or
documentation files.

## Loading Structures

### Bundled Structures

The dropdown labeled `Bundled structure` lists every `.pdb` file embedded from
the repository's `data/` directory at build time.

To add default structures to your own build:

1. Put one or more `.pdb` files in `data/`.
2. Rebuild the Go binary.
3. The files will be embedded into the executable through Go's embedded
   filesystem.

### Local Uploads

Use `Open local PDB` to load a structure from your computer.

The file is parsed in the browser. Proteoscope does not upload local PDB files
to an external server; the Go process only serves the local application.

## Main Viewer

The central viewport shows the active structure in 3D.

Mouse controls:

- Drag to rotate the molecule.
- Shift-drag to pan.
- Scroll to zoom.
- Click an atom to select it.
- Press `R` to reset the view.
- Press `Esc` to clear search and measurement state.

The renderer badge shows the active rendering mode:

- `WebGPU`: hardware-accelerated rendering is active.
- `Canvas preview`: WebGPU was unavailable in the current browser, so
  Proteoscope is using a compatibility renderer.

For best performance, use a browser with strong WebGPU support. Chrome, Edge,
and Brave work well in current testing. Safari may fall back to a non-WebGPU
path and can feel slower or less responsive with larger structures.

## Structure Summary

The top-left panel shows metadata and counts for the active structure.

### Atoms

For ordinary single-model structures, `Atoms` is the number of atoms in the
loaded model.

For NMR ensembles or other multi-model PDB files, Proteoscope renders one model
at a time. In that case the UI shows:

- `Atoms/model`: atom count in the currently selected model.
- `Total atoms`: total coordinate records across all models.
- `Models`: number of models available in the file.

For example, an NMR ensemble with 40 models and 619 atoms in each model has
24,760 total coordinate records, but the viewer displays 619 atoms at a time.

### Residues

Residues are grouped by chain, residue name, residue number, and insertion
code. Standard residues, nucleic-acid residues, ligands, and waters are all
recognized from the PDB atom records.

### Chains

Chains come from the PDB chain identifier. The chain panel lets you isolate one
chain at a time or return to all chains.

## Representations

Proteoscope provides three molecular representations.

### Ball + Stick

Shows atoms as spheres and bonds as cylinders or ribbons. This is the best
default for inspecting connectivity, ligands, cofactors, and residue-level
geometry.

### Spacefill

Shows atoms closer to their van der Waals size. This emphasizes molecular
volume, steric packing, surface shape, and how tightly ligands or residues fill
space.

### Backbone

Shows a simplified polymer trace. Proteins are traced through alpha carbons
(`CA`), while nucleic acids are traced through backbone atoms such as `P` and
sugar carbons. Ligands remain visible so cofactors and bound molecules are not
lost.

## Coloring Modes

### Chain

Assigns a different color to each chain. This is useful for complexes,
oligomers, protein-DNA assemblies, and comparing subunits.

### Element

Uses conventional element coloring, such as carbon, nitrogen, oxygen, sulfur,
phosphorus, and common metal ions. This is useful for atom-level chemical
inspection.

### B-factor

Colors atoms by B-factor, also called temperature factor or atomic displacement
parameter. Lower and higher values are mapped to different colors so flexible
or uncertain regions are easier to spot. For NMR files, B-factors may be zero
or less meaningful depending on how the file was deposited.

### Residue

Colors by residue class:

- Hydrophobic residues
- Polar residues
- Positively charged residues
- Negatively charged residues
- Nucleic-acid residues
- Ligands and solvent

This is useful for quickly reading chemical character across a structure.

## Display Controls

### Atom Scale

Changes atom sphere size. Increase it for presentations or space-filling
inspection; decrease it when dense structures become visually crowded.

### Bond Scale

Changes bond thickness. Increase it to make connectivity clearer; decrease it
for very large structures.

### Glow

Adds a subtle screen-space glow around atoms. This is a visual aid for depth and
presentation screenshots. Set it lower for a quieter scientific plotting style.

### Clip

Clips the structure along the current viewing direction. This helps inspect the
interior of dense proteins, binding pockets, nucleic-acid grooves, or buried
ligands.

## Visibility Toggles

### Ligands

Shows or hides `HETATM` records that are not water. This usually includes
cofactors, ions, inhibitors, substrates, prosthetic groups, and crystallization
components.

### Water

Shows or hides water molecules such as `HOH`, `WAT`, `H2O`, and `DOD`.

Water is off by default because crystallographic waters can clutter the view,
but turning it on is useful for inspecting active sites, interfaces, and
hydrogen-bonding networks.

### H

Shows or hides hydrogen atoms. Hydrogens are often absent from X-ray structures
and abundant in some NMR or modeled structures, so they are hidden by default.

### Motion

Enables or disables gentle automatic rotation.

## Search

The search box finds residues, ligands, chains, atom names, elements, residue
numbers, and atom serials.

Examples:

- `heme`
- `HEM A142`
- `chain B`
- `lys 42`
- `FE`
- `CA`

Search results include both residue-level and atom-level hits. Selecting a
result focuses the view on that atom or residue representative.

## Selection Panel

Click an atom or choose a search result to select it.

The selection panel reports:

- Atom name
- Residue name and number
- Chain
- Element
- Atom serial number
- Occupancy
- B-factor

Use `Frame` to center the camera on the selected atom.

## Distance Measurement

Proteoscope supports simple point-to-point distance measurements.

1. Click one atom.
2. Click a second atom.
3. Proteoscope records the distance between them in Angstroms (`Å`).

Each new atom click after the first creates a measurement from the previously
selected atom to the newly selected atom. Measurement lines are drawn in the
viewport and recent measurements appear in the selection panel.

Use `Clear measure` to remove measurement lines and reset the measurement
sequence.

Common uses:

- Ligand-to-residue contact distances
- Metal coordination distances
- Hydrogen-bond candidate distances
- Interface contacts
- Nucleic-acid base-pair or intercalator geometry checks

## Model Slider

Multi-model PDB files, especially NMR ensembles, show a model slider at the
bottom of the viewport.

Proteoscope displays one model at a time. Move the slider to inspect alternate
conformations in the ensemble.

## Chain Panel

The chain panel lists all chains detected in the first model. Each row shows:

- Chain identifier
- Residue count
- Atom count
- Chain color

Click a chain to isolate it. Click it again or press `All` to return to the
full structure.

## PNG Export

Use the square toolbar button to export the current viewport as a PNG image.
The image reflects the current camera angle, representation, coloring mode,
visibility toggles, clipping, glow, and selection state.

## PDB Parsing Notes

Proteoscope currently reads these PDB records and fields:

- `HEADER`, `TITLE`, `EXPDTA`, and resolution remarks for metadata.
- `ATOM` and `HETATM` for coordinates and atom properties.
- `MODEL` and `ENDMDL` for multi-model ensembles.
- `HELIX` and `SHEET` for secondary-structure hints.
- `CONECT` for explicit connectivity where present.
- Occupancy, B-factor, element, chain, residue name, residue number, insertion
  code, alternate location, and atom serial fields.

Bond handling:

- Explicit `CONECT` bonds are used when present.
- Standard covalent bonds are inferred from element radii and interatomic
  distance because many PDB files omit `CONECT` records for ordinary polymer
  residues.

Alternate locations:

- Blank alternate locations are accepted.
- `A` and `1` conformers are accepted.
- Other alternate locations are skipped for a cleaner default view.

Limitations:

- Proteoscope reads `.pdb` files, not `.cif`/`.mmCIF` files yet.
- Biological assembly transformations are not currently expanded.
- Full solvent-accessible surfaces, electrostatics, density maps, and sequence
  annotation tracks are not yet implemented.

## Development

### Requirements

- Go 1.24 or newer.
- A modern browser with WebGPU support. Chrome, Edge, and Brave are recommended
  for best performance. Safari may fall back to a compatibility renderer and is
  not recommended for large structures.

### Run From Source

```sh
go run .
```

Useful flags:

```sh
go run . --no-open
go run . --host 127.0.0.1 --port 8765
```

### Build A Single Binary

```sh
go build -o proteoscope .
```

The resulting executable embeds:

- `web/*`
- `data/*.pdb`

That means the app can be distributed as one file.

### Cross Compile

```sh
GOOS=darwin GOARCH=arm64 go build -o dist/proteoscope-darwin-arm64 .
GOOS=darwin GOARCH=amd64 go build -o dist/proteoscope-darwin-amd64 .
GOOS=linux GOARCH=amd64 go build -o dist/proteoscope-linux-amd64 .
GOOS=windows GOARCH=amd64 go build -o dist/proteoscope-windows-amd64.exe .
```

### Test

```sh
go test ./...
```

There is no Node build step. The frontend is plain embedded HTML, CSS, and
JavaScript.

## Troubleshooting

### The App Opens But Says Canvas Preview

Your browser did not provide a WebGPU device. The app remains usable, but for
the best rendering performance and shading quality, open the localhost URL in a
browser with WebGPU enabled. Chrome, Edge, and Brave are the recommended
choices. Safari may use a fallback path and can perform poorly on larger PDB
files.

### The Port Is Already In Use

Proteoscope tries the requested port first and then searches nearby ports. Use
the URL printed in the terminal.

### My Downloaded File Does Not Load

Make sure the file is a PDB coordinate file ending in `.pdb`. Some RCSB download
options provide `.cif`, compressed archives, validation reports, or PDFs; those
are not currently accepted by Proteoscope.
