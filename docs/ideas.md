# AI Resources Manager — Ideas Backlog

> Candidate features beyond the MVP, grounded in the current codebase (`src/adapters/`, `src/engine/`, `src/mcp/`, `web/`) and in the gaps already acknowledged in `docs/product-specification.md` §7 and `docs/design.md` §11. Nothing here is committed work — each item still needs its own design pass before implementation.

## Tier 1 — Holes the current docs already acknowledge

### 1. Rules target-file conflict detection

Product specification §7 lists this as "a candidate fast-follow," and it is the closest thing the MVP has to a correctness bug. Installing a rule writes a single file into the agent's shared rules directory (`.claude/rules/`, `.cursor/rules/`) with no check on what is already there. Two rules from different source repos that share a filename will silently clobber each other, and — worse — so will a rule that collides with the user's own hand-written file. The fix is a pre-write classification step in `src/engine/install.ts`: for each target path, determine whether it is absent, owned by an existing install record, or a foreign file the manager did not create, and surface that to the caller instead of writing blind. The UI then offers overwrite / rename-on-install / cancel, and the MCP `install_artifact` tool returns a structured conflict error rather than destroying data on an agent's behalf — the drift gate on the install-lifecycle tools (`drift_detected` carrying the affected paths, overridable with `force`) is the precedent to follow here. Rename-on-install implies the install record must store the installed filename separately from the artifact name, which is a small but real schema change worth designing carefully.

### 2. Doctor / health check page

Every install record is a claim about the state of the filesystem, and those claims rot. Working repos get moved, renamed, or deleted; source clones under the state directory get corrupted or manually wiped; the managed fenced block in `.git/info/exclude` gets hand-edited away by someone cleaning up. When any of these happen, the background refresh loop quietly does nothing useful and the UI keeps reporting a status it can no longer verify. A dedicated doctor page would walk every registered working repo, every registered skills repo, and every install record; check that the path exists, that the clone is a valid git repository on the tracked branch, that the installed files are present, and that the exclude block is intact and correctly scoped; then report each problem with a targeted repair action (re-clone, re-apply, re-write the exclude block, or forget the record). This is cheap to build, has no schema implications, and turns a class of silent failures into visible ones.

## Tier 2 — High leverage, because the adapter seam already exists

### 3. Additional artifact types: slash commands, subagents, agent files

The `ArtifactTypeAdapter` registry in `src/adapters/` was built so a new type costs one file plus a new key under `artifactPaths`. Slash commands (`.claude/commands/*.md`) and subagents (`.claude/agents/*.md`) are structurally identical to rules — a single markdown file with frontmatter, discovered by scanning a configured directory — so they are close to free, and the frontmatter parsing in `src/adapters/artifact-types/frontmatter.ts` already handles description extraction including multiline block scalars. Agent files (CLAUDE.md / AGENTS.md) are almost as easy, since the CLAUDE.md → AGENTS.md filename mapping is already implemented for Cursor targets; the wrinkle is that agent files are conventionally *merged* context rather than discrete units, so installing two of them into one repo needs a story. Adding these types is the cheapest way to make the product cover a meaningfully larger share of what a developer actually shares between repos.

### 4. MCP server configurations as a managed artifact type

