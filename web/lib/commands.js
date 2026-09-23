// Command line: parses commands such as "show sticks within 5 of resn STI" or
// "superpose 1AKE onto 4AKE fit /A:1-29" into plain objects. Execution lives in the app; this
// module only understands syntax, so it can be tested and reused by the remote-control API.

export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

export const COMMANDS = [
  { name: 'select', aliases: ['sele', 'sel'], syntax: 'select <selection>', summary: 'Select the residues that match a selection' },
  { name: 'zoom', aliases: ['view', 'frame'], syntax: 'zoom [<selection>]', summary: 'Frame the selection, or everything' },
  { name: 'orient', aliases: [], syntax: 'orient [<selection>]', summary: 'Frame along the principal axes of the selection' },
  { name: 'focus', aliases: [], syntax: 'focus <selection>', summary: 'Focus residues or a ligand: side chains within 5 Å and interactions' },
  { name: 'show', aliases: [], syntax: 'show <sticks|ball-stick|spheres|cartoon|surface|water|hydrogens> [<selection>]', summary: 'Show a representation, for a selection or everywhere' },
  { name: 'hide', aliases: [], syntax: 'hide [<representation>|everything] [<selection>]', summary: 'Hide residues or a representation' },
  { name: 'color', aliases: ['colour'], syntax: 'color <color|scheme|default> [<selection>]', summary: 'Color a selection (red, #ff8800, …) or apply a scheme (chain, plddt, deviation, …)' },
  { name: 'label', aliases: [], syntax: 'label [<selection>]', summary: 'Label residues (the selection by default)' },
  { name: 'unlabel', aliases: [], syntax: 'unlabel [<selection>]', summary: 'Remove labels' },
  { name: 'fetch', aliases: ['open', 'load'], syntax: 'fetch <PDB ID|UniProt accession>', summary: 'Fetch a structure, replacing the scene' },
  { name: 'add', aliases: [], syntax: 'add <PDB ID|UniProt accession>', summary: 'Fetch a structure and add it to the scene' },
  { name: 'search', aliases: ['lookup', 'discover'], syntax: 'search <gene|protein|UniProt|keywords|sequence>', summary: 'Find structures and models in RCSB PDB, UniProt, PDBe and 3D-Beacons' },
  { name: 'example', aliases: ['examples', 'sample', 'demo'], syntax: 'example [add] [<id>]', summary: 'Open a bundled example with its opening view (add: next to the open structures, without the view), or list them' },
  { name: 'remove', aliases: ['delete', 'close'], syntax: 'remove <structure>', summary: 'Remove a structure from the scene' },
  { name: 'activate', aliases: ['use'], syntax: 'activate <structure>', summary: 'Make a structure the active one' },
  { name: 'superpose', aliases: ['super', 'align', 'matchmaker', 'mm'], syntax: 'superpose <moving|all> [onto <reference>] [fit <selection>]', summary: 'Superpose structures and report RMSD, TM-score and lDDT' },
  { name: 'alphafold', aliases: ['af'], syntax: 'alphafold', summary: 'Compare the active structure with its AlphaFold DB model' },
  { name: 'assembly', aliases: ['assemblies', 'biounit'], syntax: 'assembly [<id>|au]', summary: 'Build a biological assembly of the active structure (au: the asymmetric unit), or list them' },
  { name: 'evidence', aliases: ['public', 'peptideatlas'], syntax: 'evidence', summary: 'Load public peptides and PTM sites (EBI Proteins API) and color their coverage' },
  { name: 'exposure', aliases: ['ppse', 'structuremap'], syntax: 'exposure', summary: 'Part-sphere exposure (pPSE) and disorder as in StructureMap, and color by pPSE' },
  { name: 'interface', aliases: ['contacts'], syntax: 'interface <chain> <chain>', summary: 'List the contacts between two chains and frame their interface' },
  { name: 'overlay', aliases: [], syntax: 'overlay [on|off]', summary: 'Overlay all models of an ensemble' },
  { name: 'ranking', aliases: ['models', 'predictions'], syntax: 'ranking [<rank>]', summary: 'List the models of an opened prediction, or show the one at a rank' },
  { name: 'domains', aliases: ['paedomains'], syntax: 'domains', summary: 'Find rigid domains in the PAE matrix and color by them' },
  { name: 'msa', aliases: [], syntax: 'msa', summary: 'Color by MSA depth (AlphaFold DB models, prediction folders, dropped .a3m files)' },
  { name: 'validate', aliases: ['validation', 'report'], syntax: 'validate [clashes|fit|refresh|off]', summary: 'Load the wwPDB validation report and color outliers, show clashes or density fit' },
  { name: 'missense', aliases: ['alphamissense', 'am'], syntax: 'missense [<UniProt accession>]', summary: 'Color by AlphaMissense pathogenicity (human proteins)' },
  { name: 'refresh', aliases: ['reload'], syntax: 'refresh', summary: 'Download the active structure again, bypassing the cache' },
  { name: 'preset', aliases: ['style', 'rep'], syntax: 'preset <cartoon|ball-stick|sticks|spacefill|trace|surface>', summary: 'Apply a representation preset' },
  { name: 'lighting', aliases: ['light'], syntax: 'lighting <standard|soft|illustrative|glossy|neon|flat>', summary: 'Apply a lighting preset' },
  { name: 'bg', aliases: ['background'], syntax: 'bg <dark|black|gray|white>', summary: 'Set the background' },
  { name: 'distance', aliases: ['dist', 'measure'], syntax: 'distance <atom> to <atom>', summary: 'Measure the distance between two atoms' },
  { name: 'turn', aliases: ['rotate'], syntax: 'turn <x|y|z> [degrees]', summary: 'Rotate the view about a screen axis' },
  { name: 'spin', aliases: [], syntax: 'spin [on|off]', summary: 'Spin the view' },
  { name: 'reset', aliases: [], syntax: 'reset', summary: 'Reset the view' },
  { name: 'save', aliases: ['session'], syntax: 'save', summary: 'Save the session as a file' },
  { name: 'link', aliases: ['share'], syntax: 'link', summary: 'Copy a link that reopens this view' },
  { name: 'mvs', aliases: ['molviewspec'], syntax: 'mvs', summary: 'Export the view as MolViewSpec for Mol*' },
  { name: 'png', aliases: ['image', 'snapshot', 'export'], syntax: 'png [1-4] [transparent]', summary: 'Save an image' },
  { name: 'list', aliases: ['structures', 'ls'], syntax: 'list', summary: 'List the structures in the scene' },
  { name: 'help', aliases: ['?', 'commands'], syntax: 'help [command]', summary: 'List commands' },
];

