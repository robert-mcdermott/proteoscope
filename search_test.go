package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A fake of the public services behind discovery: RCSB search and GraphQL, UniProt, PDBe,
// 3D-Beacons and a model provider.
func discoveryRemote(t *testing.T) *fakeRemote {
	var remote *fakeRemote
	remote = newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/rcsbsearch/v2/query":
			if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
				t.Errorf("search: %s with Content-Type %q", r.Method, r.Header.Get("Content-Type"))
			}
			var query struct {
				Query struct {
					Service    string         `json:"service"`
					Parameters map[string]any `json:"parameters"`
				} `json:"query"`
				ReturnType string `json:"return_type"`
			}
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &query); err != nil {
				t.Fatalf("search body %s: %v", body, err)
			}
			switch query.Query.Service {
			case "full_text":
				if query.Query.Parameters["value"] == "nothing" {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				writeTestJSON(w, map[string]any{"total_count": 2, "result_set": []map[string]any{{"identifier": "6OIM", "score": 1}, {"identifier": "8UDR", "score": 0.9}}})
			case "sequence":
				if query.Query.Parameters["identity_cutoff"] != 0.3 {
					t.Errorf("sequence query = %s", body)
				}
				// The hits are chains; the count of matching entries is a second, count-only query.
				if query.ReturnType == "entry" {
					if !strings.Contains(string(body), `"return_counts":true`) {
						t.Errorf("entry count query = %s", body)
					}
					writeTestJSON(w, map[string]any{"total_count": 700})
					return
				}
				if query.ReturnType != "polymer_entity" {
					t.Errorf("sequence query = %s", body)
				}
				match := func(identity, evalue float64) map[string]any {
					return map[string]any{"services": []any{map[string]any{"nodes": []any{map[string]any{"match_context": []any{map[string]any{
						"sequence_identity": identity, "evalue": evalue, "query_beg": 1, "query_end": 30, "query_length": 30,
						"subject_beg": 2, "subject_end": 31, "subject_length": 180}}}}}}}
				}
				rows := []map[string]any{}
				for _, item := range []struct {
					id       string
					identity float64
					evalue   float64
				}{{"8UDR_1", 0.62, 1e-5}, {"6OIM_1", 1, 1e-20}, {"8UDR_2", 0.95, 1e-12}, {"pdb_00001abc_3", 0.5, 1e-3}} {
					row := match(item.identity, item.evalue)
					row["identifier"] = item.id
					rows = append(rows, row)
				}
				writeTestJSON(w, map[string]any{"total_count": 1506, "result_set": rows})
			default:
				t.Errorf("unexpected search service %q", query.Query.Service)
			}
		case r.URL.Path == "/graphql":
			query := r.URL.Query().Get("query")
			var entries []map[string]any
			for _, id := range []string{"6OIM", "8UDR", "1TUP"} {
				if !strings.Contains(query, `"`+id+`"`) {
					continue
				}
				entries = append(entries, map[string]any{
					"rcsb_id": id, "struct": map[string]any{"title": "Entry " + id}, "exptl": []any{map[string]any{"method": "X-RAY DIFFRACTION"}},
					"rcsb_entry_info":     map[string]any{"resolution_combined": []float64{1.65}, "deposited_atom_count": 1613},
					"rcsb_accession_info": map[string]any{"initial_release_date": "2019-11-06T00:00:00Z"},
					"polymer_entities": []any{map[string]any{
						"rcsb_polymer_entity":         map[string]any{"pdbx_description": "GTPase KRas"},
						"rcsb_entity_source_organism": []any{map[string]any{"scientific_name": "Homo sapiens"}},
						"rcsb_polymer_entity_container_identifiers": map[string]any{"reference_sequence_identifiers": []any{
							map[string]any{"database_name": "UniProt", "database_accession": "P01116"}}},
					}},
					"nonpolymer_entities": []any{
						map[string]any{"nonpolymer_comp": map[string]any{"chem_comp": map[string]any{"id": "MOV", "name": "AMG 510"}}},
						map[string]any{"nonpolymer_comp": map[string]any{"chem_comp": map[string]any{"id": "SO4", "name": "SULFATE ION"}}},
					},
				})
			}
			writeTestJSON(w, map[string]any{"data": map[string]any{"entries": entries}})
		case r.URL.Path == "/uniprotkb/search":
			query := r.URL.Query().Get("query")
			result := func(accession, gene string) map[string]any {
				return map[string]any{"primaryAccession": accession, "uniProtkbId": gene + "_HUMAN", "entryType": "UniProtKB reviewed (Swiss-Prot)",
					"proteinDescription": map[string]any{"recommendedName": map[string]any{"fullName": map[string]any{"value": gene + " protein"}}},
					"genes":              []any{map[string]any{"geneName": map[string]any{"value": gene}}}, "organism": map[string]any{"scientificName": "Homo sapiens", "taxonId": 9606},
					"sequence": map[string]any{"length": 393}}
			}
			switch query {
			case "(gene_exact:TP53) AND (organism_id:9606)":
				writeTestJSON(w, map[string]any{"results": []any{result("P04637", "TP53")}})
			case "(TP53) AND (organism_id:9606)":
				writeTestJSON(w, map[string]any{"results": []any{result("Q12888", "TP53BP1"), result("P04637", "TP53")}})
			case "(tumor suppressor)":
				writeTestJSON(w, map[string]any{"results": []any{result("P04637", "TP53"), map[string]any{"primaryAccession": "A0A000", "entryType": "UniProtKB unreviewed (TrEMBL)",
					"proteinDescription": map[string]any{"submissionNames": []any{map[string]any{"fullName": map[string]any{"value": "Predicted"}}}}}}})
			default:
				t.Errorf("unexpected UniProt query %q", query)
				writeTestJSON(w, map[string]any{"results": []any{}})
			}
		case r.URL.Path == "/pdbe/api/mappings/best_structures/P04637":
			writeTestJSON(w, map[string]any{"P04637": []any{
				map[string]any{"pdb_id": "1tup", "chain_id": "B", "experimental_method": "X-ray diffraction", "resolution": 2.2, "tax_id": 9606, "unp_start": 94, "unp_end": 312, "coverage": 0.557},
				map[string]any{"pdb_id": "1tup", "chain_id": "A", "experimental_method": "X-ray diffraction", "resolution": 2.2, "tax_id": 9606, "unp_start": 94, "unp_end": 312, "coverage": 0.557},
			}})
		case r.URL.Path == "/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P04637.json":
			summary := func(provider, id, modelURL string, confidence any) map[string]any {
				return map[string]any{"summary": map[string]any{"provider": provider, "model_identifier": id, "model_url": modelURL, "model_format": "MMCIF",
					"uniprot_start": 1, "uniprot_end": 393, "coverage": 1, "confidence_avg_local_score": confidence, "created": "2025-08-01T00:00:00Z",
					"entities": []any{map[string]any{"description": "Cellular tumor antigen p53"}}}}
			}
			writeTestJSON(w, map[string]any{"uniprot_entry": map[string]any{"ac": "P04637", "sequence_length": 393}, "structures": []any{
				summary("SWISS-MODEL", "P04637_94-356:4mzr.1.C", remote.URL+"/models/P04637.cif?range=94-356", 0.74),
				summary("PDBe", "1tup", remote.URL+"/pdbe/1tup.cif", nil),
				summary("isoform.io", "CHS.1", "https://elsewhere.example/CHS.1.pdb", nil),
				summary("AlphaFold DB", "AF-0000000210539554", remote.URL+"/files/other.cif", 60),
				summary("AlphaFold DB", "AF-P04637-F1", remote.URL+"/files/AF-P04637-F1-model_v6.cif", 75.06),
			}})
		case r.URL.Path == "/pdbe/api/mappings/best_structures/Q9A000", r.URL.Path == "/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/Q9A000.json":
			http.NotFound(w, r)
		case r.URL.Path == "/models/P04637.cif":
			if r.URL.Query().Get("range") != "94-356" {
				t.Errorf("model query = %q", r.URL.RawQuery)
			}
			io.WriteString(w, "data_model\n_entry.id model\n")
		case r.URL.Path == "/aff/P04637":
			io.WriteString(w, "ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00 90.00           N\n")
		default:
			t.Errorf("unexpected upstream request %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	})
	return remote
}

func decodeJSON[T any](t *testing.T, body []byte) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return value
}

