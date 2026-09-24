# Validation

Proteoscope's analyses are reimplementations of published methods. This folder
checks them against the reference implementations those methods come from:
limma, MSstatsPTM, US-align, Capra and Singh's conservation scorer, EMDB's
validation pipeline and MolProbity (through the wwPDB validation reports).

The reference tools are not part of Proteoscope and are not in this
repository. Only their numbers are: `reference/` holds what each tool
produced, and `run.mjs` recomputes the same quantities with the modules in
`web/lib` and compares them.

## Running the checks

With Node.js 22 or later:

```bash
node validation/run.mjs
```

The first run downloads its public inputs (about 12 MB: 34 PDB entries, a
region of one EMDB map and one wwPDB validation report) into
`validation/cache/`, which git ignores. Later runs use the cache. The whole run
takes about 8 seconds.

| Option | Effect |
| --- | --- |
| `limma`, `msstatsptm`, `usalign`, `conservation`, `emdb`, `ramachandran` | Run only these suites |
| `--offline` | Skip suites whose inputs are not cached |
| `--verbose` | Print every check, not only failures |

The command exits with status 1 when a check fails. Continuous integration
runs the three offline suites (`limma`, `msstatsptm`, `conservation`) on every
pull request and every push to `main`. It runs all six weekly, and on pull requests that touch `web/lib` or
this folder (`.github/workflows/validation.yml`).

## What is checked

