package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

const componentFixture = `data_ACT
_chem_comp.id ACT
loop_
_chem_comp_atom.comp_id
_chem_comp_atom.atom_id
_chem_comp_atom.type_symbol
_chem_comp_atom.charge
ACT C   C 0
ACT O   O 0
ACT OXT O -1
ACT CH3 C 0
loop_
_chem_comp_bond.comp_id
_chem_comp_bond.atom_id_1
_chem_comp_bond.atom_id_2
_chem_comp_bond.value_order
ACT C O   DOUB
ACT C OXT SING
ACT C CH3 SING
`

func TestFetchChemicalComponent(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ligands/view/ACT.cif":
			w.Write([]byte(componentFixture))
		case "/ligands/view/BAD.cif":
			w.Write([]byte("<html>maintenance</html>"))
		default:
			http.NotFound(w, r)
		}
	})
	cache := t.TempDir()
	h := testHandler(t, fetchApp(remote.URL, cache, false))
	rec := get(h, "/api/fetch/ccd/act")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "_chem_comp_bond.value_order") {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Proteoscope-Filename") != "ACT.cif" || rec.Header().Get("X-Proteoscope-Cache") != "miss" {
		t.Fatalf("headers %v", rec.Header())
	}
	if again := get(h, "/api/fetch/ccd/ACT"); again.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("second request cache %q", again.Header().Get("X-Proteoscope-Cache"))
	}
	if missing := get(h, "/api/fetch/ccd/ZZZ"); missing.Code != http.StatusNotFound {
		t.Fatalf("missing component status %d", missing.Code)
	}
	if bad := get(h, "/api/fetch/ccd/BAD"); bad.Code != http.StatusBadGateway {
		t.Fatalf("non-CIF answer status %d", bad.Code)
	}
	before := len(remote.requests())
	for _, id := range []string{"TOOLONG", "A-B", "..%2F", "A%20B"} {
		if rec := get(h, "/api/fetch/ccd/"+id); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status %d, want 400", id, rec.Code)
		}
	}
	if requests := remote.requests()[before:]; len(requests) != 0 {
		t.Fatalf("invalid IDs reached the remote: %v", requests)
	}
	if files, _ := filepath.Glob(filepath.Join(cache, "ccd", "ccd-ACT.cif")); len(files) != 1 {
		t.Fatalf("components are cached with a prefix (Windows reserves CON, NUL, AUX and PRN): %v", files)
	}
	offline := testHandler(t, fetchApp(remote.URL, cache, true))
	if rec := get(offline, "/api/fetch/ccd/ACT"); rec.Code != http.StatusOK {
		t.Fatalf("offline with a cached component: status %d", rec.Code)
	}
	if rec := get(offline, "/api/fetch/ccd/HEM"); rec.Code != http.StatusForbidden {
		t.Fatalf("offline without a cached component: status %d", rec.Code)
	}
}

// Trimmed from RCSB's answer for erlotinib (AQ4).
const compoundFixture = `{
 "chem_comp": {"id": "AQ4", "name": "[6,7-BIS(2-METHOXY-ETHOXY)QUINAZOLINE-4-YL]-(3-ETHYNYLPHENYL)AMINE", "type": "non-polymer", "formula": "C22 H23 N3 O4", "formula_weight": 393.436, "pdbx_formal_charge": 0},
 "rcsb_chem_comp_descriptor": {"InChIKey": "AAKJLRGGTJKAMG-UHFFFAOYSA-N", "SMILES": "COCCOc1cc2c(cc1OCCOC)ncnc2Nc3cccc(c3)C#C", "SMILES_stereo": "COCCOc1cc2c(cc1OCCOC)ncnc2Nc3cccc(c3)C#C"},
 "rcsb_chem_comp_info": {"atom_count_heavy": 29},
 "rcsb_chem_comp_synonyms": [
  {"name": "[6,7-BIS(2-METHOXY-ETHOXY)QUINAZOLINE-4-YL]-(3-ETHYNYLPHENYL)AMINE", "type": "Preferred Name", "provenance_source": "PDB Reference Data"},
  {"name": "ERLOTINIB", "type": "Synonym", "provenance_source": "PDB Reference Data"},
  {"name": "Erlotinib hydrochloride", "type": "Synonym", "provenance_source": "DrugBank"},
  {"name": "Erlotinib", "type": "Synonym", "provenance_source": "DrugBank"}],
 "rcsb_chem_comp_related": [
  {"resource_name": "DrugBank", "resource_accession_code": "DB00530"},
  {"resource_name": "CCDC/CSD", "resource_accession_code": "DULKAX01"},
  {"resource_name": "PubChem", "resource_accession_code": "176870"},
  {"resource_name": "ChEBI", "resource_accession_code": "CHEBI:114785"},
  {"resource_name": "ChEMBL", "resource_accession_code": "CHEMBL553"}]
}`

