import { followMatches } from './follow.js';
import { BUILD } from './version.js';
import { validateBank, subjectsIn, subjectOf, setsIn, setQuestions, pickRandom } from './bank.js';
import { markQuestion, answerText } from './marking.js';
import { summarise, diagnose, childTips, fmtSec, pct, stars } from './report.js';
import { load, save, uid, hashPin, shuffle, COLORS } from './store.js';

const root = document.getElementById('app');
let D = load();
const S = {
  screen: 'profiles',
  profileId: null,
  run: null,
  cfg: { count: 10, bankId: null, subject: '', setKey: '', sec: '', picked: false, how: 'random' },
  parent: { ok: false, tab: 'results', profileId: null, openSession: null },
  notice: '',
  error: '',
};

const PRAISE = ['Nice one!', 'Spot on!', 'Brilliant!', 'Great thinking!', 'Yes!', 'Well done!', 'Correct!'];
const SOFT = ['Not quite.', 'Close, keep going.', 'Good try.', 'Nearly there.'];

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// The chosen bank, else the most recently imported one, else the built-in sample.
const currentBank = () => D.banks.find(b => b.id === S.cfg.bankId) || [...D.banks].reverse().find(b => !b.builtIn) || D.banks[0];
const profile = () => D.profiles.find(p => p.id === S.profileId);
const persist = () => { if (!save(D)) S.error = 'Could not save: this browser is out of storage space.'; };

/* ---------------------------------------------------------------- sample bank */

