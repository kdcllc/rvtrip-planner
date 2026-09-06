# Model Map — RV Trip Planner (Claude Code + GitHub Copilot / VS Code)

Model IDs are **configuration, not constants**. This file is the single place they are
defined; re-run `/setup` (or edit here and re-emit) when providers rotate model names.

Verified 2026-09-06 against the live model lists. Claude Code: Opus 5, Sonnet 5, Haiku 4.5, and Fable 5.1 are current; the frontmatter aliases `opus`, `sonnet`, `haiku`, and `fable` resolve to them and are preferred over dated IDs, which rotate. GitHub Copilot (VS Code): the `model:` key takes the display name as shown in the model picker (`docs.github.com/en/copilot/reference/ai-models/supported-models`) — current Anthropic entries are Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5; current OpenAI entries include GPT-6 Astra, GPT-5.6 (Luna/Sol/Terra), GPT-5.5, GPT-5.4 and GPT-5.4 mini. Copilot also accepts an array for `model:` (`model: ['Claude Opus 5', 'GPT-6 Astra']`) — first available wins, which is how the fallback chains below are encoded there. Cursor and Codex are not targeted by this install.

## Tier assignments

| Tier | Roles | Rationale |
|------|-------|-----------|
| `frontier` | orchestrator (main session), `evaluator`, `qa-evaluator`, `diagnostician` | Delegation and evaluation have a capability floor — don't cheap out on the roles that decide and verify; continuation-ladder diagnosis needs frontier-tier reasoning |
| `light` | `implementer`, `test-writer`, `terminal` | Checklist-driven execution and compact command running retain most quality at a fraction of the cost when the plan and the verification are strong |

## Resolved models

| Tier | Claude Code |
|------|-------------|
| `frontier` | opus |
| `light` | sonnet |

- Copilot (VS Code): frontier `Claude Opus 5`, light `Claude Sonnet 5`

Reasoning-effort pins: evaluators (`evaluator`, `qa-evaluator`, `diagnostician`) run `effort: high`, workers (`implementer`, `test-writer`, `terminal`) run `effort: medium` — set via Claude Code's `effort:` frontmatter key. GitHub Copilot has no effort key; drop the pin there and rely on tier alone. Cursor and Codex are not targeted by this install.

## Fallback chains

**Claude Code** (frontmatter aliases; `inherit` = omit the pin)

| Tier | Chain (first available wins) |
|------|------------------------------|
| `frontier` | `opus` (Opus 5) → `fable` (Fable 5.1) → `sonnet` (Sonnet 5) → (omit pin — harness default) |
| `light` | `sonnet` (Sonnet 5) → `haiku` (Haiku 4.5) → (omit pin — harness default) |

**GitHub Copilot (VS Code)** — encode the chain directly as the `model:` array

| Tier | Chain (first available wins) |
|------|------------------------------|
| `frontier` | `Claude Opus 5` → `GPT-6 Astra` → `Claude Sonnet 5` → (omit pin — session default) |
| `light` | `Claude Sonnet 5` → `GPT-5.4` → (omit pin — session default) |

Copilot's cost ceiling applies: a subagent may never resolve to a model stronger than the session's, so the orchestrated session must itself run the `frontier` tier.

