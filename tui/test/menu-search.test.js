import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMenuChoices, fuzzyScore, groupCommandChoices } from '../lib/menu-search.js';

const commands = [
  { name: '/setup', cat: 'Setup', desc: 'Create a project' },
  { name: '/security', cat: 'Security', desc: 'Scan dependencies and secrets' },
  { name: '/test', cat: 'QA', desc: 'Run unit tests' },
];

test('fuzzyScore matches non-contiguous characters', () => {
  assert.ok(Number.isFinite(fuzzyScore('scty', '/security scan')));
  assert.equal(fuzzyScore('xyz', '/security scan'), Number.NEGATIVE_INFINITY);
});

test('filterMenuChoices searches names and descriptions and removes separators', () => {
  const choices = [
    { name: 'Run Tests — auto-detect test suite', value: 'test', searchText: 'Run Tests auto-detect test suite' },
    { name: 'Security Audit — scan secrets', value: 'security', searchText: 'Security Audit scan secrets' },
    { name: '-----', value: '__sep__', disabled: true },
  ];

  assert.deepEqual(filterMenuChoices(choices, 'scrty').map(choice => choice.value), ['security']);
  assert.equal(filterMenuChoices(choices, '').length, 3);
});

test('groupCommandChoices collapses categories by default', () => {
  assert.deepEqual(
    groupCommandChoices(commands).map(item => item.type),
    ['category', 'category', 'category'],
  );
});

test('groupCommandChoices expands selected categories', () => {
  const choices = groupCommandChoices(commands, new Set(['Security']));
  assert.deepEqual(
    choices.map(item => item.type === 'command' ? item.command.name : item.category),
    ['Setup', 'Security', '/security', 'QA'],
  );
});

test('groupCommandChoices searches across command descriptions', () => {
  const choices = groupCommandChoices(commands, new Set(), 'secrets');
  assert.deepEqual(
    choices.map(item => item.type === 'command' ? item.command.name : item.category),
    ['Security', '/security'],
  );
  assert.equal(choices[0].expanded, true);
});
