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
