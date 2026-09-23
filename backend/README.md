# AI Sana — developer B backend

P0/P1 server for the business task builder, the shared 2D/3D catalog, team proposals and approved team milestones. It is a BFF for the web app screens: each command returns the updated screen, a next-action hint and the allowed buttons. The frontend and 3D world are developed separately.

## Running

Requires Node.js 22.12+ and npm. Run all commands in `backend/`:

```sh
npm ci
cp .env.example .env
npm run dev
```

PowerShell: `Copy-Item .env.example .env`. Do not overwrite an existing `.env` that contains a key. Live AI needs `OPENAI_API_KEY` in `backend/.env`; without it the app runs with a clearly labelled fallback. Defaults: `OPENAI_MODEL=gpt-6-luna`, reasoning `low`, `AI_MODE=auto`, `AI_TIMEOUT_MS=30000`, `AI_MAX_OUTPUT_TOKENS=4096`, `GIT_MODE=real`, `GIT_TIMEOUT_MS=15000`. The model and limits can be overridden in `.env`. `GITHUB_TOKEN` is optional: public GitHub repos/PRs are reachable without it; a token raises the rate limit. Keys are never sent to the browser and never committed.

- API: `http://localhost:3001/api/v1/health`
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI: `http://localhost:3001/api/openapi.json`
- On first start SQLite and demo data are created automatically. Sign-in codes are stored only in the **local** `demo-accounts.local.json`. This file is not committed to Git.
- 2 businesses and 5 teams; 5 drafts, 5 published tasks across all four levels, 5 proposals. Re-seeding does not overwrite changes. Separate command: `npm run seed`.

To build: `npm run build`, then `npm start`. Data is stored in `data/ai-sana.db` and survives restarts.

The Vite frontend can run on `localhost:5173`. For a single server, set `FRONTEND_DIST=../frontend/dist` after building the frontend. `ALLOWED_ORIGINS` is an exact comma-separated list of allowed origins. For LAN access, set `HOST=0.0.0.0` and add the actual interface origin to the list. This is a local demo server, not production-ready infrastructure for public deployment.

## Frontend integration

Full guide: [docs/backend-integration.md](../docs/backend-integration.md). Typed browser client: [client/index.ts](client/index.ts). The main prefix is `/api/v1`, not the set of CRUD routes from the preliminary spec.

Final consumer review: [business and team](../docs/consumer-ux-review.md). The team card now provides `participation.nextAction` with a navigation target, proposals have human-readable statuses, and the business dashboard shows only available reviews. Business feedback is kept in a private history after resubmission. These improvements need no new routes.

Sign-in `POST /api/v1/session/start` with `{ "code": "local code" }` returns `token`, `actor`, `expiresAt`. Send `Authorization: Bearer ...`. For two roles in two tabs, keep the token in `sessionStorage`. Team creation `POST /teams/start` returns the team code once; other members sign in with the same code.

`GET /bootstrap`, `/catalog`, `/dashboard`, `/tasks/:id`, `/tasks/:id/workspace`, `/tasks/:id/review`, `/milestones/:id`, `/scoreboard` return ready-made screen models. `/snapshot` combines the main data for initial load/reconnect. The catalog contains both sorted cards and pages of 3D pavilions, five per page, in a stable publication order. Catalog filters are `industry`, `level`, `search`; `page`, `pageSize`, `worldPage` are independent.

Editing commands require `expectedVersion` from the corresponding object (`task`, `proposal` or `milestone`). On 409 `STALE_VERSION`, keep the user's input, load a fresh screen and offer to reapply the edits. Do not retry a stale command automatically. Creating a task/proposal/milestone supports `Idempotency-Key`; use one key per logical submission and its network retries.

Take the task version for editing from `workspace.task.version`: team activity does not change it. The public `card.version` and the realtime event version reflect all activity; that is a separate counter. Existing stored tasks remain compatible without a database reset.

`analyzeTask` suggests filling empty text fields with exact quotes from `rawDescription`. The user picks stored suggestion IDs; `applySuggestions` takes `expectedVersion`, `analysisId`, `suggestionIds`. An empty array dismisses all suggestions. Applying changes only the draft, resolves the current analysis and does not update the official score until confirmation. `workspace.analysis` contains `status` (`ready`, `empty`, `stale`, `resolved`), `canApply` and the quotes; any later editor change makes an unapplied analysis stale. `workspace.quality` holds explainable hints about boilerplate phrases, repetitions and explicit contradictions, without changing scores or blocking publication.

Clarifications are saved together with answers. AI picks the fields for 3–5 questions; the server returns neutral text from its own catalog. The BFF returns `clarification.nextQuestion`, the field type and options, progress, and the full list for going back. `confirm` closes the current clarification session (`reviewed=true`) even if some answers are still unknown; an explicit new `clarify` opens a new session. Inapplicable questions are skipped, including the "metric with target or acceptance condition" alternative.

