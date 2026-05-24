# Skills Manager

Locally-run application that manages AI-agent artifacts (skills, rules, …) across multiple source repositories and multiple working repositories, without polluting the working repos' git history.

See `docs/product-specification.md` for capabilities and `docs/design.md` for architecture.

## Requirements

- Node.js 20+
- git on PATH

## Install (from source)

```bash
npm install
npm run build
node bin/skillmgr.js
```

The first launch opens your browser to `http://127.0.0.1:7747` (or the next free port).

## Dev

```bash
# Terminal 1 — BE with auto-reload
npm run dev:be

# Terminal 2 — FE with HMR (proxies /api to BE)
npm run dev:fe
```

## Tests

```bash
npm test
```

## State location

State lives in the OS user-data directory:

- macOS: `~/Library/Application Support/skillmanager/`
- Linux: `~/.config/skillmanager/`
- Windows: `%APPDATA%\skillmanager\`

## Architecture

**Stack:** Node.js 20+ (ESM), TypeScript, Fastify, React 18, Vite, simple-git, Vitest.

The backend (`src/`) is a Fastify server that serves the compiled React SPA from `dist/web/` and exposes a REST API at `/api` plus a Streamable HTTP MCP server at `/mcp`. Everything runs in one process on localhost.

### Key concepts

**Adapter pattern.** Agent-specific and artifact-type-specific behavior is behind two small registry interfaces (`AgentAdapter`, `ArtifactTypeAdapter` in `src/adapters/`). Adding a new agent or artifact type means adding one file — no changes to the engine or API.

**Install engine.** `src/engine/` contains pure functions for install, uninstall, update, re-apply, drift check, and update check. These operate on plain data types from `src/state/schema.ts` and shell out to git via `src/git/`. The API layer in `src/api/` is a thin wrapper that reads/writes state stores and calls the engine.

**State stores.** All state is JSON files in the user-data directory, managed by `JsonStore<T>` (`src/state/store.ts`) which does atomic tmp-file-then-rename writes. Each domain object (skills repos, working repos, installs, settings, snapshots, dismissed notifications) has its own typed store class.

**Git operations.** Skills repos are cloned into a cache directory under the state dir. The engine reads file content at specific SHAs via `git show` and detects updates via `git log <sha>..HEAD -- <files>`. Installed files are hidden from the working repo's git via a managed fenced block in `.git/info/exclude` — no tracked files in the working repo are ever modified.

### Source layout

```
src/
  index.ts            entry: starts server, opens browser, runs auto-update pass
  server.ts           Fastify setup, ServerDeps interface
  api/                REST route handlers (one file per resource)
  engine/             install, uninstall, update, drift, apply-update, update-pass
  git/                client wrapper, show (file-at-sha), log (commit walking)
  adapters/           AgentAdapter + ArtifactTypeAdapter interfaces, registries,
                        agents/claude-code.ts, agents/cursor.ts,
                        artifact-types/skills.ts
  discovery/          discoverArtifacts — walks SkillsRepo config → DiscoveredArtifact[]
  mcp/                tools.ts (createMcpServer), server.ts (Fastify /mcp routes)
  state/              schema.ts, store.ts, and one store class per entity
  util/               errors.ts (AppError), ids.ts
web/                  React SPA (Vite)
  api.ts              fetch wrappers + all TS types shared with FE
  pages/              Dashboard, Browse, SkillsRepos, WorkingRepos, Settings, Diff
  components/         Sidebar, InstallModal, RegisterModal(s), StatusPill
tests/
  helpers/            tmp-dir, build-fixture-repo (real git repos on disk)
  unit/               pure function tests (adapters, engine status, components)
  integration/        full-stack tests against real git repos and the Fastify server
```
