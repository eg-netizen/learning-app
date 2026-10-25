import test from 'node:test';
import assert from 'node:assert/strict';
import { summarise, diagnose, childTips, fmtSec, stars } from '../src/report.js';

const item = (topic, correct, readMs, workMs, extra = {}) =>
  Object.assign({ qid: topic + readMs, topic, correct, readMs, workMs, totalMs: readMs + workMs, hints: 0, edits: 0 }, extra);

test('summary splits reading from working time and groups by topic', () => {
  const s = summarise([item('fractions', true, 4000, 2000), item('fractions', false, 6000, 4000), item('money', true, 1000, 1000)]);
  assert.equal(s.n, 3);
  assert.equal(s.correct, 2);
  assert.equal(Math.round(s.avgReadMs), 3667);
  assert.equal(s.byTopic[0].topic, 'fractions'); // slowest first
  assert.equal(s.byTopic[0].avgTotalMs, 8000);
});

test('diagnosis points to reading when reading dominates', () => {
  const items = Array.from({ length: 6 }, () => item('worded', true, 9000, 3000));
  const text = diagnose(summarise(items)).join(' ');
  assert.match(text, /understanding the question/);
});

test('diagnosis points to fluency when working dominates', () => {
  const items = Array.from({ length: 6 }, () => item('sums', true, 1000, 9000));
  assert.match(diagnose(summarise(items)).join(' '), /fluency/);
});

test('too few questions gives no verdict', () => {
  assert.match(diagnose(summarise([item('x', true, 1, 1)]))[0], /Not enough/);
});

test('child tips compare only with her own previous session', () => {
  const prev = summarise([item('a', true, 6000, 4000), item('a', true, 6000, 4000), item('b', true, 6000, 4000)]);
  const now = summarise([item('a', true, 3000, 2000), item('a', true, 3000, 2000), item('b', true, 3000, 2000)]);
  assert.match(childTips(now, prev).join(' '), /quicker/);
  assert.ok(!/slower|longer/.test(childTips(prev, now).join(' ')) || /just as many right/.test(childTips(prev, now).join(' ')));
});

test('formatting and stars', () => {
  assert.equal(fmtSec(4200), '4.2s');
  assert.equal(fmtSec(75000), '1m 15s');
  assert.equal(stars(0.95), 3);
  assert.equal(stars(0.5), 1);
  assert.equal(stars(0.1), 0);
});

test('a mixed split is described honestly, not as even', () => {
  const items = Array.from({ length: 6 }, () => item('mixed', true, 3000, 9000));
  const text = diagnose(summarise(items)).join(' ');
  assert.match(text, /Most of the time goes on working/);
  assert.ok(!/evenly/.test(text));
});

test('no speed praise when nothing was right', () => {
  const s = summarise([item('a', false, 1000, 1000), item('b', false, 2000, 2000)]);
  assert.ok(!/Fastest/.test(childTips(s, null).join(' ')));
});