`pendingMilestones` on a station and `teamProgress.statusLabel` on a card show "Under review". A private milestone gets `statusLabel/statusHint` for the current role. Submission, return and approval update the markers via realtime; team creation refreshes an open scoreboard with a `team.created` event without sign-in secrets.

Socket.IO: connect with `auth: { token }`, or without a token as a guest. `invalidate` and `sync.required` events require re-reading the affected screen. Event payloads contain IDs/versions, no draft or proposal text. Reload the snapshot on every `connect`: sockets do not replace SQLite and HTTP. On sign-out, sockets bound to that session are disconnected.

## Business rules

Two independent measures: card readiness 0–100 and points of the selected team. Readiness is scored on the confirmed snapshot. Saving a draft shows a forecast but does not change the public card. Re-confirming an already published card immediately updates its public snapshot, including title and industry. Removing data can lower the score.

| Category | Points |
|---|---:|
| Current situation + need | 10 + 10 |
| Known data availability + real available source | 10 + 10 |
| Concrete expected result | 15 |
| Metric and target **or** acceptance condition | 15 |
| Constraints **or** explicitly confirmed absence | 10 |
| Users | 10 |
| Contact + consultation format | 5 + 5 |

Empty/boilerplate strings earn no points. `dataAvailability=none` earns 10 but does not pretend a dataset exists. The server checks structural conditions and common placeholders (in Russian and English); the business confirms the substance of the text. This is an explainable completeness heuristic, not an automated quality assessment of the description.

Levels: 0–39 `draft`, 40–69 `working`, 70–89 `ready`, 90–100 `priority`. The `draft` level is not the publication status. Any published task is open for proposals. Sorting: score descending, newer publication first, then ID. World: publication time ascending, then ID, pages of 5. The number of proposals is unlimited; several proposals from one team are allowed.

The business independently selects/rejects proposals. A selected team creates one milestone per task with an acceptance criterion and a fixed 10 points. Submitting a Git link moves the milestone to `in_review` and awards no points. The business approves or returns it with an explanation. Approval and the unique award record are written in one SQLite transaction; retries never double the points. Each selected team has its own milestone. An approved milestone is immutable; the last selection of a team cannot be cancelled after approval.

## OpenAI and Git

`src/integrations/ai.ts` contains question field selection, milestone review, `createAiProvider` and the fallback; `analysis.ts` handles quote extraction and source checks; `ai-runtime.ts` handles the shared call and metadata. The official SDK uses the Responses API, `zodTextFormat`, `store:false`, a deadline and `maxRetries:0`. By default this is one `gpt-6-luna` call with reasoning `low`, a 30-second limit and 4096 output tokens per operation. There are no paid automatic retries; re-running is an explicit user action. This is a fixed workflow: the model does not choose tools or run an autonomous loop.

Analysis receives `{ rawDescription, fields }`, and the model returns `{ suggestions: [{ field, quote }] }`. The server accepts only an exact contiguous fragment of the original `rawDescription` (in its original language), checks the target field constraint, field uniqueness and that no value is already stored. `value` equals `source.quote`. The user sets `dataAvailability` and `noConstraints` personally. A verbatim quote confirms the text source, not its truthfulness or the correctness of the chosen field: a human checks every suggestion. The analysis fallback returns no suggestions and lets the user fill in the card manually.

Clarification input: `{ rawDescription, fields, missingFields }`. BFF output: `{ missingFields, questions: [{ field, text }], mode, warning, run }`. There are 3–5 questions; with few gaps the rest verify filled fields. The model chooses fields, and **the user-facing question text is composed by the server** from a neutral catalog after validation. Answers are never generated on behalf of the business. An invalid structure, refusal or API outage yields `mode=stub` and template questions. `AI_MODE=stub` forces this mode. The fallback does not block manual filling, confirmation or publication.

`GitProvider.inspect(url)` is replaceable: `GIT_MODE=real` checks only public GitHub repo/PR/`tree/ref` links via a fixed REST host. `GIT_MODE=mock` returns `provider=mock`; other valid HTTPS hosts remain for manual review. Private repositories are excluded even with a token. The server pins the SHA and reads the README and the first page of PR patches. Limits: **8 materials, 6000 characters per material, 24000 characters in total, 256 KiB per GitHub JSON response**, 15 seconds per inspection by default. Redirects are forbidden; the server does not clone the repository, execute code or run its tests. For a PR, head, base and file count are re-checked; if they changed or cannot be verified, the materials are discarded.

The current version uses automatic review of public materials. A private GitHub link can be submitted as evidence, but the provider returns `unavailable`: the business checks it manually with its own access, and the AI draws no conclusions about private content. The privacy of the project's own repository is unchanged; public links are used to demonstrate this integration.