func TestTextAndSequenceSearch(t *testing.T) {
	remote := discoveryRemote(t)
	h := testHandler(t, fetchApp(remote.URL, t.TempDir(), false))

	rec := get(h, "/api/search/text?q=%20sotorasib%20%20KRAS%20&rows=5")
	if rec.Code != http.StatusOK {
		t.Fatalf("text search: %d %s", rec.Code, rec.Body)
	}
	text := decodeJSON[entrySearch](t, rec.Body.Bytes())
	if text.Query != "sotorasib KRAS" || text.Total != 2 || len(text.Entries) != 2 || text.Entries[0].ID != "6OIM" || text.Entries[1].ID != "8UDR" {
		t.Fatalf("text search = %+v", text)
	}
	first := text.Entries[0]
	if first.Title != "Entry 6OIM" || first.Released != "2019-11-06" || *first.Resolution != 1.65 || first.Atoms != 1613 ||
		len(first.Ligands) != 1 || first.Ligands[0].ID != "MOV" || first.Accessions[0] != "P01116" || first.Organisms[0] != "Homo sapiens" {
		t.Fatalf("summary = %+v (sulfate should be dropped as an additive)", first)
	}
	if rec := get(h, "/api/search/text?q=sotorasib%20KRAS&rows=5"); rec.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("repeat search cache status %q", rec.Header().Get("X-Proteoscope-Cache"))
	}
	if empty := decodeJSON[entrySearch](t, get(h, "/api/search/text?q=nothing").Body.Bytes()); empty.Total != 0 || len(empty.Entries) != 0 {
		t.Fatalf("an empty result (HTTP 204) = %+v", empty)
	}

	sequence := strings.Repeat("MTEYKLVVVG", 3)
	rec = get(h, "/api/search/sequence?seq="+url.QueryEscape(">kras fragment\n"+strings.ToLower(sequence[:15])+"\n"+sequence[15:]+"*"))
	if rec.Code != http.StatusOK {
		t.Fatalf("sequence search: %d %s", rec.Code, rec.Body)
	}
	hits := decodeJSON[entrySearch](t, rec.Body.Bytes())
	if len(hits.Entries) != 3 || hits.Entries[0].ID != "6OIM" || hits.Entries[1].ID != "8UDR" || hits.Query != "30-residue sequence" || hits.Total != 700 {
		t.Fatalf("sequence hits = %+v", hits)
	}
	if extended := hits.Entries[2]; extended.ID != "PDB_00001ABC" || extended.Match == nil || extended.Match.Entity != "3" {
		t.Fatalf("extended PDB ID split at its last underscore: %+v", extended)
	}
	// Out-of-range and NaN cutoffs fall back to the defaults (the fake checks identity 0.3).
	if rec := get(h, "/api/search/sequence?seq="+sequence+"&identity=NaN&evalue=nan&refresh=1"); rec.Code != http.StatusOK {
		t.Fatalf("NaN cutoffs: %d %s", rec.Code, rec.Body)
	}
	if match := hits.Entries[1].Match; match == nil || match.Entity != "2" || match.Identity != 0.95 || match.SubjectLength != 180 {
		t.Fatalf("8UDR keeps its best entity, got %+v", hits.Entries[1].Match)
	}

	for _, target := range []string{"/api/search/text?q=", "/api/search/text?q=" + strings.Repeat("a", 501), "/api/search/sequence?seq=MTEYKL",
		"/api/search/sequence?seq=" + strings.Repeat("MTEYKL", 4) + "123J", "/api/search/uniprot?q=TP53&organism=human"} {
		if rec := get(h, target); rec.Code != http.StatusBadRequest || errorMessage(t, rec) == "" {
			t.Errorf("%s: status %d", target, rec.Code)
		}
	}
}

