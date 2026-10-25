// Marking that carries a slip forward. When a question is built on her own answer to an earlier one
// (for example "double the answer to 9 and add 1"), an answer that is right for what she wrote earlier
// is accepted, and flagged so she and the parent can see it.
import { parseNum, parseTime, numEq } from './marking.js';

// What the answer would be, given her answer to the earlier question. null = cannot work it out.
export function followAnswer(follow, prevValues) {
  if (!follow || !prevValues || !prevValues.length) return null;
  const v = prevValues[0];
  if (follow.op === 'affine') {
    const n = parseNum(v);
    return n === null ? null : String(n * follow.mul + follow.add);
  }
  if (follow.op === 'minutesTo') {
    const from = parseTime(v);
    const to = parseTime(follow.time);
    if (from === null || to === null || to <= from) return null;
    return String(to - from);
  }
  return null;
}

// True when her (single-number) answer matches the carried-forward answer.
export function followMatches(follow, prevValues, values) {
  const want = followAnswer(follow, prevValues);
  return want !== null && values.length === 1 && numEq(values[0], want);
}
