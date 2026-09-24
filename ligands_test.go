package main

import (
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