func TestUniProtSearchPrefersExactGenes(t *testing.T) {
	remote := discoveryRemote(t)
	h := testHandler(t, fetchApp(remote.URL, "", false))
	result := decodeJSON[proteinSearch](t, get(h, "/api/search/uniprot?q=TP53&organism=9606").Body.Bytes())
	if len(result.Results) != 2 || result.Results[0].Accession != "P04637" || result.Results[1].Accession != "Q12888" {
		t.Fatalf("results = %+v: the exact gene first, without duplicates", result.Results)
	}
	if first := result.Results[0]; first.Gene != "TP53" || first.Name != "TP53 protein" || !first.Reviewed || first.Length != 393 || first.TaxID != 9606 {
		t.Fatalf("candidate = %+v", first)
	}
	result = decodeJSON[proteinSearch](t, get(h, "/api/search/uniprot?q=tumor%20suppressor").Body.Bytes())
	if len(result.Results) != 2 || result.Results[1].Reviewed || result.Results[1].Name != "Predicted" {
		t.Fatalf("free text = %+v", result.Results)
	}
}

func TestProteinStructuresAndModels(t *testing.T) {
	remote := discoveryRemote(t)
	h := testHandler(t, fetchApp(remote.URL, "", false))
	rec := get(h, "/api/search/protein/p04637")
	if rec.Code != http.StatusOK {
		t.Fatalf("protein: %d %s", rec.Code, rec.Body)
	}
	result := decodeJSON[proteinStructures](t, rec.Body.Bytes())
	if result.Accession != "P04637" || result.Length != 393 || len(result.Structures) != 2 || result.Structures[0].PDB != "1TUP" || result.Structures[0].Chain != "B" {
		t.Fatalf("structures = %+v", result)
	}
	if _, ok := result.Entries["1TUP"]; !ok {
		t.Fatalf("entries = %+v", result.Entries)
	}
	var ids []string
	for _, model := range result.Models {
		ids = append(ids, model.ID)
	}
	if strings.Join(ids, ",") != "AF-P04637-F1,P04637_94-356:4mzr.1.C,CHS.1,AF-0000000210539554" {
		t.Fatalf("models = %v: PDBe left out, canonical AlphaFold first, other providers, then AlphaFold DB's other models", ids)
	}
	if !result.Models[0].Fetchable || result.Models[2].Fetchable || result.Models[0].Created != "2025-08-01" || *result.Models[0].Confidence != 75.06 {
		t.Fatalf("model flags = %+v", result.Models)
	}

	rec = get(h, "/api/search/protein/Q9A000")
	empty := decodeJSON[proteinStructures](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || empty.Accession != "Q9A000" || empty.Structures == nil || len(empty.Structures) != 0 || len(empty.Models) != 0 || len(empty.Problems) != 0 {
		t.Fatalf("a protein without structures: %d %+v", rec.Code, empty)
	}
	if rec := get(h, "/api/search/protein/NOT-AN-ACCESSION"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid accession: %d", rec.Code)
	}
}

func TestModelDownloadsAreLimitedToKnownProviders(t *testing.T) {
	remote := discoveryRemote(t)
	h := testHandler(t, fetchApp(remote.URL, t.TempDir(), false))
	rec := get(h, "/api/fetch/model?url="+url.QueryEscape(remote.URL+"/models/P04637.cif?range=94-356"))
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Body.String(), "data_model") || rec.Header().Get("X-Proteoscope-Filename") != "P04637.cif" {
		t.Fatalf("model: %d %q, filename %q", rec.Code, rec.Body, rec.Header().Get("X-Proteoscope-Filename"))
	}
	rec = get(h, "/api/fetch/model?url="+url.QueryEscape(remote.URL+"/aff/P04637"))
	if rec.Code != http.StatusOK || rec.Header().Get("X-Proteoscope-Filename") != "P04637.pdb" {
		t.Fatalf("extensionless model: %d, filename %q", rec.Code, rec.Header().Get("X-Proteoscope-Filename"))
	}
	for _, target := range []string{"https://evil.example/model.cif", "file:///etc/passwd", "http://127.0.0.1:1/x.cif", "", "https://user@alphafold.ebi.ac.uk/x.cif"} {
		if rec := get(h, "/api/fetch/model?url="+url.QueryEscape(target)); rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status %d", target, rec.Code)
		}
	}
	if _, err := defaultUpstream().modelURL("https://swissmodel.expasy.org/3d-beacons/uniprot/P01116.cif?range=2-172"); err != nil {
		t.Errorf("SWISS-MODEL should be allowed: %v", err)
	}
	if _, err := defaultUpstream().modelURL("http://alphafold.ebi.ac.uk/files/x.cif"); err == nil {
		t.Error("plain http should be refused")
	}
}

