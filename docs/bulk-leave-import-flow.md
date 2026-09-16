# Bulk Leave Import — Flow Document

**Who this is for:** HR Executives, HR Managers, and Admins who manage leave data but do not write code.
**Where it lives in the app:** Leave page → **Bulk Import** button → `/leave/bulk`.
**Who can use it:** Super Admin and Admin (Full) only. Other roles will see an "access" message.

---

## 1. What this page does (in one paragraph)

Bulk Leave Import lets you upload many leave records at once from an Excel or CSV file instead of opening
each employee's profile one by one. It has two tabs. The **Leave Balance** tab sets or fixes how many
leaves each employee has. The **Leave History** tab creates past leave records (for example, when you
move from an old HR system into this one). Nothing is saved until you press **Confirm Import** — you
always get a chance to review and fix mistakes first.

---

## 2. When do you need this module?

| Scenario | Which tab? | Why |
|---|---|---|
| Starting the HR system this year and need to set everyone's leave entitlement | Leave Balance | One upload sets all opening balances |
| Leave policy changed mid-year (e.g. everyone gets 2 extra Casual Leaves) | Leave Balance | One upload adds the correction for many staff |
| Carried-forward days from last year are wrong | Leave Balance | One upload reconciles the carry-forward numbers |
| Moving from an old HR system with a list of past leaves | Leave History | Past leaves appear in reports, attendance, and payroll |
| Past approved leaves still show as "absent" in attendance | Leave History | Approved imports also create attendance entries |

**Not for this page:** a single employee applying for one leave. Employees still use
Leave → Apply Leave for themselves.

---

## 3. Before you start

1. You must be logged in as **Super Admin** or **Admin (Full)**.
2. Your file must be **Excel (.xlsx / .xls) or CSV**, with **maximum 500 rows and 3 MB**.
   Bigger lists must be split into two or more files.
3. Each employee in the file is identified by **Email** or **Employee Code** (like `CHC-2026-0001`).
   Fill at least one of the two per row. If you fill both, they must belong to the same person —
   otherwise that row is flagged as an error and skipped.

---

## 4. The common flow (same for both tabs)

```
1. Download template → 2. Choose file → 3. Pick a mode → 4. Check file
→ 5. Review the preview → 6. Confirm Import → 7. See the result
```

**Step 1 — Download template.**
Next to the tab names (Leave Balance / Leave History) there is a
**Balance template (.xlsx)** or **History template (.xlsx)** button on the right.
Click it. You get a ready-made Excel file with the correct column headings and one example row.
Do not rename the headings.

**Step 2 — Choose file.**
In the **Source file** card, click **Choose file** and select your filled Excel or CSV.
A small pill appears showing the file name and size, with a × button to remove it.
Below the button you will see the limits reminder
(Matched by Email or Employee Code · 500 rows · 3 MB).

**Step 3 — Pick a mode** (in the **Options** card — meaning explained in sections 5 and 6).

**Step 4 — Check file.**
Click **Check file**. This is a **dry run**: the system reads every row and checks it,
but **saves nothing**. Your original file is also automatically saved to secure cloud
storage at this point (see section 8), so there is always a copy of what you uploaded.

**Step 5 — Review the preview.**
A Preview table appears. Every row is marked:
- **OK (green)** — correct, will be imported.
- **Red error text** — problem with a plain reason, for example
  "Employee email not found" or "Dates overlap with an existing approved leave".

Useful tools here: the **Errors only** tick-box (shows just the bad rows) and
**Error CSV** (downloads the list of bad rows so you can fix them in Excel and check again).
You can re-check as many times as you like — nothing is saved yet.

**Step 6 — Confirm Import.**
Click **Confirm Import (n)**. Only the valid rows are saved; invalid rows are skipped automatically.
You are asked to confirm once more before anything is written.

**Step 7 — See the result.**
A banner tells you, for example, "45 succeeded, 3 failed", with the reasons for the failures.
If the import succeeded, a link **View file** points to the archived copy of your upload
in Documents → HR.

---

## 5. Leave Balance tab — step by step

**What the columns mean (Balance template):**

| Column | What to fill |
|---|---|
| employeeEmail | Employee's login email (or leave blank if you give the code) |
| employeeCode | Employee Code like `CHC-2026-0001` (or leave blank if you give the email) |
| typeCode | Leave type code, e.g. `CL`, `SL`, `PL` — must exist in that employee's leave policy |
| allocated | Leave days granted |
| used | Leave days already taken |
| pending | Leave days awaiting approval |
| carriedForward | Days carried from last year (only if that leave type allows it) |
| expiryDate | Expiry of carried days, if any (`YYYY-MM-DD`) |
| cycleYear | The leave year, e.g. `2026` (defaults to the current year) |
| reason | Why you are changing the balance (required, minimum 5 characters — kept for audit) |

**Mode — Add vs Overwrite:**

| Mode | Meaning | Example |
|---|---|---|
| **Add (delta correction)** | Adds your numbers to the current balance | File says `allocated = 2` → employee who had 12 now has 14 |
| **Overwrite (opening balance)** | Replaces the balance with your exact numbers | File says `allocated = 12, used = 2` → balance becomes exactly that |

Use **Overwrite** when setting opening balances for migration. Use **Add** for corrections.
With Overwrite, the system refuses rows where taken + pending days are more than granted +
carried days (that combination is impossible, so it must be a data mistake).

**After Confirm:** the balance numbers change immediately and are visible on the Leave page
balance cards. Every import is recorded in the audit log with who did it and when.

---

## 6. Leave History tab — step by step

**What the columns mean (History template):**

