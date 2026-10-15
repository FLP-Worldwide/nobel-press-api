# Deploy the API to Vercel

The API and website are separate Vercel projects. Deploy this repository to
`nobel-press-api`; the website uses `nobelbooks`.

## Project settings

- Root directory: this repository's root (or `nobel-press-api` if imported from a parent repository).
- Framework preset: Express.
- Node.js: 24.x, pinned in `package.json`.
- Install command: `npm ci --include=dev`.
- Build command: `npm run vercel-build`.
- Output directory: leave the override disabled. Express is a function, not a static `dist` site.

`vercel.json` supplies the framework and commands. The build explicitly runs
`prisma generate`, compiles TypeScript, and checks that the complete application,
Prisma Client and bcrypt can load. `npm run build` does not connect to or migrate
a database. `npm run vercel-build` also applies checked-in PostgreSQL migrations
when `VERCEL_ENV=production`; preview builds skip migrations.
The four dependency install scripts are approved by exact installed version in
`package.json`; update those approvals when upgrading those dependencies.

## Environment variables

Set these in the **API** project's Production environment (and separately for
Preview if you use it):

| Name | Value |
| --- | --- |
| `nobel_book_api_DATABASE_URL` | Supplied by the existing Prisma Postgres integration. The API and release script prefer this managed PostgreSQL TCP connection over the old `DATABASE_URL`. Keep the integration value private. |
| `DATABASE_URL` | PostgreSQL TCP connection for environments without that integration. The old MySQL/localhost value is obsolete. |
| `DIRECT_URL` | Optional direct PostgreSQL connection for migrations when a separate pooler requires it. Must point to the same database as the application's connection. |
| `JWT_SECRET` | Your existing production signing secret. Keep it private and stable across deployments. |
| `ALLOWED_ORIGIN` | `https://nobelbooks.vercel.app` |
| `AWS_REGION`, `S3_BUCKET` | Your existing storage configuration, with appropriate AWS credentials/role for uploads. |

Additional frontend domains can be comma-separated in `ALLOWED_ORIGIN`. Use exact
origins (scheme and hostname, without paths); wildcards are not permitted with
credentialed requests. Whitespace and trailing slashes are normalized. If this
variable is absent, production defaults to `https://nobelbooks.vercel.app`;
development defaults to localhost port 3000. An existing localhost-only value
overrides the default and must be corrected in Vercel.

In the **website** project set:

```text
NEXT_PUBLIC_API_URL=https://nobel-press-api.vercel.app/api
NEXTAUTH_URL=https://nobelbooks.vercel.app
```

Keep the website's existing `NEXTAUTH_SECRET`. Changing a `NEXT_PUBLIC_` variable
requires rebuilding the website. Payment settings are separate from API startup;
configure the existing PhonePe variables before accepting payments.

## Database schema

The active schema uses PostgreSQL. `20261015090000_postgres_baseline` creates all
tables, constraints, review/payment models and cover artwork fields in an empty
PostgreSQL database. Production Vercel builds apply it with `prisma migrate deploy`;
subsequent builds apply only pending migrations. A migration failure stops the
deployment. The script rejects MySQL URLs and loopback addresses on Vercel, and
uses the same managed connection as the API unless `DIRECT_URL` is explicitly set.

The previous MySQL schema and migration history are preserved in
`prisma/legacy/mysql`. No MySQL database is modified or copied by this release.
Existing local users and books remain in MySQL; importing them is a separate data
migration. Do not reset an existing database, use `db push` against production,
or mark the new baseline as applied to bypass a nonempty-database error.

For a manual release, run `npm run prisma:migrate:deploy` with the intended
PostgreSQL connection in the environment. Local `.env` values only fill missing
environment variables. Local development now needs a PostgreSQL database; use
the updated `.env.example` instead of the previous local MySQL connection.

Use a separate database for preview deployments. The existing integration was
attached to both Production and Preview during diagnosis; skipping preview
migrations alone does not isolate preview application traffic.

## Release and verify

1. Push these changes to the repository connected to the API project and deploy
   that revision. Redeploying an older revision does not include this fix.
2. For the first redeploy, turn off **Use existing Build Cache**. Check the build
   log for `Generated Prisma Client`, `Runtime check passed`, and successful
   PostgreSQL migrations. A project-level build-command override must also use
   `npm run vercel-build`.
3. Open `/api` or `/api/health`: expect HTTP 200 and `status: ok`. This checks
   startup only.
4. Open `/api/health/ready`: expect HTTP 200 and `database: connected`. A 503
   indicates incomplete configuration or an unreachable database; Vercel's
   runtime logs distinguish them without putting secrets in the public response.
5. Check `/api/books/all`: expect HTTP 200 and a JSON array (an empty catalogue
   is valid). Readiness does not replace this check: a connected database can
   still have unapplied migrations.
6. Open the website and check the catalogue, then author sign-in. The API response
   to that website must include
   `Access-Control-Allow-Origin: https://nobelbooks.vercel.app`.

Local regression check: `npm run test:deployment`. It uses stubbed database calls
and a temporary loopback port; it never reads or modifies a real database.

## Diagnosing the reported 500

`FUNCTION_INVOCATION_FAILED` on `/api` means the function failed before an Express
response. Its missing CORS header can cause the browser to show a second CORS
error. The previous `tsc`-only build did not explicitly generate Prisma Client;
a clean install with scripts disabled reproduced a missing `.prisma/client/default`
module. The revised build fixes that reproducible startup failure and also fixes
the independent wildcard-array CORS fallback. The original exception was not
available in runtime logs at that point.

On October 15 the API's liveness route returned 200, but readiness returned 503
and the catalogue returned 500. Vercel's runtime log confirmed that
`prisma.book.findMany()` was attempting to connect to `127.0.0.1:3307`. The project
already had a Prisma Postgres integration, but the code still used MySQL and the
stale local `DATABASE_URL`. The PostgreSQL schema, managed-connection selection,
quoted cover-save locking query and production migration step address that mismatch.

References: [Vercel Express support](https://vercel.com/docs/frameworks/backend/express),
[Prisma 6 deployment guidance](https://docs.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-vercel),
[npm install script approvals](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).
