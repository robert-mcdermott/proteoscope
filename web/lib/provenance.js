// Methods and references for what a session used: where each structure, map, alignment and
// report came from (with IDs, versions and revision dates), the analyses that ran and their
// parameters, as a paragraph to adapt for a paper's methods section, with the references as text
// and BibTeX. The app describes its state (methodsContext in app.js); this module only writes.
// DOIs were checked against Crossref (September 2026).

export const REFERENCES = {
  proteoscope: { authors: 'McDermott R', year: 2026, title: 'Proteoscope: a viewer and analysis workbench for protein structures and structural proteomics', journal: 'Software', url: 'https://github.com/robert-mcdermott/proteoscope', type: 'software' },
  pdb: { authors: 'Berman HM, Westbrook J, Feng Z, Gilliland G, Bhat TN, Weissig H, Shindyalov IN, Bourne PE', year: 2000, title: 'The Protein Data Bank', journal: 'Nucleic Acids Res', volume: '28', pages: '235–242', doi: '10.1093/nar/28.1.235' },
  wwpdb: { authors: 'wwPDB consortium', year: 2019, title: 'Protein Data Bank: the single global archive for 3D macromolecular structure data', journal: 'Nucleic Acids Res', volume: '47', pages: 'D520–D528', doi: '10.1093/nar/gky949' },
  afdb: { authors: 'Varadi M, et al.', year: 2024, title: 'AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences', journal: 'Nucleic Acids Res', volume: '52', pages: 'D368–D375', doi: '10.1093/nar/gkad1011' },
  alphafold2: { authors: 'Jumper J, et al.', year: 2021, title: 'Highly accurate protein structure prediction with AlphaFold', journal: 'Nature', volume: '596', pages: '583–589', doi: '10.1038/s41586-021-03819-2' },
  uniprot: { authors: 'UniProt Consortium', year: 2025, title: 'UniProt: the Universal Protein Knowledgebase in 2025', journal: 'Nucleic Acids Res', volume: '53', pages: 'D609–D617', doi: '10.1093/nar/gkae1010' },
  sifts: { authors: 'Dana JM, et al.', year: 2019, title: 'SIFTS: updated Structure Integration with Function, Taxonomy and Sequences resource allows 40-fold increase in coverage of structure-based annotations for proteins', journal: 'Nucleic Acids Res', volume: '47', pages: 'D482–D489', doi: '10.1093/nar/gky1114' },
  beacons: { authors: 'Varadi M, et al.', year: 2022, title: '3D-Beacons: decreasing the gap between protein sequences and structures through a federated network of protein structure data resources', journal: 'GigaScience', volume: '11', pages: 'giac118', doi: '10.1093/gigascience/giac118' },
  ccd: { authors: 'Westbrook JD, Shao C, Feng Z, Zhuravleva M, Velankar S, Young J', year: 2015, title: 'The chemical component dictionary: complete descriptions of constituent molecules in experimentally determined 3D macromolecules in the Protein Data Bank', journal: 'Bioinformatics', volume: '31', pages: '1274–1278', doi: '10.1093/bioinformatics/btu789' },
  dssp: { authors: 'Kabsch W, Sander C', year: 1983, title: 'Dictionary of protein secondary structure: pattern recognition of hydrogen-bonded and geometrical features', journal: 'Biopolymers', volume: '22', pages: '2577–2637', doi: '10.1002/bip.360221211' },
  shrake: { authors: 'Shrake A, Rupley JA', year: 1973, title: 'Environment and exposure to solvent of protein atoms. Lysozyme and insulin', journal: 'J Mol Biol', volume: '79', pages: '351–371', doi: '10.1016/0022-2836(73)90011-9' },
  tien: { authors: 'Tien MZ, Meyer AG, Sydykova DK, Spielman SJ, Wilke CO', year: 2013, title: 'Maximum allowed solvent accessibilites of residues in proteins', journal: 'PLoS One', volume: '8', pages: 'e80635', doi: '10.1371/journal.pone.0080635' },
  plip: { authors: 'Salentin S, Schreiber S, Haupt VJ, Adasme MF, Schroeder M', year: 2015, title: 'PLIP: fully automated protein–ligand interaction profiler', journal: 'Nucleic Acids Res', volume: '43', pages: 'W443–W447', doi: '10.1093/nar/gkv315' },
  plip2021: { authors: 'Adasme MF, et al.', year: 2021, title: 'PLIP 2021: expanding the scope of the protein–ligand interaction profiler to DNA and RNA', journal: 'Nucleic Acids Res', volume: '49', pages: 'W530–W534', doi: '10.1093/nar/gkab294' },
  chimerax: { authors: 'Goddard TD, et al.', year: 2018, title: 'UCSF ChimeraX: meeting modern challenges in visualization and analysis', journal: 'Protein Sci', volume: '27', pages: '14–25', doi: '10.1002/pro.3235' },
  horn: { authors: 'Horn BKP', year: 1987, title: 'Closed-form solution of absolute orientation using unit quaternions', journal: 'J Opt Soc Am A', volume: '4', pages: '629–642', doi: '10.1364/JOSAA.4.000629' },
  tmscore: { authors: 'Zhang Y, Skolnick J', year: 2004, title: 'Scoring function for automated assessment of protein structure template quality', journal: 'Proteins', volume: '57', pages: '702–710', doi: '10.1002/prot.20264' },
  tmalign: { authors: 'Zhang Y, Skolnick J', year: 2005, title: 'TM-align: a protein structure alignment algorithm based on the TM-score', journal: 'Nucleic Acids Res', volume: '33', pages: '2302–2309', doi: '10.1093/nar/gki524' },
  mmalign: { authors: 'Mukherjee S, Zhang Y', year: 2009, title: 'MM-align: a quick algorithm for aligning multiple-chain protein complex structures using iterative dynamic programming', journal: 'Nucleic Acids Res', volume: '37', pages: 'e83', doi: '10.1093/nar/gkp318' },
  usalign: { authors: 'Zhang C, Shine M, Pyle AM, Zhang Y', year: 2022, title: 'US-align: universal structure alignments of proteins, nucleic acids, and macromolecular complexes', journal: 'Nat Methods', volume: '19', pages: '1109–1115', doi: '10.1038/s41592-022-01585-1' },
  lddt: { authors: 'Mariani V, Biasini M, Barbato A, Schwede T', year: 2013, title: 'lDDT: a local superposition-free score for comparing protein structures and models using distance difference tests', journal: 'Bioinformatics', volume: '29', pages: '2722–2728', doi: '10.1093/bioinformatics/btt473' },
  ipsae: { authors: 'Dunbrack RL Jr', year: 2025, title: 'Rēs ipSAE loquuntur: what’s wrong with AlphaFold’s ipTM score and how to fix it', journal: 'bioRxiv', pages: '2025.02.10.637595', doi: '10.1101/2025.02.10.637595' },
  pdockq: { authors: 'Bryant P, Pozzati G, Elofsson A', year: 2022, title: 'Improved prediction of protein-protein interactions using AlphaFold2', journal: 'Nat Commun', volume: '13', pages: '1265', doi: '10.1038/s41467-022-28865-w' },
  pdockq2: { authors: 'Zhu W, Shenoy A, Kundrotas P, Elofsson A', year: 2023, title: 'Evaluation of AlphaFold-Multimer prediction on multi-chain protein complexes', journal: 'Bioinformatics', volume: '39', pages: 'btad424', doi: '10.1093/bioinformatics/btad424' },
  lis: { authors: 'Kim AR, et al.', year: 2024, title: 'Enhanced protein-protein interaction discovery via AlphaFold-Multimer', journal: 'bioRxiv', pages: '2024.02.19.580970', doi: '10.1101/2024.02.19.580970' },
  alphamissense: { authors: 'Cheng J, et al.', year: 2023, title: 'Accurate proteome-wide missense variant effect prediction with AlphaMissense', journal: 'Science', volume: '381', pages: 'eadg7492', doi: '10.1126/science.adg7492' },
  validation: { authors: 'Gore S, et al.', year: 2017, title: 'Validation of structures in the Protein Data Bank', journal: 'Structure', volume: '25', pages: '1916–1927', doi: '10.1016/j.str.2017.10.009' },
  molprobity: { authors: 'Williams CJ, et al.', year: 2018, title: 'MolProbity: more and better reference data for improved all-atom structure validation', journal: 'Protein Sci', volume: '27', pages: '293–315', doi: '10.1002/pro.3330' },
  structuremap: { authors: 'Bludau I, et al.', year: 2022, title: 'The structural context of posttranslational modifications at a proteome-wide scale', journal: 'PLoS Biol', volume: '20', pages: 'e3001636', doi: '10.1371/journal.pbio.3001636' },
  jwalk: { authors: 'Bullock JMA, Schwab J, Thalassinos K, Topf M', year: 2016, title: 'The importance of non-accessible crosslinks and solvent accessible surface distance in modeling proteins with restraints from crosslinking mass spectrometry', journal: 'Mol Cell Proteomics', volume: '15', pages: '2491–2500', doi: '10.1074/mcp.M116.058560' },
  hdx: { authors: 'Hageman TS, Weis DD', year: 2019, title: 'Reliable identification of significant differences in differential hydrogen exchange-mass spectrometry measurements using a hybrid significance testing approach', journal: 'Anal Chem', volume: '91', pages: '8008–8016', doi: '10.1021/acs.analchem.9b01325' },
  proteinsapi: { authors: 'Nightingale A, et al.', year: 2017, title: 'The Proteins API: accessing key integrated protein and genome information', journal: 'Nucleic Acids Res', volume: '45', pages: 'W539–W544', doi: '10.1093/nar/gkx237' },
  limma: { authors: 'Ritchie ME, et al.', year: 2015, title: 'limma powers differential expression analyses for RNA-sequencing and microarray studies', journal: 'Nucleic Acids Res', volume: '43', pages: 'e47', doi: '10.1093/nar/gkv007' },
  smyth: { authors: 'Smyth GK', year: 2004, title: 'Linear models and empirical Bayes methods for assessing differential expression in microarray experiments', journal: 'Stat Appl Genet Mol Biol', volume: '3', pages: 'Article 3', doi: '10.2202/1544-6115.1027' },
  bh: { authors: 'Benjamini Y, Hochberg Y', year: 1995, title: 'Controlling the false discovery rate: a practical and powerful approach to multiple testing', journal: 'J R Stat Soc Series B', volume: '57', pages: '289–300', doi: '10.1111/j.2517-6161.1995.tb02031.x' },
  msstatsptm: { authors: 'Kohler D, et al.', year: 2023, title: 'MSstatsPTM: statistical relative quantification of posttranslational modifications in bottom-up mass spectrometry-based proteomics', journal: 'Mol Cell Proteomics', volume: '22', pages: '100477', doi: '10.1016/j.mcpro.2022.100477' },
  perseus: { authors: 'Tyanova S, et al.', year: 2016, title: 'The Perseus computational platform for comprehensive analysis of (prote)omics data', journal: 'Nat Methods', volume: '13', pages: '731–740', doi: '10.1038/nmeth.3901' },
  capra: { authors: 'Capra JA, Singh M', year: 2007, title: 'Predicting functionally important residues from sequence conservation', journal: 'Bioinformatics', volume: '23', pages: '1875–1882', doi: '10.1093/bioinformatics/btm270' },
  henikoff: { authors: 'Henikoff S, Henikoff JG', year: 1994, title: 'Position-based sequence weights', journal: 'J Mol Biol', volume: '243', pages: '574–578', doi: '10.1016/0022-2836(94)90032-9' },
  consurf: { authors: 'Ashkenazy H, et al.', year: 2016, title: 'ConSurf 2016: an improved methodology to estimate and visualize evolutionary conservation in macromolecules', journal: 'Nucleic Acids Res', volume: '44', pages: 'W344–W350', doi: '10.1093/nar/gkw408' },
  molstar: { authors: 'Sehnal D, et al.', year: 2021, title: 'Mol* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures', journal: 'Nucleic Acids Res', volume: '49', pages: 'W431–W437', doi: '10.1093/nar/gkab314' },
  emdb: { authors: 'wwPDB Consortium', year: 2024, title: 'EMDB—the Electron Microscopy Data Bank', journal: 'Nucleic Acids Res', volume: '52', pages: 'D456–D465', doi: '10.1093/nar/gkad1019' },
  mrc2014: { authors: 'Cheng A, et al.', year: 2015, title: 'MRC2014: extensions to the MRC format header for electron cryo-microscopy and tomography', journal: 'J Struct Biol', volume: '192', pages: '146–150', doi: '10.1016/j.jsb.2015.04.002' },
  surfacenets: { authors: 'Gibson SFF', year: 1998, title: 'Constrained elastic surface nets: generating smooth surfaces from binary segmented data', journal: 'Lecture Notes in Computer Science (MICCAI 1998)', volume: '1496', pages: '888–898', doi: '10.1007/BFb0056277' },
  ifp: { authors: 'Marcou G, Rognan D', year: 2007, title: 'Optimizing fragment and scaffold docking by use of molecular interaction fingerprints', journal: 'J Chem Inf Model', volume: '47', pages: '195–207', doi: '10.1021/ci600342e' },
};

