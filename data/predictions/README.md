# Bundled prediction examples

Two examples in the Examples menu are folders of structure-prediction output, opened as if they
had been dropped on the page. Their files are gzipped here; Proteoscope serves them uncompressed
under their original names. Both come from openly licensed sources and are redistributed under
those licenses, with the changes listed below.

## 8c3u-cofolding

Interleukin-1β (PDB 8C3U, chain A) co-folded with its ligand by Boltz-1 and Protenix, from the
`examples/` folder of Runs N' Poses:

- Škrinjar P, et al. Have protein–ligand co-folding methods moved beyond memorisation? bioRxiv
  2025. doi:10.1101/2025.02.03.636309
- https://github.com/plinder-org/runs-n-poses, Apache License 2.0

The predictions were made with Boltz-1 (MIT License; Wohlwend et al., bioRxiv 2024) and Protenix
(Apache License 2.0; ByteDance). Changes:

- One seed of each tool: Boltz-1 seed 1372115236 and Protenix seed 2242028199, five models each.
  The other seeds, Boltz's pLDDT arrays (`plddt_*.npz`) and the Chai-1 and AlphaFold 3 outputs
  of the same system are left out.
- The jobs were renamed from `8c3u__1__1.A__1.C` and `input` to `il1b_8c3u_boltz1` and
  `il1b_8c3u_protenix`, in folder and file names, and the Boltz seed folder was dropped. The
  Protenix input JSON's `name` field was changed to match; the Boltz input YAML is unchanged.
- Files were gzipped. Their contents are otherwise as published.

## ul144-motsc

The cysteine-rich domain of cytomegalovirus UL144 with the mitochondrial peptide MOTS-c, predicted
by ColabFold 1.5.5 (AlphaFold-Multimer v3):

- Büttiker P. UL144-TNFR-MOTSc-AlphaFold: data release for manuscript submission. Zenodo 2026.
  doi:10.5281/zenodo.21471604, Creative Commons Attribution 4.0 International (CC BY 4.0)

Changes: the five best-ranked of the 80 models, each with its scores file, moved from the
release's separate structure and score folders into one folder and gzipped. File names and
contents are otherwise as published.
