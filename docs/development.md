# ade development

## Tools

| Tool | Version |
|---|---|
| Node.js | 24 LTS for development and CI (24.21.0 on 2026-10-11). Node.js 22 or later at runtime |
| npm | 11.6.2, from Node.js 24 |
| TypeScript | 7.0.2 for type checks and the build |
| TypeScript API | 6.0.3 as `typescript-api`, for the source comment parser only |
| Biome | 2.5.15 for format and lint |
| yaml | 2.9.1 for the YAML comment check |
| esbuild | 0.28.2 for the remote agent bundle |
| Next.js | 16.4.0 for the landing page in `site/` |
| React | 19.3.0 for the landing page |
| Tailwind CSS | 4.3.3 for the landing page |
| motion | 14.1.0 for the landing page animations |
| TypeScript in `site/` | 6.0.3, because Next.js type checks need the TypeScript API |
| pre-commit | 4.6.2 through `uvx` |
| uv | 0.12.19 or later |

## First setup

```bash
npm ci
npm ci --prefix site
```

Install the project dependencies before installing the hooks. The `site` gate needs the landing page dependencies.
Both hooks belong to this clone. A repository configuration file alone does not install them.

```bash
python3 tools/quality.py hooks-install
python3 tools/quality.py check
python3 tools/quality.py test
```

## Daily commands

```bash
npm run format
python3 tools/quality.py check
npm test
node src/cli.ts plan --profile <profile-dir> --home <scratch-home>
```

## Run the landing page

```bash
npm --prefix site run dev
```

`npm --prefix site run build` builds the site. The home page is static. `/dashboard` and `/<name>` need the API: set `ADE_API_ORIGIN` to its URL. Vercel builds the same folder for https://ade.chele.bi on each push to `main`.

## Run the accounts API

1. Install the API dependencies:

   ```bash
   npm ci --prefix server
   ```

2. Run the API checks. The tests use PGlite, an in-memory PostgreSQL:

   ```bash
   npm --prefix server run check
   ```

3. To also test against a real PostgreSQL server, set `ADE_TEST_DATABASE_URL` to a database URL. The test makes and drops its own database.
4. Start the API. It reads `PORT`, `DATABASE_URL`, `ADE_SITE_URL`, `ADE_PUBLIC_API_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD`:

   ```bash
   node server/src/main.ts
   ```

Without the three WorkOS variables, the API runs with the login off.

## Use the CLI from this clone

Node.js runs the TypeScript source directly:

```bash
node src/cli.ts --help
```

To get the `ade` command on this machine, build and link the package:

```bash
npm run build
npm link
ade --version
```

## Configuration

ade reads these variables. All are optional.

| Variable | Use |
|---|---|
| `ADE_PROFILE` | Default profile directory |
| `ADE_STATE_DIR` | State directory with `state.json` and the apply records |
| `ADE_CACHE_DIR` | Cache directory for Git skill sources |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, `PI_CODING_AGENT_DIR` | Harness home overrides |
| `ADE_API_URL` | The accounts API. Default: `https://ade-api.chele.bi` |
| `ADE_SITE_URL` | The site for page links and `ade.chele.bi/<name>` sources. Default: `https://ade.chele.bi` |
| `NO_COLOR` | Plain output |

A profile holds secret references only. Secret values come from the environment, a file, a command, or the macOS Keychain at apply time.

Keep secrets outside Git. Document required names and public values without copying secret values.
Keep local environment files ignored. Commit a safe example only when the project needs one.

## Reproduce the environment

Pin the development tools to exact versions in `package.json`. Commit `package-lock.json`. Use `npm ci` in CI. Tests create scratch home directories and never read the real home.