// A context describes the session: { version, entries: [{ name, code, source, method,
// resolution, revisionDate, afdbVersion, predicted, uses: {...} }] }; see methodsContext in app.js.
export function methodsText(context) {
  const cited = [];
  const cite = (...keys) => {
    for (const key of keys) if (!cited.includes(key)) cited.push(key);
    return `[${keys.map((key) => cited.indexOf(key) + 1).join(', ')}]`;
  };
  const entries = context.entries ?? [];
  const uses = (name) => entries.filter((entry) => entry.uses?.[name]);
  const sentences = [];

  // Data sources.
  const pdb = entries.filter((entry) => entry.source === 'pdb' || entry.source === 'example');
  const afdb = entries.filter((entry) => entry.source === 'afdb');
  const models = entries.filter((entry) => entry.source === 'model');
  const files = entries.filter((entry) => entry.source === 'file');
  const predictions = entries.filter((entry) => entry.source === 'prediction');
  const sources = [];
  if (pdb.length) sources.push(`the Protein Data Bank ${cite('pdb', 'wwpdb')} (${pdb.map(describePDB).join('; ')})`);
  if (afdb.length) sources.push(`AlphaFold DB ${cite('afdb', 'alphafold2')} (${afdb.map((entry) => `${entry.code}${entry.afdbVersion ? `, model ${entry.afdbVersion}` : ''}`).join('; ')})`);
  if (models.length) sources.push(`model providers through 3D-Beacons ${cite('beacons')} (${models.map((entry) => entry.name).join('; ')})`);
  if (predictions.length) sources.push(`structure predictions (${[...new Set(predictions.map((entry) => entry.tool).filter(Boolean))].join(', ') || 'local runs'})`);
  if (files.length) sources.push(`local files (${files.map((entry) => entry.name).join('; ')})`);
  const version = context.version ? ` version ${context.version}` : '';
  sentences.push(sources.length
    ? `Structures were obtained from ${joinList(sources)} and analyzed in Proteoscope${version} ${cite('proteoscope')}.`
    : `Structures were analyzed in Proteoscope${version} ${cite('proteoscope')}.`);

  if (uses('dssp').length) sentences.push(`Secondary structure was assigned with a DSSP implementation ${cite('dssp')}.`);
  if (uses('chemistry').length) sentences.push(`Bond orders, aromaticity and formal charges of ligands and modified residues were taken from the wwPDB Chemical Component Dictionary ${cite('ccd')}.`);
  if (uses('interactions').length) {
    sentences.push(`Non-covalent interactions (hydrogen bonds, salt bridges, π-stacking, cation–π, hydrophobic contacts, halogen bonds, metal coordination and water bridges) were detected with the geometric criteria of PLIP ${cite('plip', 'plip2021')}.`);
  }
  if (uses('sasa').length) sentences.push(`Solvent-accessible surface areas were computed with the Shrake–Rupley algorithm (1.4 Å probe) ${cite('shrake')} and relative exposure with the maximum values of Tien et al. ${cite('tien')}.`);
  if (uses('electrostatics').length) sentences.push(`Surfaces were colored by Coulombic potential with a distance-dependent dielectric (ε = 4r), as in ChimeraX ${cite('chimerax')}.`);

  const sequenceFits = uses('superposition').filter((entry) => entry.uses.superposition.method !== 'structure');
  const structureFits = uses('superposition').filter((entry) => entry.uses.superposition.method === 'structure');
  if (sequenceFits.length) {
    sentences.push(`Structures were superposed on Cα atoms of residues paired by sequence alignment${sequenceFits.some((entry) => entry.uses.superposition.method === 'uniprot') ? ' or UniProt numbering' : ''}, by least-squares fitting ${cite('horn')} with iterative pruning of pairs farther than 2 Å apart; TM-scores ${cite('tmscore')} and lDDT ${cite('lddt')} were computed over the paired residues.`);
  }
  if (structureFits.length) {
    const complex = structureFits.some((entry) => entry.uses.superposition.complex);
    sentences.push(`Structures were aligned without regard to sequence with ${complex ? 'TM-align and, for complexes, MM-align' : 'TM-align'} as implemented in US-align ${cite('tmalign', ...(complex ? ['mmalign'] : []), 'usalign')}; TM-scores are normalized by the length of the reference.`);
  }
  if (uses('prediction').length) {
    sentences.push(`Predicted interfaces were scored with ipSAE ${cite('ipsae')}, ipTM recomputed from the predicted aligned error, pDockQ ${cite('pdockq')}, pDockQ2 ${cite('pdockq2')} and LIS ${cite('lis')}, with the definitions of ipsae.py (version 4).`);
  }
  if (uses('domains').length) sentences.push(`Rigid domains were clustered from the predicted aligned error as in ChimeraX ${cite('chimerax')}.`);
  if (uses('validation').length) sentences.push(`Validation data were taken from the wwPDB validation reports ${cite('validation')}; Ramachandran classes follow the MolProbity Top8000 contours ${cite('molprobity')}.`);
  if (uses('missense').length) sentences.push(`Variant effects are AlphaMissense pathogenicity scores ${cite('alphamissense')} from AlphaFold DB.`);

  for (const entry of uses('density')) {
    const density = entry.uses.density;
    const levels = joinList(density.levels.map((level) => {
      const sigma = `${level.kind === 'fo-fc' ? '±' : ''}${level.sigma.toFixed(1)}σ`;
      if (level.kind === 'em' || level.kind === 'map') return `${level.absolute.toPrecision(3)} (${sigma}${level.recommended ? ', the EMDB-recommended level' : ''})`;
      return `${sigma} (${level.channel})`;
    }));
    if (density.source === 'file') {
      sentences.push(`The density map ${density.name} (CCP4/MRC ${cite('mrc2014')}) was contoured at ${levels} with surface nets ${cite('surfacenets')}.`);
    } else if (density.kind === 'em') {
      sentences.push(`The cryo-EM map ${density.id} ${cite('emdb')} was obtained through the PDBe volume server ${cite('molstar')} and contoured at ${levels}${density.fit ? `; ${formatPercent(density.fit.atomInclusion)} of the model's atoms were inside the contour (atom inclusion)` : ''}.`);
    } else {
      sentences.push(`The 2Fo-Fc and Fo-Fc maps of ${density.id} were obtained from the PDBe volume server ${cite('molstar')} and contoured at ${levels}${density.fit ? `; ${formatPercent(density.fit.atomInclusion)} of the model's atoms lie above 1σ of the 2Fo-Fc map` : ''}.`);
    }
  }

  for (const entry of uses('conservation')) {
    const conservation = entry.uses.conservation;
    const sources = conservation.summaries.map((item) => `${item.source} (${item.sequences} sequences)`).join(', ');
    sentences.push(`Residue conservation was computed from ${sources} as ${conservation.method === 'entropy' ? 'the normalized Shannon entropy' : 'the Jensen–Shannon divergence'} of Capra and Singh ${cite('capra')}, with position-based sequence weights ${cite('henikoff')}, a gap penalty and a three-residue window, and shown in nine equal-frequency grades on the ConSurf color scale ${cite('consurf')}.`);
  }

  for (const entry of uses('report')) {
    const report = entry.uses.report;
    const filters = [report.qFiltered === false ? '' : `a q-value of ${report.qValue}`, `a localization probability of ${report.localization}`].filter(Boolean);
    sentences.push(`${report.label} results (${report.name}) were filtered at ${joinList(filters)}.`);
    const statistics = report.statistics;
    if (statistics) {
      const features = report.kind === 'sites' ? 'sites' : 'peptides';
      const steps = ['log2-transformed', statistics.normalize === 'median' ? 'median-normalized' : ''].filter(Boolean);
      const kept = statistics.impute
        ? `${features} with at least ${statistics.minValid} observed values in at least one group were kept and their missing values imputed from a down-shifted normal distribution as in Perseus ${cite('perseus')}`
        : `${features} with at least ${statistics.minValid} values in each group were kept`;
      const adjusted = statistics.adjust
        ? ` The changes of modified peptides were adjusted for the change of their protein, estimated from its unmodified peptides, as in MSstatsPTM ${cite('msstatsptm')}, and the adjusted p-values corrected in the same way.`
        : '';
      sentences.push(`For differential abundance, the intensities of all ${features} in the report were ${joinList(steps)}; ${kept}. They were compared with moderated t-tests (limma empirical Bayes ${cite('smyth', 'limma')}) and the p-values adjusted by the Benjamini–Hochberg method ${cite('bh')}.${adjusted}`);
    }
  }
  if (uses('exposure').length) sentences.push(`Part-sphere exposure and intrinsically disordered regions were computed as in StructureMap ${cite('structuremap')}.`);
  if (uses('evidence').length) sentences.push(`Public peptide and PTM evidence came from the EBI Proteins API ${cite('proteinsapi')}.`);
  if (uses('crosslinks').length) sentences.push(`Cross-links were checked against Cα–Cα distances${uses('crosslinks').some((entry) => entry.uses.crosslinks.sasd) ? ` and solvent-accessible surface distances computed as in Jwalk ${cite('jwalk')}` : ''}.`);
  const hdxTests = new Set(uses('hdx').map((entry) => entry.uses.hdx?.test ?? ''));
  if (hdxTests.has('hybrid')) sentences.push(`HDX-MS differences were tested with the hybrid significance test of Hageman and Weis ${cite('hdx')}.`);
  if (hdxTests.has('threshold')) sentences.push('HDX-MS differences were judged against a fixed threshold, without replicate statistics.');
  if (hdxTests.has('uptake') || hdxTests.has('')) sentences.push('HDX-MS uptake was mapped onto the structure.');
  for (const entry of uses('docking')) {
    const docking = entry.uses.docking;
    sentences.push(`${docking.count} docking poses (${docking.name}) were analyzed in the receptor ${entry.name}${docking.fingerprints ? `, with interaction fingerprints ${cite('ifp')} from the PLIP criteria` : ''}.`);
  }
  if (entries.some((entry) => entry.uniprot)) sentences.push(`Residues were mapped to UniProt ${cite('uniprot')} through SIFTS ${cite('sifts')} or the files' own references.`);
  return { text: sentences.join(' '), references: cited };
}

function describePDB(entry) {
  const details = [methodName(entry.method), entry.resolution, entry.revisionDate ? `revision of ${entry.revisionDate}` : ''].filter(Boolean).join(', ');
  return details ? `${entry.code}: ${details}` : entry.code;
}

// Experimental methods as they read in prose: "X-ray diffraction", "cryo-EM", "solution NMR".
function methodName(method) {
  const text = String(method ?? '').toLowerCase();
  if (!text) return '';
  if (text.includes('x-ray')) return 'X-ray diffraction';
  if (text.includes('electron microscopy')) return 'cryo-EM';
  if (text.includes('nmr')) return text.includes('solid') ? 'solid-state NMR' : 'solution NMR';
  if (text.includes('neutron')) return 'neutron diffraction';
  return text;
}

function joinList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'a share';
}

export function formatReference(key, index = null) {
  const reference = REFERENCES[key];
  if (!reference) return '';
  const prefix = index === null ? '' : `${index}. `;
  const authors = reference.authors.endsWith('.') ? reference.authors : `${reference.authors}.`;
  if (reference.type === 'software') return `${prefix}${authors} ${reference.title}. ${reference.year}. ${reference.url}`;
  const volume = reference.volume ? `;${reference.volume}` : '';
  const pages = reference.pages ? `:${reference.pages}` : '';
  return `${prefix}${authors} ${reference.title}. ${reference.journal}. ${reference.year}${volume}${pages}. doi:${reference.doi}`;
}

// "Zhang Y, Skolnick J" → "Zhang, Y. and Skolnick, J."; "Dunbrack RL Jr" → "Dunbrack, Jr., R. L.";
// a corporate author ("wwPDB consortium") is braced so BibTeX keeps it whole; "et al." becomes
// "others".
function bibtexAuthors(authors) {
  return authors.split(/,\s*/).map((name) => {
    if (/^et al\.?$/i.test(name)) return 'others';
    const words = name.trim().split(/\s+/);
    const suffix = /^(Jr|Sr|II|III|IV)\.?$/.test(words.at(-1)) && words.length > 2 ? words.pop().replace(/\.$/, '') : '';
    const initials = words.at(-1);
    if (words.length < 2 || !/^[A-Z]{1,4}$/.test(initials)) return `{${name.trim()}}`;
    const surname = words.slice(0, -1).join(' ');
    const given = [...initials].map((letter) => `${letter}.`).join(' ');
    return suffix ? `${surname}, ${suffix}., ${given}` : `${surname}, ${given}`;
  }).join(' and ');
}

export function bibtex(keys) {
  return keys.map((key) => {
    const reference = REFERENCES[key];
    if (!reference) return '';
    const fields = reference.type === 'software'
      ? { author: bibtexAuthors(reference.authors), title: reference.title, year: reference.year, url: reference.url }
      : { author: bibtexAuthors(reference.authors), title: reference.title, journal: reference.journal, year: reference.year, volume: reference.volume, pages: reference.pages?.replace('–', '--'), doi: reference.doi };
    // Author lists carry their own braces (corporate authors); other fields must not.
    const body = Object.entries(fields).filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `  ${name} = {${name === 'author' ? value : String(value).replace(/[{}]/g, '')}}`).join(',\n');
    return `@${reference.type === 'software' ? 'software' : 'article'}{${key}${reference.year},\n${body}\n}`;
  }).filter(Boolean).join('\n\n');
}
