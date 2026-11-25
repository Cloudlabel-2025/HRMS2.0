const plain = value => typeof value?.toObject === 'function' ? value.toObject() : value;

export function canonicalLeaveCode(code, name = '') {
  const value = String(code || '').trim().toUpperCase();
  return value === 'PL' || value === 'EL' || /\b(privilege|earned)\b/i.test(name) ? 'EL' : value;
}

// Existing Earned Leave rules win when a policy contains both PL and EL.
// Renaming PL must never grant a second annual allowance.
export function canonicalizeLeaveTypes(configs = []) {
  const rows = configs.map(plain);
  const earned = rows.find(row => String(row.code).trim().toUpperCase() === 'EL');
  const result = [], seen = new Set();
  for (const row of rows) {
    const code = canonicalLeaveCode(row.code, row.name);
    if (seen.has(code)) continue;
    seen.add(code);
    const source = code === 'EL' ? (earned || row) : row;
    result.push({ ...source, code,
      ...(code === 'EL' ? { name: 'Earned Leave', unusedPeriodRollover: true } : {}),
      ...(Array.isArray(source.linkedLeaveTypes) ? {
        linkedLeaveTypes: [...new Set(source.linkedLeaveTypes.map(value => canonicalLeaveCode(value)))].filter(value => value !== code),
      } : {}),
    });
  }
  return result;
}

export function canonicalizePolicy(policy) {
  const value = plain(policy);
  return { ...value,
    ...(value.leaveTypeConfigs ? { leaveTypeConfigs: canonicalizeLeaveTypes(value.leaveTypeConfigs) } : {}),
    ...(value.draftConfig?.leaveTypeConfigs ? { draftConfig: {
      ...value.draftConfig, leaveTypeConfigs: canonicalizeLeaveTypes(value.draftConfig.leaveTypeConfigs),
    } } : {}),
  };
}

export function canonicalizeLeaveRecord(leave) {
  const value = plain(leave);
  const code = canonicalLeaveCode(value.typeCode, value.type);
  return { ...value,
    ...(code === 'EL' ? { typeCode: 'EL', type: 'Earned Leave' } : {}),
    ...(canonicalLeaveCode(value.requestedTypeCode, value.requestedTypeName) === 'EL'
      ? { requestedTypeCode: 'EL', requestedTypeName: 'Earned Leave' } : {}),
    ...(value.classificationOptions ? { classificationOptions: canonicalizeLeaveTypes(value.classificationOptions)
      .map(({ code, name }) => ({ code, name })) } : {}),
  };
}

export function mergeEarnedLeaveBalances(balances = []) {
  const rows = balances.map(plain);
  const earned = rows.filter(row => canonicalLeaveCode(row.typeCode) === 'EL');
  if (!earned.length) return rows;
  const base = earned.find(row => row.typeCode === 'EL') || earned[0];
  const periods = new Map();
  for (const row of earned) for (const period of row.periodUsage || []) {
    const current = periods.get(period.period) || { period: period.period, used: 0, cap: 0 };
    current.used = Math.round((current.used + Number(period.used || 0)) * 100) / 100;
    current.cap = Math.max(current.cap, Number(period.cap || 0));
    periods.set(period.period, current);
  }
  const total = field => Math.round(earned.reduce((sum, row) => sum + Number(row[field] || 0), 0) * 100) / 100;
  const merged = { ...base, typeCode: 'EL', used: total('used'), pending: total('pending'), periodUsage: [...periods.values()] };
  let inserted = false;
  return rows.flatMap(row => {
    if (canonicalLeaveCode(row.typeCode) !== 'EL') return [row];
    if (inserted) return [];
    inserted = true;
    return [merged];
  });
}