const BY_NAME = new Map();
for (const command of COMMANDS) {
  BY_NAME.set(command.name, command);
  for (const alias of command.aliases) BY_NAME.set(alias, command);
}

export const REPRESENTATION_ALIASES = {
  sticks: 'sticks', stick: 'sticks', licorice: 'sticks',
  'ball-stick': 'ball-stick', ballstick: 'ball-stick', 'ball-and-stick': 'ball-stick', ball_and_stick: 'ball-stick', balls: 'ball-stick', bs: 'ball-stick',
  spheres: 'spacefill', sphere: 'spacefill', spacefill: 'spacefill', cpk: 'spacefill', vdw: 'spacefill',
  cartoon: 'cartoon', cartoons: 'cartoon', ribbon: 'cartoon', ribbons: 'cartoon',
  trace: 'trace',
  surface: 'surface', surf: 'surface', surfaces: 'surface',
  water: 'water', waters: 'water', solvent: 'water',
  hydrogens: 'hydrogens', hydrogen: 'hydrogens', h: 'hydrogens',
  labels: 'labels', label: 'labels',
  everything: 'everything', all: 'everything', residues: 'everything',
};

// Named colors: CSS basics plus the PyMOL names people type most.
export const NAMED_COLORS = {
  white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', lightgray: '#c8c8c8', lightgrey: '#c8c8c8', darkgray: '#505050', silver: '#c0c0c0',
  red: '#ff0000', green: '#00c000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  orange: '#ff8000', purple: '#bf00bf', pink: '#ffa6d9', hotpink: '#ff007f', salmon: '#ff9999', firebrick: '#b22222',
  brown: '#a6522b', tan: '#d2b48c', wheat: '#fcd1a5', gold: '#ffd124', lime: '#80ff80', forest: '#339933', olive: '#808000',
  teal: '#00bfbf', slate: '#8080ff', marine: '#0080ff', skyblue: '#3380cc', lightblue: '#bfbfff', deepblue: '#4040a6',
  navy: '#000080', violet: '#ff80ff', lavender: '#b3b3e6', palegreen: '#a6ffa6', lightpink: '#ffdbeb', raspberry: '#b24c66',
};

