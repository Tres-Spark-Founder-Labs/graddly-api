# Database setup

Postgres is used with **Row Level Security (RLS)** for tenant isolation. The API must connect as a **non-superuser** role without `BYPASSRLS` so policies apply. Schema changes are applied by a separate **migrator** user.

## Roles

| Role            | Env vars                                         | Purpose                                                                                               |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Migrator**    | `DB_MIGRATION_USERNAME`, `DB_MIGRATION_PASSWORD` | Run migrations (`CREATE TABLE`, RLS policies, etc.). Typically `postgres` locally or a CI/admin user. |
| **Application** | `DB_USERNAME`, `DB_PASSWORD`                     | NestJS API and e2e tests. Must not be a superuser.                                                    |

Do **not** put the app password in migrations or source control for production. Create the role in your host (Railway, RDS, etc.) and set secrets there.

## RLS-protected tables

With `TENANT_DB_CONTEXT_ENABLED=true`, the migrator applies Row Level Security on PII / tenant tables. As of the invitations migration, that set includes `users`, `organisations`, `organisation_memberships`, `user_oidc_identities`, and **`invitations`**. The `invitations` policies mirror other org-scoped data: members of the target organisation can read; inserts require the inviter (`invitedByUserId`) to match the current user unless RLS bootstrap is active; updates and deletes are constrained to the active organisation context (`app.current_org`).

## First-time local setup

1. Create the database (if needed):

   ```bash
   createdb graddly
   ```

2. Copy env and set migrator + app credentials:

   ```bash
   cp .env.example .env
   ```

   ```env
   DB_MIGRATION_USERNAME=postgres
   DB_MIGRATION_PASSWORD=
   DB_USERNAME=graddly_app
   DB_PASSWORD=choose-a-dev-password
   DB_NAME=graddly
   TENANT_DB_CONTEXT_ENABLED=true
   ```

3. Run schema migrations **as the migrator** (`DB_MIGRATION_*` in `.env`):

   ```bash
   yarn migration:run
   ```

   The TypeORM CLI uses `DB_MIGRATION_USERNAME` / `DB_MIGRATION_PASSWORD` when set (`src/config/data-source.ts`); otherwise it falls back to `DB_USERNAME` / `DB_PASSWORD`.

4. Provision the application role and grants **after** migrations:

   ```bash
   yarn db:provision-role
   ```

5. Point the app at the application role in `.env` (`DB_USERNAME` / `DB_PASSWORD`), then start:

   ```bash
   yarn start:dev
   ```

Shortcut (migrations + provision in order):

```bash
yarn db:setup
```

## CI / e2e

CI runs `yarn db:provision-role` after `yarn migration:run`, then e2e with `DB_USERNAME=graddly_app`.

Locally, `test/global-setup.ts` also applies pending migrations, but it reads them
from `dist/`, so a new migration reaches the e2e database only after `yarn build`.
A missing or stale `dist/` is skipped silently, not reported. See "Building and
testing" in the README.

## Production / Railway

1. Create the database and an application user in the platform (or via SQL as admin).
2. Set `DB_USERNAME` / `DB_PASSWORD` in service secrets.
3. Run migrations in deploy as admin (`DB_MIGRATION_*`), not as the app user.
4. Run `yarn db:provision-role` once per environment after migrations (or replicate the same `GRANT`s in infra).
5. Disable relying on `migrationsRun: true` on app boot if the app user cannot run DDL; run migrations in the deploy pipeline only.

## Removed migration: `CreateGraddlyAppRole`

The app role was previously created in TypeORM migration `1777310000000-CreateGraddlyAppRole`. That has been **removed** in favour of this script.

If your database already recorded that migration, delete the row (role can stay):

```sql
DELETE FROM migrations WHERE name = 'CreateGraddlyAppRole1777310000000';
```

## Scripts

| Command                  | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `yarn db:provision-role` | Create/update app role and grants (idempotent)     |
| `yarn db:setup`          | `migration:run` then `db:provision-role`           |
| `yarn migration:run`     | Apply schema migrations (use migrator credentials) |
