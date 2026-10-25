// Marking rules. Pure functions with no browser dependencies so they can be tested in Node.
// Answers are compared by value, not by text: 15, 15.0 and 15.00 are the same answer.

const OP_MAP = { '+': '+', '-': '−', '−': '−', '–': '−', 'x': '×', 'X': '×', '*': '×', '×': '×', '/': '÷', '÷': '÷' };

export function normOp(s) {
  return OP_MAP[String(s).trim()] || String(s).trim();
}

// "1,000" -> 1000, "£1.50" -> 1.5, "3/4" -> 0.75, "15 g" -> 15. Returns null if not a number.
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/[£,\s]/g, '').replace(/p$/i, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^-?\.\d+$/.test(t)) return Number(t);
  let m = t.match(/^(\d+)\/(\d+)$/);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  return null;
}

export function numEq(a, b) {
  const x = parseNum(a);
  const y = parseNum(b);
  return x !== null && y !== null && Math.abs(x - y) < 1e-9;
}

// Minutes since midnight, or null. Accepts "4:15 pm", "4.15pm", "4:15 p.m.", "16:15", "8 a.m.", "8am".
export function parseTime(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toLowerCase().replace(/\s+/g, '');
  let m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?([ap])\.?m?\.?$/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3] === 'a') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
    return h * 60 + min;
  }
  m = t.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

export function timeEq(a, b) {
  const x = parseTime(a);
  const y = parseTime(b);
  return x !== null && y !== null && x === y;
}

// Dates: the book's day-month-year order or month-day-year, any separator, 2- or 4-digit year.
export function dateMatches(text, accept) {
  const parts = String(text).trim().split(/[^0-9]+/);
  if (parts.length !== 3 || !parts.every(Boolean)) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  let c = Number(parts[2]);
  if (parts[2].length === 2) c += 2000;
  else if (parts[2].length !== 4) return false;
  const { day, month, year } = accept;
  if (c !== year) return false;
  const orders = accept.orders || ['dmy', 'mdy'];
  return (orders.includes('dmy') && a === day && b === month) || (orders.includes('mdy') && a === month && b === day);
}

export function normText(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\/.]+/g, ' ').trim();
}

// For "which two" answers: order and the word "and" do not matter.
export function bagOfTokens(s) {
  return normText(s).split(' ').filter(t => t && t !== 'and').sort().join('|');
}

// Mark one field. field = { kind, answer, accept?, bag? }, value = what the child entered.
export function markField(field, value) {
  const v = (value === undefined || value === null) ? '' : String(value).trim();
  if (v === '') return false;
  switch (field.kind) {
    case 'num': return numEq(v, field.answer);
    case 'time': return timeEq(v, field.answer);
    case 'date': return field.accept ? dateMatches(v, field.accept) : normText(v) === normText(field.answer);
    case 'op': return normOp(v) === normOp(field.answer);
    case 'choice': return normText(v) === normText(field.answer);
    case 'text':
    default:
      if (field.bag) return bagOfTokens(v) === bagOfTokens(field.answer);
      return normText(v).replace(/\s/g, '') === normText(field.answer).replace(/\s/g, '');
  }
}

// Mark a whole question. q.fields = [...]; values = array of strings, one per field.
// q.orderFree means the fields are a list that can be entered in any order (e.g. "list the multiples").
export function markQuestion(q, values) {
  const fields = q.fields;
  if (q.orderFree) {
    const wanted = fields.map(f => parseNum(f.answer));
    const got = values.map(parseNum);
    const per = got.map(() => false);
    if (got.some(g => g === null)) return { correct: false, perField: per };
    const used = new Array(wanted.length).fill(false);
    got.forEach((g, i) => {
      for (let j = 0; j < wanted.length; j++) {
        if (!used[j] && Math.abs(wanted[j] - g) < 1e-9) { used[j] = true; per[i] = true; break; }
      }
    });
    return { correct: per.every(Boolean), perField: per };
  }
  const perField = fields.map((f, i) => markField(f, values[i]));
  return { correct: perField.every(Boolean), perField };
}

// The answer as text for showing after a wrong answer.
export function answerText(q) {
  return q.fields.map(f => {
    const pre = f.prefix || '';
    const suf = f.suffix ? ' ' + f.suffix : '';
    const lab = f.label && f.label !== 'r' ? f.label + ' ' : (f.label === 'r' ? 'r ' : '');
    return (lab + pre + f.answer + suf).trim();
  }).join(',  ');
}
