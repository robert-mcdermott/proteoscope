// Writes validation/reference/smiles.json: RDKit's reading of drug-like SMILES, each written out
// as RDKit's randomized SMILES too (other atom orders, ring numbers, branches and ways of writing
// @, @@, / and \). Per molecule: elements, charges, hydrogens, Kekulé bonds, 3D coordinates
// RDKit embedded (which satisfy the stereochemistry), and how many stereocenters and stereo bonds
// RDKit keeps; per variant: the string and the order in which it writes the molecule's atoms.
// The smiles suite reads every variant with smiles.js and checks its atoms and bonds, which
// stereo marks it keeps, and the stereo against the coordinates and their mirror image.
//
//   PYTHON=/path/to/python node validation/scripts/smiles-reference.mjs
//
// PYTHON must have RDKit (pip install rdkit); it is not part of Proteoscope.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeReference } from '../common.mjs';

const python = process.env.PYTHON;
if (!python) {
  console.error('Set PYTHON to a Python with RDKit installed (pip install rdkit).');
  process.exit(2);
}

// Drugs, cofactors and small heterocycles: stereocenters (steroids, sugars, β-lactams, ATP's
// ribose, a sulfoxide and a sulfonium), E/Z double bonds (tamoxifen, retinoic acid), charged groups and aromatic rings whose
// Kekulé structure depends on their hydrogens ([nH]).
const MOLECULES = {
  alanine: 'C[C@H](N)C(=O)O',
  glucose: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O',
  testosterone: 'C[C@]12CC[C@H]3[C@@H](CCC4=CC(=O)CC[C@@]34C)[C@@H]1CC[C@@H]2O',
  estradiol: 'C[C@]12CC[C@@H]3c4ccc(O)cc4CC[C@H]3[C@@H]1CC[C@@H]2O',
  cholesterol: 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C',
  morphine: 'CN1CC[C@]23c4c5ccc(O)c4O[C@H]2[C@@H](O)C=C[C@H]3[C@H]1C5',
  penicillinG: 'CC1(C)S[C@@H]2[C@H](NC(=O)Cc3ccccc3)C(=O)N2[C@H]1C(=O)O',
  atorvastatin: 'CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CC[C@@H](O)C[C@@H](O)CC(=O)O',
  oseltamivir: 'CCOC(=O)C1=C[C@@H](OC(CC)CC)[C@H](NC(C)=O)[C@@H](N)C1',
  quinine: 'COc1ccc2nccc([C@@H](O)[C@@H]3C[C@@H]4CCN3C[C@@H]4C=C)c2c1',
  ephedrine: 'CN[C@@H](C)[C@@H](O)c1ccccc1',
  captopril: 'C[C@H](CS)C(=O)N1CCC[C@H]1C(=O)O',
  artemisinin: 'C[C@@H]1CC[C@H]2[C@@H](C)C(=O)O[C@@H]3O[C@@]4(C)CC[C@@H]1[C@]32OO4',
  atp: 'Nc1ncnc2c1ncn2[C@@H]1O[C@H](CO[P@@](=O)(O)O[P@](=O)(O)OP(=O)(O)O)[C@@H](O)[C@H]1O',
  sam: 'C[S@@+](CC[C@H](N)C(=O)[O-])C[C@H]1O[C@@H](n2cnc3c(N)ncnc32)[C@H](O)[C@@H]1O',
  esomeprazole: 'COc1ccc2[nH]c([S@@](=O)Cc3ncc(C)c(OC)c3C)nc2c1',
  biotin: 'OC(=O)CCCC[C@@H]1SC[C@@H]2NC(=O)N[C@H]12',
  camphor: 'CC1(C)[C@@H]2CC[C@@]1(C)C(=O)C2',
  cocaine: 'COC(=O)[C@H]1[C@@H](OC(=O)c2ccccc2)C[C@@H]2CC[C@H]1N2C',
  tamoxifen: 'CC/C(=C(\\c1ccccc1)c1ccc(OCCN(C)C)cc1)c1ccccc1',
  resveratrol: 'Oc1ccc(/C=C/c2cc(O)cc(O)c2)cc1',
  retinoic: 'CC1=C(/C=C/C(C)=C/C=C/C(C)=C/C(=O)O)C(C)(C)CCC1',
  maleate: 'OC(=O)/C=C\\C(=O)O',
  erlotinib: 'COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC',
  imatinib: 'Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1',
  sotorasib: 'C=CC(=O)N1CCN(c2nc(=O)n(-c3c(C)ccnc3C(C)C)c3nc(-c4c(O)cccc4F)c(F)cc23)[C@@H](C)C1',
  caffeine: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
  tryptophan: 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O',
  nitrophenylalanine: 'O=[N+]([O-])c1ccc(C[C@@H](N)C(=O)O)cc1',
  pyridinium: 'C[n+]1ccccc1',
  imidazolium: 'Cn1cc[n+](C)c1',
  sulfamethoxazole: 'Cc1cc(NS(=O)(=O)c2ccc(N)cc2)no1',
  furosemide: 'NS(=O)(=O)c1cc(C(=O)O)c(NCc2ccco2)cc1Cl',
  sitagliptin: 'N[C@@H](CC(=O)N1CCn2c(nnc2C(F)(F)F)C1)Cc1cc(F)c(F)cc1F',
  lisinopril: 'NCCCC[C@H](N[C@@H](CCc1ccccc1)C(=O)O)C(=O)N1CCC[C@H]1C(=O)O',
  cefalexin: 'CC1=C(C(=O)O)N2C(=O)[C@@H](NC(=O)[C@H](N)c3ccccc3)[C@H]2SC1',
  mz1: 'Cc1sc2n3c(C)nnc3[C@H](CC(=O)NCCOCCOCCOCC(=O)N[C@H](C(=O)N4C[C@H](O)C[C@H]4C(=O)NCc5ccc(cc5)c6scnc6C)C(C)(C)C)N=C(c7ccc(Cl)cc7)c2c1C',
  selenophene: 'c1cc[se]c1',
  azulene: 'c1ccc2cccc2cc1',
  purine: 'c1ncc2[nH]cnc2n1',
  tetrazole: 'c1nn[nH]n1',
  cyclopentadienide: 'c1cc[cH-]c1',
  // Relative configurations across rings and in a meso compound, which RDKit keeps.
  transDecalin: 'C1CC[C@H]2CCCC[C@@H]2C1',
  cisCyclohexanediol: 'O[C@H]1CC[C@@H](O)CC1',
  mesoButanediol: 'C[C@@H](O)[C@H](C)O',
  transCyclooctene: 'C1=C\\CCCCCC/1',
  // Marks RDKit drops as not stereogenic: equivalent neighbors, an amine, a small-ring bond.
  isopropanol: '[C@H](C)(C)O',
  chlorofluorocyclobutane: 'C1CC[C@]1(F)Cl',
  amine: '[N@](C)(CC)CCC',
  isobutenyl: 'C/C=C(/C)C',
  cyclohexylidene: 'F/C=C1/CCCCC1',
};
const VARIANTS = 8;