`evidence.snapshot` contains `commitSha`, `inspectedAt`, `coverage`, `files`, `warnings`; each material has `id`, `path`, `kind`, `sourceUrl`, `content`, `truncated`. `complete` means completeness of the **limited sample**, `partial` means partial/truncated materials, `metadata_only` means no materials were read. Even `verified` and `complete` do not confirm a working result. If GitHub fails, the link and team description are kept for manual review, but unavailable materials are not counted as read.

For a milestone, the model picks `factIndexes` from verified metadata, `checkIds` from the server catalog and, when materials exist, `criterionMatches` with exact quotes. The BFF returns `review.criterionEvidence`: the criterion, a status of `materials_found`, `insufficient_evidence` or `not_assessed`, quotes with links, and the next manual review step. `not_assessed` explicitly marks a skipped assessment while materials were available, including fallback and criteria beyond the first 12 lines available to the model per call. A README is the author's claim linked to a blob SHA; a patch is change text linked to a base SHA vs head SHA comparison. A quote does not prove a criterion is met; a missing quote does not mean the team failed. The decision stays with the business, which approves the milestone and awards 10 points exactly once.

SQLite keeps the last **100 completed AI runs per task**; the owner's private workspace shows the last **20** in `aiRuns`. Metadata includes the operation, model/prompt version, time, duration, usage, validation, fallback reason, source version and `disposition=applied|stale`. `applied` means the call result was saved, not that a human agreed with the suggestions. The log contains no prompts, raw responses, keys or internal reasoning. This is a history of completed synchronous requests: there is no progress status, background queue or resumption after a process stop. The UI shows its own waiting state, keeps input and allows manual continuation; after a lost response it re-reads the screen first.

## Checks and submission

```sh
npm run check
npm test
npm run build
npm run demo
npm run preflight
npm run eval
npm run eval -- --live --repeat=3
```

`demo` starts an isolated temporary server and runs over HTTP through a new cafe example, analysis with applied quotes, clarification, two proposals, selecting two teams, a milestone, evidence, approval and a repeat without double awarding. By default external providers are stub/mock; for a live check with a key: `npm run demo -- --live`. The live HTTP demo on 23 September 2026 passed with Luna, Git material quotes, three history records and a business approval command: 10 points without repeat awarding. The user decision is simulated by the smoke script; the public link serves to test the integration, not as proof of the example's business result.

`preflight` requires `OPENAI_API_KEY`: it checks that the configured model is available, a public repository and a discovered public PR with materials. The live check on 23 September 2026 passed for the model, repo and PR; public GitHub worked without a token. This is a connectivity check, not a measure of model quality or business criteria. The commands live in [scripts/preflight.ts](scripts/preflight.ts), [scripts/eval.ts](scripts/eval.ts), and the scenarios in [scripts/eval-cases.ts](scripts/eval-cases.ts).

`eval` without `--live` checks the stub contract; the live variant spends API tokens. The set contains 15 synthetic extraction scenarios: quote accuracy, expected fields, no unsupported assumptions and preserving edits. `--repeat=1..3` and `--output=path` control repetitions and the output file. By default reports are written to `docs/evals/stub-harness-report.json` and `docs/evals/live-harness-report.json`; they include mode, model, pass rate, fallbacks, p50/p95 and usage. [Live series from 23 September 2026](../docs/evals/live-harness-report.json): **45/45**, no fallbacks, p95 **4853 ms** (recorded with the earlier Russian-language scenarios). This is an initial extraction regression, not a full semantic or UX evaluation; a successful preflight does not by itself measure model quality.

Tests cover the formula and its boundaries, permissions, draft isolation, version conflicts, idempotency, persistence after reopening the DB, end-to-end roles, the real SDK with test HTTP responses, the Git provider, two sockets, reconnect and sign-out. Limitations: one process/SQLite, one milestone per team and task, sign-in with demo codes, no private Git/OAuth and no background webhooks. Performance and the 3D world are verified in the frontend implementation.

## Structure

`contracts.ts` holds input schemas and domain types; `domain/score.ts` the formula; `services/` scenarios and invariants; `db.ts` tables and transactions; `auth.ts` hashed codes/sessions; `views.ts` screen responses; `app.ts` HTTP; `realtime.ts` post-save events; `integrations/` replaceable external dependencies.

Research, sources and decisions: [backend design](../docs/superpowers/specs/2026-09-23-backend-design.md), [harness design](../docs/superpowers/specs/2026-09-23-agent-harness-design.md), [historical audit before the harness implementation](../docs/agent-harness-assessment.md). Current contracts and limitations are described here and in the [frontend guide](../docs/backend-integration.md). The original case and the user spec were used as requirements; their texts are not added to the repository.
