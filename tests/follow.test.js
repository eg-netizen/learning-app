import test from 'node:test';
import assert from 'node:assert/strict';
import { followAnswer, followMatches } from '../src/follow.js';

const dbl = { op: 'affine', mul: 2, add: 1 };
const mins = { op: 'minutesTo', time: '6:25 p.m.' };

test('double the earlier answer and add 1, using what she actually wrote', () => {
  assert.equal(followAnswer(dbl, ['11']), '23');
  assert.equal(followAnswer(dbl, ['10']), '21');
  assert.equal(followAnswer(dbl, ['']), null);
  assert.equal(followMatches(dbl, ['10'], ['21']), true);
  assert.equal(followMatches(dbl, ['10'], ['23']), false);
});

test('minutes from the time she wrote to 6.25 p.m.', () => {
  assert.equal(followAnswer(mins, ['6.00 p.m.']), '25');
  assert.equal(followAnswer(mins, ['6:10 p.m.']), '15');
  assert.equal(followAnswer(mins, ['7:00 p.m.']), null); // later than 6.25: nothing sensible to carry
  assert.equal(followMatches(mins, ['6:10 p.m.'], ['15']), true);
  assert.equal(followMatches(mins, ['6:10 p.m.'], ['16']), false);
});