Rules (adapted from bradygaster/squad's model selector):

- **Never fall back UP a tier** — a light role must never silently land on a frontier
  model, and a frontier role never degrades below the standard rung of its chain.
- Fallbacks are silent to the user but **logged in the orchestration log**.
- Max 3 fallback attempts, then omit the model pin and take the harness default.
- Apply at most **one** complexity adjustment per spawn — no cascading bumps.
- **Cost ceiling policy**: an EXPLICIT human model choice above a plan/admin ceiling →
  warn loudly and honor it; an implicit (auto-selected) choice → downgrade to the
  ceiling; no compliant model at all → fail loud — never silently substitute.
- **Prompts are executable — narrowly**: only tasks that edit `templates/agents/*`
  or `templates/skills/*-criteria/*` (the files that shape every later spawn's
  behavior) use the frontier tier; skills, emitters, drivers, docs, and tests stay
  on the light tier.
- **Every spawn names its model.** The orchestrator passes the tier's resolved ID
  explicitly on every spawn and records `requested` vs the agent's self-reported
  model in the orchestration log; `inherit` is legitimate only for a tier the
  install deliberately left unpinned.

### Loop fallback chain

| Chain (first available wins) | Resolves |
|-------------------------------|----------|
| Claude Code: `sonnet` (Sonnet 5) → `haiku` (Haiku 4.5) → (omit pin — harness default) | `sonnet,haiku` |
| Copilot: `Claude Sonnet 5` → `GPT-5.4` → (omit pin — session default) | `Claude Sonnet 5,GPT-5.4` |

The loop driver is emitted once, against the primary harness (Claude Code), so `sonnet,haiku` resolves to `sonnet,haiku`. Loop iterations are implementer/test-writer-shaped work and stay light-tier. This install runs the loop in a throwaway `git worktree` off `master` with a **maximum of 5 iterations**; commits stay local and are never auto-pushed.

## Fix-cycle rotation (after evaluator rejections)

A model blind to its own class of mistake rarely fixes it on retry. Rotate:

**Claude Code**

| Fix cycle | Implementer model |
|-----------|-------------------|
| 1 | `sonnet` (Sonnet 5) — normal light tier |
| 2 | `haiku` (Haiku 4.5) — a different model family at comparable tier (analytical diversity) |
| 3 | `opus` (Opus 5) — frontier |

**GitHub Copilot (VS Code)**

| Fix cycle | Implementer model |
|-----------|-------------------|
| 1 | `Claude Sonnet 5` — normal light tier |
| 2 | `GPT-5.4` — a different provider family at comparable tier |
| 3 | `Claude Opus 5` — frontier (the session tier; never above it) |

Claude Code exposes only Claude models, so its cycle-2 rotation swaps model *family* within Claude (Sonnet → Haiku) rather than provider. Copilot can rotate across providers and does.

### After cycle 3 — continuation ladder pins

When fix cycles 1–3 exhaust, the continuation ladder (see ORCHESTRATION.md) applies:

**Claude Code**

| Ladder step | Model pin |
|-------------|-----------|
| Diagnosis-driven implementation attempt (rung 4) | `opus` (Opus 5) |
| Evaluator arbitration mode (rung 5) | `fable` (Fable 5.1) — a different model family at frontier tier, and not the cycle-2 light-tier rotation |

**GitHub Copilot (VS Code)**

| Ladder step | Model pin |
|-------------|-----------|
| Diagnosis-driven implementation attempt (rung 4) | `Claude Opus 5` |
| Evaluator arbitration mode (rung 5) | `GPT-6 Astra` — a different provider family at frontier tier |

`fable` resolves to `fable` for the primary harness. Fable 5.1 is a distinct family from the Opus line and sits at or above frontier capability, so it is the arbitration pin; `haiku` stays reserved for the light-tier cycle-2 rotation and is never used for arbitration.

**Copilot fit:** frontier = session tier, so diagnostician and arbiter pins respect the
cost ceiling; Copilot has no effort key (drop it).

## Harness caveats that shape tiering

- **Copilot cost ceiling**: a subagent cannot run a *stronger* model than the session — the orchestrated session must run the `frontier` tier (`Claude Opus 5`); workers pin down. A too-strong pin makes the subagent not run at all, silently.
- **Copilot has no effort key**: drop `effort:` from every `.github/agents/*.agent.md`; tier alone carries the intent there.
- **Copilot model names are display names**, not slugs — `Claude Opus 5`, not `claude-opus-5`. The `model:` key also accepts an array (`['Claude Opus 5', 'GPT-6 Astra']`) which is how fallback is expressed in that harness.
- **Copilot nesting stays off** (kit default): `feature.agent.md` is the L1 orchestrator and spawns workers and evaluators directly; workers spawn nothing. `/setup` must not enable `chat.subagents.allowInvocationsFromSubagents`, and must not write `.vscode/settings.json` — this repo already has a `.vscode/` directory.
- **Claude Code env overrides**: `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` override frontmatter, and an org `availableModels` allowlist can cause pins to be ignored — an agent that self-reports a model other than the one requested is a signal, not a bug in the map.
- **Claude Code nesting depth**: this install merges `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3` into `.claude/settings.json` so workers can spawn `terminal`. The default has flipped before — keep it pinned explicitly.
- **Claude Code aliases over dated IDs**: `opus`/`sonnet`/`haiku`/`fable` track the current generation; dated IDs rotate and go stale. Re-run `/setup` (or edit this file and re-emit) when a provider rotates names.
- Cursor and Codex are not targeted by this install; their caveats are omitted.
