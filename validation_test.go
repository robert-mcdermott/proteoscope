package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A trimmed wwPDB validation report: summary attributes on <Entry>, residues as
// <ModelledSubgroup> with outlier children, and one clash reported on both of its atoms.
const validationFixture = `<?xml version="1.0" encoding="UTF-8"?>
<wwPDB-validation-information>
  <Entry pdbid="1abc" PDB-resolution="2.10" clashscore="7.42" absolute-percentile-clashscore="61.3"
         percent-rama-outliers="0.50" percent-rota-outliers="3.10" percent-RSRZ-outliers="1.20" DCC_Rfree="0.231"/>
  <ModelledSubgroup altcode=" " chain="A" ent="1" icode=" " model="1" resname="LEU" resnum="10" said="A" seq="10"
         rama="Favored" phi="-64.1" psi="-40.2" rota="mt" rsrz="0.41" rscc="0.95" avgoccu="1.00" NatomsEDS="8">
    <clash atom="CD1" cid="1" clashmag="0.52" dist="2.88"/>
  </ModelledSubgroup>
  <ModelledSubgroup altcode=" " chain="A" ent="1" icode="A" model="1" resname="SER" resnum="11" said="A" seq="11"
         rama="OUTLIER" phi="60.0" psi="-150.0" rota="OUTLIER" rsrz="2.60" rscc="0.71">
    <clash atom="OG" cid="1" clashmag="0.52" dist="2.88"/>
    <bond-outlier atom0="CA" atom1="CB" mean="1.53" obs="1.40" stdev="0.02" z="-6.5"/>
    <angle-outlier atom0="N" atom1="CA" atom2="C" mean="111.0" obs="98.0" stdev="2.7" z="-4.8"/>
  </ModelledSubgroup>
  <ModelledSubgroup altcode=" " chain="A" ent="2" icode=" " model="1" resname="HEM" resnum="201" said="B" seq="."
         ligRSRZ="0.8" rscc="0.88" mogul_bonds_rmsz="1.9">
    <mog-angle-outlier atoms="C1A,C2A,C3A" Zscore="5.1" obsval="110.0" mean="106.0" stdev="0.8"/>
  </ModelledSubgroup>
</wwPDB-validation-information>`

func TestParseValidationXML(t *testing.T) {
	report, err := parseValidationXML(strings.NewReader(validationFixture))
	if err != nil {
		t.Fatal(err)
	}
	if report.Entry["clashscore"] != "7.42" || report.Entry["percent-RSRZ-outliers"] != "1.20" {
		t.Fatalf("entry attributes %v", report.Entry)
	}
	if len(report.Residues) != 3 {
		t.Fatalf("%d residues, want 3", len(report.Residues))
	}
	leu, ser, heme := report.Residues[0], report.Residues[1], report.Residues[2]
	if leu.Chain != "A" || leu.Number != 10 || leu.ICode != "" || leu.Rama != "Favored" || *leu.Phi != -64.1 || leu.Values["rsrz"] != 0.41 || leu.Values["NatomsEDS"] != 8 {
		t.Fatalf("LEU10 %+v", leu)
	}
	if ser.ICode != "A" || ser.Rota != "OUTLIER" || ser.Outliers["bond-outlier"] != 1 || ser.Outliers["angle-outlier"] != 1 || ser.Outliers["clash"] != 1 {
		t.Fatalf("SER11A %+v", ser)
	}
	if heme.LabelSeq != "" || heme.Values["ligRSRZ"] != 0.8 || heme.Values["mogul_bonds_rmsz"] != 1.9 || heme.Outliers["mog-angle-outlier"] != 1 {
		t.Fatalf("HEM201 %+v", heme)
	}
	if len(report.Clashes) != 1 {
		t.Fatalf("%d clashes, want 1", len(report.Clashes))
	}
	clash := report.Clashes[0]
	if clash.A.Atom != "CD1" || clash.B.Atom != "OG" || clash.B.ICode != "A" || clash.Overlap != 0.52 || clash.Distance != 2.88 {
		t.Fatalf("clash %+v", clash)
	}
	if _, err := parseValidationXML(strings.NewReader("<nothing/>")); err == nil {
		t.Fatal("a document without <Entry> should be rejected")
	}
}

func TestFetchValidationReport(t *testing.T) {
	compressed := gzipBytes(t, validationFixture)
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pub/pdb/validation_reports/ab/1abc/1abc_validation.xml.gz" {
			http.NotFound(w, r)
			return
		}
		w.Write(compressed)
	})
	h := testHandler(t, fetchApp(remote.URL, t.TempDir(), false))
	rec := get(h, "/api/fetch/validation/1ABC")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != jsonContentType {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	var report validationReport
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.ID != "1ABC" || len(report.Residues) != 3 || len(report.Clashes) != 1 || !strings.HasSuffix(report.Source, "1abc_validation.xml.gz") {
		t.Fatalf("report %+v", report)
	}
	if missing := get(h, "/api/fetch/validation/2XYZ"); missing.Code != http.StatusNotFound || !strings.Contains(errorMessage(t, missing), "No wwPDB validation report") {
		t.Fatalf("missing report: status %d body %s", missing.Code, missing.Body)
	}
	if extended := get(h, "/api/fetch/validation/pdb_00001abc"); extended.Code != http.StatusBadRequest {
		t.Fatalf("extended ID: status %d", extended.Code)
	}
}