func TestSearchesAreOfflineAwareAndCachedForADay(t *testing.T) {
	remote := discoveryRemote(t)
	cacheDir := t.TempDir()
	h := testHandler(t, fetchApp(remote.URL, cacheDir, false))
	if rec := get(h, "/api/search/protein/P04637"); rec.Code != http.StatusOK {
		t.Fatalf("protein: %d", rec.Code)
	}
	offline := testHandler(t, fetchApp(remote.URL, cacheDir, true))
	if rec := get(offline, "/api/search/protein/P04637"); rec.Code != http.StatusOK || rec.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("offline cached search: %d %q", rec.Code, rec.Header().Get("X-Proteoscope-Cache"))
	}
	if rec := get(offline, "/api/search/text?q=anything"); rec.Code != http.StatusForbidden {
		t.Fatalf("offline uncached search: %d", rec.Code)
	}

	cache := &diskCache{dir: cacheDir, maxAge: 30 * 24 * time.Hour}
	file := filepath.Join(cacheDir, "search", "protein-P04637.json")
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	if _, ok, stale := cache.load("search", "protein-P04637.json"); !ok || !stale {
		t.Fatalf("a day-old search: ok %v, stale %v", ok, stale)
	}
	if cache.maxAgeFor("pdb") != 30*24*time.Hour || (&diskCache{}).maxAgeFor("search") != searchCacheAge || (&diskCache{maxAge: time.Hour}).maxAgeFor("search") != time.Hour {
		t.Fatal("search results expire after a day unless the cache is set shorter")
	}
}