This one is more interesting than the other new types because it does not fit the copy-a-file model. Installing an MCP server definition means *merging a key* into an existing JSON document (`.mcp.json`, `.cursor/mcp.json`, or an agent's settings file) that the user also edits by hand; uninstalling means removing exactly that key without disturbing anything else; and drift is per-key rather than per-file, since the user may legitimately have added three unrelated servers next to the managed one. It also breaks the ignore mechanism: `.mcp.json` is usually a tracked file, so the current "hide it via `.git/info/exclude`" approach cannot apply, and the non-intrusiveness guarantee in §6 of the spec has to be either rethought or explicitly relaxed for this type. That is precisely why it is worth doing early — it is the strongest available test of whether the `ArtifactTypeAdapter` abstraction actually holds, and if it does not, now is the cheapest time to find out.

### 5. Additional agent adapters

Design doc §11 notes that each new agent is one adapter file plus its entries in the {agent × artifact-type} matrix. Codex, Windsurf, Cline, GitHub Copilot, and Zed are all plausible targets, and each expands the product's audience for a very small amount of work. Codex is the most natural next one given that it standardizes on `AGENTS.md` and a `~/.codex/` global directory, both of which map cleanly onto concepts the manager already has. The main design work is not the adapters themselves but deciding what happens as the matrix grows sparse: with two agents, "not supported" (Cursor global rules) is a footnote, but with six agents and five artifact types, the UI needs a coherent way to explain why a given combination is unavailable rather than silently omitting it from a dropdown.

## Tier 3 — Genuinely new capability

### 6. Contribute changes back upstream

Right now drift has exactly two endings: leave it visible, or discard it. But drift is frequently not a mistake — it is the user improving a skill in the place where they discovered it was wrong. A third ending would let the user promote the working-repo version back into the source repository: create a branch in the local clone, commit the changed files with a generated message, and either leave the branch for the user to push or open a pull request via `gh` if it is available. This turns the product from one-directional distribution into a genuine authoring loop, and it composes neatly with what already exists — the drift diff is exactly the patch to be committed, and once the contribution lands upstream the normal update path brings it back down as a new version. The design work is mostly about the git edge cases (a dirty clone, a diverged tracked branch, an artifact spanning several files, a source repo the user has no write access to) and about being unambiguous that this writes to a *source* repo, which the manager has so far only ever read from.

### 7. Local folder sources

Every source today must be a git URL that gets cloned into the state directory, which means authoring a new skill requires a commit-and-push round trip before you can install and try it. Allowing a plain local directory to be registered as a source would collapse that loop: point the manager at `~/dev/my-skills`, edit in place, install into a working repo, iterate. The hard part is that the entire version model is built on commit SHAs — "version" means "last commit that touched these files," drift means "differs from the file at the recorded SHA," and update detection is `git log <sha>..HEAD`. A non-git source has none of that, so it needs either a degraded model (content hash instead of SHA, no version history, no update notifications) or a rule that the directory must itself be a git working tree, in which case much of the existing machinery can be reused against the local HEAD. Choosing between those two is the whole design.

### 8. Profiles and configuration export/import

A profile is a named set of artifacts — "my TypeScript setup," "my Python setup" — that can be applied to any working repo in a single action. It answers two situations the product currently handles badly: starting a new project, where the user re-picks the same twelve artifacts by hand, and setting up a new machine, where nothing carries over at all. Applying a profile to a repo becomes a reconciliation operation (install what is missing, optionally remove what is extra, report what conflicts), which is a more useful primitive than a loop of individual installs. Paired with export/import of the full configuration as a single JSON file — registered sources, working repos, settings, favorites, profiles — this covers machine migration and backup without crossing into the multi-user or team-sharing territory that the spec deliberately excludes. Worth noting that an exported profile is also, incidentally, a shareable file, so this is the natural on-ramp if team features are ever reconsidered.

### 9. Bulk operations

Every operation in the product is currently singular: install one artifact, update one install, uninstall one install. That is fine for a demo and tedious in daily use. The obvious additions are multi-select with checkboxes in Browse feeding a single install flow, an "install everything from this source repo" action on the skills-repo detail page, and "update all" / "update all non-drifted" buttons on the working-repo detail page and the dashboard. The engine already exposes the right unit operations, so the work is mostly in the API (batch endpoints, or a client-side loop with aggregate progress) and in the UI's error handling: a batch of twenty installs where three fail needs to report partial success clearly rather than throwing away the seventeen that worked. The activity log also needs a view on this so twenty entries do not bury everything else in the recent-activity panel.

### 10. Headless CLI

`bin/arm.js` already exists as an entry point, but it does exactly one thing: start the server and open a browser. Extending it with real subcommands — `arm install <artifact> --repo .`, `arm update --all`, `arm status`, `arm list` — would let the manager be used from scripts, Makefiles, and devcontainer post-create hooks, where launching a browser is impossible and an interactive UI is beside the point. Because the API layer in `src/api/` is already a thin wrapper over the engine, the CLI can call the same engine functions directly in-process rather than going through HTTP, avoiding any need for a running server. The main design decisions are how a command-line user names an artifact unambiguously across source repos (the existing artifact-key helpers in `src/util/artifact-key.ts` are the starting point) and how errors and exit codes are reported so CI can act on them.

## Tier 4 — UX and polish

### 11. Rendered markdown in the file viewer

The artifact detail page's file viewer shows raw file content, which is the correct default for diffing and for inspecting frontmatter, but a poor default for reading. Since essentially every artifact in the system is markdown, adding a rendered view with a raw/rendered toggle — remembering the last choice — would make the detail page genuinely usable for deciding whether to install something, which is its main job. Frontmatter should stay visible in some form even in rendered mode, because the `description:` field is the thing a user most often wants to check.

### 12. Context-budget awareness

Installed artifacts are not free: every skill and rule in a working repo consumes part of the agent's context window, and there is currently nothing anywhere in the product that acknowledges this. Showing each artifact's size — byte count and an approximate token estimate — in Browse, and a running total per working repo on its detail page, would give the user the one piece of information they need to decide whether installing a fourteenth rule is a good idea. It is a small amount of code (the file contents are already read at install time) and it is the sort of detail that no comparable tool surfaces, which makes it disproportionately memorable.

### 13. Multi-file diff navigation

Skills are directories, so a version-to-version comparison of a skill is inherently a multi-file diff, but the diff page is oriented around one file at a time. Adding a file tree or file list beside the diff — with per-file added/removed indicators and a way to step through only the files that changed — would make version comparison usable for anything larger than a single-file rule. A "copy patch" action producing a unified diff for the whole artifact would also make it easy to hand a change to an agent or paste it into a review.

### 14. Command palette

With the page count now at nine and the artifact count in a realistic setup running into the hundreds, keyboard-first navigation earns its place. A `⌘K` / `Ctrl+K` palette that searches artifacts, source repos, working repos, and page names in one list — jumping straight to an artifact detail page from anywhere — would remove most of the click-through navigation the app currently requires. It layers cleanly on top of the existing search endpoint and needs no backend changes beyond possibly a combined search route.
