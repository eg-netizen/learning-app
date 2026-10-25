import test from 'node:test';
import assert from 'node:assert/strict';
import { numEq, parseNum, parseTime, timeEq, dateMatches, normOp, markQuestion, markField, bagOfTokens } from '../src/marking.js';

test('numbers are compared by value, not text', () => {
  assert.ok(numEq('15', '15.0'));
  assert.ok(numEq('15.00', '15'));
  assert.ok(numEq('1,000', '1000'));
  assert.ok(numEq('£1.50', '1.5'));
  assert.ok(numEq('0.75', '3/4'));
  assert.ok(!numEq('15', '16'));
  assert.ok(!numEq('', '0'));
  assert.equal(parseNum('abc'), null);
});

test('times accept the usual ways of writing them', () => {
  for (const t of ['4:15 pm', '4.15pm', '4:15 p.m.', '16:15', '4:15PM']) assert.ok(timeEq(t, '4:15 p.m.'), t);
  assert.ok(timeEq('8 a.m.', '8am'));
  assert.ok(timeEq('12 a.m.', '0:00'));
  assert.ok(timeEq('12 p.m.', '12:00'));
  assert.ok(!timeEq('4:15 a.m.', '4:15 p.m.'));
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime('hello'), null);
});

test('dates: day-month-year or month-day-year, any separator, 2- or 4-digit year', () => {
  const acc = { day: 21, month: 8, year: 2017, orders: ['dmy', 'mdy'] };
  for (const d of ['21/08/2017', '21/8/17', '21.8.2017', '8/21/2017', '08-21-17']) assert.ok(dateMatches(d, acc), d);
  for (const d of ['21/09/2017', '2017/08/21', '210817', '21/08', '21/08/2018', '']) assert.ok(!dateMatches(d, acc), d);
  assert.ok(!dateMatches('8/21/2017', { day: 21, month: 8, year: 2017, orders: ['dmy'] }));
});

test('operators are normalised', () => {
  assert.equal(normOp('-'), '−');
  assert.equal(normOp('x'), '×');
  assert.equal(normOp('/'), '÷');
});

test('"which two" answers ignore order and the word and', () => {
  assert.equal(bagOfTokens('3/5 and 6/10'), bagOfTokens('6/10, 3/5'));
  assert.ok(markField({ kind: 'text', answer: '3/5 and 6/10', bag: true }, '6/10 3/5'));
  assert.ok(!markField({ kind: 'text', answer: '3/5 and 6/10', bag: true }, '3/5'));
});

test('multi-field questions need every field right', () => {
  const q = { fields: [{ kind: 'num', answer: '9' }, { kind: 'num', answer: '1', label: 'r' }] };
  assert.deepEqual(markQuestion(q, ['9', '1']), { correct: true, perField: [true, true] });
  assert.deepEqual(markQuestion(q, ['9', '2']), { correct: false, perField: [true, false] });
  assert.equal(markQuestion(q, ['9', '']).correct, false);
});

test('list questions can be answered in any order but not with repeats', () => {
  const q = { orderFree: true, fields: [6, 12, 18, 24].map(n => ({ kind: 'num', answer: String(n) })) };
  assert.equal(markQuestion(q, ['24', '6', '18', '12']).correct, true);
  assert.equal(markQuestion(q, ['6', '6', '18', '12']).correct, false);
  assert.equal(markQuestion(q, ['6', '12', '18', '']).correct, false);
});

test('empty answers are never correct', () => {
  assert.equal(markField({ kind: 'num', answer: '0' }, ''), false);
  assert.equal(markField({ kind: 'text', answer: 'XL' }, '  '), false);
});
