// Turns recorded question items into summaries for the child's review and the parent's report.
// item = { qid, topic, text, correct, skipped, readMs, workMs, totalMs, hints, edits, answer }

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarise(items) {
  const n = items.length;
  const correct = items.filter(i => i.correct).length;
  const base = {
    n,
    correct,
    accuracy: n ? correct / n : 0,
    avgReadMs: avg(items.map(i => i.readMs)),
    avgWorkMs: avg(items.map(i => i.workMs)),
    avgTotalMs: avg(items.map(i => i.totalMs)),
    hintsUsed: items.reduce((a, i) => a + (i.hints || 0), 0),
    hintedQuestions: items.filter(i => (i.hints || 0) > 0).length,
    avgEdits: avg(items.map(i => i.edits || 0)),
  };
  const topics = {};
  for (const i of items) (topics[i.topic] = topics[i.topic] || []).push(i);
  base.byTopic = Object.keys(topics).map(t => {
    const xs = topics[t];
    return {
      topic: t,
      n: xs.length,
      correct: xs.filter(i => i.correct).length,
      accuracy: xs.filter(i => i.correct).length / xs.length,
      avgReadMs: avg(xs.map(i => i.readMs)),
      avgWorkMs: avg(xs.map(i => i.workMs)),
      avgTotalMs: avg(xs.map(i => i.totalMs)),
      hints: xs.reduce((a, i) => a + (i.hints || 0), 0),
    };
  }).sort((a, b) => b.avgTotalMs - a.avgTotalMs);
  return base;
}

export function fmtSec(ms) {
  const s = ms / 1000;
  if (s < 10) return s.toFixed(1) + 's';
  if (s < 60) return Math.round(s) + 's';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + 'm ' + String(r).padStart(2, '0') + 's';
}

export function pct(x) {
  return Math.round(x * 100) + '%';
}

// Notes for the parent: what the timing split suggests. Needs enough questions to mean anything.
export function diagnose(s) {
  const notes = [];
  if (s.n < 5) return ['Not enough questions yet to see a pattern. Patterns become visible after a few sessions.'];
  const t = s.avgReadMs + s.avgWorkMs;
  if (t > 0) {
    const readShare = s.avgReadMs / t;
    if (readShare >= 0.5) notes.push('Reading takes ' + pct(readShare) + ' of the time before an answer. That points to understanding the question, so the simpler-wording hints may help.');
    else if (readShare <= 0.2) notes.push('Almost all the time goes on working it out (' + pct(1 - readShare) + '). That points to arithmetic fluency, so short repeated drills may help.');
    else notes.push('Most of the time goes on working it out (' + pct(1 - readShare) + '), with ' + pct(readShare) + ' on reading. Neither stands out as a problem on its own.');
  }
  if (s.avgEdits >= 2) notes.push('She changes her answer a lot (about ' + s.avgEdits.toFixed(1) + ' deletions per question). This can mean guessing or doubting herself.');
  if (s.hintedQuestions / s.n >= 0.4) notes.push('Hints were used on ' + pct(s.hintedQuestions / s.n) + ' of questions.');
  const slow = s.byTopic.filter(x => x.n >= 2).slice(0, 2);
  if (slow.length) notes.push('Slowest topics: ' + slow.map(x => x.topic + ' (' + fmtSec(x.avgTotalMs) + ' each)').join(', ') + '.');
  const weak = s.byTopic.filter(x => x.n >= 2 && x.accuracy < 0.6).map(x => x.topic);
  if (weak.length) notes.push('Needs more practice: ' + weak.join(', ') + '.');
  return notes;
}

// Friendly lines for the child at the end of a session. Compares her only with her own previous session.
export function childTips(s, prev) {
  const tips = [];
  if (!s.n) return tips;
  if (prev && prev.n >= 3 && prev.avgTotalMs > 0 && s.avgTotalMs > 0) {
    const change = (prev.avgTotalMs - s.avgTotalMs) / prev.avgTotalMs;
    if (change >= 0.1) tips.push('You were ' + pct(change) + ' quicker per question than last time. Brilliant pacing!');
    else if (change <= -0.1 && s.accuracy >= prev.accuracy) tips.push('You took a little longer than last time, but you got just as many right. Careful thinking counts.');
  }
  const fast = s.byTopic.filter(x => x.n >= 1 && x.accuracy > 0).slice().sort((a, b) => a.avgTotalMs - b.avgTotalMs)[0];
  if (fast && s.byTopic.length > 1 && s.accuracy >= 0.5) tips.push('Fastest on ' + fast.topic + '.');
  const tricky = s.byTopic.filter(x => x.n >= 1 && x.accuracy < 1).sort((a, b) => a.accuracy - b.accuracy)[0];
  if (tricky) tips.push('Worth another go: ' + tricky.topic + '.');
  const t = s.avgReadMs + s.avgWorkMs;
  if (t > 0 && s.avgReadMs / t >= 0.5) tips.push('Try this: read the question twice and underline the numbers before you start.');
  return tips.slice(0, 3);
}

export function stars(accuracy) {
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.7) return 2;
  if (accuracy >= 0.4) return 1;
  return 0;
}
