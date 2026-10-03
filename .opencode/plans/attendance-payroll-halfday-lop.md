# Paid Leave Is Always Paid — Half-Day Leave, Attendance Report & LOP Reconciliation

## The core policy change
**A leave whose type is `isPaid: true` is always paid in full. Leave balance is an administrative
flag, never a payroll deduction.** Only an explicitly unpaid leave (`typeCode: 'LOP'`) creates LOP.

Today `src/app/api/leave/route.js:480-483` silently converts paid leave into LOP when the balance
runs dry, with no warning to applicant or approver:

```js
if (days > allowedPaidDays) {
  paidDays = allowedPaidDays;
  unpaidDays = Number((days - allowedPaidDays).toFixed(2));   // <- silent LOP
}
```

**Live evidence this is wrong**

| Employee | Leave | Type | `isPaid` | paidDays | unpaidDays | Balance |
|---|---|---|---|---|---|---|
| Kavin Kumar G | 12 Aug, 0.5-day half | Sick Leave | **true** | **0** | **0.5** | SL `allocated 1.5 / used 1.5` |
| Kavin Kumar G | 15 Sep, 1-day | Sick Leave | **true** | 0.5 | **0.5** | SL exhausted |
| Rishidharshini S | 26–27 Aug, 2-day | Casual Leave | **true** | 0.38 | **1.62** | CL `allocated 0.38 / used 0.38` |

All three are approved **paid** leave types that payroll is treating as unpaid. This is the actual
cause of "Kavin has LOP for 0.5 days even though he applied leave".

Policy config that starves the balances: `Standard Leave Policy` sets
`annualAllocation: 6 · accrualMode: 'monthly' · creditSchedule: 'quarterly' · unusedPeriodRollover: false`.
Quarterly crediting with no rollover means the balance is near zero for most of the year.
Separately, `maxUsagePerPeriod: 1.5` is **not enforced** — `periodUsage` rows persist as `{ period: 'Q2', cap: 0 }`.

## Locked rules
| Situation | Paid Leave | Presence | LOP | Wage that day |
|---|---|---|---|---|
| **Paid** leave type, full day | 1.0 | 0 | **0** | Full |
| **Paid** leave type, half day — other half worked | 0.5 | 0.5 | **0** | Full |
| **Paid** leave type, half day — other half **not** worked | 0.5 | 0 | **0.5** | Half |
| **Unpaid** (`LOP`) leave type, full day | 0 | 0 | 1.0 | None |
| **Unpaid** (`LOP`) leave type, half day | 0 | 0 | 1.0 | None |
| Absent, no leave | 0 | 0 | 1.0 | None |
| Late, incl. past half-day threshold | 0 | 1.0 | 0 | Full — display only |
| Permission / short hours | 0 | 1.0 | 0 | Full — informational |
| Balance exhausted on a paid type | 1.0 (full) | — | **0** | Full — flagged only |

## Scope
1. Paid leave always paid in full; balance becomes a flag, not a deduction.
2. Reconcile existing approved leaves + the affected payroll rows.
3. Attendance report counts a half-day leave as **0.5 leave days**.
4. Attendance report flags a normal day whose arrival crossed the half-day threshold.
5. Fix `daysWorked` persisting `0` for every non-employer.
6. Retroactive leave against a locked payroll auto-reopens and re-runs that cycle.
7. Payslip states payable days and the LOP arithmetic explicitly.

Out of scope: Kavin's `2026-07` draft (`present 10 / lop 16 / net ₹5,384.04`) — stale/legacy, not chased.

---

## 1. Paid leave is always paid

`src/lib/models/Leave.js` — add an `isPaid: { type: Boolean, default: true }` snapshot so payroll
never has to re-resolve the policy (and survives policy edits).

`src/app/api/leave/route.js` L471-487 — replace the balance-clamping split:
```js
let paidDays = days;
let unpaidDays = 0;
if (!typeConfig.isPaid) { paidDays = 0; unpaidDays = days; }
// Balance no longer clamps payable days. Track it for reporting only.
```
Keep computing `allowedPaidDays` / `overallAvailable` purely to emit
`balanceWarning: { typeCode, available, requestedDays, shortfallDays }` so the UI can say
*"Casual Leave balance is exhausted (0 of 2.0 available) — this leave will still be paid in full."*

