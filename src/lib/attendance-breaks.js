function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function diffMins(start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return 0;
  if (e >= s) return e - s;
  return e + (24 * 60) - s; // overnight crossover
}

export function getBreakAllowance(type, shiftBreaks) {
  const rules = (shiftBreaks || []).filter(b => b.type === type);
  if (rules.length === 0) return type === 'lunch' ? 60 : 30;
  return rules.reduce((sum, b) => sum + (b.maxDuration ?? 0) * (b.maxCount ?? 1), 0);
}

export function getBreakMaxCount(type, shiftBreaks) {
  const rules = (shiftBreaks || []).filter(b => b.type === type);
  if (rules.length === 0) return 1;
  return rules.reduce((sum, b) => sum + (b.maxCount ?? 1), 0);
}

export function getBreakTypes(shiftBreaks) {
  return [...new Set((shiftBreaks || []).map(b => b.type).filter(Boolean))];
}

export function isBreakType(type) {
  return typeof type === 'string' && type !== 'task';
}

export function calculateBreakDeduction(breaks, shiftBreaks) {
  const totals = {};
  for (const b of (breaks || [])) {
    if (!b.end) continue;
    totals[b.type] = (totals[b.type] || 0) + diffMins(b.start, b.end);
  }
  let deduction = 0;
  for (const [type, total] of Object.entries(totals)) {
    deduction += Math.max(0, total - getBreakAllowance(type, shiftBreaks));
  }
  return deduction;
}

const BREAK_PALETTES = [
  { color: '#f59e0b', bg: '#fffbeb', icon: 'bi-cup-hot' },
  { color: '#8b5cf6', bg: '#f5f3ff', icon: 'bi-egg-fried' },
  { color: '#0ea5e9', bg: '#f0f9ff', icon: 'bi-cup-straw' },
  { color: '#10b981', bg: '#ecfdf5', icon: 'bi-emoji-coffee' },
  { color: '#ef4444', bg: '#fef2f2', icon: 'bi-fire' },
  { color: '#f97316', bg: '#fff7ed', icon: 'bi-moon-stars' },
  { color: '#06b6d4', bg: '#ecfeff', icon: 'bi-snow' },
  { color: '#64748b', bg: '#f8fafc', icon: 'bi-cup' },
];

const SPECIAL_STYLE = {
  break: BREAK_PALETTES[0],
  lunch: BREAK_PALETTES[1],
};

export function breakStyle(type) {
  const t = String(type || '').toLowerCase();
  let base = SPECIAL_STYLE[t];
  if (!base) {
    let hash = 0;
    for (let i = 0; i < t.length; i++) {
      hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
    }
    base = BREAK_PALETTES[hash % BREAK_PALETTES.length];
  }
  return { ...base, borderColor: base.color + '30' };
}
