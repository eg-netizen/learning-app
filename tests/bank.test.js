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

import { subjectOf, subjectsIn } from '../src/bank.js';

test('subject comes from the question, else the book code', () => {
  assert.equal(subjectOf({ subject: 'Verbal Reasoning', book: 'MA3' }), 'Verbal Reasoning');
  assert.equal(subjectOf({ book: 'MA3' }), 'Mental Arithmetic');
  assert.equal(subjectOf({ book: 'PS3' }), 'Problem Solving');
  assert.equal(subjectOf({}), '');
});

test('subjectsIn counts each subject and ignores untagged questions', () => {
  const qs = [{ book: 'MA3' }, { book: 'MA3' }, { book: 'PS3' }, {}];
  assert.deepEqual(subjectsIn(qs), [{ name: 'Mental Arithmetic', n: 2 }, { name: 'Problem Solving', n: 1 }]);
});

test('toRuntime keeps the subject', () => {
  assert.equal(toRuntime({ id: 'x', text: '1+1=', answer: '2', book: 'PS3' }).subject, 'Problem Solving');
});

import { setsIn, setQuestions, refOf } from '../src/bank.js';

const fx = (id, test, section, number, page) => ({ id, text: 'q ' + id, answer: '1', book: 'MA3', test, section, number, page });

test('sets keep booklet order and can be limited to one section', () => {
  const raw = [fx('MA3-3-A1', 3, 'A', 1, 6), fx('MA3-3-A2', 3, 'A', 2, 6), fx('MA3-3-B1', 3, 'B', 1, 6), fx('MA3-4-A1', 4, 'A', 1, 7),
    { id: 'PS3-Time-3a', text: 't', answer: '1', book: 'PS3', test: 'Time', section: '', number: 3, page: 4 }];
  const qs = validateBank(raw).questions;
  const sets = setsIn(qs);
  assert.deepEqual(sets.map(s => [s.title, s.n]), [['Test 3', 3], ['Test 4', 1], ['Time', 1]]);
  assert.deepEqual(sets[0].sections, [{ name: 'A', n: 2 }, { name: 'B', n: 1 }]);
  assert.deepEqual(setQuestions(qs, 'MA3|3').map(q => q.id), ['MA3-3-A1', 'MA3-3-A2', 'MA3-3-B1']);
  assert.deepEqual(setQuestions(qs, 'MA3|3', 'B').map(q => q.id), ['MA3-3-B1']);
});

test('every question keeps its book, set, question number and page', () => {
  assert.equal(refOf(fx('MA3-4-B7', 4, 'B', 7, 7)), 'Mental Arithmetic 3 · Test 4 · Section B, question 7 · page 7');
  assert.equal(refOf({ id: 'PS3-Time-3a', book: 'PS3', test: 'Time', section: '', number: 3, page: 4 }), 'Problem Solving 3 · Time · Question 3a · page 4');
  assert.equal(refOf({ id: 'S-01' }), '');
  assert.equal(toRuntime(fx('MA3-5-C2', 5, 'C', 2, 8)).ref, 'Mental Arithmetic 3 · Test 5 · Section C, question 2 · page 8');
});

test('a question image and its description carry through to the runtime question', () => {
  const r = toRuntime({ id: 'x', text: 'Read the chart.', answer: '4', image: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E', imageAlt: 'A bar chart' });
  assert.equal(r.image.startsWith('data:image/svg+xml'), true);
  assert.equal(r.imageAlt, 'A bar chart');
});
