import assert from 'node:assert/strict';
import test from 'node:test';
import { REFERENCES, bibtex, formatReference, methodsText } from './provenance.js';

const context = {
  version: '0.6.0',
  entries: [
    {
      name: '1M17', code: '1M17', source: 'pdb', method: 'X-RAY DIFFRACTION', resolution: '2.60 Å', revisionDate: '2024-02-14', uniprot: true,
      uses: {
        dssp: true, chemistry: true, interactions: true,
        superposition: { method: 'structure', complex: false },
        density: { source: 'server', kind: 'x-ray', id: '1M17', levels: [{ channel: '2Fo-Fc', kind: '2fo-fc', sigma: 1.5, absolute: 0.18 }, { channel: 'Fo-Fc', kind: 'fo-fc', sigma: 3, absolute: 0.14 }], fit: { atomInclusion: 0.925 } },
        report: { label: 'DIA-NN', name: 'report.parquet', kind: 'peptides', qValue: 0.01, localization: 0.75, statistics: { normalize: 'median', minValid: 2, impute: true, adjust: true } },
        conservation: { method: 'jsd', summaries: [{ source: 'egfr.a3m', sequences: 2048 }] },
      },
    },
    { name: 'AF-P00533-F1', code: 'AF-P00533-F1', source: 'afdb', afdbVersion: 'v6', uses: {} },
  ],
};

test('the methods paragraph names sources, versions and each analysis, with numbered citations', () => {
  const { text, references } = methodsText(context);
  assert.match(text, /^Structures were obtained from the Protein Data Bank \[1, 2\] \(1M17: X-ray diffraction, 2\.60 Å, revision of 2024-02-14\) and AlphaFold DB \[3, 4\] \(AF-P00533-F1, model v6\) and analyzed in Proteoscope version 0\.6\.0 \[5\]\./);
  assert.match(text, /DSSP implementation \[6\]/);
  assert.match(text, /aligned without regard to sequence with TM-align as implemented in US-align/);
  assert.match(text, /contoured at 1\.5σ \(2Fo-Fc\) and ±3\.0σ \(Fo-Fc\); 92\.5% of the model's atoms lie above 1σ/);
  assert.match(text, /moderated t-tests \(limma empirical Bayes \[\d+, \d+\]\)/);
  assert.match(text, /as in MSstatsPTM \[\d+\]/);
  assert.match(text, /Jensen–Shannon divergence of Capra and Singh \[\d+\]/);
  assert.equal(new Set(references).size, references.length, 'each reference once');
  const numbers = [...text.matchAll(/\[([\d, ]+)\]/g)].flatMap((match) => match[1].split(', ').map(Number));
  assert.equal(Math.max(...numbers), references.length, 'every citation points into the list');
  for (const key of references) assert.ok(REFERENCES[key], key);
  assert.match(text, /at a q-value of 0\.01 and a localization probability of 0\.75/);
  assert.match(text, /with at least 2 observed values in at least one group were kept and their missing values imputed/);
});

test('the methods paragraph states only what ran', () => {
  const entry = (uses) => ({ ...context, entries: [{ ...context.entries[0], uses }] });
  // A site table is not q-filtered; without imputation every group needs its values; no protein
  // change, no adjustment.
  const sites = methodsText(entry({ report: { label: 'MaxQuant', name: 'Phospho (STY)Sites.txt', kind: 'sites', qValue: 0.01, localization: 0.75, qFiltered: false, statistics: { normalize: 'none', minValid: 3, impute: false, adjust: false } } })).text;
  assert.match(sites, /were filtered at a localization probability of 0\.75\./);
  assert.doesNotMatch(sites, /q-value/);
  assert.match(sites, /sites with at least 3 values in each group were kept/);
  assert.doesNotMatch(sites, /MSstatsPTM|Perseus/);
  // HDX: the hybrid test only when it ran.
  assert.match(methodsText(entry({ hdx: { test: 'hybrid' } })).text, /hybrid significance test/);
  const threshold = methodsText(entry({ hdx: { test: 'threshold' } })).text;
  assert.match(threshold, /fixed threshold, without replicate statistics/);
  assert.doesNotMatch(threshold, /hybrid/);
});

test('references format as text and BibTeX', () => {
  assert.equal(formatReference('dssp', 3), '3. Kabsch W, Sander C. Dictionary of protein secondary structure: pattern recognition of hydrogen-bonded and geometrical features. Biopolymers. 1983;22:2577–2637. doi:10.1002/bip.360221211');
  assert.match(formatReference('afdb'), /^Varadi M, et al\. AlphaFold/, 'no doubled period after et al.');
  const bib = bibtex(['dssp', 'proteoscope']);
  assert.match(bib, /@article\{dssp1983,\n  author = \{Kabsch, W\. and Sander, C\.\},/);
  // BibTeX reads "Last, F." names; corporate authors stay whole, suffixes keep their place.
  assert.match(bibtex(['wwpdb']), /author = \{\{wwPDB consortium\}\},/);
  assert.match(bibtex(['ipsae']), /author = \{Dunbrack, Jr\., R\. L\.\},/);
  assert.match(bibtex(['afdb']), /author = \{Varadi, M\. and others\},/);
  assert.match(bib, /pages = \{2577--2637\}/);
  assert.match(bib, /@software\{proteoscope2026,/);
  for (const [key, reference] of Object.entries(REFERENCES)) {
    if (reference.type !== 'software') assert.match(reference.doi, /^10\.\d{4,5}\//, key);
  }
});