const PYTHON_SCRIPT = String.raw`
import json, random, sys
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem
RDLogger.DisableLog('rdApp.*')
molecules = json.load(open(sys.argv[1]))
variants_per_molecule = int(sys.argv[3])
random.seed(1)
def chiral(mol):
    # Whether the mirror image (every tetrahedral tag inverted) is another molecule.
    mirror = Chem.Mol(mol)
    for atom in mirror.GetAtoms():
        tag = atom.GetChiralTag()
        if tag == Chem.ChiralType.CHI_TETRAHEDRAL_CW:
            atom.SetChiralTag(Chem.ChiralType.CHI_TETRAHEDRAL_CCW)
        elif tag == Chem.ChiralType.CHI_TETRAHEDRAL_CCW:
            atom.SetChiralTag(Chem.ChiralType.CHI_TETRAHEDRAL_CW)
    return Chem.MolToSmiles(mirror) != Chem.MolToSmiles(mol)

out = []
for name, smiles in molecules.items():
    mol = Chem.MolFromSmiles(smiles)
    withH = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 7
    assert AllChem.EmbedMolecule(withH, params) == 0, name
    conf = withH.GetConformer()
    kekule = Chem.Mol(mol)
    Chem.Kekulize(kekule, clearAromaticFlags=True)
    variants = []
    seen = set()
    for k in range(200):
        if len(variants) >= variants_per_molecule:
            break
        text = smiles if k == 0 else Chem.MolToSmiles(mol, doRandom=True, isomericSmiles=True, kekuleSmiles=(k % 4 == 0))
        if text in seen:
            continue
        seen.add(text)
        if k == 0:
            order = list(range(mol.GetNumAtoms()))
        else:
            order = [int(i) for i in mol.GetProp('_smilesAtomOutputOrder').strip('[],').split(',') if i != '']
        # RDKit reads the variant with its atoms in the order written.
        check = Chem.MolFromSmiles(text)
        assert [a.GetSymbol() for a in check.GetAtoms()] == [mol.GetAtomWithIdx(i).GetSymbol() for i in order], (name, text)
        variants.append({'smiles': text, 'order': order})
    out.append({
        'name': name,
        'elements': [a.GetSymbol().upper() for a in mol.GetAtoms()],
        'charges': [a.GetFormalCharge() for a in mol.GetAtoms()],
        'hydrogens': [a.GetTotalNumHs() for a in mol.GetAtoms()],
        'bonds': [x for b in kekule.GetBonds() for x in (b.GetBeginAtomIdx(), b.GetEndAtomIdx(), int(b.GetBondTypeAsDouble()))],
        'coordinates': [round(v, 3) for i in range(mol.GetNumAtoms()) for v in conf.GetAtomPosition(i)],
        'centers': len(Chem.FindMolChiralCenters(mol, includeUnassigned=False, useLegacyImplementation=False)),
        'stereoBonds': sum(1 for b in mol.GetBonds() if b.GetStereo() != Chem.BondStereo.STEREONONE),
        'chiral': chiral(mol),
        'variants': variants,
    })
json.dump(out, open(sys.argv[2], 'w'))
`;

const work = mkdtempSync(join(tmpdir(), 'smiles-'));
const scriptPath = join(work, 'smiles.py');
const moleculesPath = join(work, 'molecules.json');
const resultsPath = join(work, 'results.json');
writeFileSync(scriptPath, PYTHON_SCRIPT);
writeFileSync(moleculesPath, JSON.stringify(MOLECULES));
const run = spawnSync(python, [scriptPath, moleculesPath, resultsPath, String(VARIANTS)], { encoding: 'utf8' });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(1);
}
const molecules = JSON.parse(readFileSync(resultsPath, 'utf8'));
const version = spawnSync(python, ['-c', 'import rdkit; print(rdkit.__version__)'], { encoding: 'utf8' }).stdout.trim();
writeReference('smiles.json', { tool: `RDKit ${version}: MolFromSmiles, Kekulize, ETKDGv3 coordinates, randomized SMILES`, molecules });
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${molecules.length} molecules, ${molecules.reduce((sum, item) => sum + item.variants.length, 0)} SMILES.`);
