# Security Policy

## Supported versions

Only the latest commit on `master` is supported. Fixes are made there; there are no maintained release branches.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately with GitHub private vulnerability reporting: open the repository's **Security** tab, choose **Report a vulnerability**, and fill in the form. Include what is affected, the steps to reproduce it, and the impact you expect.

Reports are handled on a best-effort basis. Please give the maintainers time to release a fix before you disclose the issue publicly.

## Secrets

Never commit secrets: no connection strings, API keys, session secrets, invite codes or passwords, in code, docs, tests or fixtures.

- Local values belong in `.env` or `api/local.settings.json`, both git-ignored.
- `.env.example` holds variable names and placeholder values only.
- Deployed values are Static Web App application settings and azd environment values; see [DEPLOYMENT.md](DEPLOYMENT.md).

The **Secret Scan** workflow (`.github/workflows/secret-scan.yml`) runs gitleaks on every pull request and on every push to `master`, using the rules in `.gitleaks.toml`.

If you find a committed secret, or commit one by mistake, treat it as leaked: rotate it first, then report it through the private channel above. Removing it from the latest commit does not remove it from history.
