package main

import "testing"

func TestStructureFileExtensions(t *testing.T) {
	for _, name := range []string{"1abc.pdb", "1abc.cif", "1abc.mmcif"} {
		if !isStructureFile(name) {
			t.Fatalf("expected %s to be accepted", name)
		}
	}
	if isStructureFile("validation.pdf") {
		t.Fatal("PDF validation report should not be accepted as a structure file")
	}
}

func TestParseCIFSample(t *testing.T) {
	const cif = `data_1ABC
_entry.id 1ABC
_struct.title
;Example structure
with multiline title
;
loop_
_exptl.method
'X-RAY DIFFRACTION'
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N . GLY A 10 ? 1.0 2.0 3.0 1.00 10.0 10 GLY A N 1
ATOM 2 C CA B GLY A 10 ? 1.5 2.5 3.5 0.50 11.0 10 GLY A CA 1
HETATM 3 O O . HOH B . ? 4.0 5.0 6.0 1.00 20.0 301 HOH B O 1
ATOM 4 C CA . GLY A 10 ? 1.6 2.6 3.6 1.00 12.0 10 GLY A CA 2
`

	item := parseSample("1abc.cif", cif)
	if item.Name != "1ABC" {
		t.Fatalf("Name = %q, want 1ABC", item.Name)
	}
	if item.Title != "1ABC: Example structure with multiline title" {
		t.Fatalf("Title = %q", item.Title)
	}
	if item.Atoms != 3 {
		t.Fatalf("Atoms = %d, want 3", item.Atoms)
	}
	if item.Models != 2 {
		t.Fatalf("Models = %d, want 2", item.Models)
	}
	if item.Chains != 2 {
		t.Fatalf("Chains = %d, want 2", item.Chains)
	}
	if item.Residues != 2 {
		t.Fatalf("Residues = %d, want 2", item.Residues)
	}
	if item.Method != "X-RAY DIFFRACTION" {
		t.Fatalf("Method = %q", item.Method)
	}
}
