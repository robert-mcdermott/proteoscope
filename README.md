# Proteoscope

![proteoscope](proteoscope.png)

Proteoscope is a local, single-binary 3D viewer and analysis workbench for
protein and nucleic-acid structures. A small Go executable embeds the browser
application and serves it on `localhost`. Parsing, rendering and analysis all
happen in your browser, so local files never leave your computer.

It covers the everyday structural biology loop: open a structure by file, PDB
ID or UniProt accession; style it; find and focus a ligand or residue; see its
interactions, surface and electrostatics; judge model quality (B-factors,
AlphaFold pLDDT and PAE, Ramachandran); map proteomics data onto it; and
export a publication-ready figure.

Highlights:

- **WebGPU renderer.**
  - Ray-cast atoms and bonds with exact intersections.
  - Screen-space ambient occlusion, outlines, depth fog and anti-aliasing.
  - Lighting presets: Standard, Soft, Illustrative, Glossy, Neon and Flat.
  - Interactive at 100k atoms.
- **Representations.**
  - Cartoon with sheet arrows and nucleic-acid bases, ball and stick,
    sticks, spacefill and trace.
  - Molecular, solvent-accessible and Gaussian surfaces with Coulombic
    electrostatics.
- **Analysis.**
  - DSSP secondary structure.
  - Ligand and interface interactions (PLIP criteria).
  - SASA and buried surface area.
  - Ramachandran plot and per-residue profiles.
  - Distance, angle and torsion rulers.
- **AlphaFold.** Fetch any UniProt accession from AlphaFold DB; view pLDDT
  coloring and an interactive PAE plot linked to the 3D view.
- **Proteomics.**
  - ProtParam-style sequence properties.
  - Peptide coverage from MaxQuant, DIA-NN, Spectronaut, ProForma or Comet
    output.
  - PTM and variant sites, with UniProt numbering.
  - Cross-link validation.
  - Custom per-residue data.
  - UniProt annotations mapped onto the structure.
- **Figures.** Supersampled PNG up to 4× with transparent background and
  legend; clipboard copy; spin videos.
- **Private.** Local files are parsed in the browser; `--offline` disables
  all network access.

## Quick Start: Download A Release

Most users do not need Go installed. Download a prebuilt binary from the
Proteoscope release page:

