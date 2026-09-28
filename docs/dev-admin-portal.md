# Dev Admin Portal (`/admin/dev-admin`)

Dev-only island next to the Policy Control Portal (`/admin/control-center`).
It reflects three existing super-admin screens as-is — no new business logic,
no new API routes.

## Surfaces

| Route | Renders | Same screen as |
|---|---|---|
| `/admin/dev-admin` | Hub with four module cards | — |
| `/admin/dev-admin/leave-bulk` | `BulkImportPage` (`src/components/dev-admin/BulkImportPage.js`) — Balance, History **and Attendance** tabs | `/leave/bulk` |
| `/admin/dev-admin/shift-assign` | `ShiftManagement` (`src/components/ShiftManagement.js`) | Core HR → Shifts pill |
| `/admin/dev-admin/shifts` | `ShiftMaster` + `ShiftFormModal` (`src/components/dev-admin/`) | Settings → Shifts tab |
| `/admin/control-center` | Unchanged policy + sandbox tabs | (linked from the nav) |

Shared banner/nav: `src/components/dev-admin/DevAdminNav.js` (also used by
control-center).

## Access control

- Allowlist: `DEV_ADMIN_EMAILS` in `src/lib/permissions.js` (currently
  `kavin.dev01@gmail.com`). Do not re-add the literal anywhere — import
  `isDevAdminEmail` / `DEV_ADMIN_EMAILS`.
- Nav visibility: `dev_admin` module key in `MODULE_ACCESS` (`permissions.js`);
  `getAccess()` returns `'full'` for allowlisted emails, `false` for everyone else.
- Route lock: `PersistentAppShell.js` keeps allowlisted users inside
  `/admin/control-center` + `/admin/dev-admin` (login still lands on
  control-center) and bounces everyone else off `/admin/*` to `/dashboard`.
- Data APIs are the existing role-gated endpoints
  (`/api/settings?type=shifts`, `/api/shifts/assign*`, `/api/leave/bulk/*`);
  the dev user passes them as `super_admin`. No dev-specific endpoints exist.
