import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandError, parseColor, parseCommand, suggestCommands } from './commands.js';

const schemes = ['chain', 'plddt', 'deviation', 'element', 'structure'];

test('commands and aliases are recognized; other text is not a command', () => {
  assert.equal(parseCommand('select chain A').name, 'select');
  assert.equal(parseCommand('sele chain A').selection, 'chain A');
  assert.equal(parseCommand('mm 1AKE onto 4AKE').name, 'superpose');
  assert.equal(parseCommand('chain A and resi 10'), null);
  assert.equal(parseCommand('HEM'), null);
  assert.equal(parseCommand(''), null);
  // Commands without arguments share words with selection keywords; with more words they select.
  assert.equal(parseCommand('ppse').name, 'exposure');
  assert.equal(parseCommand('exposure').name, 'exposure');
  for (const text of ['ppse < 6', 'exposure < 0.2', 'msa < 30']) assert.equal(parseCommand(text), null, text);
});

test('show and hide take an optional representation and selection', () => {
  assert.deepEqual(pick(parseCommand('show sticks within 5 of resn STI')), { representation: 'sticks', selection: 'within 5 of resn STI' });
  assert.deepEqual(pick(parseCommand('show spheres')), { representation: 'spacefill', selection: null });
  assert.deepEqual(pick(parseCommand('hide water')), { representation: 'water', selection: null });
  assert.deepEqual(pick(parseCommand('hide chain B')), { representation: 'everything', selection: 'chain B' });
  assert.deepEqual(pick(parseCommand('show chain B')), { representation: 'cartoon', selection: 'chain B' });
  assert.throws(() => parseCommand('show'), CommandError);
});

test('color accepts names, hex values, schemes and resets', () => {
  assert.equal(parseColor('Slate'), '#8080ff');
  assert.equal(parseColor('#f80'), '#ff8800');
  assert.equal(parseColor('chartreuse-ish'), null);
  assert.deepEqual(pick(parseCommand('color magenta /A:315', { schemes })), { color: '#ff00ff', selection: '/A:315' });
  assert.deepEqual(pick(parseCommand('color #00ff00 #2 and chain A', { schemes })), { color: '#00ff00', selection: '#2 and chain A' });
  assert.equal(parseCommand('color plddt', { schemes }).scheme, 'plddt');
  assert.equal(parseCommand('color default chain A', { schemes }).reset, true);
  assert.throws(() => parseCommand('color plddt chain A', { schemes }), /apply to whole structures/);
  assert.throws(() => parseCommand('color blurple', { schemes }), /Unknown color "blurple"/);
});

test('superpose reads moving, reference and fit selection', () => {
  assert.deepEqual(pick(parseCommand('superpose 1AKE onto 4AKE fit /A:1-29,60-121')), { mobile: '1AKE', reference: '4AKE', fit: '/A:1-29,60-121' });
  assert.deepEqual(pick(parseCommand('super all')), { mobile: 'all', reference: null, fit: null });
  assert.deepEqual(pick(parseCommand('align 2 1')), { mobile: '2', reference: '1', fit: null });
  assert.throws(() => parseCommand('superpose 1AKE fit'), /needs a selection/);
});

test('other commands parse their arguments', () => {
  assert.deepEqual(pick(parseCommand('distance /A:315@OG1 to :STI@N3')), { from: '/A:315@OG1', to: ':STI@N3' });
  assert.deepEqual(pick(parseCommand('turn y 45')), { axis: 'y', degrees: 45 });
  assert.deepEqual(pick(parseCommand('png 3 transparent')), { scale: 3, transparent: true });
  assert.equal(parseCommand('fetch 4hhb').id, '4hhb');
  assert.equal(parseCommand('spin off').state, 'off');
  assert.throws(() => parseCommand('turn w'), CommandError);
  assert.deepEqual(suggestCommands('su').map((command) => command.name), ['superpose']);
});

function pick(parsed) {
  const { name, command, text, ...rest } = parsed;
  return rest;
}

test('triage, info and interactions', () => {
  assert.deepEqual(fields(parseCommand('triage'), 'action', 'metric', 'limit', 'level', 'pair'), { action: 'rank', metric: null, limit: null, level: null, pair: undefined });
  assert.deepEqual(fields(parseCommand('triage by pDockQ2 top 10 models pair A B'), 'action', 'metric', 'limit', 'level', 'pair'), { action: 'rank', metric: 'pdockq2', limit: 10, level: 'models', pair: ['A', 'B'] });
  assert.deepEqual(fields(parseCommand('batch lis best jobs'), 'name', 'metric', 'level', 'pair'), { name: 'triage', metric: 'lis', level: 'jobs', pair: null });
  assert.deepEqual(fields(parseCommand('triage show #3'), 'action', 'position'), { action: 'show', position: 3 });
  assert.deepEqual(fields(parseCommand('triage gallery'), 'action', 'count'), { action: 'gallery', count: 12 });
  assert.equal(parseCommand('triage csv').action, 'export');
  assert.equal(parseCommand('triage by auto top 20 jobs best').metric, 'auto');
  assert.throws(() => parseCommand('triage by rmsd'), /Rank by ipsae/);
  assert.throws(() => parseCommand('triage gallery 40'), /1 to 24/);
  assert.throws(() => parseCommand('triage pair A'), /triage pair <chain> <chain>/);
  assert.throws(() => parseCommand('triage show'), /Usage/);
  assert.equal(parseCommand('info').name, 'info');
  assert.equal(parseCommand('describe').name, 'info');
  assert.equal(parseCommand('interactions resn STI').selection, 'resn STI');
  assert.throws(() => parseCommand('interactions'), /Usage/);
});

function fields(object, ...keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

test('compound, diagram and map peaks', () => {
  const parse = (text) => parseCommand(text);
  assert.deepEqual([parse('compound').name, parse('compound').selection], ['compound', null]);
  assert.equal(parse('chem resn STI').selection, 'resn STI');
  assert.deepEqual([parse('diagram').selection, parse('diagram').names], [null, false]);
  assert.deepEqual([parse('diagram resn AQ4 names').selection, parse('diagram resn AQ4 names').names], ['resn AQ4', true]);
  assert.equal(parse('ligplot').name, 'diagram');
  assert.deepEqual([parse('map peaks').action, parse('map peaks').value], ['peaks', 3]);
  assert.equal(parse('map peaks 3.5σ').value, 3.5);
  assert.throws(() => parse('map peaks 0.2'), /map peaks/);
  // "ligand" stays a selection keyword.
  assert.equal(parse('ligand'), null);
});
