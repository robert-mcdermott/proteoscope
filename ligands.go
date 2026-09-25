package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Chemical Component Dictionary entries: one small mmCIF file per ligand or modified residue
// with its bond orders, aromatic flags and formal charges. The page asks for the components a
// structure file does not define itself (PDB files, predictions); RCSB and PDBe mmCIF files
// carry their own.

var ccdIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{1,5}$`)

func (a *app) fetchComponent(w http.ResponseWriter, r *http.Request) {
	id := strings.ToUpper(r.PathValue("id"))
	if !ccdIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "Invalid chemical component ID: use 1 to 5 letters or digits, such as ATP or HEM.")
		return
	}
	// A prefix keeps components named CON, NUL, AUX or PRN clear of Windows device names.
	a.serveRemote(w, r, "ccd", "ccd-"+id+".cif", func(ctx context.Context) (payload, error) {
		return a.remote.chemicalComponent(ctx, id)
	})
}

func (u *upstream) chemicalComponent(ctx context.Context, id string) (payload, error) {
	source := u.rcsb + "/ligands/view/" + id + ".cif"
	body, err := u.download(ctx, source, "RCSB")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "The Chemical Component Dictionary has no component %s", id)
	}
	if err != nil {
		return payload{}, err
	}
	if !bytes.HasPrefix(bytes.TrimSpace(body), []byte("data_")) {
		return payload{}, fetchErrorf(http.StatusBadGateway, "RCSB returned an unexpected file for component %s", id)
	}
	return textPayload(body, id+".cif", source), nil
}

// Facts about a component for the ligand card: its names, formula, weight, charge, SMILES and
// InChIKey, and the matching entries of other databases, from RCSB's chemical component API.
// The answer is cut down to what the card shows.
func (a *app) fetchCompound(w http.ResponseWriter, r *http.Request) {
	id := strings.ToUpper(r.PathValue("id"))
	if !ccdIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "Invalid chemical component ID: use 1 to 5 letters or digits, such as ATP or HEM.")
		return
	}
	a.serveRemote(w, r, "ccd", "compound-"+id+".json", func(ctx context.Context) (payload, error) {
		return a.remote.compound(ctx, id)
	})
}

type compoundInfo struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	CommonName string            `json:"commonName,omitempty"`
	Synonyms   []string          `json:"synonyms,omitempty"`
	Type       string            `json:"type,omitempty"`
	Formula    string            `json:"formula,omitempty"`
	Weight     float64           `json:"weight,omitempty"`
	Charge     *int              `json:"charge,omitempty"`
	SMILES     string            `json:"smiles,omitempty"`
	InChIKey   string            `json:"inchiKey,omitempty"`
	HeavyAtoms int               `json:"heavyAtoms,omitempty"`
	Related    map[string]string `json:"related,omitempty"`
}

// The databases the card links to, by RCSB's resource names.
var compoundResources = map[string]string{"PubChem": "pubchem", "ChEMBL": "chembl", "DrugBank": "drugbank", "ChEBI": "chebi", "CAS": "cas"}

func (u *upstream) compound(ctx context.Context, id string) (payload, error) {
	source := u.rcsbData + "/rest/v1/core/chemcomp/" + id
	body, err := u.download(ctx, source, "RCSB PDB data")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "The Chemical Component Dictionary has no component %s", id)
	}
	if err != nil {
		return payload{}, err
	}
	info, err := parseCompound(body)
	if err != nil {
		return payload{}, fetchErrorf(http.StatusBadGateway, "RCSB returned an unexpected answer for component %s", id)
	}
	// Without a name of the wwPDB's own, a drug is called by DrugBank's name for it
	// (acetazolamide for AZM); a failed request leaves the name out.
	if info.CommonName == "" && info.Related["drugbank"] != "" {
		if drug, err := u.download(ctx, u.rcsbData+"/rest/v1/core/drugbank/"+id, "RCSB PDB data"); err == nil {
			var answer struct {
				Info struct {
					Name string `json:"name"`
				} `json:"drugbank_info"`
			}
			if json.Unmarshal(drug, &answer) == nil {
				info.CommonName = strings.TrimSpace(answer.Info.Name)
			}
		}
	}
	encoded, _ := json.Marshal(info)
	return jsonPayload(encoded, "RCSB PDB data", source)
}

func parseCompound(body []byte) (compoundInfo, error) {
	var raw struct {
		ChemComp struct {
			ID            string  `json:"id"`
			Name          string  `json:"name"`
			Type          string  `json:"type"`
			Formula       string  `json:"formula"`
			FormulaWeight float64 `json:"formula_weight"`
			FormalCharge  *int    `json:"pdbx_formal_charge"`
		} `json:"chem_comp"`
		Descriptor struct {
			SMILES       string `json:"SMILES"`
			SMILESStereo string `json:"SMILES_stereo"`
			InChIKey     string `json:"InChIKey"`
		} `json:"rcsb_chem_comp_descriptor"`
		Info struct {
			HeavyAtoms int `json:"atom_count_heavy"`
		} `json:"rcsb_chem_comp_info"`
		Synonyms []struct {
			Name       string `json:"name"`
			Type       string `json:"type"`
			Provenance string `json:"provenance_source"`
		} `json:"rcsb_chem_comp_synonyms"`
		Related []struct {
			Resource  string `json:"resource_name"`
			Accession string `json:"resource_accession_code"`
		} `json:"rcsb_chem_comp_related"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return compoundInfo{}, err
	}
	if raw.ChemComp.ID == "" {
		return compoundInfo{}, errors.New("no chem_comp record")
	}
	info := compoundInfo{
		ID:         raw.ChemComp.ID,
		Name:       strings.TrimSpace(raw.ChemComp.Name),
		Type:       raw.ChemComp.Type,
		Formula:    raw.ChemComp.Formula,
		Weight:     raw.ChemComp.FormulaWeight,
		Charge:     raw.ChemComp.FormalCharge,
		SMILES:     raw.Descriptor.SMILESStereo,
		InChIKey:   raw.Descriptor.InChIKey,
		HeavyAtoms: raw.Info.HeavyAtoms,
	}
	if info.SMILES == "" {
		info.SMILES = raw.Descriptor.SMILES
	}
	// The wwPDB's own synonyms name the molecule (IMATINIB for STI, HEME for HEM); DrugBank's
	// tell which of them is the drug's name.
	var reference []string
	drugbank := map[string]bool{}
	for _, synonym := range raw.Synonyms {
		name := strings.TrimSpace(synonym.Name)
		switch {
		case name == "" || synonym.Type != "Synonym":
		case synonym.Provenance == "PDB Reference Data":
			reference = append(reference, name)
		case synonym.Provenance == "DrugBank":
			drugbank[strings.ToLower(name)] = true
		}
	}
	info.Synonyms = reference
	info.CommonName = commonName(reference, drugbank)
	for _, item := range raw.Related {
		key, ok := compoundResources[item.Resource]
		if !ok || item.Accession == "" {
			continue
		}
		if info.Related == nil {
			info.Related = map[string]string{}
		}
		if _, seen := info.Related[key]; !seen {
			info.Related[key] = item.Accession
		}
	}
	return info, nil
}

// commonName picks the synonym a chemist would use: one DrugBank also lists, else the shortest
// without digits (a name rather than a code such as STI-571), else none.
func commonName(synonyms []string, drugbank map[string]bool) string {
	for _, name := range synonyms {
		if drugbank[strings.ToLower(name)] {
			return name
		}
	}
	candidates := []string{}
	for _, name := range synonyms {
		if !strings.ContainsFunc(name, unicode.IsDigit) && len(name) <= 40 {
			candidates = append(candidates, name)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return len(candidates[i]) < len(candidates[j]) })
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}
