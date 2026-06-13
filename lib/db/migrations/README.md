# Migrations

Migrations here are **hand-authored**, not generated.

- Write the SQL file `NNNN_name.sql`, splitting statements with `--> statement-breakpoint`.
- Register it in `meta/_journal.json` (`idx`, `version: "7"`, `tag`, `breakpoints: true`).
- Apply with `npm run db:migrate` (runs `lib/db/migrate.ts` against `DATABASE_URL`).

## Do NOT run `drizzle-kit generate`

Snapshot files in `meta/` are intentionally **not** maintained past `0004`. Running
`drizzle-kit generate` would diff the current schema against those stale snapshots and
emit destructive SQL (re-creating existing tables/columns/indexes). For that reason the
package script is named `db:generate:UNSAFE`, not `db:generate` — it exists only as a
deliberate escape hatch and must not be run without first regenerating the snapshots to
match the live database.

If you ever do need to reintroduce generated migrations, first produce accurate snapshots
for `0005`–`latest` (so the diff baseline is correct), then rename the script back.