| Column | What to fill |
|---|---|
| employeeEmail / employeeCode | Same as Balance (one of them is enough) |
| typeCode | Leave type code, e.g. `CL`, `SL` |
| from / to | Leave dates in `YYYY-MM-DD` format, e.g. `2026-06-10`. `to` cannot be before `from` |
| halfDay | `TRUE` or `FALSE`. `TRUE` only for a single day (`from` = `to`) |
| halfDayType | If halfDay is `TRUE`: `first_half` or `second_half` |
| reason | Why the leave was taken (required, minimum 5 characters) |
| status | `approved` or `pending` (the page-level mode you pick decides for the whole file) |
| paidDays / unpaidDays | Leave blank — the system calculates working days from the company calendar |

**Mode — Approved vs Pending:**

| Mode | What happens on Confirm |
|---|---|
| **Approved** | Creates the leave record, deducts the paid days from the employee's balance, and creates attendance entries marked "Leave" for those dates (so they stop showing as absent). If the leave is from a past month whose payroll is already closed, it is flagged for adjustment in the next payroll run instead of changing the closed month. |
| **Pending** | Creates a leave request that appears in the managers' Approvals queue. Only the "pending" part of the balance moves; no attendance entries are created until a manager approves. |

**Skip eligibility tick-box:** normally the system checks that the employee is actually eligible
for the leave type (for example, a leave type meant only for female employees cannot be imported
for a male employee). Tick **Skip eligibility** only when migrating old data that you trust and
want imported as-is.

**After Confirm:** approved leaves appear on the Leave page and in attendance; pending leaves
appear in Pending Approvals for managers.

---

## 7. Reading the preview and fixing errors

Fix the red rows in your Excel and press **Check file** again. The most common messages:

| Message you see | What it means | What to do |
|---|---|---|
| Employee email not found / Employee code not found | Typo, or the person is not in the system | Correct the email/code or remove the row |
| Email and code belong to different employees | The two columns point to two different people | Fix one of them so both match the same person |
| Leave type X is not enabled in policy Y | That department/role does not have this leave type | Change the type code or remove the row |
| Dates overlap with an existing approved/pending leave | The employee already has a leave covering those dates | Change the dates or remove the duplicate row |
| Overlaps row N in this file | Two rows in your own file cover the same dates | Merge or fix the two rows |
| Half-day leave must be a single day | `from` and `to` differ but halfDay is TRUE | Set both dates equal, or set halfDay to FALSE |
| This leave type is only for male/female employees | Gender-restricted type (e.g. maternity/paternity) | Correct the row, or tick Skip eligibility for migration |
| used+pending exceeds allocated+carriedForward | Impossible balance numbers | Correct the numbers in the row |
| carriedForward exceeds max N for X | More carried days than the policy allows | Reduce to the allowed maximum |
| Dates contain only holidays/weekends | The range has zero working days | Check the dates |
| reason is required (min 5 characters) | Reason too short or empty | Write a proper reason |

---

## 8. Where your uploaded file lives (cloud storage)

You don't need to do anything — it happens automatically:

1. When you press **Check file**, your original Excel/CSV is saved to secure cloud storage
   (a separate folder for bulk imports, not mixed with other documents).
2. In the Source file card you will see a green **Archived to Cloudinary — View file** badge
   with a link to open the uploaded file. If saving ever fails, you see an amber note instead —
   **this never blocks your validation**; you can still review and import.
3. When you press **Confirm Import** and at least one row succeeds, a copy is also filed under
   **Documents → HR** (visible to admins, named like `Bulk Leave Balance (delta) — 2026-…`),
   so the file can be re-downloaded later or deleted through the normal Documents trash flow.

---

## 9. Do and Don't

**Do:**
- Always download a fresh template before preparing a file.
- Fill Email or Employee Code carefully — most errors come from typos here.
- Press Check file and fix all red rows before confirming.
- Write a clear reason in every row (it becomes the audit trail).
- Split files larger than 500 rows.

**Don't:**
- Don't use Overwrite unless you mean to replace balances — prefer Add for corrections.
- Don't import the same file twice — the second run will be blocked as overlapping duplicates.
- Don't tick Skip eligibility unless you are migrating trusted historical data.

---

## 10. Frequently asked questions

**Email or Employee Code — which is better?**
Either works. Employee Code is the most reliable because emails can change; if you have the
code column from an HR export, use it.

**I picked the wrong mode. Can I undo?**
Balances changed with Add can be corrected with another Add file (e.g. −2).
Overwritten balances can be re-overwritten with the right numbers.
Approved history leaves can be cancelled like normal leaves and the balance is restored.

**The preview shows 0 valid rows. What now?**
Download Error CSV, fix the file (usually headers renamed or wrong date format —
dates must be `YYYY-MM-DD`), and check again.

**Will bulk import disturb a closed payroll month?**
No. Approved leaves falling inside a finalized payroll month are flagged for adjustment
in the next run instead of silently changing the closed month.

**Where is the proof of what I uploaded?**
Two places: the audit log records who imported what and when, and the original file
is kept in Documents → HR after every successful import.

---

## 11. Glossary

- **Allocated** — leave days granted for the year.
- **Used / Pending** — days already taken / awaiting approval.
- **Carried forward** — unused days brought from the previous year.
- **Cycle year** — the leave year the balance belongs to (usually the current year).
- **Type code** — short code of a leave type (`CL` = Casual, `SL` = Sick, `PL` = Privilege, etc.).
- **Dry run** — the Check file step: full validation with zero saving.
- **Archive** — the automatic cloud copy of your uploaded file.

---

*[Screenshots to attach: 1) empty Balance tab, 2) empty History tab, 3) selected file chip,
4) preview with valid + one red row, 5) result banner with View file link.]*
