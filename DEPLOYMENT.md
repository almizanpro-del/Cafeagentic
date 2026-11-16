

---

## Automated CI/CD — GitHub Actions + Vercel

The repository includes `.github/workflows/ci-cd.yml` and two reusable scripts:

- `npm run ci` / `scripts/ci-verify.sh` runs lint, all Vitest tests, TypeScript, and the production build.
- `scripts/deploy-vercel.sh` links the project, deploys the verified commit to Vercel, and smoke-checks `/robots.txt`.

Every pull request runs the verification job. Every push to `main` runs verification and, only after it passes, deploys to the Vercel production project.

### GitHub configuration

Create a GitHub Actions environment named `production`, then add these environment secrets:

| Secret | Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel API/deployment token |
| `VERCEL_ORG_ID` | Vercel team or account scope ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `DATABASE_URL` | Pooled runtime database URL, used only when migrations exist |
| `DIRECT_URL` | Session/direct database URL for Prisma migrations |

The workflow uses Node 20 and `npm ci`, so `package-lock.json` must be kept in sync with `package.json`.

### Database migration safety

This repository currently has no committed `prisma/migrations/` directory and historically used `prisma db push` for initial setup. The production deployment script deliberately **does not** run `db push --accept-data-loss` and does not mutate the database when no migration history exists. It prints a warning and continues with the application deployment.

For team-managed schema changes, create and review migrations locally with:

```bash
npm run db:migrate
```

Commit the generated `prisma/migrations/` directory. Future main-branch deployments will then run:

```bash
npm run db:migrate:deploy
```

before deploying the application. Never add production credentials to repository files or use demo seed data in the production workflow.

### Manual checks

Run the same gates locally before pushing:

```bash
npm ci
npm run ci
```

A production deployment can be run locally with the Vercel CLI after exporting the required `VERCEL_*` variables:

```bash
./scripts/deploy-vercel.sh
```