async function ensureSampleBank() {
  try {
    const res = await fetch('data/sample-bank.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('not found');
    const { questions } = validateBank(await res.json());
    const existing = D.banks.find(b => b.id === 'sample');
    if (existing) existing.questions = questions;
    else D.banks.unshift({ id: 'sample', name: 'Sample questions', builtIn: true, questions });
    persist();
  } catch (e) { /* offline: keep whatever is stored */ }
}

/* ---------------------------------------------------------------- running a session */

function timerVisible() {
  const p = profile();
  return S.run && (S.run.mode === 'test' || (p && p.showTimer));
}

function startRun(mode) {
  if ((D.paused || {})[S.profileId] && !confirm('You have a saved session. Starting a new one will throw the saved one away. Start new?')) return;
  clearProgress(S.profileId);
  const bank = currentBank();
  if (!bank) { S.error = 'There are no questions yet. Ask a parent to add a question bank.'; render(); return; }
  const subjects = subjectsIn(bank.questions).map(x => x.name);
  const subject = subjects.includes(S.cfg.subject) ? S.cfg.subject : '';
  const set = S.cfg.setKey ? setsIn(bank.questions).find(x => x.key === S.cfg.setKey) : null;
  let pool = subject ? bank.questions.filter(q => subjectOf(q) === subject) : bank.questions;
  let qs; let label = bank.name + (subject ? ' · ' + subject : '');
  if (set) {
    // Booklet order: the whole set, or one section of it, exactly as printed.
    const sec = set.sections.some(x => x.name === S.cfg.sec) ? S.cfg.sec : '';
    qs = setQuestions(bank.questions, set.key, sec);
    label = bank.name + ' · ' + set.bookTitle + ' · ' + set.title + (sec ? ' · Section ' + sec : '');
  } else {
    qs = pickRandom(pool, Math.min(S.cfg.count, pool.length), bank.questions, shuffle);
  }
  S.run = { mode, bankId: bank.id, bankName: label, setKey: set ? set.key : '', qs, idx: 0, items: [], streak: 0, best: 0, startedAt: Date.now(), q: null, session: null };
  beginQuestion();
  S.screen = 'question';
  S.error = '';
  render();
}

/* Save and resume: one saved run per player. The question being answered restarts when she comes back. */
function saveProgress() {
  const r = S.run;
  if (!r || !r.items.length || r.idx >= r.qs.length) return;
  D.paused = D.paused || {};
  D.paused[S.profileId] = { mode: r.mode, bankId: r.bankId, bankName: r.bankName, setKey: r.setKey || '', qids: r.qs.map(q => q.id), idx: r.items.length, items: r.items, streak: r.streak, best: r.best, startedAt: r.startedAt, savedAt: Date.now() };
  persist();
}

function clearProgress(profileId) {
  if (D.paused && D.paused[profileId]) { delete D.paused[profileId]; persist(); }
}

function resumeRun() {
  const pz = (D.paused || {})[S.profileId];
  const bank = pz && D.banks.find(b => b.id === pz.bankId);
  const byId = bank ? new Map(bank.questions.map(q => [q.id, q])) : null;
  const qs = pz && byId ? pz.qids.map(id => byId.get(id)) : [];
  if (!pz || !qs.length || qs.some(q => !q)) {
    clearProgress(S.profileId);
    S.error = 'That saved session can no longer be opened because its questions have changed. Please start again.';
    render(); return;
  }
  S.run = { mode: pz.mode, bankId: pz.bankId, bankName: pz.bankName, setKey: pz.setKey, qs, idx: pz.idx, items: pz.items, streak: pz.streak, best: pz.best, startedAt: pz.startedAt, q: null, session: null };
  beginQuestion();
  S.screen = 'question'; S.error = '';
  render();
}

function beginQuestion() {
  const Q = S.run.qs[S.run.idx];
  S.run.q = {
    shownAt: performance.now(), firstAt: null, paused: 0, pausedAtFirst: 0, hiddenAt: null,
    hintsShown: 0, edits: 0, values: Q.fields.map(() => ''), active: 0, feedback: null,
  };
}

// The first tap on a key, a field or a hint ends "reading" and starts "working".
function touch() {
  const q = S.run.q;
  if (q.firstAt === null) { q.firstAt = performance.now(); q.pausedAtFirst = q.paused; }
}

function pressKey(k) {
  const r = S.run; const q = r.q;
  if (q.feedback) return;
  const Q = r.qs[r.idx];
  touch();
  let v = q.values[q.active];
  if (k === 'next') { q.active = (q.active + 1) % Q.fields.length; render(); return; }
  if (k === 'back') { if (v) q.edits++; v = /\s[ap]\.m\.$/.test(v) ? v.replace(/\s[ap]\.m\.$/, '') : v.slice(0, -1); }
  else if (k === 'clear') { if (v) q.edits++; v = ''; }
  else if (k === 'am' || k === 'pm') v = v.replace(/\s[ap]\.m\.$/, '') + (k === 'am' ? ' a.m.' : ' p.m.');
  else if (k === 'space') v += ' ';
  else if (v.length < 16) v += k;
  q.values[q.active] = v;
  render();
}

function pickValue(v) {
  const q = S.run.q;
  if (q.feedback) return;
  touch();
  if (q.values[q.active] && q.values[q.active] !== v) q.edits++;
  q.values[q.active] = v;
  render();
}

function submit(skip) {
  const r = S.run; const q = r.q; const Q = r.qs[r.idx];
  if (q.feedback) return;
  const t = performance.now();
  const total = t - q.shownAt - q.paused;
  let readMs; let workMs;
  if (q.firstAt === null) { readMs = total; workMs = 0; }
  else { readMs = q.firstAt - q.shownAt - q.pausedAtFirst; workMs = t - q.firstAt - (q.paused - q.pausedAtFirst); }
  let res = skip ? { correct: false, perField: q.values.map(() => false) } : markQuestion(Q, q.values);
  // Built on her own earlier answer? Accept what is right for it, and flag it.
  let followed = null;
  if (!skip && !res.correct && Q.after && Q.follow) {
    const prev = r.items.find(i => i.qid === Q.after && !i.skipped && !i.correct);
    const prevQ = prev && D.banks.find(b => b.id === r.bankId).questions.find(x => x.id === Q.after);
    if (prev && followMatches(Q.follow, prev.answer, q.values)) {
      followed = { fromId: Q.after, fromNum: String(Q.after).split('-').pop(), her: prevQ.fields.map((f, k) => (f.prefix || '') + (prev.answer[k] || '') + (f.suffix ? ' ' + f.suffix : '')).join(', ').trim(), book: answerText(prevQ) };
      res = { correct: true, perField: q.values.map(() => true) };
    }
  }
  const item = {
    qid: Q.id, ref: Q.ref || '', topic: Q.topic, text: Q.text, correct: res.correct, skipped: !!skip,
    readMs: Math.max(0, Math.round(readMs)), workMs: Math.max(0, Math.round(workMs)), totalMs: Math.max(0, Math.round(total)),
    hints: q.hintsShown, edits: q.edits, answer: q.values.slice(), expected: answerText(Q),
  };
  if (followed) item.followed = followed;
  r.items.push(item);
  if (res.correct) { r.streak++; r.best = Math.max(r.best, r.streak); } else r.streak = 0;
  if (r.mode === 'practice') { q.feedback = { res, praise: res.correct ? pick(PRAISE) : pick(SOFT), followed }; render(); }
  else advance();
}

function advance() {
  const r = S.run;
  r.idx++;
  if (r.idx >= r.qs.length) finishRun();
  else { saveProgress(); beginQuestion(); render(); }
}

function finishRun() {
  const r = S.run;
  const prior = D.sessions.filter(s => s.profileId === S.profileId && s.mode === r.mode).slice(-1)[0];
  const session = {
    id: uid(), profileId: S.profileId, mode: r.mode, bankId: r.bankId, bankName: r.bankName, setKey: r.setKey || '',
    startedAt: r.startedAt, endedAt: Date.now(), items: r.items,
  };
  D.sessions.push(session);
  if (D.paused) delete D.paused[S.profileId];
  persist();
  r.session = session;
  r.prevSummary = prior ? summarise(prior.items) : null;
  S.screen = 'results';
  render();
}

document.addEventListener('visibilitychange', () => {
  if (S.screen !== 'question' || !S.run || !S.run.q) return;
  const q = S.run.q;
  if (document.hidden) q.hiddenAt = performance.now();
  else if (q.hiddenAt !== null) { q.paused += performance.now() - q.hiddenAt; q.hiddenAt = null; }
});

/* ---------------------------------------------------------------- screens */

const header = (title) => `<header class="top"><h1>${esc(title)}</h1></header>`;

function screenProfiles() {
  if (!D.profiles.length) {
    return `${header('Welcome')}
    <main class="card narrow">
      <p>Who will be playing first? You can add more players later in the parent area.</p>
      <form data-form="addProfile">
        <label>Name <input name="name" maxlength="20" required autocomplete="off"></label>
        ${colorPicker()}
        <button class="btn primary big" type="submit">Let's go</button>
      </form>
    </main>
    ${footerParent()}`;
  }
  return `${header("Who's playing?")}
  <main class="grid">
    ${D.profiles.map(p => `<button class="who" style="--accent:${p.color}" data-a="chooseProfile" data-id="${p.id}"><span class="avatar">${esc(p.name.charAt(0).toUpperCase())}</span>${esc(p.name)}</button>`).join('')}
    ${S.addingPlayer ? '' : `<button class="who add" data-a="showAddPlayer"><span class="avatar">+</span>Add player</button>`}
  </main>
  ${S.addingPlayer ? `<section class="card narrow"><h2>New player</h2>
    <form data-form="addProfile">
      <label>Name <input name="name" maxlength="20" required autocomplete="off" autofocus></label>
      ${colorPicker()}
      <button class="btn primary big" type="submit">Add player</button>
      <button class="btn" type="button" data-a="hideAddPlayer">Cancel</button>
    </form></section>` : ''}
  ${footerParent()}`;
}

function versionLine() {
  if (!BUILD.time) return 'Local copy, not deployed';
  const when = new Date(BUILD.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return 'Updated ' + when + ' · build ' + BUILD.commit;
}

function footerParent() { return `<footer class="foot"><button class="link" data-a="openParent">Parent area</button><div class="version">${esc(versionLine())}</div></footer>`; }

function colorPicker(selected) {
  return `<fieldset class="colors"><legend>Colour</legend>${COLORS.map((c, i) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${(selected ? selected === c : i === 0) ? 'checked' : ''}><span></span></label>`).join('')}</fieldset>`;
}

const SUBJECT_ICON = { 'Mental Arithmetic': '🧮', 'Problem Solving': '🧩' };

function screenHome() {
  const p = profile();
  const mine = D.sessions.filter(s => s.profileId === p.id);
  const totalStars = mine.reduce((a, s) => a + stars(summarise(s.items).accuracy), 0);
  const bank = currentBank();
  if (bank) S.cfg.bankId = bank.id;
  const subjects = bank ? subjectsIn(bank.questions) : [];
  const allSets = bank ? setsIn(bank.questions) : [];
  // With no subjects in the bank there is nothing to choose first, so go straight to step 2.
  const picked = S.cfg.picked || !subjects.length;
  if (!subjects.some(x => x.name === S.cfg.subject)) S.cfg.subject = '';
  const sets = allSets.filter(x => !S.cfg.subject || x.subject === S.cfg.subject);
  if (S.cfg.how === 'booklet' && !sets.length) S.cfg.how = 'random';
  if (S.cfg.how !== 'booklet') { S.cfg.setKey = ''; S.cfg.sec = ''; }
  if (!sets.some(x => x.key === S.cfg.setKey)) { S.cfg.setKey = ''; S.cfg.sec = ''; }
  const pz = (D.paused || {})[S.profileId];
  const resumeCard = pz ? `<div class="resume"><div><b>Carry on where you left off</b>
      <small>${esc(pz.bankName.split(' · ').slice(-2).join(' · '))} · question ${pz.idx + 1} of ${pz.qids.length}</small>
      <button class="link danger" data-a="discardPaused">Throw it away</button></div>
      <button class="btn primary" data-a="resume">Continue</button></div>` : '';

  const badgeFor = (set) => {
    if (pz && bank && pz.bankId === bank.id && pz.setKey === set.key) return `<span class="hbadge p">${pz.idx} of ${pz.qids.length} done</span>`;
    const l = mine.filter(s => s.setKey === set.key && s.bankId === bank.id && s.items.length === set.n).slice(-1)[0];
    if (l) { const ls = summarise(l.items); return `<span class="hbadge ok">last ${ls.correct}/${ls.n}</span>`; }
    return '<span class="hbadge n">not started</span>';
  };

  let top; let body; let summary; let ready = false;
  const countOpts = [5, 10, 15, 20].map(n => `<option ${n === S.cfg.count ? 'selected' : ''}>${n}</option>`).join('');
  const subjectLabel = S.cfg.subject || 'Everything';
  const set = sets.find(x => x.key === S.cfg.setKey);
  const pool = bank ? (S.cfg.subject ? bank.questions.filter(q => subjectOf(q) === S.cfg.subject) : bank.questions) : [];

  if (!picked) {
    top = `<button class="link" data-a="switchPlayer">‹ Switch player</button><h1>Hi ${esc(p.name)}!</h1><span class="stars">⭐ ${totalStars}</span>`;
    body = `${resumeCard}<h3>What shall we practise?</h3>
      <div class="htiles">
        ${subjects.map(x => `<button class="htile" data-a="pickSubject" data-s="${esc(x.name)}"><span class="ic">${SUBJECT_ICON[x.name] || '📚'}</span><b>${esc(x.name)}</b><small>${x.n} questions</small></button>`).join('')}
        <button class="htile wide" data-a="pickSubject" data-s=""><span class="ic">🎲</span><span class="wtext"><b>A bit of everything</b><small>${bank ? bank.questions.length : 0} questions</small></span></button>
      </div>
      ${D.banks.length > 1 ? `<label class="bankpick">Questions from <select data-change="bank">${D.banks.map(b => `<option value="${b.id}" ${b.id === S.cfg.bankId ? 'selected' : ''}>${esc(b.name)} (${b.questions.length})</option>`).join('')}</select></label>` : ''}`;
    summary = 'Pick something to start';
  } else {
    top = `${subjects.length ? '<button class="link" data-a="backHome">‹ Back</button>' : '<button class="link" data-a="switchPlayer">‹ Switch player</button>'}<h1>${esc(subjects.length ? subjectLabel : 'Hi ' + p.name + '!')}</h1><span class="stars">⭐ ${totalStars}</span>`;
    const booklet = S.cfg.how === 'booklet';
    body = `${subjects.length ? '' : resumeCard}<h3>How?</h3>
      <div class="hopt ${!booklet ? 'on' : ''}" ${booklet ? 'data-a="pickHow" data-how="random" role="button" tabindex="0"' : ''}><div><b>🎲 Random mix</b><small>questions picked from the bank</small></div>
        ${booklet ? '<span>›</span>' : `<select class="hsel" data-change="count" aria-label="How many questions">${countOpts}</select>`}</div>
      ${sets.length ? `<button class="hopt ${booklet ? 'on' : ''}" data-a="pickHow" data-how="booklet"><div><b>📖 Booklet tests, in order</b><small>just like the book</small></div><span>${booklet ? '▾' : '›'}</span></button>` : ''}
      ${booklet ? `<h3>${S.cfg.subject ? 'Your booklet tests' : 'Booklet tests'}</h3>
        ${sets.map(x => { const on = S.cfg.setKey === x.key;
          return `<button class="hopt ${on ? 'on' : ''}" data-a="pickSet" data-key="${esc(x.key)}" data-sec=""><div><b>${S.cfg.subject ? '' : esc(x.bookTitle) + ' · '}${esc(x.title)}</b><small>${x.page ? 'page ' + x.page + ' · ' : ''}${x.n} questions</small></div>${badgeFor(x)}</button>
          ${on && x.sections.length > 1 ? `<div class="chips"><button class="chip ${S.cfg.sec === '' ? 'on' : ''}" data-a="pickSet" data-key="${esc(x.key)}" data-sec="">Whole test</button>${x.sections.map(sc => `<button class="chip ${S.cfg.sec === sc.name ? 'on' : ''}" data-a="pickSet" data-key="${esc(x.key)}" data-sec="${esc(sc.name)}">${esc(sc.name)}</button>`).join('')}</div>` : ''}`; }).join('')}` : ''}`;
    if (booklet) {
      if (set) {
        const n = S.cfg.sec ? (set.sections.find(x => x.name === S.cfg.sec) || { n: set.n }).n : set.n;
        summary = `<b>${esc(set.title)}${S.cfg.sec ? ' · Section ' + esc(S.cfg.sec) : ''}</b> · ${n} questions, in order`; ready = true;
      } else summary = 'Pick a test';
    } else {
      summary = `<b>${esc(subjectLabel)}</b> · random mix · ${Math.min(S.cfg.count, pool.length)} questions`; ready = pool.length > 0;
    }
  }
  return `<header class="top">${top}</header>
  <main class="homebody">${body}${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}</main>
  <div class="startbar"><div class="sum">${summary}</div>
    <div class="btns"><button class="hbtn ${ready ? 'p' : ''}" data-a="start" data-mode="practice" ${ready ? '' : 'disabled'}>🌱 Practice<small>hints and feedback</small></button>
      <button class="hbtn" data-a="start" data-mode="test" ${ready ? '' : 'disabled'}>⏱ Test<small>timed, no hints</small></button></div>
    <div class="homefoot"><button class="link" data-a="openParent">Parent area</button><span class="version">${esc(versionLine())}</span></div></div>`;
}

function fieldHTML(Q, q, i) {
  const f = Q.fields[i];
  const fb = q.feedback;
  const state = fb ? (fb.res.perField[i] ? 'ok' : 'bad') : '';
  const val = q.values[i];
  const shown = val === '' ? '' : esc(val);
  return `${f.label ? `<span class="lab">${esc(f.label)}</span>` : ''}${f.prefix ? `<span class="aff">${esc(f.prefix)}</span>` : ''}<button class="field ${i === q.active && !fb ? 'active' : ''} ${state}" data-a="focus" data-i="${i}" aria-label="answer box ${i + 1}"><span class="val">${shown}</span></button>${f.suffix ? `<span class="aff">${esc(f.suffix)}</span>` : ''}`;
}

const key = (k, label, cls = '') => `<button class="key ${cls}" data-a="key" data-k="${esc(k)}">${label}</button>`;

function padHTML(Q, q) {
  const f = Q.fields[q.active];
  const many = Q.fields.length > 1;
  if (f.kind === 'choice') {
    return `<div class="opts">${f.options.map(o => `<button class="optbtn ${q.values[q.active] === o ? 'sel' : ''}" data-a="pickval" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  }
  if (f.kind === 'op') {
    return `<div class="opts ops">${['+', '−', '×', '÷'].map(o => `<button class="optbtn ${q.values[q.active] === o ? 'sel' : ''}" data-a="pickval" data-v="${o}">${o}</button>`).join('')}</div>${many ? `<div class="opts"><button class="optbtn" data-a="key" data-k="next">Next symbol ▶</button></div>` : ''}`;
  }
  if (f.kind === 'text') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => key(c, c)).join('');
    const digits = '1234567890'.split('').map(c => key(c, c, 'sm')).join('');
    return `<div class="pad text"><div class="row10">${digits}</div><div class="row7">${letters}</div><div class="row3">${key('/', '/')}${key('space', 'space')}${key('back', '⌫', 'fn')}</div>${many ? `<div class="row3">${key('next', 'Next box ▶', 'fn')}</div>` : ''}</div>`;
  }
  if (f.kind === 'time') {
    return `<div class="pad">${[7, 8, 9].map(n => key(n, n)).join('')}${key('back', '⌫', 'fn')}${[4, 5, 6].map(n => key(n, n)).join('')}${key(':', ':')}${[1, 2, 3].map(n => key(n, n)).join('')}${key('.', '.')}${key(0, 0)}${key('am', 'a.m.', 'fn')}${key('pm', 'p.m.', 'fn')}${key('clear', 'C', 'fn')}</div>`;
  }
  // numbers and dates
  return `<div class="pad">${[7, 8, 9].map(n => key(n, n)).join('')}${key('back', '⌫', 'fn')}${[4, 5, 6].map(n => key(n, n)).join('')}${key('/', '/')}${[1, 2, 3].map(n => key(n, n)).join('')}${key('.', '.')}${key(0, 0, 'span2')}${many ? key('next', 'Next box ▶', 'fn span2') : key('clear', 'Clear', 'fn span2')}</div>`;
}

// A reminder for a question that builds on an earlier one: her own answer to it if she gave one this run,
// otherwise the book's answer (for example when she skipped it).
function contextNote(Q) {
  if (Q.context) return Q.context;
  if (!Q.after) return '';
  const bank = D.banks.find(b => b.id === S.run.bankId);
  const prev = bank && bank.questions.find(x => x.id === Q.after);
  if (!prev) return '';
  const num = String(prev.id).split('-').pop();
  const done = S.run.items.find(i => i.qid === prev.id && !i.skipped);
  const mine = done ? prev.fields.map((f, k) => (f.prefix || '') + (done.answer[k] || '') + (f.suffix ? ' ' + f.suffix : '')).join(', ').trim() : '';
  const text = mine || answerText(prev);
  return (mine ? 'Your answer to question ' : 'The answer to question ') + num + (mine ? ' was ' : ' is ') + text + (text.endsWith('.') ? '' : '.');
}

function screenQuestion() {
  const r = S.run; const q = r.q; const Q = r.qs[r.idx]; const p = profile();
  const fb = q.feedback;
  const hints = Q.hints || [];
  const showClock = timerVisible();
  const progress = Math.round((r.idx / r.qs.length) * 100);
  const hasAny = q.values.some(v => v !== '');
  return `<header class="qhead">
    <button class="link" data-a="quit" aria-label="Quit">✕</button>
    <div class="prog"><div class="bar"><i style="width:${progress}%"></i></div><span>${r.idx + 1} / ${r.qs.length}</span></div>
    <div class="right">${r.streak >= 2 ? `<span class="streak">🔥 ${r.streak}</span>` : ''}
      ${r.mode === 'practice' && p.childCanToggleTimer !== false ? `<button class="link clock ${p.showTimer ? 'on' : ''}" data-a="toggleTimer" aria-label="Show or hide the timer">🕐</button>` : ''}
      ${showClock ? `<span class="timer" id="timer">0.0s</span>` : ''}</div>
  </header>
  <main class="qbody">
    ${Q.ref ? `<p class="ref">${esc(Q.ref)}</p>` : ''}
    <p class="qtext">${esc(Q.text)}</p>
    ${contextNote(Q) ? `<p class="context">${esc(contextNote(Q))}</p>` : ''}
    ${Q.image ? `<img class="qimg" alt="${esc(Q.imageAlt || '')}" src="${esc(Q.image)}">` : ''}
    <div class="answer">${Q.fields.map((_, i) => fieldHTML(Q, q, i)).join('')}</div>
    ${fb ? `<div class="feedback ${fb.res.correct ? 'good' : 'oops'}"><strong>${esc(fb.praise)}</strong>${fb.res.correct ? '' : `<div>The answer is <b>${esc(answerText(Q))}</b></div>`}${fb.followed ? `<div>That is right for your answer to question ${esc(fb.followed.fromNum)} (${esc(fb.followed.her)}), but that one should be ${esc(fb.followed.book)}. Check it again.</div>` : ''}</div>` : ''}
    ${q.hintsShown ? `<div class="hints">${hints.slice(0, q.hintsShown).map((h, i) => `<div class="hint"><b>Hint ${i + 1}</b> ${esc(h)}</div>`).join('')}</div>` : ''}
    ${fb ? '' : padHTML(Q, q)}
  </main>
  <footer class="qfoot">
    ${fb ? `<button class="btn primary big" data-a="next">${r.idx + 1 >= r.qs.length ? 'See results' : 'Next'}</button>` : `
      ${r.mode === 'practice' ? `<button class="btn" data-a="hint" ${q.hintsShown >= hints.length ? 'disabled' : ''}>💡 ${!hints.length ? 'No hint for this one' : q.hintsShown >= hints.length ? 'No more hints' : 'Hint ' + (q.hintsShown + 1) + ' of ' + hints.length}</button>` : ''}
      <button class="btn primary" data-a="check" ${hasAny ? '' : 'disabled'}>${r.mode === 'test' ? (r.idx + 1 >= r.qs.length ? 'Finish' : 'Next') : 'Check'}</button>
      ${r.mode === 'test' ? `<button class="link" data-a="skip">Skip</button>` : ''}`}
  </footer>`;
}

function screenResults() {
  const r = S.run; const s = summarise(r.items); const p = profile();
  const tips = childTips(s, r.prevSummary);
  const wrong = r.items.filter(i => !i.correct);
  const carried = r.items.filter(i => i.followed);
  const st = stars(s.accuracy);
  return `<header class="top"><h1>${r.mode === 'test' ? 'Test finished' : 'Nice work'}, ${esc(p.name)}!</h1></header>
  <main class="card narrow center">
    <div class="starsbig">${'⭐'.repeat(st)}${'☆'.repeat(3 - st)}</div>
    <p class="big">${s.correct} out of ${s.n} right</p>
    ${r.best >= 3 ? `<p>🔥 Best streak: ${r.best} in a row</p>` : ''}
    <p class="muted">Pace: about ${fmtSec(s.avgTotalMs)} a question</p>
    ${tips.length ? `<ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${carried.length ? `<div class="carried"><b>Marked using your earlier answer</b>${carried.map(c => `<div>${c.ref ? esc(c.ref.split(' · ').slice(2).join(' · ')) + ': ' : ''}right for your answer to question ${esc(c.followed.fromNum)} (${esc(c.followed.her)}). Question ${esc(c.followed.fromNum)} should have been <b>${esc(c.followed.book)}</b>, so have another look at it.</div>`).join('')}</div>` : ''}
    ${wrong.length ? `<details><summary>Look again at ${wrong.length} question${wrong.length > 1 ? 's' : ''}</summary>${wrong.map(w => `<div class="again">${w.ref ? `<div class="muted">${esc(w.ref)}</div>` : ''}<div>${esc(w.text)}</div><div class="muted">Answer: <b>${esc(w.expected)}</b></div></div>`).join('')}</details>` : ''}
    <button class="btn primary big" data-a="start" data-mode="${r.mode}">Go again</button>
    <button class="btn big" data-a="home">Back to start</button>
  </main>`;
}

/* ---------------------------------------------------------------- parent area */

function screenPin() {
  if (S.pinReset && D.pinHash) {
    return `${header('Forgot the PIN?')}
  <main class="card narrow">
    <p>You can choose a new PIN. Your players, results and questions are all kept.</p>
    <form data-form="pinReset">
      <label>Type the word RESET to continue <input name="word" autocomplete="off" autocapitalize="characters" required></label>
      ${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
      <button class="btn primary big" type="submit">Choose a new PIN</button>
    </form>
    <button class="link" data-a="cancelPinReset">‹ Back</button>
  </main>`;
  }
  const create = !D.pinHash;
  return `${header(create ? 'Create a parent PIN' : 'Parent area')}
  <main class="card narrow">
    <p>${create ? 'Choose a 4-digit PIN. It stops accidental changes to settings and results.' : 'Enter your PIN.'}</p>
    <form data-form="pin">
      <label>PIN <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required autocomplete="off"></label>
      ${create ? '<label>Repeat PIN <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" required autocomplete="off"></label>' : ''}
      ${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
      <button class="btn primary big" type="submit">${create ? 'Save PIN' : 'Open'}</button>
    </form>
    ${create ? '' : '<button class="link" data-a="forgotPin">Forgot the PIN?</button>'}
    <button class="link" data-a="leaveParent">‹ Back</button>
  </main>`;
}

function parentTabs() {
  const tabs = [['results', 'Results'], ['players', 'Players'], ['banks', 'Questions'], ['data', 'Data']];
  return `<nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.parent.tab === k ? 'on' : ''}" data-a="tab" data-tab="${k}">${l}</button>`).join('')}</nav>`;
}

function screenParent() {
  const t = S.parent.tab;
  const body = t === 'results' ? parentResults() : t === 'players' ? parentPlayers() : t === 'banks' ? parentBanks() : parentData();
  return `<header class="top"><button class="link" data-a="leaveParent">‹ Exit</button><h1>Parent area</h1><span></span></header>
  ${parentTabs()}
  <main class="pwrap">${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}${body}</main>`;
}

function parentResults() {
  if (!D.profiles.length) return '<p>No players yet.</p>';
  const pid = S.parent.profileId || D.profiles[0].id;
  const sessions = D.sessions.filter(s => s.profileId === pid);
  const all = [].concat(...sessions.map(s => s.items));
  const sum = summarise(all);
  const sel = `<label>Player <select data-change="resultsPlayer">${D.profiles.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  if (!sessions.length) return `${sel}<p>No sessions recorded yet for this player.</p>`;
  const notes = diagnose(sum);
  return `${sel}
  <div class="cards">
    <div class="stat"><b>${sessions.length}</b><span>sessions</span></div>
    <div class="stat"><b>${pct(sum.accuracy)}</b><span>correct</span></div>
    <div class="stat"><b>${fmtSec(sum.avgReadMs)}</b><span>avg reading</span></div>
    <div class="stat"><b>${fmtSec(sum.avgWorkMs)}</b><span>avg working</span></div>
  </div>
  <h2>What the timing suggests</h2>
  <ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
  <h2>By topic</h2>
  <div class="scroll"><table><thead><tr><th>Topic</th><th>Qs</th><th>Right</th><th>Read</th><th>Work</th><th>Hints</th></tr></thead><tbody>
  ${sum.byTopic.map(x => `<tr><td>${esc(x.topic)}</td><td>${x.n}</td><td>${pct(x.accuracy)}</td><td>${fmtSec(x.avgReadMs)}</td><td>${fmtSec(x.avgWorkMs)}</td><td>${x.hints}</td></tr>`).join('')}
  </tbody></table></div>
  <h2>Sessions</h2>
  ${sessions.slice().reverse().map(s => {
    const x = summarise(s.items);
    const open = S.parent.openSession === s.id;
    return `<div class="sess"><button class="sesshead" data-a="openSession" data-id="${s.id}"><span>${new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${s.mode}</span><span>${x.correct}/${x.n} · ${fmtSec(x.avgTotalMs)} each</span></button>
    ${open ? `<div class="scroll"><table><thead><tr><th>Question</th><th></th><th>Read</th><th>Work</th><th>Hints</th><th>Edits</th></tr></thead><tbody>${s.items.map(i => `<tr><td>${esc(i.text.slice(0, 48))}${i.text.length > 48 ? '…' : ''}${i.ref ? `<div class="muted">${esc(i.ref)}</div>` : ''}${i.followed ? `<div class="muted">* marked right for her answer to question ${esc(i.followed.fromNum)} (${esc(i.followed.her)}; the book answer is ${esc(i.followed.book)})</div>` : ''}</td><td>${i.correct ? '✓' : (i.skipped ? '–' : '✗')}${i.followed ? '*' : ''}</td><td>${fmtSec(i.readMs)}</td><td>${fmtSec(i.workMs)}</td><td>${i.hints}</td><td>${i.edits}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
  }).join('')}`;
}

function parentPlayers() {
  return `${D.profiles.map(p => `<div class="prow" style="--accent:${p.color}">
    <span class="avatar sm">${esc(p.name.charAt(0).toUpperCase())}</span><b>${esc(p.name)}</b>
    <label class="chk"><input type="checkbox" data-change="timerDefault" data-id="${p.id}" ${p.showTimer ? 'checked' : ''}> Show timer in practice by default</label>
    <label class="chk"><input type="checkbox" data-change="timerToggle" data-id="${p.id}" ${p.childCanToggleTimer !== false ? 'checked' : ''}> Child can switch the timer on or off</label>
    <button class="link danger" data-a="deleteProfile" data-id="${p.id}">Remove</button></div>`).join('')}
  <h2>Add a player</h2>
  <form data-form="addProfile"><label>Name <input name="name" maxlength="20" required autocomplete="off"></label>${colorPicker()}<button class="btn primary" type="submit">Add player</button></form>`;
}

function parentBanks() {
  return `<p>Question banks are JSON files from the content pipeline. They stay on this device and are not uploaded anywhere.</p>
  ${D.banks.map(b => `<div class="prow"><b>${esc(b.name)}</b><span class="muted">${b.questions.length} questions${b.builtIn ? ' · built in' : ''}</span>${b.builtIn ? '' : `<button class="link danger" data-a="deleteBank" data-id="${b.id}">Remove</button>`}</div>`).join('')}
  <h2>Import a question bank</h2>
  <input type="file" accept=".json,application/json" data-change="importBank">`;
}

function parentData() {
  return `<h2>Back up</h2>
  <p>Results live only in this browser. Export a copy to keep or move to another device.</p>
  <button class="btn" data-a="export">Export everything</button>
  <h2>Restore</h2>
  <input type="file" accept=".json,application/json" data-change="importBackup">
  <h2>Security</h2>
  <button class="btn" data-a="changePin">Change PIN</button>
  <h2>Reset</h2>
  <button class="btn danger" data-a="reset">Erase all data on this device</button>`;
}

/* ---------------------------------------------------------------- render + events */

const screens = { profiles: screenProfiles, home: screenHome, question: screenQuestion, results: screenResults, pin: screenPin, parent: screenParent };
let tick = null;

let lastView = '';
function render() {
  const p = profile();
  document.documentElement.style.setProperty('--accent', p ? p.color : COLORS[0]);
  // Keep her place on the page while she types, adds a hint or checks an answer; start at the top only on a new screen or question.
  const view = S.screen + '|' + (S.run && S.screen === 'question' ? S.run.idx : '');
  const keepY = view === lastView ? window.scrollY : 0;
  lastView = view;
  root.innerHTML = screens[S.screen]();
  if (S.screen === 'question' && S.run && timerVisible()) {
    if (!tick) tick = setInterval(updateTimer, 200);
    updateTimer();
  } else if (tick) { clearInterval(tick); tick = null; }
  window.scrollTo(0, keepY);
}

function updateTimer() {
  const el = document.getElementById('timer');
  if (!el || !S.run || !S.run.q || S.run.q.feedback) return;
  const q = S.run.q;
  el.textContent = fmtSec(performance.now() - q.shownAt - q.paused);
}

const actions = {
  chooseProfile(el) { S.profileId = el.dataset.id; D.lastProfileId = S.profileId; persist(); S.screen = 'home'; S.error = ''; render(); },
  showAddPlayer() { S.addingPlayer = true; render(); },
  hideAddPlayer() { S.addingPlayer = false; render(); },
  switchPlayer() { S.addingPlayer = false; S.profileId = null; S.screen = 'profiles'; render(); },
  start(el) { startRun(el.dataset.mode); },
  pickSet(el) { S.cfg.setKey = el.dataset.key; S.cfg.sec = el.dataset.sec || ''; render(); },
  pickSubject(el) { S.cfg.picked = true; S.cfg.subject = el.dataset.s; S.cfg.how = 'random'; S.cfg.setKey = ''; S.cfg.sec = ''; render(); },
  backHome() { S.cfg.picked = false; S.cfg.how = 'random'; S.cfg.setKey = ''; S.cfg.sec = ''; render(); },
  pickHow(el) { S.cfg.how = el.dataset.how; S.cfg.setKey = ''; S.cfg.sec = ''; render(); },
  focus(el) { const q = S.run.q; if (q.feedback) return; touch(); q.active = Number(el.dataset.i); render(); },
  key(el) { pressKey(el.dataset.k); },
  pickval(el) { pickValue(el.dataset.v); },
  check() { submit(false); },
  skip() { submit(true); },
  next() { advance(); },
  hint() {
    const q = S.run.q; const Q = S.run.qs[S.run.idx];
    if (q.feedback || q.hintsShown >= (Q.hints || []).length) return;
    touch(); q.hintsShown++; render();
  },
  quit() {
    const r = S.run;
    if (r && r.items.length) {
      if (!confirm('Save your place and stop for now? You can carry on later from the start screen.')) return;
      saveProgress();
    } else if (!confirm('Stop this session?')) return;
    S.run = null; S.screen = 'home'; S.cfg.picked = false; render();
  },
  resume() { resumeRun(); },
  forgotPin() { S.pinReset = true; S.error = ''; render(); },
  cancelPinReset() { S.pinReset = false; S.error = ''; render(); },
  discardPaused() { if (confirm('Throw away the saved session?')) { clearProgress(S.profileId); render(); } },
  home() { S.run = null; S.screen = 'home'; render(); },
  toggleTimer() { const p = profile(); p.showTimer = !p.showTimer; persist(); render(); },
  openParent() { S.error = ''; S.notice = ''; S.screen = S.parent.ok ? 'parent' : 'pin'; render(); },
  leaveParent() { S.pinReset = false; S.parent.ok = false; S.error = ''; S.notice = ''; S.screen = S.profileId ? 'home' : 'profiles'; render(); },
  tab(el) { S.parent.tab = el.dataset.tab; S.notice = ''; S.error = ''; render(); },
  openSession(el) { S.parent.openSession = S.parent.openSession === el.dataset.id ? null : el.dataset.id; render(); },
  deleteProfile(el) {
    const p = D.profiles.find(x => x.id === el.dataset.id);
    if (!p || !confirm('Remove ' + p.name + ' and all of their results?')) return;
    D.profiles = D.profiles.filter(x => x.id !== p.id);
    D.sessions = D.sessions.filter(s => s.profileId !== p.id);
    if (D.paused) delete D.paused[p.id];
    if (S.profileId === p.id) S.profileId = null;
    persist(); render();
  },
  deleteBank(el) {
    const b = D.banks.find(x => x.id === el.dataset.id);
    if (!b || !confirm('Remove "' + b.name + '"? Past results are kept.')) return;
    D.banks = D.banks.filter(x => x.id !== b.id);
    if (S.cfg.bankId === b.id) S.cfg.bankId = null;
    persist(); render();
  },
  export() {
    const blob = new Blob([JSON.stringify(D)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'learning-app-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  changePin() { if (confirm('Change the PIN? You will set a new one straight away.')) { D.pinHash = null; persist(); S.parent.ok = false; S.screen = 'pin'; render(); } },
  reset() {
    if (prompt('This erases all players, results and imported questions on this device. Type RESET to confirm.') === 'RESET') {
      D = Object.assign({}, load(), { v: 1, profiles: [], banks: [], sessions: [], pinHash: null, lastProfileId: null });
      persist(); S.parent.ok = false; S.profileId = null; S.screen = 'profiles';
      ensureSampleBank().then(render); render();
    }
  },
};

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.a];
  if (fn) fn(el, e);
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target; const kind = form.dataset.form;
  const fd = new FormData(form);
  if (kind === 'addProfile') {
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    D.profiles.push({ id: uid(), name, color: fd.get('color') || COLORS[0], showTimer: false, childCanToggleTimer: true });
    persist(); S.error = '';
    S.addingPlayer = false;
    render();
  } else if (kind === 'pinReset') {
    if (String(fd.get('word') || '').trim().toUpperCase() !== 'RESET') { S.error = 'Please type the word RESET.'; render(); return; }
    D.pinHash = null; persist(); S.pinReset = false; S.error = ''; render();
  } else if (kind === 'pin') {
    const pin = String(fd.get('pin') || '');
    if (!/^\d{4}$/.test(pin)) { S.error = 'The PIN must be exactly 4 digits.'; render(); return; }
    if (!D.pinHash) {
      if (pin !== String(fd.get('pin2') || '')) { S.error = 'The two PINs do not match.'; render(); return; }
      D.pinHash = await hashPin(pin); persist();
    } else if ((await hashPin(pin)) !== D.pinHash) { S.error = 'That PIN is not right.'; render(); return; }
    S.parent.ok = true; S.error = ''; S.screen = 'parent'; render();
  }
});

root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const kind = el.dataset.change;
  if (kind === 'count') { S.cfg.count = Number(el.value); render(); }
  else if (kind === 'bank') { S.cfg.bankId = el.value; S.cfg.picked = false; S.cfg.subject = ''; render(); }
  else if (kind === 'resultsPlayer') { S.parent.profileId = el.value; S.parent.openSession = null; render(); }
  else if (kind === 'timerDefault') { D.profiles.find(p => p.id === el.dataset.id).showTimer = el.checked; persist(); }
  else if (kind === 'timerToggle') { D.profiles.find(p => p.id === el.dataset.id).childCanToggleTimer = el.checked; persist(); }
  else if (kind === 'importBank' || kind === 'importBackup') readFile(el.files[0], kind);
});

function readFile(file, kind) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    S.notice = ''; S.error = '';
    try {
      const raw = JSON.parse(String(reader.result));
      if (kind === 'importBank') {
        const { questions, skipped } = validateBank(raw);
        D.banks.push({ id: uid(), name: file.name.replace(/\.json$/i, ''), questions });
        persist();
        if (!S.error) S.notice = 'Imported ' + questions.length + ' questions' + (skipped.length ? ' (' + skipped.length + ' skipped because they had no usable answer)' : '') + '.';
      } else {
        if (!raw || !Array.isArray(raw.profiles) || !Array.isArray(raw.sessions) || !Array.isArray(raw.banks)) throw new Error('This does not look like a backup from this app.');
        if (!confirm('Replace everything on this device with this backup?')) return;
        D = Object.assign({}, load(), raw);
        persist(); S.notice = 'Backup restored.';
      }
    } catch (err) { S.error = err.message || 'That file could not be read.'; }
    render();
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------- start */

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
ensureSampleBank().then(() => { if (S.screen === 'home' || S.screen === 'parent') render(); });
