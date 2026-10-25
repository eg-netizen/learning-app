// Converts a question from the content pipeline format into the runtime format the app plays.
//
// Pipeline question: { id, text, type, unit, answer, topic, hints?, options?, accept? }
// Runtime question:  { id, text, topic, hints, orderFree?, fields: [{ kind, answer, prefix?, suffix?, label?, options?, accept?, bag? }] }

const UNIT_RE = '[A-Za-zµ°%]+';

function numberish(s) {
  return /^-?[\d.]+(\/\d+)?$/.test(String(s).trim());
}

function splitValueUnit(v) {
  const m = String(v).trim().match(new RegExp('^(-?[\\d.]+(?:/\\d+)?)\\s*(' + UNIT_RE + '(?:\\s' + UNIT_RE + ')?)$'));
  return m ? { value: m[1], unit: m[2] } : { value: String(v).trim(), unit: '' };
}

function unitSuffix(unit, answerIsMoney) {
  if (!unit) return {};
  if (unit === '£') return { prefix: '£' };
  return { suffix: unit };
}

const BOOK_SUBJECTS = { MA3: 'Mental Arithmetic', PS3: 'Problem Solving' };

// The subject a child can choose to practise. Pipeline banks may set `subject`; otherwise it comes from the book code.
export function subjectOf(q) {
  return q.subject || BOOK_SUBJECTS[q.book] || q.book || '';
}

// Distinct subjects in a bank with question counts, in first-seen order.
export function subjectsIn(questions) {
  const m = new Map();
  for (const q of questions) {
    const s = subjectOf(q);
    if (s) m.set(s, (m.get(s) || 0) + 1);
  }
  return [...m].map(([name, n]) => ({ name, n }));
}

const BOOK_TITLES = { MA3: 'Mental Arithmetic 3', PS3: 'Problem Solving 3' };

// Booklet position of a question: which set it belongs to and where it sits in the original book.
// Works on pipeline questions and runtime questions (both carry book, test, section, id, page).
export function setKeyOf(q) {
  return q.book && q.test !== undefined && q.test !== null && q.test !== '' ? q.book + '|' + q.test : '';
}

export function refOf(q) {
  if (!setKeyOf(q)) return '';
  const last = String(q.id).split('-').pop();
  const where = q.section ? 'Section ' + q.section + ', question ' + (q.number ?? last.replace(/^[A-Z]/, '')) : 'Question ' + last;
  const title = typeof q.test === 'number' || /^\d+$/.test(String(q.test)) ? 'Test ' + q.test : String(q.test);
  return [BOOK_TITLES[q.book] || q.book, title, where, q.page ? 'page ' + q.page : ''].filter(Boolean).join(' · ');
}

// The sets in a bank, in the order they first appear (which is booklet order).
export function setsIn(questions) {
  const m = new Map();
  for (const q of questions) {
    const key = setKeyOf(q);
    if (!key) continue;
    if (!m.has(key)) m.set(key, { key, title: /^\d+$/.test(String(q.test)) ? 'Test ' + q.test : String(q.test), bookTitle: BOOK_TITLES[q.book] || q.book, subject: subjectOf(q), page: q.page, n: 0, sections: [] });
    const s = m.get(key);
    s.n++;
    if (q.section) {
      const sec = s.sections.find(x => x.name === q.section);
      if (sec) sec.n++; else s.sections.push({ name: q.section, n: 1 });
    }
  }
  return [...m.values()];
}

// Questions of one set in booklet order, optionally just one section.
export function setQuestions(questions, key, section) {
  return questions.filter(q => setKeyOf(q) === key && (!section || q.section === section));
}

