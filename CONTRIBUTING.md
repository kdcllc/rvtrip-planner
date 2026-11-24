# Contributing

Thanks for taking the time to contribute. This file covers how to set up, what a pull request must pass, and how commits are named.

## Development setup

Follow [QUICKSTART.md](QUICKSTART.md) to run the app locally. The npm scripts and the project layout are listed in [README.md](README.md).

## Branch and pull request flow

1. Fork the repository, or create a branch if you have write access. Branch from `master`.
2. Name the branch after the kind of change, for example `feat/admin-test-email` or `fix/admin-route-404`.
3. Keep each pull request to one change. Add or update tests for behavior you change, and update the docs when a command, setting or workflow changes.
4. Open the pull request against `master` and fill in the pull request template.
5. A push to `master` deploys the live site (`.github/workflows/azure-dev.yml`), so changes reach `master` through reviewed pull requests.

## Checks a pull request must pass

Two workflows run on every pull request: **PR Checks** (`.github/workflows/pr-checks.yml`) and **Secret Scan** (`.github/workflows/secret-scan.yml`). Run the same checks locally before you push:

| Check | Command | Where |
|---|---|---|
| Type check | `npx tsc -b` | repo root |
| Lint | `npm run lint` | repo root |
| Tests | `npm test` | repo root |
| API tests | `npm test` | `api/` |
| Build | `npm run build` | repo root |
| Secret scan | gitleaks, configured by `.gitleaks.toml` | runs in CI |

Tests must not call live services: mock all network and database access.

## Commit messages

Commits use conventional prefixes, with an optional scope, followed by a short summary in the imperative:

```
feat: admins invite any address and copy the one-time invite link
fix(api): move admin invite-request routes from /api/admin to /api/manage
refactor(ci): move deploy-workflow database steps into scripts/ci-db.sh
```

Prefixes used in the history so far: `feat`, `fix`, `refactor`, `chore`. Use `docs` or `test` for changes of that kind.

## Secrets

Never commit a secret, connection string or API key. Keep local values in `.env` or `api/local.settings.json`, both git-ignored. `.env.example` holds names and placeholders only. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