func TestFetchCompound(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/v1/core/chemcomp/AQ4":
			w.Write([]byte(compoundFixture))
		case "/rest/v1/core/chemcomp/AZM":
			w.Write([]byte(`{"chem_comp": {"id": "AZM", "name": "5-ACETAMIDO-1,3,4-THIADIAZOLE-2-SULFONAMIDE"}, "rcsb_chem_comp_synonyms": [{"name": "Acetazolamid", "type": "Synonym", "provenance_source": "DrugBank"}], "rcsb_chem_comp_related": [{"resource_name": "DrugBank", "resource_accession_code": "DB00819"}]}`))
		case "/rest/v1/core/drugbank/AZM":
			w.Write([]byte(`{"drugbank_info": {"drugbank_id": "DB00819", "name": "Acetazolamide"}}`))
		case "/rest/v1/core/chemcomp/BAD":
			w.Write([]byte(`{"status": 500}`))
		default:
			http.NotFound(w, r)
		}
	})
	h := testHandler(t, fetchApp(remote.URL, t.TempDir(), false))
	rec := get(h, "/api/fetch/compound/aq4")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
	var info compoundInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.ID != "AQ4" || info.CommonName != "ERLOTINIB" || info.Formula != "C22 H23 N3 O4" || info.Weight != 393.436 || info.Charge == nil || *info.Charge != 0 {
		t.Fatalf("info %+v", info)
	}
	if info.InChIKey != "AAKJLRGGTJKAMG-UHFFFAOYSA-N" || info.HeavyAtoms != 29 || !strings.HasPrefix(info.SMILES, "COCCOc1") {
		t.Fatalf("descriptors %+v", info)
	}
	want := map[string]string{"drugbank": "DB00530", "pubchem": "176870", "chebi": "CHEBI:114785", "chembl": "CHEMBL553"}
	if len(info.Related) != len(want) {
		t.Fatalf("related %v, want %v (no CSD)", info.Related, want)
	}
	for key, value := range want {
		if info.Related[key] != value {
			t.Fatalf("related %v, want %v", info.Related, want)
		}
	}
	// Without a wwPDB synonym, DrugBank's name for the drug.
	var drug compoundInfo
	if err := json.Unmarshal(get(h, "/api/fetch/compound/AZM").Body.Bytes(), &drug); err != nil || drug.CommonName != "Acetazolamide" {
		t.Fatalf("AZM common name %q (%v)", drug.CommonName, err)
	}
	if missing := get(h, "/api/fetch/compound/ZZZ"); missing.Code != http.StatusNotFound {
		t.Fatalf("missing component status %d", missing.Code)
	}
	if bad := get(h, "/api/fetch/compound/BAD"); bad.Code != http.StatusBadGateway {
		t.Fatalf("unexpected answer status %d", bad.Code)
	}
	if rec := get(h, "/api/fetch/compound/A-B"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid ID status %d", rec.Code)
	}
}

func TestCommonName(t *testing.T) {
	for _, test := range []struct {
		synonyms []string
		drugbank map[string]bool
		want     string
	}{
		{[]string{"STI-571", "IMATINIB"}, nil, "IMATINIB"},
		{[]string{"HEME"}, map[string]bool{"heme iron": true}, "HEME"},
		{[]string{"N-acetyl-beta-D-glucosamine", "2-acetamido-2-deoxy-D-glucose", "N-ACETYL-D-GLUCOSAMINE"}, nil, "N-ACETYL-D-GLUCOSAMINE"},
		{[]string{"Afatinib", "BIBW2992"}, map[string]bool{"afatinib": true}, "Afatinib"},
		{nil, nil, ""},
	} {
		if got := commonName(test.synonyms, test.drugbank); got != test.want {
			t.Errorf("commonName(%v) = %q, want %q", test.synonyms, got, test.want)
		}
	}
}