`src/lib/leave/reevaluate.js` `recomputePaidSplit` (L49-64) — same change; it must mirror the
creation path exactly or re-evaluation will reintroduce the split.
Also **remove `halfDay: { $ne: true }` at L175** — half-day leaves are currently excluded from
re-evaluation entirely, so a stale split on a half-day leave is never corrected.

`src/lib/leave/accrual.js` — no change to accrual maths; balance still increments `used` so
over-consumption is visible, and `available` is allowed to go negative.

`src/app/api/payroll/run/route.js` L184-198 — derive the ratio from the leave's own paid flag
instead of `paidDays / days`, which is what diluted Rishidharshini's 2-day leave to 0.19:
```js
const isUnpaidLeave = leave.typeCode === 'LOP' || leave.type === 'Loss of Pay' || leave.isPaid === false;
const paidRatio = isUnpaidLeave ? 0 : 1;
```
The unworked-half rule (§3) is orthogonal and stays.

## 2. Reconcile existing data

Approved leaves where the type is paid but `unpaidDays > 0`:
- Kavin: `6a7c2202107acac1c2d3e387` (12 Aug, 0.5 unpaid) and his 15 Sep 1-day (0.5 unpaid).
- Rishidharshini: her 26–27 Aug 2-day (1.62 unpaid).

For each, set `paidDays = days`, `unpaidDays = 0`, and re-apply the balance (`used -= unpaidDays`
equivalent) so the ledger stays consistent. Ship as an idempotent one-shot script under `scripts/`
(dry-run mode first, printing every row it will touch).

Then re-run payroll for the affected cycles so `2026-09` reflects the correction:
- Kavin `2026-09` — expect `unpaidLeaveDays 0`, `lopDays 1.0` (absent 09-05 only),
  `salaryPerDay 782.61`, `lossOfPay 782.61`, `netPay ≈ ₹15,678.39`.
- Rishidharshini `2026-09` — expect `paidLeaveDays 2.0`, `unpaidLeaveDays 0`, `lopDays 5.0`,
  `lossOfPay 3,260.85`, `netPay ≈ ₹10,456.65`.

## 3. Payroll — half-day leave is a leave allowance

`src/app/api/payroll/run/route.js` L184-199. Today a half-day leave on a day the employee **never
clocked in** leaves the other 0.5 of the working day unaccounted for: `absentDays` skips it (status
is `half_day`, not `absent` — L166) and the leave side credits only 0.5, so `lopDays` lands on 0 and
the employee is **over-paid**.
```js
let unpaidHalfDayRemainder = 0;
...
  const workedThatDay = clockedDates.has(d);
  if (workedThatDay && !leave.halfDay) continue;
  const credit = leave.halfDay && lopConfig.countHalfDay !== false ? 0.5 : 1;
  paidLeaveDays   += credit * paidRatio;
  unpaidLeaveDays += credit * (1 - paidRatio);
  // Half-day leave on a day never clocked in: the remaining half of the
  // working day is neither worked nor covered by leave.
  if (leave.halfDay && !workedThatDay) unpaidHalfDayRemainder += 0.5;
```
- Fold `unpaidHalfDayRemainder` into `unpaidLeaveDaysVal` (L200-201) so the persisted breakdown and
  `lopDays` (L205) stay one consistent number.
- Rewrite the comment block at L177-180 to match the locked-rules table.

`src/lib/attendance-resolver.js` — `classifyPresence`
- Collapse L122/L123 into one rule: `if (rec.approvedHalfDayLeave || rec.status === 'half_day') return 0.5;`
- Rationale: `countHalfDay: false` currently **double-credits** — 1.0 presence *and* 0.5 paid leave =
  1.5 payable days for one working day. "Pay a half-day leave as a full day" now lives solely on the
  leave-credit side (`credit = 1`), keeping the unworked-half rule consistent.
- Update the docblock (L98-112).

## 4. `daysWorked` always persists as 0 — shadowed variable

`src/app/api/payroll/run/route.js` declares `let daysWorkedVal = 0;` **twice** — L92 and again L162
inside the `else` block. The inner declaration shadows the outer, so the value persisted at L260 is
the outer one, assigned only in the employer branch (L100).

