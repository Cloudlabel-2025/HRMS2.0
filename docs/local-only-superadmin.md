# Local-only seeded superadmin with a shared database

Run localhost with `npm run dev`. The existing `superadmin@hrms.com` account
can authenticate in development, but production rejects its login, access
tokens, refresh tokens, and attendance stream renewal. Other users keep their
existing access. `kavin.dev01@gmail.com` is exempt from this restriction and
retains its existing dev-admin portal access in both environments.

No database deletion or status change is needed. The seed account remains in
the shared database; this change restricts authentication, not its appearance
in every report, notification, or user list. Local writes still affect the
shared database.

Production configuration:

```dotenv
ENABLE_SEED_ROUTE=false
LOCAL_ONLY_ADMIN_EMAILS=
```

Do not configure `SETUP_TOKEN` or seed passwords in production. If an older
seed account uses a different email, put that email in
`LOCAL_ONLY_ADMIN_EMAILS` in both environments, then restart/redeploy. The
current `SEED_ADMIN_EMAIL`, when present, is also treated as local-only.
New seeded accounts receive a persistent `localOnly` marker, except for
the existing dev-admin email allowlist. The seed route checks the requested
email rather than refusing when any superadmin already exists, so Kavin and
the local seed account can coexist.

For first-time local seeding, configure `SETUP_TOKEN`, `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, and optionally `SEED_ADMIN_NAME` in `.env.local`.
POST to `/api/seed` with an `x-setup-token` header or a `setupToken` JSON field.
Existing accounts do not need to be reseeded.

`npm start` uses production mode even on localhost and blocks local-only
accounts. Production restrictions use the server environment, never the
request hostname. Use different `JWT_SECRET` values locally and in production
to keep the two environments' signed tokens separate.