export function findCommand(word) {
  return BY_NAME.get(String(word ?? '').toLowerCase()) ?? null;
}

export function parseColor(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (NAMED_COLORS[value]) return NAMED_COLORS[value];
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return null;
}

// Splits "verb rest" and interprets the rest per command. `schemes` lists the valid color scheme
// ids so "color plddt" is told apart from a named color.
export function parseCommand(text, options = {}) {
  const source = String(text ?? '').trim();
  const match = source.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return null;
  const command = findCommand(match[1]);
  if (!command) return null;
  const rest = match[2].trim();
  const words = rest ? rest.split(/\s+/) : [];
  const parsed = { name: command.name, command, text: source };
  const restAfter = (count) => rest.split(/\s+/).slice(count).join(' ').trim();

  switch (command.name) {
    case 'select':
    case 'focus':
      if (!rest) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, selection: rest };
    case 'zoom':
    case 'orient':
    case 'label':
    case 'unlabel':
      return { ...parsed, selection: rest || null };
    case 'show':
    case 'hide': {
      const representation = REPRESENTATION_ALIASES[words[0]?.toLowerCase()];
      if (!representation) {
        if (command.name === 'show' && !rest) throw new CommandError(`Usage: ${command.syntax}`);
        return { ...parsed, representation: command.name === 'hide' ? 'everything' : 'cartoon', selection: rest || null };
      }
      return { ...parsed, representation, selection: restAfter(1) || null };
    }
    case 'color': {
      if (!words.length) throw new CommandError(`Usage: ${command.syntax}`);
      const first = words[0].toLowerCase();
      const selection = restAfter(1) || null;
      if (first === 'default' || first === 'reset' || first === 'none') return { ...parsed, reset: true, selection };
      const color = parseColor(first);
      if (color) return { ...parsed, color, selection };
      const scheme = (options.schemes ?? []).find((id) => id.toLowerCase() === first || id.toLowerCase() === first.replace(/_/g, '-'));
      if (scheme) {
        if (selection) throw new CommandError(`Color schemes apply to whole structures; use "color ${scheme}" alone, or a named color for "${selection}".`);
        return { ...parsed, scheme };
      }
      throw new CommandError(`Unknown color "${words[0]}". Use a name (red, slate, …), a hex value (#ff8800) or a scheme (${(options.schemes ?? []).slice(0, 6).join(', ')}, …).`);
    }
    case 'fetch':
    case 'add':
      if (words.length !== 1) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, id: words[0] };
    case 'search':
      if (!rest) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, query: rest };
    case 'example': {
      const add = words[0]?.toLowerCase() === 'add';
      const ids = add ? words.slice(1) : words;
      if (ids.length > 1 || (add && !ids.length)) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, add, id: ids[0] ?? null };
    }
    case 'assembly':
      if (words.length > 1) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, assembly: words[0] ?? null };
    case 'interface': {
      // "A B", "/A /B", "A,B" and "A:B" all name two chains.
      const chains = rest.split(/[\s,:/]+/).filter(Boolean);
      if (chains.length !== 2) throw new CommandError(`Usage: ${command.syntax}, for example "interface A B".`);
      return { ...parsed, chains };
    }
    case 'remove':
    case 'activate':
      if (!rest) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, structure: rest };
    case 'superpose': {
      if (!words.length) throw new CommandError(`Usage: ${command.syntax}`);
      const fitIndex = words.findIndex((word) => word.toLowerCase() === 'fit');
      const head = fitIndex >= 0 ? words.slice(0, fitIndex) : words;
      const fit = fitIndex >= 0 ? words.slice(fitIndex + 1).join(' ') : null;
      if (fitIndex >= 0 && !fit) throw new CommandError('"fit" needs a selection, for example "fit /A:1-120".');
      const ontoIndex = head.findIndex((word) => ['onto', 'on', 'to'].includes(word.toLowerCase()));
      const mobile = ontoIndex >= 0 ? head.slice(0, ontoIndex).join(' ') : head[0];
      const reference = ontoIndex >= 0 ? head.slice(ontoIndex + 1).join(' ') : head.slice(1).join(' ');
      if (!mobile) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, mobile, reference: reference || null, fit };
    }
    case 'ranking': {
      if (!words.length) return { ...parsed, rank: null };
      const rank = Number(words[0].replace(/^#/, ''));
      if (!Number.isInteger(rank) || rank < 1 || words.length > 1) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, rank };
    }
    case 'validate': {
      const mode = words[0]?.toLowerCase() ?? 'load';
      if (!['load', 'clashes', 'fit', 'refresh', 'off'].includes(mode) || words.length > 1) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, mode };
    }
    case 'missense':
      if (words.length > 1 || (words[0] && !/^[A-Z0-9]{6,10}(-\d+)?$/i.test(words[0]))) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, accession: words[0]?.toUpperCase() ?? null };
    case 'overlay':
    case 'spin': {
      const state = words[0]?.toLowerCase();
      if (state && !['on', 'off', 'toggle'].includes(state)) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, state: state ?? 'toggle' };
    }
    case 'preset':
    case 'lighting':
    case 'bg':
      if (words.length !== 1) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, value: words[0].toLowerCase() };
    case 'distance': {
      const parts = rest.split(/\s+to\s+/i);
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new CommandError(`Usage: ${command.syntax}, for example "distance /A:315@OG1 to :STI@N3".`);
      return { ...parsed, from: parts[0].trim(), to: parts[1].trim() };
    }
    case 'turn': {
      const axis = words[0]?.toLowerCase();
      if (!['x', 'y', 'z'].includes(axis)) throw new CommandError(`Usage: ${command.syntax}`);
      const degrees = words[1] === undefined ? 90 : Number(words[1]);
      if (!Number.isFinite(degrees)) throw new CommandError(`Usage: ${command.syntax}`);
      return { ...parsed, axis, degrees };
    }
    case 'png': {
      let scale = 2;
      let transparent = false;
      for (const word of words) {
        if (/^[1-4]x?$/i.test(word)) scale = Number(word.replace(/x/i, ''));
        else if (/^(transparent|alpha)$/i.test(word)) transparent = true;
        else throw new CommandError(`Usage: ${command.syntax}`);
      }
      return { ...parsed, scale, transparent };
    }
    case 'help':
      return { ...parsed, topic: words[0]?.toLowerCase() ?? null };
    default:
      // Commands without arguments share words with selection keywords ("msa", "ppse",
      // "exposure"): followed by more words, the text is a selection such as "msa < 30".
      return words.length ? null : parsed;
  }
}

// Commands whose name starts with the typed word, for suggestions in the search box.
export function suggestCommands(prefix, limit = 6) {
  const value = String(prefix ?? '').trim().toLowerCase();
  if (!value) return [];
  return COMMANDS.filter((command) => command.name.startsWith(value) || command.aliases.some((alias) => alias.startsWith(value))).slice(0, limit);
}
