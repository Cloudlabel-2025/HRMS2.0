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

export function isBreakType(type) {
  return typeof type === 'string' && type !== 'task';
}

export function getRuleAllowance(rule) {
  return (rule?.maxDuration ?? 0) * (rule?.maxCount ?? 1);
}

// Match a break entry to the shift-config rule it belongs to.
// Preference: explicit ruleIdx (set by the client when a rule tab is used),
// then rule name + type, then first rule of the same type (legacy entries).
export function matchBreakRule(entry, shiftBreaks) {
  const rules = shiftBreaks || [];
  if (entry && entry.ruleIdx != null && !Number.isNaN(Number(entry.ruleIdx))) {
    const idx = Number(entry.ruleIdx);
    if (rules[idx]) return { rule: rules[idx], index: idx };
  }
  if (entry?.name) {
    const named = rules.findIndex(r => r.type === entry.type && (r.name || '') === entry.name);
    if (named !== -1) return { rule: rules[named], index: named };
  }
  const typed = rules.findIndex(r => r.type === entry?.type);
  if (typed !== -1) return { rule: rules[typed], index: typed };
  return null;
}

// Allowance (maxDuration x maxCount) for the rule an entry belongs to.
// Falls back to per-type aggregate allowance for unmatched/legacy entries.
export function getBreakAllowanceForEntry(entry, shiftBreaks) {
  const m = matchBreakRule(entry, shiftBreaks);
  if (m) return getRuleAllowance(m.rule);
  return getBreakAllowance(entry?.type, shiftBreaks);
}

/**
 * Break time taken over and above what the allowances permit.
 *
 * Two bounds are evaluated per group (rule, or type for legacy/unmatched
 * entries) and the LARGER wins, because each is a genuine violation on its
 * own:
 *
 *   perOccurrence = Σ max(0, duration_i − maxDuration)
 *                   — one break ran long against its own cap
 *                   (a 30m break that took 40m => 10m)
 *
 *   pool          = max(0, Σ duration_i − allowance)
 *                   — the day's total outran the bucket
 *                   (two 40m breaks in a 60m pool => 20m)
 *
 * Staying inside every cap AND inside the pool is zero excess: 45m of a 60m
 * lunch allowance is normal, never short hours.
 */
export function calculateBreakExcess(breaks, shiftBreaks) {
  const rules = shiftBreaks || [];
  const groups = new Map();

  for (const b of (breaks || [])) {
    if (!b?.start || !b?.end) continue;
    const dur = diffMins(b.start, b.end);
    if (dur <= 0) continue;

    const m = matchBreakRule(b, rules);
    const key = m ? 'r' + m.index : 't' + (b.type || '');
    let g = groups.get(key);
    if (!g) {
      g = { total: 0, perOccurrence: 0, hasRule: !!m, rule: m ? rules[m.index] : null, type: b.type || '' };
      groups.set(key, g);
    }
    g.total += dur;
    if (g.hasRule) {
      const cap = Number(g.rule?.maxDuration);
      // No per-break cap configured => only the pool bound can apply.
      if (Number.isFinite(cap) && cap > 0) g.perOccurrence += Math.max(0, dur - cap);
    }
  }

  let excessMins = 0;
  const byGroup = [];
  for (const g of groups.values()) {
    const allowance = g.hasRule ? getRuleAllowance(g.rule) : getBreakAllowance(g.type, rules);
    const poolExcess = Math.max(0, g.total - allowance);
    const excess = Math.max(g.perOccurrence, poolExcess);
    if (excess > 0) {
      excessMins += excess;
      byGroup.push({ type: g.type, excess });
    }
  }
  return { excessMins, byGroup };
}

export function calculateBreakDeduction(breaks, shiftBreaks) {
  return calculateBreakExcess(breaks, shiftBreaks).excessMins;
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
