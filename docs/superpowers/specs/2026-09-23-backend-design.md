# AI Sana backend / BFF design

Scope: developer B only, P0 and P1, one Node process and a persistent SQLite database. Frontend and 3D belong to other teammates. User authorized implementation after research; no deployment or production credentials are required.

## Research and decisions

- Microsoft BFF pattern: tailor read models to the client experience; keep business rules independent of presentation. One web client does not justify separate microservices. https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends
- API design: aggregate screen data, avoid mirroring database tables and chatty requests. https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
- GOV.UK check answers and error summary: expose a review preview, explicit confirmation, field errors and recoverable next actions. https://design-system.service.gov.uk/patterns/check-answers/ ; https://design-system.service.gov.uk/components/error-summary/
- OpenAI Responses SDK with Zod structured output, timeout, validation and explicit fallback. https://developers.openai.com/api/docs/guides/structured-outputs ; https://github.com/openai/openai-node
- Socket.IO events may be lost: use invalidation events after commit and refetch on every connection. https://socket.io/docs/v4/delivery-guarantees/
- SQLite through better-sqlite3 transactions. https://github.com/WiseLibs/better-sqlite3
- Public GitHub metadata via REST, behind a replaceable evidence provider; URL-only/manual review for other Git hosts and explicit mock mode. https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request

## User journeys and BFF

`/api/v1`: bootstrap (session, features, navigation), catalog (filters, score-sorted cards, stable 5-slot world page), task detail, business/team dashboard, task workspace (draft, official score, forecast, preview, gaps, next action), review desk (proposal comparisons), scoreboard (team names and confirmed points only).

Commands: session start/end; start task; save draft; request clarification; apply answers; confirm; publish; propose; select/reject proposal; create milestone; submit evidence; approve/return milestone. Commands return the updated screen and Russian feedback, not raw database rows. Errors carry code, message, fieldErrors and recovery hints. Mutation request IDs support safe retries where new entities are created. Version checks protect edits from stale tabs.

Read models are shaped in presenters, rules in services, persistence in a store, external integrations behind interfaces. Client contract helpers and an OpenAPI document support A without importing database code. Contract v1 is local to backend and can evolve collaboratively.

## Domain invariants

Task owns immutable rawDescription, editable draftFields, confirmedFields snapshot, publicationStatus, version, timestamps. Title and industry are inside both snapshots, so unpublished edits never leak. Confirmation atomically replaces official snapshot and recomputes score (including decreases). Only published snapshots are public. Low score never blocks publication or proposal.

Fields: title, industry, context, need, users, dataAvailability (available/none/unknown), dataSource, expectedResult, successMetric, successTarget, acceptanceCriteria, constraints, noConstraints, contact, interactionFormat. Scoring: context10+need10; known availability10+available source10; result15; metric+target OR acceptance15; constraints or explicit noConstraints10; users10; contact5+interaction5. Blank/placeholders earn zero. Levels draft 0–39, working 40–69, ready 70–89, priority 90–100. Forecast never changes official score. Questions refer to actual missing fields, at least 3, distinct; when fewer gaps, clearly ask verification questions about existing fields.

Proposal belongs to team and task; no global limit. Idempotency key prevents retry duplicates, not legitimate additional proposals. Business owner decides each proposal independently; multiple selected teams allowed. Team cannot select itself.

One milestone per task/team; team must be selected. Fixed 10 points, not client-controlled. States draft -> in_review -> approved OR changes_requested -> in_review. Evidence/AI are preliminary only. Business alone approves. Unique score event per milestone and approval transaction guarantee exactly one award. Each selected team has its own milestone. An approved milestone is immutable. Selection cannot be revoked after milestone approval; before approval a revoked selection blocks new submission/approval.

## Auth, storage and events

Prepared business/team profiles and generated demo codes written to an ignored local file by seed; hashed codes in SQLite. Server-issued random bearer session stored hashed in SQLite, with expiry/logout. Bearer in each browser tab allows two roles in one browser (sessionStorage, not localStorage). No OAuth unless user clarifies otherwise. Server-side owner/team checks on each command. Guests read published tasks only. CORS origin allowlist, request body limits, security headers, rate limits, safe URL validation. No remote execution/cloning of supplied repositories.

Tables users, teams, sessions, tasks, proposals, milestones, score_events, idempotency. Atomic synchronous SQLite transactions; no external calls inside transactions. Auth/role checked before external calls and versions/selection rechecked after. Real GitHub fetch uses fixed api.github.com routes, bounded timeout and no redirects. Provider failures preserve evidence as unverified and allow human review. Private repositories/OAuth excluded.

Public events contain only entity IDs/version and invalidation keys; draft changes sent only to owner room. Private proposal/milestone data only to involved users. Guest sockets receive public updates. Snapshot/read endpoints reauthorize; reconnect always refetches. Scoreboard never exposes evidence or contacts.

## Delivery and acceptance

backend/ standalone npm project: TypeScript, Express5, Socket.IO, better-sqlite3, Zod, official OpenAI SDK, Vitest, Supertest; npm lockfile. Optional serving of built frontend from configured path. Backend README, frontend handoff, OpenAPI/Swagger UI, typed client, .env.example, seed and demo smoke script.

Tests: score boundaries and placeholders; new cafe description through clarification/save/confirm/publish; guest and two teams; sorting/filters; partial drafts preserved across restart; stale write rejected; another owner forbidden; hidden draft never leaks; unlimited proposals and multiple selection; milestone evidence then one-time approval; rejected evidence no points; OpenAI invalid/timeout fallback; live and mock Git contract; two sockets invalidation/reconnect; seed idempotency and minimum 5 drafts/cards/teams/proposals.

Explicit limits: backend cannot validate final 3D FPS or teammate UI. Live OpenAI needs user's local key. Git metadata confirms repository facts, not business success.
