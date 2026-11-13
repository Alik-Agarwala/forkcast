# Publishing

Forkcast ships two packages from this repository:

| Package | Registry | Source | Section |
| --- | --- | --- | --- |
| `forkcast` | npm | repository root | [npm](#publishing-to-npm) |
| `forkcast-sdk` (import `forkcast`) | PyPI | `python/` | [PyPI](#publishing-the-python-sdk-to-pypi) |

They are versioned independently. Bump the Python package when the Python code changes, and the npm package when the JS code changes.

## Publishing to npm

### One-time setup

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

### Release checklist

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

### Pre-releases

```bash
npm version prerelease --preid beta   # 0.2.0-beta.0
npm publish --tag beta                # users opt in with npm install forkcast@beta
```

### Automating with GitHub Actions (optional)

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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm publish --provenance
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

### Semantic versioning rules for this project

- **Major**: anything that changes which treatment an existing user gets (hashing, precedence), removes an export, or changes the config format incompatibly.
- **Minor**: new features, new options with backwards-compatible defaults, new API endpoints.
- **Patch**: bug fixes, docs, dashboard polish.

## Publishing the Python SDK to PyPI

The name `forkcast` is taken on PyPI by an unrelated project, so the distribution is called **`forkcast-sdk`**. Users still write `import forkcast`.

### One-time setup

1. Create an account on <https://pypi.org> and enable two-factor authentication.
2. **Recommended: trusted publishing (no tokens).** On PyPI go to *Your account → Publishing → Add a new pending publisher* and enter:
   - PyPI project name: `forkcast-sdk`
   - Owner / repository: the GitHub owner and repository name
   - Workflow name: `publish-python.yml`
   - Environment name: `pypi`

   Then create an environment called `pypi` in the GitHub repository settings (*Settings → Environments*). You can add required reviewers there so every release needs a click.

### Release checklist

```bash
cd python
pip install -e ".[dev]"
pytest && ruff check . && mypy
```

1. Bump `__version__` in `python/src/forkcast/_version.py` (the user agent and `pyproject.toml` read it from there).
2. Add a `CHANGELOG.md` entry (prefix Python-only entries with **Python:**).
3. Commit, then tag and push. The tag format is `python-v<version>`:

   ```bash
   git tag python-v0.1.0
   git push origin python-v0.1.0
   ```

   `.github/workflows/publish-python.yml` runs the tests, builds the wheel and sdist, checks them with `twine` and uploads to PyPI. It can also be started by hand from the *Actions* tab.

4. Check it works for users:

   ```bash
   pip install forkcast-sdk==0.1.0
   python -c "import forkcast; print(forkcast.__version__)"
   ```

### Publishing by hand (without GitHub Actions)

Create an API token on PyPI (*Account settings → API tokens*), then:

```bash
cd python
python -m build                 # python/dist/forkcast_sdk-<version>.tar.gz and .whl
twine check dist/*
twine upload dist/*             # username: __token__, password: your pypi-... token
```

Try it on TestPyPI first with `twine upload --repository testpypi dist/*` and `pip install -i https://test.pypi.org/simple/ forkcast-sdk`.

### Versioning

Same rules as npm. Anything that changes which treatment a user gets is a **major** change in both SDKs at once, and it should never happen (see the hashing invariant).