| Suite | Proteoscope | Reference | Inputs | Required | Current agreement |
| --- | --- | --- | --- | --- | --- |
| `limma` | `moderatedTTest` (`stats.js`) | limma 3.68.5: `lmFit`, `contrasts.fit`, `eBayes`; `p.adjust` (BH) | Three simulated experiments: 3 vs 3 complete (moment estimate of the prior); 4 vs 5 with 20% missing values (likelihood estimate, unequal df); 3 vs 3 with d0 = ∞ | Relative difference below 1e-8 in d0, s0², log2FC, t, p and q; the same features tested | 9e-11 or better |
| `msstatsptm` | `adjustForProtein` | MSstatsPTM 2.14.0, `.adjustProteinLevel` | 60 simulated sites: one without its protein, two with infinite changes, one protein with SE 0 | Relative difference below 1e-10; special cases handled alike | 7e-14 |
| `usalign` | `tmAlign`, `mmAlign` (`tmalign.js`) | US-align 20260920 | 17 chain pairs (proteins, tRNAs, a riboswitch, a moved copy); 16 complex pairs (hemoglobins, protease–inhibitor, protein–RNA, a moved and relabeled copy, 4 vs 3 chains) | TM-scores to US-align's 5 printed decimals; RMSD, identity and aligned length; the same residue pairs (chains) or chain assignment (complexes) | All 33 identical |
| `conservation` | `conservationScores` (`conservation.js`) | `score_conservation.py` (Capra & Singh 2007) | Pfam seeds PF00240 (ubiquitin, 59 sequences) and PF00870 (p53 DNA-binding domain, 38 sequences), each with 7 option sets: Jensen–Shannon divergence and Shannon entropy, windows, weighting, gap penalty and cutoff | Difference below 1e-9; the same columns left unscored | 5e-13 |
| `emdb` | `mapFit` (`volume.js`) | EMDB validation analysis | Model 8GUB in map EMD-34272 at the recommended contour, 0.136 | Atom inclusion within 0.005; per residue identical or one atom apart | 0.8935 vs 0.896; 1,234 of 1,254 residues identical, 20 one atom apart |
| `ramachandran` | `classifyRamachandran` (`ramachandran.js`) | The wwPDB report of 1M17 (MolProbity's Top8000 analysis) | Bundled 1M17 | Every class agrees | 308 of 308 |

Notes:

- **US-align's complex mode.** When the first complex has more chains than
  the second, US-align 20260920 passes its chain-score matrix to
  `hetero_refined_greedy_search` without transposing it (`USalign.cpp`). It
  then reads past the ends of the matrix rows, and its results for those
  cases change from run to run. Four of the 16 complex cases are affected. Their
  reference numbers (marked `"build": "patched"`) come from the same source
  with the transposed matrix passed. Proteoscope's port passes the transposed
  matrix and matches US-align in the other 12 cases.
- **EMDB counts fewer atoms than Proteoscope.** Its analysis counts 10,115
  atoms, while the model has 10,358 heavy atoms (10,328 protein and 30
  ligand). Per residue, Proteoscope's inclusion equals EMDB's for 1,234 of
  1,254 residues, and the other 20 differ by one atom. The volume server
  sends the map as 8-bit values, which moves a few atoms across the contour.
- **Constant features.** When a feature's values are identical within each
  group, limma's QR decomposition leaves a residual SD of about 1e-15
  (occasionally exactly 0), where Proteoscope computes exactly 0. The results
  agree while such features are a minority. When most features are constant,
  limma's prior depends on those rounding residues, and the results part.
  Given limma's own residual SDs, Proteoscope's empirical Bayes step still
  matches its p-values to 2e-15. The simulated experiments here have no
  constant features.

## Regenerating the references

Each script in `scripts/` writes one file in `reference/`. None of the tools
they call are shipped with Proteoscope; install them locally.

| Reference | Command | Needs |
| --- | --- | --- |
| `limma.json` | `Rscript validation/scripts/limma-reference.R validation/reference/limma.json` | R with limma (Bioconductor) and jsonlite |
| `msstatsptm.json` | `Rscript validation/scripts/msstatsptm-reference.R validation/reference/msstatsptm.json [path/to/MSstatsPTM/R/utils_groupComparison.R]` | MSstatsPTM installed, or its source file; data.table and jsonlite |
| `usalign.json` | `USALIGN=/path/to/USalign [USALIGN_PATCHED=/path/to/patched/USalign] node validation/scripts/usalign-reference.mjs` | US-align built from <https://github.com/pylelab/USalign>. For the patched build, pass `TMave_mat` transposed in the `else` branch that calls `hetero_refined_greedy_search` |
| `conservation.json` | `python3 validation/scripts/port-score-conservation.py /path/to/conservation_code`, then `SCORE_CONSERVATION=/path/to/conservation_code node validation/scripts/conservation-reference.mjs` | Capra & Singh's `conservation_code` from <https://compbio.cs.princeton.edu/conservation/> (Python 2 code; the first command makes a Python 3 copy that prints 12 decimals) |
| `emdb-34272.json` | `node validation/scripts/emdb-reference.mjs` | Network access to EMDB's API |

The simulated data are generated with fixed seeds inside the R scripts and
stored with the results, so the checks never need R.

## Data and licenses

- `data/PF00240.seed.sto` (PF00240.30) and `data/PF00870.seed.sto`
  (PF00870.24) are Pfam seed alignments. Pfam is distributed under CC0.
- Downloaded at run time: PDB entries from RCSB, a region of EMD-34272 from
  the PDBe volume server, and the 1M17 validation report from the wwPDB
  archive. The PDB and EMDB archives are CC0.

## Checks that are not automated

These checks need large inputs or tools that are not scripted here. They were
run once, while each feature was built.

| Check | Result |
| --- | --- |
| TM-align, all against all: 25 protein chains and 3 RNAs, in both directions (606 pairs), against US-align | 606 identical: TM-scores, aligned length, RMSD, residue pairs and rotation |
| TM-align edge cases: chains of 3 to 30 residues, DNA, RNA against protein, and the fast mode up to the 959-residue SARS-CoV-2 spike chain (6VXX vs 6VYB) | All identical to US-align |
| limma, 12 simulated experiments: complete and missing values, minimum-value filters, the moment and likelihood priors, d0 = ∞, df = 0 features, and 50,000 features (6 vs 6, 18% missing) | Nine agree to 3e-10 in t and 4e-12 in p. In two, limma left a constant feature at exactly 0 residual SD instead of its usual ~1e-15, which moves t by up to 2.5e-4; with those set to 1e-20, they agree to 4e-11. The twelfth has 60% constant features (see the note on constant features) |
| Capra & Singh, 175 runs: 25 alignments with 7 option sets each. The alignments were OpenProteinSet A3Ms (UniRef90, BFD/Uniclust, MGnify and combined) for three chains; three Pfam seeds, each as Stockholm, interleaved Stockholm and two Clustal layouts; and a synthetic A3M with rare letters | Largest difference 5.0e-13; the same columns unscored; the same rows read |
| Conservation on 1TUP from a UniRef90 A3M of the p53 DNA-binding domain (1,384 sequences) | The most conserved residues are the zinc ligands C176, H179, C238 and C242, then S241, R175, R248 and R273 |
| Density orientation: 1M17 2Fo−Fc from the PDBe volume server | 2.53σ on average at atom positions, 0.13σ at random points |
| Differential ubiquitination: DIA-NN report of MZ1 vs DMSO (the MSstatsPTM example), mapped on 5T35 | Without imputation, 11 GlyGly features are tested and 7 are significant. With imputation (features seen at least twice in a group), 38 are tested and 20 are significant, including BRD4 K362, K404, K431 and K445 (log2FC 4.1–6.2, q ≤ 1e-5) |
| Structure alignment in the page: 1A5R onto 1UBQ | TM-score 0.654 / 0.524, 2.36 Å over 71 pairs, as US-align gives; the sequence-based fit reaches 0.625 |

Checks from earlier waves are listed in the validation sections of
[the roadmap](../proteoscope-spec/roadmap.md). Among them:

- the clashes of the 1M17 report;
- interface scores against `ipsae.py`;
- the Parquet and Zstandard decoders against pyarrow and zstd;
- half-sphere exposure against Biopython;
- cross-link importers on each tool's published examples.