Live proof: Rishidharshini `2026-09` → `presentDays: 16`, `daysWorked: 0`. Kavin `2026-09` →
`presentDays: 20.5`, `daysWorked: 0`. Both payslips claim zero days worked.

- Delete the inner `let daysWorkedVal = 0;` at L162.
- Audit `presentDays`, `absentDaysVal`, `paidLeaveDaysVal` — re-assigned at L160-161 so they are
  safe today, but drop the redundant declarations for clarity.
- Keep `daysWorked` (integer "turned up", via `isWorkedDay`) distinct from `presentDays`
  (fractional payroll credit) and label them unambiguously on the payslip.

## 5. Attendance report — fractional leave totals

`src/lib/attendance-stats.js`
- Keep `stats.leave` = **integer row count** — it is an operand of the reconciliation identity at
  L162; changing it would break the loud integrity check.
- Add `stats.leaveDays` = `fullLeaveRows * 1 + halfDayLeaveRows * 0.5`.
- Add `stats.fullDayLeave` = `leave.length - halfDayLeaveRows`.
- Export a shared `leaveDayWeight(rec)` (`1` / `0.5` / `0`) so `/api/reports` cannot drift.
- Update the docblock (L7-19): a half-day-leave day contributes **0.5** to `leaveDays`, **1 row** to `leave`.
- `reconciliationLine()` (L168) stays integer.

Consumers
- `src/app/(protected)/attendance/page.js` L2951 — `Days of Leave` card shows `stats.leaveDays`, plus `(N half-day)` when `stats.halfDayLeave > 0`.
- `src/lib/attendance-team-export.js` L267 (Excel), L438 (PDF) — `On Leave: ${st.leaveDays} (${st.halfDayLeave} half-day)`.
- `src/app/api/reports/route.js` L68-73 — accumulate `leave += leaveDayWeight(r)`; keep the separate `halfDay` count column; L87 `Total Leave Days` becomes fractional.
- `src/app/api/attendance/report/route.js` — CSV has **no** leave or half-day visibility today. Add `Leave Credit` and `Past Half-day Threshold` columns.

## 6. Half-day threshold flag on a normal working day

The flag is already computed everywhere (`attendance-constants.js:145-151` → `halfDayThresholdExceeded`;
`isLatePastThreshold` at `attendance-stats.js:49-51`; dashboard today-cards `page.js:1706-1708`).
Only the **team report row** never renders it.

- `page.js` Flag column (L3031-3051), beside the existing `Half-day` badge at L3038 — add `Half-day · late` when `isLatePastThreshold(row)`, colours `#ffedd5`/`#ea580c` (`src/lib/constants.js:5`).
- Same badge in the mobile card flag row (L3060-3108).
- `displayStatusOf(row)` still returns `'late'` — status stays Late, the badge is the flag. **No payroll effect** (`classifyPresence` returns 1 for any `late` row, `attendance-resolver.js:125`).

## 7. Retroactive leave → auto-reopen and re-run the affected cycle

**7a.** Extract `POST /api/payroll/run`'s 300 inline lines to `src/lib/payroll-run-engine.js` exporting `runPayrollForMonth({ month, userIds, actor })`; the route becomes a thin wrapper calling it with all active employees.

**7b.** New `src/lib/payroll-reopen.js`:
- `affectedPayrollMonths(fromDate, toDate, config)` — map leave dates through `getCycleMonth` (`src/lib/payroll-cycle.js:159`).
- `reopenPayrollForLeave(leave)` — per month `Payroll.findOneAndUpdate({ userId, month, status: { $in: ['approved','finalized'] } }, { $set: { status: 'draft' } })`; collect reopened months; `auditLog('Payroll Reopened', ...)`.
- Reset `retroAdjustedInPayroll` so the leave is not double-counted once recomputed in-cycle.

**7c.** `src/app/api/leave/[id]/route.js` — inside the `newStatus === 'approved'` block after balance deduction (L175-214) and after `materializeLeaveAttendance` (L262-288 / L315), call `reopenPayrollForLeave` then `runPayrollForMonth({ month, userIds: [leave.userId], actor: user })`. Return `reopenedPayrollMonths`.

**7d.** The `finalized`/`approved` continue guards (L74-76) must be bypassed for explicitly reopened months only.

