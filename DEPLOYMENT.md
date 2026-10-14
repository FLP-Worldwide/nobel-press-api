# Deploy the API to Vercel

The API and website are separate Vercel projects. Deploy this repository to
`nobel-press-api`; the website uses `nobelbooks`.

## Project settings

- Root directory: this repository's root (or `nobel-press-api` if imported from a parent repository).
- Framework preset: Express.
- Node.js: 24.x, pinned in `package.json`.
- Install command: `npm ci --include=dev`.
- Build command: `npm run build`.
- Output directory: leave the override disabled. Express is a function, not a static `dist` site.

`vercel.json` supplies the framework and commands. The build explicitly runs
`prisma generate`, compiles TypeScript, and checks that the complete application,
Prisma Client and bcrypt can load. It does not connect to or migrate a database.
The four dependency install scripts are approved by exact installed version in
`package.json`; update those approvals when upgrading those dependencies.

## Environment variables

Set these in the **API** project's Production environment (and separately for
Preview if you use it):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Your hosted MySQL connection string, with URL-encoded credentials. A localhost database cannot be reached by Vercel. |
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

Against the intended hosted database, run `npm run prisma:migrate:deploy` from
your release environment. The database needs every checked-in migration,
including `20261008063000_cover_canvas`. Do not run development resets or
`prisma db push` against production. Preview deployments should use a separate
database; migrations intentionally do not run automatically on every Vercel build.

## Release and verify

1. Push these changes to the repository connected to the API project and deploy
   that revision. Redeploying an older revision does not include this fix.
2. For the first redeploy, turn off **Use existing Build Cache**. Check the build
   log for `Generated Prisma Client` and `Runtime check passed`.
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
the independent wildcard-array CORS fallback. Production runtime logs are still
needed to confirm whether this was the exact exception in the failed deployment.

References: [Vercel Express support](https://vercel.com/docs/frameworks/backend/express),
[Prisma 6 deployment guidance](https://docs.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-vercel),
[npm install script approvals](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).
