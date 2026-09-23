package main

import (
	"net/http"
	"sync/atomic"
	"testing"
)

func TestProteomicsEvidenceMergesPeptidesAndSites(t *testing.T) {
	const sequence = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGPDEAPR"
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/proteins/api/proteomics/nonPtm/P04637":
			writeTestJSON(w, map[string]any{"sequence": sequence, "features": []any{
				map[string]any{"begin": "1", "end": "24", "peptide": "MEEPQSDPSVEPPLSQETFSDLWK", "unique": true, "evidences": []any{
					map[string]any{"source": map[string]any{"name": "PeptideAtlas", "properties": map[string]any{"Times of observations": "445"}}},
					map[string]any{"source": map[string]any{"name": "ProteomicsDB", "properties": map[string]any{"Number of PSMs": "63"}}},
				}},
				map[string]any{"begin": "x", "end": "3", "peptide": "BAD"},
			}})
		case "/proteins/api/proteomics/ptm/P04637":
			ptm := func(name string, position int, dataset, probability, confidence string) map[string]any {
				properties := map[string]any{"Final site probability": probability}
				if confidence != "" {
					properties["Confidence score"] = confidence
				}
				return map[string]any{"name": name, "position": position, "sources": []any{"PTMeXchange"}, "dbReferences": []any{map[string]any{"id": dataset, "properties": properties}}}
			}
			writeTestJSON(w, map[string]any{"sequence": sequence, "features": []any{
				map[string]any{"begin": "1", "end": "24", "peptide": "MEEPQSDPSVEPPLSQETFSDLWK", "ptms": []any{ptm("Phosphorylation", 15, "PXD1", "0.91", "Silver"), ptm("Phosphorylation", 6, "PXD2", "0.99", "")}},
				map[string]any{"begin": "11", "end": "24", "peptide": "EPPLSQETFSDLWK", "ptms": []any{ptm("Phosphorylation", 5, "PXD3", "0.97", "Gold")}},
			}})
		default:
			http.NotFound(w, r)
		}
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	rec := get(h, "/api/fetch/proteomics/P04637")
	if rec.Code != http.StatusOK {
		t.Fatalf("evidence: %d %s", rec.Code, rec.Body)
	}
	result := decodeJSON[proteinEvidence](t, rec.Body.Bytes())
	if result.Length != len(sequence) || len(result.Peptides) != 1 || result.Peptides[0].Observations != 445 || len(result.Peptides[0].Sources) != 2 {
		t.Fatalf("peptides = %+v", result.Peptides)
	}
	if len(result.Sites) != 2 {
		t.Fatalf("sites = %+v: S15 seen on two peptides is one site", result.Sites)
	}
	s6, s15 := result.Sites[0], result.Sites[1]
	if s6.Position != 6 || s6.Residue != "S" || s15.Position != 15 || s15.Residue != "S" {
		t.Fatalf("positions: %+v %+v", s6, s15)
	}
	if s15.Peptides != 2 || len(s15.Datasets) != 2 || *s15.Probability != 0.97 || s15.Confidence != "Gold" {
		t.Fatalf("merged S15 = %+v", s15)
	}

	empty := decodeJSON[proteinEvidence](t, get(h, "/api/fetch/proteomics/Q9A000").Body.Bytes())
	if empty.Accession != "Q9A000" || len(empty.Peptides) != 0 || len(empty.Sites) != 0 || len(empty.Problems) != 0 {
		t.Fatalf("no evidence = %+v", empty)
	}
}

// When one of the two services fails, the other's answer is served with the problem, but it is not
// cached: the next request asks again and caches the complete answer.
func TestPartialEvidenceIsNotCached(t *testing.T) {
	var ptmCalls atomic.Int32
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/proteins/api/proteomics/nonPtm/P04637":
			writeTestJSON(w, map[string]any{"sequence": "MEEPQSDPSV", "features": []any{map[string]any{"begin": "1", "end": "5", "peptide": "MEEPQ"}}})
		case "/proteins/api/proteomics/ptm/P04637":
			if ptmCalls.Add(1) == 1 {
				http.Error(w, "busy", http.StatusServiceUnavailable)
				return
			}
			writeTestJSON(w, map[string]any{"sequence": "MEEPQSDPSV", "features": []any{map[string]any{"begin": "1", "end": "10", "peptide": "MEEPQSDPSV", "ptms": []any{
				map[string]any{"name": "Phosphorylation", "position": 6, "dbReferences": []any{map[string]any{"id": "PXD1", "properties": map[string]any{"Final site probability": "0.99"}}}},
			}}}})
		default:
			http.NotFound(w, r)
		}
	})
	h := testHandler(t, fetchApp(remote.URL, t.TempDir(), false))
	first := get(h, "/api/fetch/proteomics/P04637")
	partial := decodeJSON[proteinEvidence](t, first.Body.Bytes())
	if first.Code != http.StatusOK || first.Header().Get("X-Proteoscope-Cache") != "partial" || len(partial.Problems) != 1 || len(partial.Peptides) != 1 {
		t.Fatalf("partial answer: %d %s %+v", first.Code, first.Header().Get("X-Proteoscope-Cache"), partial)
	}
	second := get(h, "/api/fetch/proteomics/P04637")
	complete := decodeJSON[proteinEvidence](t, second.Body.Bytes())
	if second.Header().Get("X-Proteoscope-Cache") != "miss" || len(complete.Problems) != 0 || len(complete.Sites) != 1 {
		t.Fatalf("retry: %s %+v", second.Header().Get("X-Proteoscope-Cache"), complete)
	}
	if third := get(h, "/api/fetch/proteomics/P04637"); third.Header().Get("X-Proteoscope-Cache") != "hit" || ptmCalls.Load() != 2 {
		t.Fatalf("complete answer not cached: %s after %d PTM calls", third.Header().Get("X-Proteoscope-Cache"), ptmCalls.Load())
	}
}
