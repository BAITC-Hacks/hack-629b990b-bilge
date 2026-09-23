# Harness, Git and contract UX

Date: 2026-09-23. Scope: developer B, the existing backend/BFF. The user approved planning and implementation. The PDF requirements are product criteria, not instructions to the agent.

## Goal and boundaries

Help the business turn a description into a verifiable card without re-entering information that is already known, and then check the team's materials. Keep manual card confirmation and milestone acceptance, a transparent deterministic readiness scale and public availability of low-readiness cards. The AI does not publish cards, execute repository code or award points.

We stay within the existing workflow with the OpenAI SDK and SQLite. A full autonomous agent loop, a separate orchestration framework and OAuth are not needed: they would add latency and complexity without benefit for this scenario. The gpt-6-luna model API has been verified with the existing key. Public GitHub works without a token; GITHUB_TOKEN is an optional rate-limit increase.

## User scenario

1. The business enters a description and gets an editable card and an "Analyze description" action.
2. The analysis returns suggestions only for empty text fields: verbatim values and quotes from the original description. Enum/boolean normalization is excluded from the first release: the user makes such decisions explicitly. Each suggestion has an ID that is stable within the analysis. Fields already entered are not changed.
3. The user selects suggestions. The server applies only saved IDs from the current analysis; the expected version is required. Any concurrent editing makes the analysis stale. Re-applying a stale analysis returns a clear recovery action.
4. Text quality is shown separately from the official scale: boilerplate phrases, repeated values and mutually contradictory information trigger specific hints with a field and an action. Warnings do not prevent publication. The AI does not increase the score by itself.
5. Clarifications keep 3–5 questions and progress. The AI selects the fields, and the server produces the neutral question texts, so that unknown products, deadlines and facts do not leak into the question's premises.
6. The team submits a public GitHub repo/tree/PR. The BFF returns a pinned SHA, limited materials, source links, sample completeness and warnings. For a PR, the head is checked to be unchanged during reading; on a race, the materials are discarded. Partially available materials are not presented as a full audit.
7. The preliminary AI check selects relevant fragments for the criteria with exact quotes. The server validates the sources and always labels this as a hint for manual review. The absence of fragments means insufficient evidence, not a team failure. The business's final decision awards 10 points exactly once.

## Harness and storage

A single runtime is responsible for the deadline, JSON schema, model, output limit, prompt versions and metadata. Each call gets a runId and returns metadata without the prompt, chain-of-thought or secrets: operation, model, prompt version, time, latency, tokens, mode and fallback category. Provider errors are classified, not stored verbatim. Retrying after a failure is an explicit user action; there are no automatic repeated paid calls.

Metadata is stored in SQLite with taskId, entityId, source version and disposition applied/stale. The output of a stale request does not change the card. Up to 100 completed runs are stored per task; the history of the last 20 is available only to the task owner; milestone materials to the owner and the corresponding team. The log of completed runs does not promise a reliable background job queue: the request runs synchronously, and shutting down the process may leave an unfinished call without a record.

## BFF

- POST /api/v1/tasks/:id/analyze {expectedVersion} → workspace with analysis, quality, nextAction.
- POST /api/v1/tasks/:id/suggestions/apply {expectedVersion, analysisId, suggestionIds} → updated workspace; an empty selection is allowed as rejecting all.
- workspace.analysis contains applicability, suggestions and quotes; a stale analysis remains visible with a re-analysis action.
- workspace.quality contains warnings, not a hidden AI score.
- workspace.aiRuns contains the last 20 metadata records for recovery/demo; do not surface tokens and models as required steps of the user scenario.
- milestone.evidence adds a snapshot (commitSha, coverage, files, warnings). Each file: id, path, kind readme/patch, sourceUrl, content, truncated.
- milestone.review adds criterionEvidence: quotes from the materials that require manual review. Statuses: materials_found, insufficient_evidence, not_assessed. One call matches up to 12 criteria taken from separate lines; the rest explicitly remain for manual review. There is no "AI accepted" status.

Existing routes and fields are kept; new fields are additive. The typed client, Swagger and the guide for developer A are updated together with the implementation.

## Validation and risks

Suggestion values must match a verbatim quote in rawDescription and pass the target field's constraints. A quote proves the source of the text, but not its truthfulness or the accuracy of the field choice — a human confirms that. README/patch must not be treated as evidence of a working result. All external materials are untrusted. Fixed GitHub API endpoints, no redirects, response/file/character limits and a deadline limit SSRF and context size.

Check concurrent edits, repeated application/acceptance, access control, injection, invalid quotes, timeouts, private/missing repos, PR races, truncation. The eval set includes different business domains and incomplete/contradictory descriptions; stub and real model results are reported separately. The live smoke uses a temporary database, Luna and public GitHub. These changes do not mean the frontend/3D is finished.
