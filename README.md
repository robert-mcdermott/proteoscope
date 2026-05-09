# Proteoscope

Proteoscope is a self-contained Go application for interactive 3D visualization of
Protein Data Bank (`.pdb`) structures. It embeds the browser UI and bundled sample
structures into a single executable, then serves the app on localhost.

## Features

- Embedded sample PDBs from `data/`, exposed through `/api/samples`.
- Local `.pdb` upload and parsing entirely in the browser.
- PDB-aware parsing for `ATOM`, `HETATM`, `MODEL`/`ENDMDL`, `HELIX`, `SHEET`,
  `CONECT`, occupancy, B-factor, residue, chain, element, ligand, water, and
  hydrogen fields.
- Representations for ball-and-stick, spacefill, and backbone traces.
- Coloring by chain, element, B-factor, or residue class.
- Chain isolation, ligand/water/hydrogen toggles, model scrubbing for NMR
  ensembles, atom/residue search, picking, selection framing, distance
  measurement, clipping, glow, and PNG export.
- WebGPU renderer when available, with a canvas compatibility preview for
  browsers where WebGPU is disabled or unavailable.

## Run Locally

```sh
go run . --no-open
```

Then open the printed localhost URL, usually `http://127.0.0.1:8765`.

To let Proteoscope open the browser automatically:

```sh
go run .
```

## Build

```sh
go build -o proteoscope .
```

The resulting binary includes `web/*` and `data/*.pdb` through Go's embedded
filesystem.

## Cross Compile

```sh
GOOS=darwin GOARCH=arm64 go build -o dist/proteoscope-darwin-arm64 .
GOOS=darwin GOARCH=amd64 go build -o dist/proteoscope-darwin-amd64 .
GOOS=linux GOARCH=amd64 go build -o dist/proteoscope-linux-amd64 .
GOOS=windows GOARCH=amd64 go build -o dist/proteoscope-windows-amd64.exe .
```

## Notes

PDB bond records are not complete for standard residues, so Proteoscope uses
explicit `CONECT` records where present and infers standard covalent bonds from
element radii and interatomic distance. Alternate locations are filtered to blank,
`A`, or `1` conformers for a clean default view.