[https://github.com/robert-mcdermott/proteoscope/releases/tag/v0.4](https://github.com/robert-mcdermott/proteoscope/releases/tag/v0.4)

Choose the file for your operating system:

| Platform | Download |
| --- | --- |
| macOS, Apple Silicon | [`proteoscope-darwin-arm64`](https://github.com/robert-mcdermott/proteoscope/releases/download/v0.4/proteoscope-darwin-arm64) |
| Linux, x64 | [`proteoscope-linux-amd64`](https://github.com/robert-mcdermott/proteoscope/releases/download/v0.4/proteoscope-linux-amd64) |
| Windows, x64 | [`proteoscope-windows-amd64.exe`](https://github.com/robert-mcdermott/proteoscope/releases/download/v0.4/proteoscope-windows-amd64.exe) |

When Proteoscope starts, it prints a local URL, usually:

```text
http://127.0.0.1:8765
```

It will also try to open that URL in your browser. Use a browser with WebGPU:
Chrome, Edge or Brave on any desktop OS, Safari 26 or later on macOS, or
Firefox 141 or later on Windows. Other browsers fall back to a simplified
compatibility renderer.

Release binaries can lag behind the main branch. To use the newest features,
build from source (see [Development](#development)).

### macOS

Download the macOS binary for your Mac:

Open Terminal and run:

```sh
chmod +x ./proteoscope-darwin-arm64
./proteoscope-darwin-arm64
```

Because the binary is not signed with an Apple developer certificate, macOS may
show a warning such as:

```text
Apple could not verify "proteoscope-darwin-arm64" is free of malware.
```

You can unblock it in either of these ways.

Option 1, from System Settings:

1. Try to open the app once and dismiss the warning.
2. Open `System Settings`.
3. Go to `Privacy & Security`.
4. Scroll to the `Security` section.
5. Click `Open Anyway` for Proteoscope.
6. Confirm by clicking `Open`.

Option 2, from Terminal:

```sh
cd ~/Downloads
xattr -d com.apple.quarantine ./proteoscope-darwin-arm64
chmod +x ./proteoscope-darwin-arm64
./proteoscope-darwin-arm64
```

If `xattr` says the quarantine attribute was not found, continue with the
`chmod` and run commands. Replace the filename with the Intel binary if needed.

### Linux

Download `proteoscope-linux-amd64`, then run:

```sh
cd ~/Downloads
chmod +x ./proteoscope-linux-amd64
./proteoscope-linux-amd64
```

If your browser does not open automatically, copy the printed localhost URL into
Chrome, Edge, Brave, or another WebGPU-capable browser.

### Windows

Download `proteoscope-windows-amd64.exe`, then double-click it.

If Windows SmartScreen blocks the app:

1. Click `More info`.
2. Click `Run anyway`.

If Windows marks the downloaded file as blocked:

1. Right-click `proteoscope-windows-amd64.exe`.
2. Choose `Properties`.
3. On the `General` tab, check `Unblock` if it appears.
4. Click `Apply`.
5. Run the `.exe` again.

You can also run it from PowerShell:

```powershell
.\proteoscope-windows-amd64.exe
```

## Opening Structures

| Source | How |
| --- | --- |
| **RCSB PDB** | Type a PDB ID (for example `4HHB`, or an extended ID such as `pdb_00004hhb`) in **Open structure** and press **Fetch**. The PDBx/mmCIF file is downloaded from RCSB. |
| **AlphaFold DB** | Type a UniProt accession (for example `P04637`). The current AlphaFold DB model and its predicted aligned error (PAE) matrix are downloaded. |
| **Local file** | Click **Open local file** or drag files onto the window. Accepts `.pdb`, `.ent`, `.cif` and `.mmcif`, optionally gzip-compressed (`.gz`). |
| **Command line** | `proteoscope structure.cif model.pdb.gz` opens the first file at startup. |
| **Examples** | **Bundled examples** lists the structures embedded from `data/`. |
| **Deep link** | `http://127.0.0.1:8765/#fetch=4HHB` fetches on load. |

Remote downloads go through the local Proteoscope server, which only contacts
`files.rcsb.org`, `alphafold.ebi.ac.uk` and `rest.uniprot.org`. Results are
cached on disk under your user cache directory, for example
`~/Library/Caches/proteoscope` on macOS. Start with `--offline` to disable all
network access; cached entries are still served.

AlphaFold 3, ColabFold and AlphaFold DB PAE files (`.json`) can be dropped onto
a loaded model to show its PAE plot.

## The Workspace

- **Top bar:** structure title, search (press `/`), renderer badge, panel toggles.
- **Left panel tabs:**
  - **Structure:** entry metadata (method, resolution, R-free, organism,
    deposition date), biological assemblies, composition and molecules, and
    the secondary-structure source.
  - **Style:** representations, surface, color scheme, sizes, lighting and
    effects, background, projection and clipping.
  - **Analysis:** interactions, solvent accessibility, Ramachandran plot,
    per-residue profile, PAE.
  - **Proteomics:** sequence properties, UniProt annotations, peptides,
    sites and variants, cross-links, custom data.
- **Right panel:**
  - Chains: click to show or hide; double-click to show only that chain.
  - Selection details, interactions of the focused residue, and measurements.
- **Sequence panel:** the full sequence of the chosen chain.
  - Residues missing from the model are grey, and helices and strands are
    underlined.
  - Numbering gaps are marked.
  - Click to select, shift-click to add, drag for a range, double-click to
    focus.
- **Toolbar:** reset view, focus, distance, angle and torsion rulers, spin,
  export, full screen, help.
- **Legend:** describes the active color scheme and surface coloring. Click a
  legend title to collapse it.

## Navigation

| Action | Mouse / key |
| --- | --- |
| Rotate (free trackball) | Drag |
| Pan | Shift-drag or right-drag |
| Roll | Alt/Option-drag |
| Zoom | Scroll or pinch |
| Select residue / add to selection | Click / Shift-click |
| Focus a residue or ligand | Double-click, or select and press `F` |
| Reset view | `R` |
| Representation presets | `1` cartoon, `2` ball & stick, `3` sticks, `4` spacefill, `5` trace, `6` surface |
| Distance / angle / torsion ruler | `D` / `A` / `T` |
| Label selection | `L` |
| Spin | `S` |
| Orthographic / perspective | `O` |
| Water / hydrogens | `W` / `H` |
| Export image | `P` |
| Clear focus, selection or ruler | `Esc` |
| Shortcuts | `?` |

New structures are framed on their principal axes, with the longest axis
horizontal.

## Representations

The **Representation** presets set the polymer and ligand styles together.
You can also set each component separately:

- **Polymer:** cartoon, trace, ball and stick, sticks, spacefill or hidden.
  - The cartoon draws helices as ribbons, strands as flat arrows and loops as
    tubes, with smooth transitions.
  - Nucleic acids get a phosphate-backbone tube with base slabs.
- **Ligands and ions:** ball and stick, sticks, spacefill or hidden. Ions are
  drawn as spheres; metal-coordination bonds are dashed.
- **Side chains:** *Around focus* (the default) shows side chains within 5 Å
  of the focused residue or ligand. *All* shows every side chain on top of
  the cartoon.
- **Water and hydrogens:** toggles.
- **Surface:**
  - *Molecular (SES)*, *Solvent accessible (SAS)*, *Gaussian* or *van der
    Waals*.
  - Coloring can match the color scheme, Coulombic electrostatics or
    hydrophobicity.
  - Opacity is adjustable; a transparent surface shows the cartoon underneath.
  - Surfaces are computed in a background worker, taking about 0.2 s for a
    5,000-atom protein.

Modified residues such as selenomethionine and phosphoserine stay part of the
polymer. Unknown residues with a linked peptide or sugar-phosphate backbone
are recognized automatically.

## Color Schemes

| Scheme | Notes |
| --- | --- |
| Chain / Molecule (entity) | Palettes: Vivid, Colorblind-safe (Okabe-Ito), Muted (Tol), Pastel |
| Rainbow (N → C) | Sequence position within each chain |
| Secondary structure | Helix, strand, turn, coil |
| Molecule type | Protein, nucleic acid, ligand, ion, water |
| Element | Standard element colors |
| Residue class | Hydrophobic, polar, positive, negative, nucleic acid, ligand |
| Hydrophobicity | Kyte-Doolittle scale |
| Nucleotide | A, C, G, U/T |
| B-factor | Blue-white-red, viridis or magma colormaps |
| AlphaFold confidence (pLDDT) | AlphaFold DB colors: >90 dark blue, 70–90 light blue, 50–70 yellow, <50 orange. Applied automatically to predicted models. |
| Solvent exposure | Relative SASA, after **Compute SASA** |
| Peptide coverage / Custom residue data | From the Proteomics tab |
| Uniform | Any color |

*Heteroatoms by element* (on by default) colors N, O, S and other non-carbon
atoms by element in the structural schemes. Ligand carbons are green.

## Lighting and Effects

| Preset | Look |
| --- | --- |
| Standard | Key light plus headlamp, ambient occlusion, depth fog |
| Soft | Strong ambient occlusion with little direct light, similar to ChimeraX "soft" |
| Illustrative | Flat colors, black outlines and ambient occlusion, for Goodsell-style figures |
| Glossy | Strong specular highlights |
| Neon | Additive glow on a dark background (the original Proteoscope look) |
| Flat | Unlit colors with outlines |

The individual sliders are ambient occlusion strength and radius, outline,
depth fog, glow and specular. Backgrounds are dark, black, gray or white.
**Front clip** and **Back clip** cut slabs through the molecule without
rebuilding geometry; clipped atoms are capped.

## Selection, Focus and Interactions

![Imatinib in the ABL kinase pocket (2HYY) with hydrogen bonds to Met318, Thr315, Glu286 and Asp381, salt bridges, π-stacking and hydrophobic contacts](docs/images/binding-site.jpg)

- **Selecting.** Click an atom to select its residue. The selection card
  shows:
  - Residue type, including modifications.
  - Secondary structure and its source, including the DSSP code.
  - φ/ψ angles.
  - B-factor or pLDDT.
  - UniProt position.
  - Relative SASA and proteomics values, when computed.
- **Focusing.** Double-click a residue or ligand (or select one and press
  `F`) to focus it:
  - The camera frames the binding site.
  - Side chains within 5 Å appear.
  - Non-covalent interactions are detected and drawn as colored dashed lines.
- **Interaction types:** hydrogen bond, salt bridge, π-stacking (parallel and
  T-shaped), cation-π, hydrophobic contact, halogen bond, metal coordination
  and water bridge (when water is shown).
  - The criteria follow PLIP (Salentin et al. 2015).
  - Each type can be toggled in the Analysis tab.
  - **Analyze interface** lists the contacts between two chains.
  - **Export CSV** saves the interaction table.
- **Labels.** **Label** (or `L`) adds 3D labels to the selected residues.
  **Isolate chain** hides the other chains.

## Measurements

Pick a ruler in the toolbar or press `D` (distance), `A` (angle) or `T`
(torsion/dihedral), then click 2, 3 or 4 atoms. Values appear as 3D labels
and in the Measurements card. Remove one with ×, or press Backspace to remove
the last.

## Analysis Tab

![AlphaFold DB model of p53 (P04637) colored by pLDDT, with the per-residue confidence profile and the predicted aligned error matrix](docs/images/alphafold-pae.jpg)

- **Secondary structure.**
  - *Auto* uses the file's HELIX/SHEET or `struct_conf` annotations when
    present, and otherwise computes DSSP (Kabsch & Sander 1983).
  - *DSSP* always recomputes.
  - Chains with only C-alpha atoms fall back to a C-alpha-geometry estimate.
- **Solvent accessibility.**
  - Shrake-Rupley SASA with a 1.4 Å probe gives totals per chain and relative
    exposure per residue (maximum ASA from Tien et al. 2013).
  - It also gives each chain's buried surface area in the complex.
  - After an interface analysis, it adds the buried surface area of that
    interface.
- **Ramachandran plot.** φ/ψ per residue, colored by secondary structure, with
  glycine and proline marked. Click a point to select the residue. The shaded
  regions are an approximate guide, not MolProbity contours.
- **Per-residue profile.** B-factor or pLDDT, relative SASA, hydrophobicity
  (9-residue window) or custom data along the sequence. Click to select.
- **Predicted aligned error.** The PAE heatmap for AlphaFold models. Drag a
  rectangle to select the residues of both ranges in 3D.

## Proteomics Tab

![p53 bound to DNA (1TUP) with the six most frequent cancer hotspot mutations labeled and peptide coverage shown in gold](docs/images/proteomics-sites.jpg)

Everything in this tab runs in the browser. Nothing is uploaded.

- **Sequence properties.**
  - Uses ExPASy ProtParam conventions: average and monoisotopic mass, the
    Bjellqvist pI, net charge at pH 7, ε280 with and without cystines,
    absorbance at 0.1 %, GRAVY, the aliphatic and instability indices, and
    aromaticity.
  - Computed from the full deposited sequence when SEQRES or `entity_poly`
    is available.
- **UniProt annotations.**
  - Fetches domains, functional sites, PTMs, disease variants and mutagenesis
    data from UniProtKB.
  - Features are mapped onto the structure through its UniProt
    cross-reference.
  - Filter the list (for example `R175`, `kinase`, `phospho`), click a feature
    to select it, or mark features as sites.
- **Peptide coverage.**
  - Paste peptides, one per line, with an optional value.
  - Understands MaxQuant, Spectronaut, DIA-NN, ProForma 2.0, Comet/SEQUEST and
    FragPipe notation, including modifications.
  - Isoleucine and leucine can be treated as equal.
  - Coverage is mapped onto every matching chain and colored by peptide count.
    Peptide values are averaged per residue.
  - **In-silico digest** generates theoretical peptides for common proteases.
- **Sites and variants.**
  - Accepts `R175H`, `p.Arg248Gln`, `pS15`, `A:K120ac`, `Y1068` and similar.
  - Sites can use structure (author) or UniProt numbering. Wild-type
    mismatches are flagged, which catches numbering offsets.
  - Sites are highlighted, labeled and focused.
- **Cross-links (XL-MS).**
  - Paste links such as `A:K123-B:K45`, or CSV with Protein1, Residue1,
    Protein2 and Residue2 columns.
  - Cα–Cα distances are checked against the chosen cross-linker's maximum
    (DSS/BS3 30 Å, DSSO 30 Å, PhoX 20 Å, EDC 20 Å, …).
  - Links are drawn green when satisfied and red when violated. For
    homo-oligomers the shortest chain pairing is used.
- **Custom residue data.**
  - Paste `chain,residue,value` rows, such as HDX uptake, conservation or DMS
    fitness.
  - Choose a colormap, optionally centered on zero, to color the structure
    and plot the profile.

## Exporting

**Export image** (the camera button, or `P`) renders the current view off
screen:

- Resolution 1× to 4× of the viewport, optionally supersampled for smooth
  edges.
- Optionally a transparent background, the color legend, labels and
  measurements.
- **Copy** puts the image on the clipboard.
- **Spin video** records one full rotation as WebM.

Interaction tables export as CSV.

## Biological Assemblies and Ensembles

- **Assemblies.** When a file defines biological assemblies (PDBx/mmCIF
  `pdbx_struct_assembly` or PDB `REMARK 350`), choose one under **Biological
  assembly**. Assemblies above 300,000 atoms per model are shown as
  unavailable.
- **Ensembles.** Multi-model files, such as NMR ensembles, show a model slider
  with a play button.

## Structure Parsing Notes

- **Legacy PDB:**
  - Coordinates, `MODEL`/`ENDMDL`, `HELIX`/`SHEET`, `CONECT` and `SSBOND`.
  - Header metadata from `HEADER`, `TITLE`, `COMPND`, `SOURCE`, `EXPDTA`,
    `KEYWDS`, `REMARK 2` and `REMARK 3` (resolution, R-free), and
    `REMARK 350` (assemblies).
  - `SEQRES`, and UniProt mappings from `DBREF`/`DBREF1`/`DBREF2`.
  - Element columns and formal charges. When the element column is missing,
    the element is inferred from the PDB atom-name alignment, so an alpha
    carbon is never mistaken for calcium.
- **PDBx/mmCIF:**
  - `_atom_site`: author and label identifiers, entity IDs, models, formal
    charges.
  - `_entity`, `_entity_poly` and `_entity_poly_seq`.
  - `_struct_conf` and `_struct_sheet_range`.
  - `_struct_conn`: only covalent, disulfide and metal-coordination records
    become bonds.
  - `_pdbx_struct_assembly*` and `_pdbx_struct_oper_list`.
  - `_struct_ref`/`_struct_ref_seq` for UniProt numbering.
  - `_refine`, `_reflns` and `_em_3d_reconstruction` for resolution and
    R-factors, plus the organism and deposition-date categories.
  - ModelCIF `_ma_qa_metric_local` for per-residue pLDDT.
- **Chain and residue identifiers.** Author chain and residue IDs are used for
  display.
- **Alternate conformers.** The highest-occupancy conformer is kept.
- **Bonds** come from explicit records plus geometry, using element covalent
  radii. The geometric step also finds inter-chain disulfides and metal
  coordination.

## Command-Line Options

```text
proteoscope [flags] [structure files...]

  --host string       interface to bind (default 127.0.0.1)
  --port int          preferred port; nearby ports are tried if busy (default 8765)
  --no-open           do not open a browser
  --offline           disable remote fetching (cached entries still work)
  --cache-dir path    fetch cache location (default: user cache dir/proteoscope)
  --no-cache          do not read or write the fetch cache
  --dev               serve web/ and data/ from disk for development
  --version           print the version and exit
```

The server only answers requests whose Host is the local address, and it
rejects cross-origin API calls. This protects against DNS-rebinding and
cross-site requests.

## Scripting

The page exposes a small console API for automation:

```js
await proteoscope.fetch('6OIM');                  // PDB ID or UniProt accession
proteoscope.representation('cartoon');            // cartoon, ball-stick, sticks, spacefill, trace, surface
proteoscope.color('plddt');                       // any scheme id from the Style tab
proteoscope.lighting('illustrative');
const ligand = proteoscope.residues().find((r) => r.resName === 'MOV');
await proteoscope.focus([ligand.key]);            // frame, side chains, interactions
const png = await proteoscope.snapshot({ scale: 3, transparent: true });  // data URL
```

## Development

### Requirements

- Go 1.24 or newer.
- Node.js 22 or newer, to run the JavaScript tests.
- A WebGPU-capable browser.

### Run From Source

```sh
go run . --dev
```

`--dev` serves `web/` and `data/` from disk, so edits to the frontend show up
after a browser reload without rebuilding. There is no JavaScript build step.

### Build A Single Binary

```sh
go build -o proteoscope .
```

The executable embeds `web/index.html`, `web/styles.css`, `web/app.js`,
`web/favicon.svg`, `web/lib/*.js` and the structures in `data/`. To bundle
your own example structures, put `.pdb`, `.ent`, `.cif` or `.mmcif` files in
`data/` and rebuild.

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
node --test "web/lib/*.test.mjs"
```

### Code Layout

| Path | Responsibility |
| --- | --- |
| `main.go`, `fetch.go`, `cache.go`, `local.go`, `security.go` | Local server, embedded assets, fetch proxy and cache, command-line files, request hardening |
| `web/app.js` | Application state, UI wiring, render loop, analysis and proteomics panels |
| `web/lib/parse.js` | PDB and PDBx/mmCIF parsing, assemblies |
| `web/lib/structure.js` | Residues, polymer typing, bonds, secondary structure, sequences, UniProt mapping |
| `web/lib/dssp.js` | DSSP secondary-structure assignment |
| `web/lib/cartoon.js` | Protein and nucleic-acid cartoon meshes |
| `web/lib/scene.js`, `web/lib/coloring.js` | Representation and color-scheme logic |
| `web/lib/renderer.js` | WebGPU renderer: impostors, G-buffer, SSAO, outlines, FXAA, picking, capture |
| `web/lib/renderer-canvas.js` | Canvas 2D fallback renderer |
| `web/lib/camera.js`, `web/lib/math3d.js` | Trackball camera and math |
| `web/lib/surface.js`, `web/lib/surface-worker.js`, `web/lib/electrostatics.js` | Surfaces, SASA, Coulombic potential |
| `web/lib/interactions.js` | Non-covalent interaction detection |
| `web/lib/proteomics.js` | Sequence properties, peptide, site and cross-link parsing, digestion |
| `web/lib/sequence-view.js`, `web/lib/plots.js` | Sequence panel, Ramachandran, profile and PAE plots |
| `web/lib/residues.js`, `web/lib/elements.js`, `web/lib/colors.js` | Shared chemistry and color tables |

See [proteoscope-spec/roadmap.md](proteoscope-spec/roadmap.md) for the project
review, a comparison with other viewers and the roadmap.

## Troubleshooting

### The badge says "Canvas preview"

Your browser did not provide WebGPU, so Proteoscope is using a simplified
renderer without surfaces, ambient occlusion or outlines. Use Chrome, Edge or
Brave, Safari 26 or later on macOS, or Firefox 141 or later on Windows. To
force the compatibility renderer, for example to work around a GPU driver
problem, open `http://127.0.0.1:8765/?renderer=canvas`.

### Fetching fails

Check your network connection, and make sure Proteoscope was not started with
`--offline`. The error message shows RCSB's or AlphaFold DB's reply, for
example when an entry does not exist. Very large entries can take longer than
the 45-second download limit on slow connections; download the file and open
it locally instead.

### The port is already in use

Proteoscope tries the requested port first and then nearby ports. Use the URL
printed in the terminal.

### My downloaded file does not load

Use a coordinate file ending in `.pdb`, `.ent`, `.cif` or `.mmcif`,
optionally gzip-compressed. Validation reports, sequence files, BinaryCIF and
PDFs are not coordinate files.

## License

Proteoscope is licensed under the Apache License 2.0. See [LICENSE](LICENSE)
for the full license text.
