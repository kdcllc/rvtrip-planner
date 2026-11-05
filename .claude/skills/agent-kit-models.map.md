# Model Map — RV Trip Planner (Claude Code)

Model IDs are **configuration, not constants**. This file is the single place they are
defined; re-run `/agent-kit` (or edit here and re-emit) when providers rotate model names.

Verified 2026-11-03 against Claude Code's model configuration (Claude Code 2.1.317). Current Claude models: Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`), Haiku 5.5 (`claude-haiku-5-5`), Fable 5.1 (`claude-fable-5-1`). This install pins full model IDs rather than aliases so pins are reproducible; re-run `/agent-kit` when a provider rotates IDs. Only Claude Code is targeted.

## Tier assignments

| Tier | Roles | Rationale |
|------|-------|-----------|
| `frontier` | orchestrator (main session), `evaluator`, `qa-evaluator`, `diagnostician` | Delegation and evaluation have a capability floor — don't cheap out on the roles that decide and verify; continuation-ladder diagnosis needs frontier-tier reasoning |
| `light` | `implementer`, `test-writer`, `evidence-collector` | Checklist-driven execution retains most quality at a fraction of the cost when the plan and the verification are strong |
| `fast` | `terminal` | Single-command execution and result extraction need no deep reasoning — the cheapest, quickest tier fits |

## Resolved models

| Tier | Claude Code |
|------|-------------|
| `frontier` | claude-sonnet-5-5 |
| `light` | claude-sonnet-5-5 |
| `fast` | claude-haiku-5-5 |

An install that omits `fast` runs `terminal` on the light model (the `fast` row then
repeats the light ID).

Reasoning-effort pins (Claude Code `effort:` frontmatter): `diagnostician` `xhigh`; `evaluator` and `qa-evaluator` `high`; `implementer`, `test-writer` and `evidence-collector` `medium`; `terminal` `low`.

## Fallback chains

**Claude Code** (full model IDs; `inherit` = omit the pin)

| Tier | Chain (first available wins) |
|------|------------------------------|
| `frontier` | `claude-sonnet-5-5` (Sonnet 5.5) → (omit pin — harness default) |
| `light` | `claude-sonnet-5-5` (Sonnet 5.5) → `claude-haiku-5-5` (Haiku 5.5) → (omit pin — harness default) |
| `fast` | `claude-haiku-5-5` (Haiku 5.5) → `claude-sonnet-5-5` (Sonnet 5.5, fast → light carve-out) → (omit pin) |

This install deliberately runs the frontier tier on Sonnet 5.5 (cost choice): evaluators and workers share a model and differ by effort.

Rules (adapted from bradygaster/squad's model selector):

- **Never fall back UP a tier** — a light role must never silently land on a frontier
  model, and a frontier role never degrades below the standard rung of its chain.
  One carve-out: fast → light is allowed, because light is `terminal`'s baseline tier
  (installs without `fast` run it there).
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
| Claude Code: `claude-sonnet-5-5` (Sonnet 5.5) → `claude-haiku-5-5` (Haiku 5.5) → (omit pin — harness default) | `claude-sonnet-5-5,claude-haiku-5-5` |

`claude-sonnet-5-5,claude-haiku-5-5` resolves to `claude-sonnet-5-5,claude-haiku-5-5`. Loop iterations are implementer/test-writer-shaped work and stay light-tier. This install runs the loop in a throwaway `git worktree` off `master` with a **maximum of 5 iterations**; commits stay local and are never auto-pushed.

## Fix-cycle rotation (after evaluator rejections)

A model blind to its own class of mistake rarely fixes it on retry. Rotate:

**Claude Code**

| Fix cycle | Implementer model |
|-----------|-------------------|
| 1 | `claude-sonnet-5-5` (Sonnet 5.5) — normal light tier |
| 2 | `claude-haiku-5-5` (Haiku 5.5) — same-family rotation (reduced diversity) |
| 3 | `claude-sonnet-5-5` (Sonnet 5.5) — frontier tier (same model as light in this install) |

Claude Code exposes only Claude models, so cycle-2 rotation swaps model within the Claude family rather than provider.

**Same-family rotation.** When no different-family model at comparable tier is reachable
on a harness, fix cycle 2 may pin a different same-family model (see the table above) and
label the row `same-family rotation (reduced diversity)`. A second harness such as Copilot
or Codex provides cross-family models when targeted. Repeated same-shaped failures across
fix cycle 2 and continuation-ladder rung 4 should escalate to a human sooner.

### After cycle 3 — continuation ladder pins

When fix cycles are exhausted (cycle 3, or earlier on early ladder entry), the continuation ladder (see ORCHESTRATION.md) applies:

**Claude Code**

| Ladder step | Model pin |
|-------------|-----------|
| Diagnosis-driven implementation attempt (rung 4) | `claude-sonnet-5-5` (Sonnet 5.5, frontier tier) |
| Evaluator arbitration mode (rung 5) | `claude-fable-5-1` (Fable 5.1) — **same-family arbiter (reduced independence)**: Claude Code exposes only Anthropic models, so the arbiter is a different, stronger Claude model rather than a different provider |

`claude-fable-5-1` resolves to `claude-fable-5-1`. `claude-haiku-5-5` stays reserved for the cycle-2 rotation and `terminal`, and is never used for arbitration.

**Same-family arbiter.** When no different-family frontier model is reachable on a
harness, `frontier_alt_family` may equal `frontier` with `arbiter_same_family: true`
in the answers file (emit otherwise warns); the rung-5 row is then labelled
"same-family arbiter (reduced independence)" and the arbiter's verdict header says
`same-family arbiter`. Reusing the fix-cycle-2 alternate (`alt_family`) for
arbitration stays forbidden — when `frontier_alt_family` equals `alt_family` (and
differs from `frontier`), emit warns even with the flag.

## Harness caveats that shape tiering

- **Claude Code env overrides**: `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` override frontmatter, and an org `availableModels` allowlist can cause pins to be ignored — an agent that self-reports a model other than the one requested is a signal, not a bug in the map.
- **Claude Code nesting depth**: this install merges `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3` into `.claude/settings.json` so workers can spawn `terminal`. The default has flipped before — keep it pinned explicitly.
- **Full model IDs over aliases**: pins use `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-fable-5-1` for reproducibility; they go stale when Anthropic ships a new generation — re-run `/agent-kit` then.
- Copilot, Cursor and Codex are not targeted by this install; their caveats are omitted.
