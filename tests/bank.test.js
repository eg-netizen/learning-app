import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toRuntime, validateBank } from '../src/bank.js';
import { markQuestion } from '../src/marking.js';

const sample = JSON.parse(readFileSync(new URL('../data/sample-bank.json', import.meta.url), 'utf8'));

test('every sample question marks its own answer correct', () => {
  const { questions, skipped } = validateBank(sample);
  assert.equal(skipped.length, 0);
  assert.equal(questions.length, sample.length);
  for (const q of questions) {
    assert.ok(markQuestion(q, q.fields.map(f => f.answer)).correct, q.id);
  }
});

test('conversion produces the right fields for each answer shape', () => {
  const kinds = (q) => toRuntime(q).fields.map(f => [f.kind, f.label || '', f.answer, f.prefix || '', f.suffix || ''].join('|'));
  assert.deepEqual(kinds({ id: 1, text: 't', type: 'remainder', answer: '9 r 1' }), ['num||9||', 'num|r|1||']);
  assert.deepEqual(kinds({ id: 2, text: 't', type: 'multi', unit: 'p', answer: 'a=15, b=60' }), ['num|a|15||p', 'num|b|60||p']);
  assert.deepEqual(kinds({ id: 3, text: 't', type: 'multi', answer: '1 l 710 ml' }), ['num||1||l', 'num||710||ml']);
  assert.deepEqual(kinds({ id: 4, text: 't', type: 'multi', answer: 'a=1900 g, b=2 kg' }), ['num|a|1900||g', 'num|b|2||kg']);
  assert.deepEqual(kinds({ id: 5, text: 't', type: 'money', unit: '£', answer: '1.14' }), ['num||1.14|£|']);
  assert.deepEqual(kinds({ id: 6, text: 't', type: 'operators', answer: '● = −, ▲ = ÷' }), ['op|●|−||', 'op|▲|÷||']);
  assert.deepEqual(kinds({ id: 7, text: 't', type: 'fraction', answer: '2/9' }), ['num||2/9||']);
  assert.equal(toRuntime({ id: 8, text: 't', type: 'list', answer: '6, 12, 18' }).orderFree, true);
  assert.equal(toRuntime({ id: 9, text: 't', type: 'choice', answer: '3/6', options: ['2/5', '3/6'] }).fields[0].kind, 'choice');
});

test('questions without a usable answer are skipped, not imported', () => {
  const { questions, skipped } = validateBank([
    { id: 'ok', text: '1 + 1 =', type: 'numeric', answer: '2' },
    { id: 'unknown', text: 'chart question', type: 'numeric', answer: '?' },
    { id: 'blank', text: 'no answer', type: 'numeric' },
  ]);
  assert.equal(questions.length, 1);
  assert.deepEqual(skipped, ['unknown', 'blank']);
});

test('a file that is not a question bank is rejected', () => {
  assert.throws(() => validateBank({ hello: 'world' }));
  assert.throws(() => validateBank([]));
});
