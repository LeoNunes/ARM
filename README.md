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

## Slice 1 — manual smoke test

1. Launch the app, open Settings, confirm favorite agent shows `Claude Code`.
2. Skills repos → Register: name `superpowers`, git URL (file:// to a local fixture or a public repo), branch `main`, skills paths `skills` (or wherever).
3. The repo appears in the list; click it to see discovered skills.
4. Working repos → Register: name `test-proj`, path to any existing local git repo (`mkdir t && cd t && git init` works for a fresh one).
5. Browse → find a skill → Install. Pick the working repo, leave agent as Claude Code.
6. Check the working repo: `.claude/skills/<name>/` exists, `.git/info/exclude` contains a `# BEGIN skills-manager` block listing the new path, `git status` is clean.
7. Open the working-repo detail page; the install appears.
8. Uninstall — files vanish, exclude block is updated.