export function toRuntime(q) {
  if (q.fields) return q; // already in runtime form
  const type = q.type || 'numeric';
  const unit = q.unit || '';
  const ans = String(q.answer).trim();
  const out = { id: q.id, text: String(q.text).replace(/ {2,}/g, '\n'), topic: q.topic || 'general', hints: q.hints || [], book: q.book, page: q.page, test: q.test, section: q.section, number: q.number };
  const ref = refOf(q);
  if (ref) out.ref = ref;
  if (q.after) out.after = q.after;
  if (q.context) out.context = q.context;
  out.subject = subjectOf(q);
  if (q.image) { out.image = q.image; out.imageAlt = q.imageAlt || ''; }

  // Dates with a flexible marking rule
  if (q.accept && q.accept.type === 'date') {
    out.fields = [{ kind: 'date', answer: ans, accept: q.accept }];
    return out;
  }

  if (type === 'time') {
    out.fields = [{ kind: 'time', answer: ans }];
    return out;
  }

  if (type === 'operators') {
    const pairs = [...ans.matchAll(/([●▲])\s*=\s*([+−\-×x÷/])/g)];
    if (pairs.length) {
      out.fields = pairs.map(p => ({ kind: 'op', label: p[1], answer: p[2] === '-' ? '−' : p[2] }));
      return out;
    }
  }

  if (type === 'list') {
    const items = ans.split(',').map(s => s.trim()).filter(Boolean);
    out.fields = items.map(a => ({ kind: 'num', answer: a }));
    out.orderFree = true;
    return out;
  }

  if (type === 'remainder') {
    const m = ans.match(/^(\d+)\s*r\s*(\d+)$/i);
    if (m) {
      out.fields = [{ kind: 'num', answer: m[1] }, { kind: 'num', label: 'r', answer: m[2] }];
      return out;
    }
  }

  if (type === 'choice' && q.options && q.options.length) {
    out.fields = [{ kind: 'choice', answer: ans, options: q.options }];
    return out;
  }

  if (type === 'multi' || /^[a-z]\s*=/.test(ans)) {
    // a=15, b=60   |   a=1900 g, b=2 kg   |   a=Z, b=square
    if (/^[a-z]\s*=/.test(ans)) {
      const parts = ans.split(/,\s*(?=[a-z]\s*=)/);
      out.fields = parts.map(p => {
        const m = p.match(/^([a-z])\s*=\s*(.+)$/);
        const raw = m[2].trim();
        if (numberish(raw) || /^-?[\d.]+(\/\d+)?\s*[A-Za-zµ]/.test(raw)) {
          const { value, unit: u } = splitValueUnit(raw);
          return Object.assign({ kind: 'num', label: m[1], answer: value }, unitSuffix(u || unit));
        }
        return { kind: 'text', label: m[1], answer: raw };
      });
      return out;
    }
    // 1 l 710 ml   |   186 cm -> 1 m 86 cm   |   2 hours 30 minutes
    const m = ans.match(new RegExp('^(\\d+)\\s*(' + UNIT_RE + ')\\s+(\\d+)\\s*(' + UNIT_RE + ')$'));
    if (m) {
      out.fields = [
        { kind: 'num', answer: m[1], suffix: m[2] },
        { kind: 'num', answer: m[3], suffix: m[4] },
      ];
      return out;
    }
  }

  // Two-unit answers that are not typed 'multi' (for example "1 m 86 cm")
  const pair = ans.match(new RegExp('^(\\d+)\\s*(' + UNIT_RE + ')\\s+(\\d+)\\s*(' + UNIT_RE + ')$'));
  if (pair) {
    out.fields = [
      { kind: 'num', answer: pair[1], suffix: pair[2] },
      { kind: 'num', answer: pair[3], suffix: pair[4] },
    ];
    return out;
  }

  if (type === 'choice') {
    out.fields = [{ kind: 'text', answer: ans, bag: true }];
    return out;
  }

  if (type === 'text') {
    out.fields = [{ kind: 'text', answer: ans }];
    return out;
  }

  // numeric, decimal, money, fraction and anything else with a numeric answer
  if (numberish(ans)) {
    out.fields = [Object.assign({ kind: 'num', answer: ans }, unitSuffix(unit))];
    return out;
  }

  // Fallback: type the answer as text
  out.fields = [{ kind: 'text', answer: ans }];
  return out;
}

export function validateBank(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : null);
  if (!list) throw new Error('This file does not look like a question bank (expected a list of questions).');
  const questions = [];
  const skipped = [];
  for (const q of list) {
    if (!q || !q.text || q.answer === undefined || q.answer === '?' || q.answer === null) {
      skipped.push(q && q.id ? q.id : '(unknown)');
      continue;
    }
    try {
      const r = toRuntime(q);
      if (!r.fields || !r.fields.length) { skipped.push(q.id || '(unknown)'); continue; }
      questions.push(r);
    } catch (e) {
      skipped.push(q.id || '(unknown)');
    }
  }
  if (!questions.length) throw new Error('No usable questions were found in this file.');
  return { questions, skipped };
}

// Random mix. A question that builds on an earlier one (`after`) is always drawn together with it,
// the earlier one first, as two separate questions. `all` is every question in the bank (to find the earlier one).
export function pickRandom(pool, count, all, shuffleFn) {
  const byId = new Map(all.map(q => [q.id, q]));
  const poolIds = new Set(pool.map(q => q.id));
  const dependents = pool.filter(q => q.after && byId.has(q.after));
  const depOf = new Map(dependents.map(q => [q.after, q]));
  const units = [];
  for (const q of pool) {
    if (q.after && byId.has(q.after)) units.push([byId.get(q.after), q]);
    else if (depOf.has(q.id)) continue; // leads a pair, added with its dependent
    else units.push([q]);
  }
  const out = [];
  const used = new Set();
  for (const u of shuffleFn(units)) {
    if (out.length >= count) break;
    if (out.length + u.length > count && out.length > 0 && u.length > 1) continue;
    for (const q of u) if (!used.has(q.id)) { out.push(q); used.add(q.id); }
  }
  return out;
}
