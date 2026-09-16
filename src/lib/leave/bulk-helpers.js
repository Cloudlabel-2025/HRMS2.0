/**
 * Shared helpers for bulk leave import (balance + leave history).
 * Pure parsing / coercion lives here; DB lookups stay in the API routes
 * except resolveEmployee which is shared by validate + commit.
 */

export const BULK_ADMIN_ROLES = ['super_admin', 'admin_full'];
export const BULK_MAX_ROWS = 500;
export const BULK_MAX_BYTES = 3 * 1024 * 1024;

export const BALANCE_HEADERS = [
  'employeeEmail',
  'employeeCode',
  'typeCode',
  'allocated',
  'used',
  'pending',
  'carriedForward',
  'expiryDate',
  'cycleYear',
  'reason',
];

export const LEAVE_HEADERS = [
  'employeeEmail',
  'employeeCode',
  'typeCode',
  'from',
  'to',
  'halfDay',
  'halfDayType',
  'reason',
  'status',
  'paidDays',
  'unpaidDays',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

const BALANCE_ALIASES = {
  employeeemail: 'employeeEmail',
  email: 'employeeEmail',
  employeecode: 'employeeCode',
  employeenumber: 'employeeCode',
  employeeno: 'employeeCode',
  empcode: 'employeeCode',
  empnumber: 'employeeCode',
  userid: 'employeeCode',
  typecode: 'typeCode',
  leavetype: 'typeCode',
  type: 'typeCode',
  allocated: 'allocated',
  used: 'used',
  pending: 'pending',
  carriedforward: 'carriedForward',
  carryforward: 'carriedForward',
  expirydate: 'expiryDate',
  expiry: 'expiryDate',
  cycleyear: 'cycleYear',
  year: 'cycleYear',
  reason: 'reason',
};

const LEAVE_ALIASES = {
  employeeemail: 'employeeEmail',
  email: 'employeeEmail',
  employeecode: 'employeeCode',
  employeenumber: 'employeeCode',
  employeeno: 'employeeCode',
  empcode: 'employeeCode',
  empnumber: 'employeeCode',
  userid: 'employeeCode',
  typecode: 'typeCode',
  leavetype: 'typeCode',
  type: 'typeCode',
  from: 'from',
  fromdate: 'from',
  to: 'to',
  todate: 'to',
  halfday: 'halfDay',
  halfdaytype: 'halfDayType',
  reason: 'reason',
  status: 'status',
  paiddays: 'paidDays',
  unpaiddays: 'unpaidDays',
};

export function mapHeaders(rawHeaders, kind) {
  const aliases = kind === 'balance' ? BALANCE_ALIASES : LEAVE_ALIASES;
  return rawHeaders.map(h => aliases[normHeader(h)] || null);
}

export function excelSerialToDateStr(n) {
  // Excel serial: days since 1899-12-30
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function coerceDateStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') return excelSerialToDateStr(v);
  const s = String(v).trim();
  // Accept DD/MM/YYYY or MM/DD/YYYY with slashes → convert to YYYY-MM-DD (assume DD/MM/YYYY first)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    // If first part > 12 it must be DD/MM/YYYY
    if (Number(a) > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    // Ambiguous — prefer DD/MM/YYYY (Indian default)
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  // Accept YYYY/MM/DD
  const isoSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlash) {
    const [, y, m, d] = isoSlash;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return s;
}

export function isValidDateStr(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export function coerceNumber(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).trim());
  return Number.isNaN(n) ? NaN : n;
}

export function coerceBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0', ''].includes(s)) return false;
  return null;
}

/**
 * Parse a CSV buffer into { headers, rows } — minimal RFC4180 handling
 * (quoted commas + escaped quotes). Keeps dependency-free.
 */
export function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const split = line => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

/**
 * Parse an xlsx buffer with exceljs into { headers, rows }.
 * First row = headers, subsequent rows = values (raw cell values).
 */
export async function parseXlsxBuffer(buffer) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers = [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (rowNumber === 1) {
      vals.forEach(v => headers.push(v === null || v === undefined ? '' : String(v).trim()));
    } else {
      rows.push(vals.map(v => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v;
        if (typeof v === 'object' && v !== null && 'text' in v) return String(v.text);
        return v;
      }));
    }
  });
  return { headers, rows };
}

export function rowsToObjects(headers, rows, kind) {
  const mapped = mapHeaders(headers, kind);
  return rows.map((cells, idx) => {
    const obj = { __rowNum: idx + 2 };
    mapped.forEach((key, col) => {
      if (key) obj[key] = cells[col] === undefined ? '' : cells[col];
    });
    return obj;
  });
}

/**
 * Resolve employee by email OR employeeCode (EmpProfile.employeeNumber).
 * Returns { user, profile, identifier } or { error }.
 * If both provided they must belong to the same person.
 */
export async function resolveBulkEmployee({ employeeEmail, employeeCode }) {
  const email = String(employeeEmail || '').trim().toLowerCase();
  const code = String(employeeCode || '').trim();
  if (!email && !code) return { error: 'Provide employeeEmail or employeeCode' };

  const User = (await import('@/lib/models/User')).default;
  const EmpProfile = (await import('@/lib/models/EmploymentProfile')).default;

  let byEmail = null;
  let byCodeProfile = null;

  if (email) {
    byEmail = await User.findOne({ email }).select('_id name email role department status identityId profileId').lean();
    if (!byEmail) return { error: `Employee email not found: ${email}` };
  }
  if (code) {
    // employeeCode = EmpProfile.employeeNumber
    byCodeProfile = await EmpProfile.findOne({ employeeNumber: code }).select('_id identityId employeeNumber').lean();
    if (!byCodeProfile) {
      // Fallback: treat code as User _id (technical exports)
      try {
        const byId = await User.findById(code).select('_id name email role department status identityId profileId').lean();
        if (byId) {
          if (byEmail && byEmail._id.toString() !== byId._id.toString()) {
            return { error: 'employeeEmail and employeeCode belong to different employees' };
          }
          return { user: byId, profile: null, identifier: email || code };
        }
      } catch { /* not an ObjectId — fall through */ }
      return { error: `Employee code not found: ${code}` };
    }
    // Map profile → user via profileId or identityId
    const linked = await User.findOne({
      $or: [{ profileId: byCodeProfile._id }, ...(byCodeProfile.identityId ? [{ identityId: byCodeProfile.identityId }] : [])],
    }).select('_id name email role department status identityId profileId').lean();
    if (!linked) return { error: `No user linked to employee code: ${code}` };
    if (byEmail && byEmail._id.toString() !== linked._id.toString()) {
      return { error: 'employeeEmail and employeeCode belong to different employees' };
    }
    return { user: linked, profile: byCodeProfile, identifier: email || code };
  }
  return { user: byEmail, profile: null, identifier: email };
}
