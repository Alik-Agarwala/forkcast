# Publishing to npm

## One-time setup

1. Create an account on <https://www.npmjs.com> and enable two-factor authentication.
2. Log in from your terminal:

   ```bash
   npm login
   ```

3. Check the name is still available (it was when this project was created):

   ```bash
   npm view forkcast
   ```

   A `404` means it is free. If it is taken, rename the package in `package.json` (for example to a scope you own: `@your-name/forkcast`) and publish scoped packages with `--access public`.

## Release checklist

```bash
git checkout main && git pull
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run          # review the file list: dist/, README.md, LICENSE, CHANGELOG.md only
```

1. Update `CHANGELOG.md`.
2. Bump the version (this also creates a git tag):

   ```bash
   npm version patch   # 0.1.0 -> 0.1.1  bug fixes
   npm version minor   # 0.1.0 -> 0.2.0  new features
   npm version major   # breaking changes
   ```

3. Update `VERSION` in `src/cli/index.ts` to match (shown by `forkcast --version`).
4. Publish and push:

   ```bash
   npm publish          # prepublishOnly runs typecheck, tests and build again
   git push --follow-tags
   ```

5. Create a GitHub release from the tag with the changelog entry.

## Pre-releases

```bash
npm version prerelease --preid beta   # 0.2.0-beta.0
npm publish --tag beta                # users opt in with npm install forkcast@beta
```

## Automating with GitHub Actions (optional)

Add an `NPM_TOKEN` secret (an npm *automation* token) to the repository, then publish from a workflow on tag push:

```yaml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm publish --provenance
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

## Semantic versioning rules for this project

- **Major**: anything that changes which treatment an existing user gets (hashing, precedence), removes an export, or changes the config format incompatibly.
- **Minor**: new features, new options with backwards-compatible defaults, new API endpoints.
- **Patch**: bug fixes, docs, dashboard polish.
