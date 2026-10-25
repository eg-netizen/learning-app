// Round-trip check for a question bank file: every question's own answer must mark as correct,
// and nothing should fall back to a plain text field unexpectedly.
// Usage: node tools/selfcheck.mjs path/to/bank.json
import { readFileSync } from 'node:fs';
import { validateBank } from '../src/bank.js';
import { markQuestion } from '../src/marking.js';

const path = process.argv[2];
if (!path) { console.error('Usage: node tools/selfcheck.mjs path/to/bank.json'); process.exit(2); }

const raw = JSON.parse(readFileSync(path, 'utf8'));
const { questions, skipped } = validateBank(raw);
let bad = 0;
const textFallbacks = [];
for (const q of questions) {
  const values = q.fields.map(f => f.answer);
  const r = markQuestion(q, values);
  if (!r.correct) { bad++; console.log('FAILS own answer:', q.id, JSON.stringify(q.fields)); }
  if (q.fields.length === 1 && q.fields[0].kind === 'text') textFallbacks.push(q.id);
}
console.log(`questions: ${questions.length}, skipped: ${skipped.length}${skipped.length ? ' (' + skipped.join(', ') + ')' : ''}`);
console.log(`own-answer failures: ${bad}`);
console.log(`single text-field questions (check these are meant to be text): ${textFallbacks.join(', ') || 'none'}`);
process.exit(bad ? 1 : 0);