**7e.** `payroll/run/route.js:208-213` filters retro leaves on `isRetroactive` alone with **no date filter**, so a backdated leave lands on whatever cycle runs next. Add `to: { $lt: fromDate }` so only leaves that closed *before* this cycle start push a retro adjustment. Update the comment at `leave/route.js:504-505`.

## 8. Payslip clarity

`src/app/(protected)/payroll/page.js` print view L164-169:
- Keep `Days Present (credit)`, `Days Worked`, `Absent Days`, `Paid Leave Days`.
- Add **`Payable Days`** = `workingDays − (effectiveLopDays + retroLopDays)`, with `Leave Credit` = `paidLeaveDays` beneath.
- `LOP Days` — add the proof `LOP ₹ = ₹{salaryPerDay} × {days}` under the value.
- Fix the "Days Worked" label after §4.
- Register table (L349) shows `p.lossOfPay` only — **retro LOP is invisible**. Add it to the `LOP (₹)` column or a separate one.

`src/lib/payroll-calculator.js` — return `payableDays` and `lopBase` so the UI never recomputes them.

## Files touched
| File | Change |
|---|---|
| `src/app/api/leave/route.js` | paid-always split, `balanceWarning` in response |
| `src/lib/models/Leave.js` | `isPaid` snapshot field |
| `src/lib/leave/reevaluate.js` | mirror new split; stop excluding half-day leaves (L175) |
| `src/app/api/leave/[id]/route.js` | warning payload on approval; trigger reopen + scoped re-run |
| `src/app/api/payroll/run/route.js` | `isPaid`-based `paidRatio`; `unpaidHalfDayRemainder`; **remove `daysWorked` shadowing**; retro-LOP date scope |
| `src/lib/payroll-run-engine.js` | **new** — extracted run logic, `userIds`-scoped |
| `src/lib/payroll-reopen.js` | **new** — affected-cycle detection + reopen + audit |
| `src/lib/attendance-resolver.js` | `classifyPresence` half-day rule unified to 0.5 |
| `src/lib/attendance-stats.js` | `leaveDays`, `fullDayLeave`, `leaveDayWeight()`, docblock |
| `src/app/(protected)/attendance/page.js` | 0.5 leave card + sub-label; half-day-threshold Flag badge (desktop + mobile) |
| `src/lib/attendance-team-export.js` | Excel/PDF `On Leave` chip uses `leaveDays` |
| `src/app/api/reports/route.js` | fractional `leave`, shared helper |
| `src/app/api/attendance/report/route.js` | `Leave Credit` + `Past Half-day Threshold` CSV columns |
| `src/lib/payroll-calculator.js` | return `payableDays`, `lopBase` |
| `src/app/(protected)/payroll/page.js` | `Payable Days` line, LOP proof, retro LOP in register |
| `scripts/reconcile-paid-leave.js` | **new** — one-shot, idempotent, dry-run-first data fix |

## Verification
- `npm run lint` && `npm run build`. No Next.js API changes (route handlers + libs only), so `node_modules/next/dist/docs/` is not required — read it if anything surfaces.
- **Reconciliation gate:** Rishidharshini `2026-09` → `presentDays 16`, `daysWorked 16`, `absentDays 5`, `paidLeaveDays 2.0`, `unpaidLeaveDays 0`, `lopDays 5.0`, `netPay ≈ ₹10,456.65`.
- **Kavin gate:** `2026-09` → `unpaidLeaveDays 0`, `lopDays 1.0` (absent 09-05 only), `lossOfPay 782.61`. His 12 Aug half-day SL → `paidDays 0.5`, `unpaidDays 0`, 1 day wage.
- **Reconciliation-identity gate:** `workingDays = worked + leave + absent + notArrived` still holds after §5 — the fractional `leaveDays` must **not** enter the identity.
- Locked-rules matrix: seed one employee per row, re-run, assert exact `presentDays / paidLeaveDays / lopDays / netPay`.
- Report gate: a month with one full-day and one half-day paid leave must show `Days of Leave 1.5`, `workingDays = worked + leave + absent + notArrived` unchanged.
- Badge gate: a `late` row with `halfDayThresholdExceeded: true` shows `Half-day · late` in the Flag column and still pays a full day.
- Reopen gate: approve a backdated leave against a finalized cycle → cycle returns to `draft`, re-run honours the leave, audit log records the reopen.