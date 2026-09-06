---
name: qa-criteria
description: Criteria the qa-evaluator applies to user-facing behavioral evidence for RV Trip Planner. Reference skill — not invoked directly.
disable-model-invocation: true
---

# QA Evaluation Criteria

Evaluate observed behavior from the user's perspective. Evidence not provided = behavior
not tested = an issue.

**Hard-threshold rule**: the criteria below are gates, not averages — one failing
surface **or cross-cutting check** caps the verdict at ISSUES FOUND no matter how clean
the rest are. A secrets leak, for example, caps the verdict on its own, regardless of how
clean every surface is.

## Per-surface criteria

### SPA UI surfaces (`src/app`, `src/features/*`, `src/components/common`)
- Screenshots show the affected views rendering correctly at both a desktop and a narrow viewport.
- Browser console is free of errors and React warnings; network log shows no failed requests.
- Loading, empty, and error states are each explicitly rendered — never a blank panel.
- Keyboard reachability and labeling hold for any form control or button touched.

### External API integration surfaces (`src/services/{maps,geocoding,weather,gas}`)
- The exact request issued is shown, together with the response shape the code handles.
- Failure and fallback paths are exercised, not just the happy path: OSRM → alternate OSRM → OpenRouteService for routing, and the geocoding/weather providers' error responses.
- Rate-limit, timeout, and malformed-response handling produce a user-visible message rather than a thrown error.
- No live network call originates from a test; evidence from tests is the mocked fixture output.

### Export artifact surfaces (PDF, iCal, trip JSON)
- The generated file is produced and inspected, not merely reported as generated.
- PDF output contains the stops, dates, and map capture for the trip under test.
- `.ics` output parses and carries one event per dated stop with correct arrival/departure.
- Exported trip JSON re-imports cleanly into the app with no data loss.

### Cross-cutting
- No Google OAuth token, refresh token, or API key appears in the DOM, console, network log, or any exported artifact.
- No change silently breaks the persisted localStorage trip schema without a migration.

## Cross-cutting checks

- **Effect verification**: an operation that reports success demonstrably had its effect.
- **No secrets** in any output, log, or screenshot.
- **Consistency**: the same information reported by two surfaces agrees.

## Verdicts

- **PASS**: all affected surfaces evidenced and clean.
- **ISSUES FOUND**: numbered issues, each with observed vs expected and exact repro
  steps — these become fix tasks for implementer.
- **REJECT**: an auto-fail trigger fired (see `.claude/agents/qa-evaluator.md`) or the
  evidence shows the feature fundamentally doesn't work.