func TestFetchAlphaMissense(t *testing.T) {
	const csv = "protein_variant,am_pathogenicity,am_class\nM1A,0.3647,Ambiguous\n"
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		switch r.URL.Path {
		case "/api/prediction/P04637":
			entry := alphaFoldTestEntry(base, "AF-P04637-F1")
			entry["amAnnotationsUrl"] = base + "/files/AF-P04637-F1-aa-substitutions.csv"
			writeTestJSON(w, []map[string]any{entry})
		case "/api/prediction/P0A7Y4":
			writeTestJSON(w, []map[string]any{alphaFoldTestEntry(base, "AF-P0A7Y4-F1")})
		case "/files/AF-P04637-F1-aa-substitutions.csv":
			w.Write([]byte(csv))
		case "/files/AF-P04637-F1-model_v6.cif":
			w.Write([]byte("data_AF\n"))
		default:
			http.NotFound(w, r)
		}
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	rec := get(h, "/api/fetch/afdb/P04637/missense")
	if rec.Code != http.StatusOK || rec.Body.String() != csv {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	if model := get(h, "/api/fetch/afdb/P04637"); model.Header().Get("X-Proteoscope-Missense") != "/api/fetch/afdb/P04637/missense" {
		t.Fatalf("model response does not advertise AlphaMissense: %v", model.Header())
	}
	if none := get(h, "/api/fetch/afdb/P0A7Y4/missense"); none.Code != http.StatusNotFound || !strings.Contains(errorMessage(t, none), "human proteins") {
		t.Fatalf("non-human protein: status %d body %s", none.Code, none.Body)
	}
}

// Expired entries are refetched; if the upstream is down they are still served, marked stale.
// ?refresh=1 bypasses a fresh entry.
func TestCacheExpiryAndRefresh(t *testing.T) {
	const cif = "data_1ABC\n"
	var down atomic.Bool
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if down.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/download/1ABC.cif.gz" {
			http.NotFound(w, r)
			return
		}
		w.Write(gzipBytes(t, cif))
	})
	cacheDir := t.TempDir()
	a := fetchApp(remote.URL, cacheDir, false)
	a.cache.maxAge = time.Hour
	h := testHandler(t, a)
	if rec := get(h, "/api/fetch/pdb/1ABC"); rec.Header().Get("X-Proteoscope-Cache") != "miss" {
		t.Fatalf("first fetch cache %q", rec.Header().Get("X-Proteoscope-Cache"))
	}
	if rec := get(h, "/api/fetch/pdb/1ABC"); rec.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("fresh entry cache %q", rec.Header().Get("X-Proteoscope-Cache"))
	}
	if rec := get(h, "/api/fetch/pdb/1ABC?refresh=1"); rec.Header().Get("X-Proteoscope-Cache") != "miss" {
		t.Fatalf("refresh cache %q", rec.Header().Get("X-Proteoscope-Cache"))
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(filepath.Join(cacheDir, "pdb", "1ABC.cif"), old, old); err != nil {
		t.Fatal(err)
	}
	down.Store(true)
	rec := get(h, "/api/fetch/pdb/1ABC")
	if rec.Code != http.StatusOK || rec.Body.String() != cif || rec.Header().Get("X-Proteoscope-Cache") != "stale" {
		t.Fatalf("stale fallback: status %d cache %q", rec.Code, rec.Header().Get("X-Proteoscope-Cache"))
	}
	down.Store(false)
	if rec := get(h, "/api/fetch/pdb/1ABC"); rec.Header().Get("X-Proteoscope-Cache") != "miss" {
		t.Fatalf("expired entry was not refetched: cache %q", rec.Header().Get("X-Proteoscope-Cache"))
	}
	if got := formatAge(30 * 24 * time.Hour); got != "30 days" {
		t.Fatalf("formatAge = %q", got)
	}
}

// AlphaFold DB renamed entryId to modelEntityId; entries that only carry the new name are still
// matched, and the model's MSA is served when the entry lists one.
func TestAlphaFoldModelEntityIDAndMSA(t *testing.T) {
	const a3m = ">query\nMEEPQSDPSV\n>hit\nMEEPQSDP--\n"
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		switch r.URL.Path {
		case "/api/prediction/P04637":
			isoform := alphaFoldTestEntry(base, "AF-P04637-2-F1")
			canonical := alphaFoldTestEntry(base, "")
			delete(isoform, "entryId")
			delete(canonical, "entryId")
			isoform["modelEntityId"] = "AF-P04637-2-F1"
			canonical["modelEntityId"] = "AF-P04637-F1"
			canonical["cifUrl"] = base + "/files/AF-P04637-F1-model_v6.cif"
			canonical["msaUrl"] = base + "/files/msa/AF-P04637-F1-msa_v6.a3m"
			writeTestJSON(w, []map[string]any{isoform, canonical})
		case "/files/AF-P04637-F1-model_v6.cif":
			w.Write([]byte("data_AF\n"))
		case "/files/msa/AF-P04637-F1-msa_v6.a3m":
			w.Write([]byte(a3m))
		default:
			http.NotFound(w, r)
		}
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	model := get(h, "/api/fetch/afdb/P04637")
	if model.Code != http.StatusOK || model.Header().Get("X-Proteoscope-Filename") != "AF-P04637-F1-model_v6.cif" {
		t.Fatalf("model: status %d headers %v", model.Code, model.Header())
	}
	if model.Header().Get("X-Proteoscope-Msa") != "/api/fetch/afdb/P04637/msa" {
		t.Fatalf("model response does not advertise the MSA: %v", model.Header())
	}
	if rec := get(h, "/api/fetch/afdb/P04637/msa"); rec.Code != http.StatusOK || rec.Body.String() != a3m {
		t.Fatalf("msa: status %d body %q", rec.Code, rec.Body)
	}
}
