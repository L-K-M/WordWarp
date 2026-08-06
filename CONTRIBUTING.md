# Contributing

Use Node.js and npm versions from `.nvmrc` and `package.json`, then install with `npm ci`.

Before opening a pull request, run:

```bash
scripts/check.sh --install-browsers
docker compose up --build --detach --wait
docker compose down --volumes
```

Keep changes focused and include tests for behavior changes. Document model or IndexedDB schema
changes require migrations and fixture-backed tests. PWA changes require production-build offline and
base-path coverage. Do not commit generated builds, browser reports, local environment files, or
secrets. See `AGENTS.md` for architectural invariants and `CICD.md` for automation details.
