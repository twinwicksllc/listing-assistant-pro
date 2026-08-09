## Contributing — Formatting & Pre-commit Checks

We use Prettier + ESLint to enforce consistent style. To keep commits fast, we only run formatting and lint on staged files via `lint-staged` and Husky.

Local setup

1. Install dependencies:

```bash
npm ci
```

2. Install Husky hooks (runs automatically after `npm ci` if `prepare` script exists):

```bash
npm run prepare
# or if you need to re-install hooks
npx husky install
```

3. Make a change, stage files, and commit. The pre-commit hook will run `lint-staged` which runs Prettier and ESLint on staged files only.

Commands

- Format staged files only (via lint-staged):

```bash
# stage files first
git add <files>
git commit -m "..."
```

- Manually format the entire repo:

```bash
npm run format
```

CI

The repository includes a GitHub Actions workflow (`.github/workflows/pre-commit-checks.yml`) that runs `npm run format:check` and `npm run lint` on pull requests and pushes to `main`. Fix issues locally before pushing to speed up reviews.

If you prefer a different editor integration (e.g. VS Code format on save), enable Prettier integration in your editor and add a recommended extension in `.vscode/extensions.json`.

Thanks for contributing — clean commits make reviews faster!
