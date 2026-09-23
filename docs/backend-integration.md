# Connecting the frontend to AI Sana

HTTP base: `http://localhost:3001/api/v1`. Swagger: `http://localhost:3001/api/docs`, OpenAPI 3.1 JSON: `http://localhost:3001/api/openapi.json`. Command schemas are generated from the same Zod validators the server uses to validate requests. The browser client is `backend/client/index.ts`: it has no runtime dependencies on the server, SQLite or Node.js; imports of server types are erased at build time.

From `backend/`: `npm ci`, copy `.env.example` to `.env` if the file does not exist yet, then `npm run seed`, `npm run dev`. Live AI requires `OPENAI_API_KEY`; without a key a clearly labelled fallback is available. Defaults are `gpt-6-luna`, reasoning `low`, 30 seconds and 4096 output tokens per AI operation. `GITHUB_TOKEN` is optional for public repos/PRs. Codes for the prepared profiles are in the **local** `backend/demo-accounts.local.json`; seed creates random codes and does not publish them in the repository. The server also runs seed on startup. Allowed frontend origins are set in `ALLOWED_ORIGINS`; by default these are `http://localhost:5173` and `http://127.0.0.1:5173`.

## Session in a separate tab

The client returns the whole envelope, does not store the token itself and does not retry requests. `baseUrl` is the full prefix, including `/api/v1`. When proxying on the same origin the parameter can be omitted. The frontend can import the client from the sibling backend folder; do not copy a single file without the type-only imports it needs.

```ts
import { createSanaClient, ApiError } from '../backend/client/index';
import type { WorkspaceView, InvalidationEvent } from '../backend/client/index';

const api = createSanaClient({
  baseUrl: 'http://localhost:3001/api/v1',
  getToken: () => sessionStorage.getItem('sana.token'),
});

async function signIn(code: string) {
  const { data } = await api.startSession({ code });
  sessionStorage.setItem('sana.token', data.token);
  return data.actor;
}

async function signOut() {
  await api.endSession();
  sessionStorage.removeItem('sana.token');
}

// One-time creation of a new team instead of logging in with a prepared code:
async function registerTeam(name: string) {
  const { data } = await api.createTeam({ name });
  sessionStorage.setItem('sana.token', data.token);
  return data.code; // Show it to the user and suggest saving the code for the next login.
}
```

Open two independent tabs: log in with a business code in one and a team code in the other. `sessionStorage` isolates later token changes between tabs; a new tab opened via opener/duplication may first receive a copy of the current session — log in with the required role in it. Do not use shared `localStorage` for this demo. `POST /teams/start` returns the code only on creation and **does not support** safe repetition via `Idempotency-Key`; do not automatically retry this request.

## Response shape and screen state

```json
{
  "data": { "screen": "task-workspace", "task": { "id": "…", "version": 3 } },
  "feedback": { "kind": "success", "message": "Draft saved" },
  "meta": { "requestId": "…", "contractVersion": "1.0" }
}
```

The example is abbreviated; full types are exported by the client. `data` is a ready-made BFF screen model, not a table row. A command returns the updated screen: replace the corresponding cache with its `data` and show `feedback?.message`. Reads usually return `feedback: null`. `actions[].enabled/reason`, `nextAction`, `emptyState`, field labels and steps are already prepared by the server. The server still re-checks permissions for every command. Below are all 26 routes of the typed client.

| Client method | HTTP after `/api/v1` | Data and access |
| --- | --- | --- |
| `health()` | `GET /health` | Server/database check; public |
| `bootstrap()` | `GET /bootstrap` | Actor, capabilities, navigation; guest allowed |
| `startSession({code})` | `POST /session/start` | Token, actor, expiresAt |
| `endSession()` | `POST /session/end` | End the current session |
| `createTeam(input)` | `POST /teams/start` | Team, session and one-time code issuance |
| `catalog(filters?)` | `GET /catalog` | Filters, cards and world; published only |
| `dashboard()` | `GET /dashboard` | Dashboard for the current role; session required |
| `scoreboard()` | `GET /scoreboard` | Only name, confirmedPoints, rank |
| `snapshot()` | `GET /snapshot` | Bootstrap + catalog + dashboard + scoreboard |
| `startTask(input, options?)` | `POST /tasks/start` | Workspace; business only |
| `task(id)` | `GET /tasks/{id}` | Public card and the team's own proposals |
| `workspace(id)` | `GET /tasks/{id}/workspace` | Workspace; owner only |
| `reviewDesk(id)` | `GET /tasks/{id}/review` | Proposal comparison and milestones; owner only |
| `saveDraft(id, input)` | `POST /tasks/{id}/draft` | Partial fields → workspace |
| `applyAnswers(id, input)` | `POST /tasks/{id}/answers` | Answers by field → workspace |
| `clarifyTask(id, {expectedVersion})` | `POST /tasks/{id}/clarify` | 3–5 questions → workspace |
| `analyzeTask(id, {expectedVersion})` | `POST /tasks/{id}/analyze` | Quotes for empty fields → workspace; owner |
| `applySuggestions(id, input)` | `POST /tasks/{id}/suggestions/apply` | Selected IDs or reject all → workspace; owner |
| `confirmTask(id, {expectedVersion})` | `POST /tasks/{id}/confirm` | Confirmed snapshot → workspace |
| `publishTask(id, {expectedVersion})` | `POST /tasks/{id}/publish` | Publication → workspace |
| `propose(id, input, options?)` | `POST /tasks/{id}/proposals` | Updated card; team |
| `decideProposal(id, input)` | `POST /proposals/{id}/decision` | Review desk; task owner |
| `createMilestone(taskId, input, options?)` | `POST /tasks/{id}/milestones` | Milestone; selected team |
| `milestone(id)` | `GET /milestones/{id}` | Milestone; own team or task owner |
| `submitEvidence(id, input)` | `POST /milestones/{id}/evidence` | Milestone after submission; own selected team |
| `decideMilestone(id, input)` | `POST /milestones/{id}/decision` | Milestone after the decision; task owner |

For tasks, take `expectedVersion` from `workspace.task.version`; for a proposal decision, from `proposal.version`; for a milestone, from `milestone.version`. After each command use the version from the new response. For `saveDraft`, the changed fields are enough. `applyAnswers` accepts an array of `{field, value}`: `noConstraints` is a boolean, `dataAvailability` is `available | none | unknown`, other fields are strings.

`workspace.task.version` protects editing specifically: new proposals, team selection and milestone events do not change it. So the business's input does not conflict with team actions. `card.version` and the event version reflect all task activity; they must not be used as the editor's `expectedVersion`. An old version from another editor tab still gets `409`.

## Description analysis and manual filling

`analyzeTask` is the explicit "Analyze description" action. It takes the saved `rawDescription` and fields, and returns `workspace.analysis`, `quality` and the updated version. Each suggestion contains `id`, `field`, `value`, `source: {id: 'rawDescription', quote}`. `value` equals an exact contiguous fragment of the original description: the model does not paraphrase it or add information. Only empty text fields can be suggested; `dataAvailability` and `noConstraints` remain a manual choice. The quote confirms the source, but a human checks its meaning and fit with the field.

Show the quote next to the field and the user's choice. `applySuggestions` sends `{expectedVersion, analysisId, suggestionIds}` with IDs from the saved response, without field values. An empty `suggestionIds: []` rejects all; applying a subset completes the whole analysis, and the remaining suggestions are not applied. Save human-corrected text via `saveDraft`. Applying all suggestions automatically is not allowed. Applying updates only the draft and the forecast; the official score and published information change after the usual human confirmation.

| `analysis.status` | Display and action |
| --- | --- |
| `ready` | Suggestions are available for review; apply only when `canApply=true` |
| `empty` | No suggestions; continue manually or explicitly repeat the analysis; show `mode`/`warning` |
| `stale` | Saved suggestions belong to an earlier version; cannot be applied, offer a new analysis |
| `resolved` | The user has already applied a selection or rejected all; do not send these IDs again |

Before the first analysis, `analysis=null`. The analysis stores `sourceVersion` and `applicableVersion`; the server decides applicability. After a successful analysis use the **new** `workspace.task.version` to apply. Any later editor command that changes the version makes an unresolved analysis stale. Team activity in the catalog does not change the editor version.

`quality.warnings` are server-side recommendations with `field`, `relatedFields`, `message`, `actionLabel`; `quality.nextAction` may point to a field. The rules flag known generic phrases, the same text in three or more fields, "no data" combined with a filled-in source, and "no constraints" combined with constraint text. These are limited, explainable checks: they do not prove the content is complete, do not change the scoring formula and do not block publication. Show them next to the fields, separately from `forecast` and `officialScore`.

## AI waiting, fallback and history

Requests run synchronously. During `analyzeTask`, `clarifyTask` or `submitEvidence`, show a local waiting state and disable resubmission of the same operation. Keep typed text and allow manual filling to continue. Do not tie the availability of confirmation or publication to AI success; use the server's `actions`. If the user saves edits while the AI is working, the late result may get `409 STALE_VERSION` — this protects the newer data. Cancelling the request in the browser does not guarantee that server-side processing is cancelled; re-read the screen before retrying.

The default AI limit is 30 seconds, Git is 15 seconds. Submitting evidence runs Git and AI sequentially, so it can take both budgets plus network time. Do not show a fake completion percentage. In `mode=stub`, analysis returns an empty list, clarification returns template questions, and milestone checking returns manual checks. For analysis and clarifications show `warning`, the manual path and an explicit retry button. A submitted milestone stays `in_review` even with fallback: the result is saved, and `reviewNotice` explains the manual review by the business. Do not offer resubmission of a locked milestone; it becomes available after it is returned for rework. The client and SDK do not make automatic paid retries.

`workspace.aiRuns` contains the last 20 completed runs; SQLite keeps up to 100 per task. The log is available only to the task owner, not to the catalog or other teams. A record contains the operation, model, prompt version, duration, usage, source version, validation result and fallback category. `disposition=applied` means the call result was saved, and `stale` means it could not be applied to the changed state; this is not the user's decision on the suggestions. Prompts, raw responses, secrets and internal reasoning are not written to this log. There is no `in_progress` status, queue or resumption of an interrupted process. Technical metadata can be moved to diagnostics without making it a required user step.

## Clarifications and catalog

Show clarifications one at a time via `clarification.nextQuestion`. The AI chooses the fields for the questions, and the server produces neutral text from its own catalog; an arbitrary model-generated question is never shown to the user. The response already includes `field`, `text`, `index` (1-based), the saved `value`, the `input` type and `options` for a list. `progress` contains `total`, `answered`, `skipped`, `remaining`; `questions` keeps the whole list with `answered` and `skipped` flags. After answering, replace the workspace with the server response: the next question is selected automatically. When reopening, call `workspace(id)`; do not run `clarifyTask` automatically — that creates a new question session.

Saving any field does not remove questions. A cleared answer becomes incomplete again. "No data" skips the source, the absence of constraints skips the constraints question; a metric with a target and an acceptance condition substitute for each other. If the alternative is removed, the question comes back. "Don't know yet" counts as an answer but does not add readiness points for having the information.

`nextAction.id=answer_question` means continue with the current question. After the questions are finished, reviewing the card is suggested. An incomplete card can also be confirmed — clarifications are not a barrier to publication. `confirmTask` sets `clarification.reviewed=true` and ends the current session; a new explicit `clarifyTask` opens questions again, even if the card is already published. `questions` and progress remain available for viewing.

The catalog accepts `search`, `industry`, `level`, `page`, `pageSize`, `worldPage`. Cards are sorted by official score; the world is ordered stably by publication, five stations at a time with `slot` and `position`. `page` and `worldPage` are independent. `snapshot()` uses the default catalog filters and `dashboard: null` for a guest; re-request the current filtered catalog separately.

On cards and stations, `pendingMilestones > 0` enables the "In review" marker; `approvedMilestones` shows confirmed milestones. In the details, `teamProgress` contains `pendingStages`, `approvedStages`, `status` and a ready-made `statusLabel` for each selected team. Links, work descriptions and business comments are not published here. On the private milestone screen use `statusLabel` and `statusHint`: the team sees that review is pending or a request to fix the result, the business sees a decision hint. Points appear only after confirmation.

## Cafe scenario

In the business tab after `signIn`:

```ts
let workspace = (await api.startTask({
  rawDescription: 'Every evening the cafe is left with unsold dishes. We need a purchasing forecast.',
  title: 'Reduce write-offs at the cafe', industry: 'Food service',
})).data;
const taskId = workspace.task.id;
workspace = (await api.analyzeTask(taskId, {
  expectedVersion: workspace.task.version,
})).data;
// Show analysis.suggestions with quotes. selectedSuggestionIds is the human's choice in the UI.
const selectedSuggestionIds: string[] = []; // An empty selection means "Continue without suggestions".
if (workspace.analysis?.canApply) {
  workspace = (await api.applySuggestions(taskId, {
    expectedVersion: workspace.task.version,
    analysisId: workspace.analysis.id,
    suggestionIds: selectedSuggestionIds,
  })).data;
}
workspace = (await api.clarifyTask(taskId, {
  expectedVersion: workspace.task.version,
})).data;
// Show workspace.clarification.nextQuestion; mode/warning honestly report the AI mode.
workspace = (await api.applyAnswers(taskId, {
  expectedVersion: workspace.task.version,
  answers: [{ field: 'dataAvailability', value: 'available' }],
})).data;
workspace = (await api.saveDraft(taskId, {
  expectedVersion: workspace.task.version,
  fields: {
    need: 'Reduce write-offs of prepared food', users: 'Cafe managers',
    dataSource: 'Sales CSV for three months', expectedResult: 'Purchasing forecast prototype',
    acceptanceCriteria: 'Upload a CSV and show a forecast for each dish',
    constraints: 'Two weeks, no personal data',
    contact: 'cafe@example.test', interactionFormat: 'Two consultations per week',
  },
})).data;
// Show the preview and forecast. The user checks the details and clicks "Confirm".
workspace = (await api.confirmTask(taskId, { expectedVersion: workspace.task.version })).data;
workspace = (await api.publishTask(taskId, { expectedVersion: workspace.task.version })).data;
```

In the team tab, after logging in with its own code, choose the published card via `catalog()`:

```ts
const catalog = (await api.catalog({ industry: 'Food service' })).data;
const card = catalog.cards.find(card => card.title === 'Reduce write-offs at the cafe');
if (!card) throw new Error('Choose a published task');
const taskId = card.id;
const detail = (await api.propose(taskId, {
  idea: 'Demand forecast by day of the week', plan: 'Check the CSV, compare baseline models, run a pilot',
  estimatedTime: 'Two weeks', prototypeUrl: 'https://example.com/cafe-demo',
})).data;
// detail.myProposals — all of this team's proposals for the task.
```

In `myProposals`, the dashboard and the review desk, each proposal has `statusLabel` and `statusHint`. For a team, the card contains `participation`: the state of that team's own work and a `nextAction` with `taskId`/`milestoneId`. For guests and businesses, `participation=null`; other parties' private information never ends up there. Action routing: `propose` opens the proposal form, `open_dashboard` the team dashboard, `create_milestone` the milestone form for the given task, `open_milestone` an existing milestone by `milestoneId`. `selectedTasks[].nextAction` on the dashboard uses the same contract. A different approach can be proposed: having a selected proposal does not block additional proposals.

If a milestone has already been created and the last selected proposal of that team is deselected, `participation.status=paused` and the milestone label is "Work paused". As long as the team still has another selected proposal, work continues. Materials are kept; submit/accept actions on a paused milestone are unavailable until the team is selected again. The business dashboard counts only selected teams' milestones in `pendingReviews`; `pausedMilestones` shows paused ones separately. `tasks[].nextAction` leads first to results in review, then to new proposals, and only after that to the builder.

`milestone.reviewHistory` stores up to the 20 most recent business decisions with `decision`, `feedback`, `decidedAt` and the result version of the decision. The date may be `null` only for a comment from an old record with no known date; the UI must not substitute a made-up time. `previousFeedback` keeps the most recent comments after resubmission; show them as "Latest business comments" next to the new work. `feedback` is the text of the current decision. The history is available only to that team and the task owner. A repeated confirmation reports "No repeated award" and does not create another decision record.

When returning without an explanation, the server responds with `422 FEEDBACK_REQUIRED`, `fieldErrors.feedback` and `recovery=correct_fields`: keep the form and highlight the comments field. Title/industry allow meaningful short values of two or more characters, for example `IT`; the rules for awarding points for descriptive fields do not change.

The business picks the desired proposal from `reviewDesk(taskId)` and calls:

```ts
const desk = (await api.reviewDesk(taskId)).data;
const proposal = desk.proposals[0]; // In the UI, the row selected by the user.
if (!proposal) throw new Error('No proposals yet');
await api.decideProposal(proposal.id, {
  expectedVersion: proposal.version, decision: 'select', note: 'Starting the pilot',
});
```

The selected team creates a milestone and submits the result:

```ts
let stage = (await api.createMilestone(taskId, {
  title: 'Check the forecast', acceptanceCriteria: 'A forecast for each dish from the test CSV',
})).data.milestone;
stage = (await api.submitEvidence(stage.id, {
  expectedVersion: stage.version,
  evidenceUrl: 'https://github.com/openai/openai-node', // Replace with a link to your own materials.
  description: 'Added CSV import and a forecast demo',
})).data.milestone;
// stage.status === 'in_review'; points have not been awarded yet.
```

The business opens this milestone and makes a decision:

```ts
const stage = (await api.milestone(milestoneId)).data.milestone; // ID from reviewDesk.milestones.
const accepted = (await api.decideMilestone(stage.id, {
  expectedVersion: stage.version, decision: 'approve',
})).data.milestone;
const scoreboard = (await api.scoreboard()).data;
// To return it, use decision: 'return' and a non-empty feedback.
```

Drafts are not available to guests: for them `task(id)` returns 404, while the owner reads `workspace(id)`. The official score changes only on confirmation and **may decrease**; before that, `forecast` is only a forecast. The title and industry are also part of the confirmed snapshot and do not leak from the draft. A low score does not block publication or proposals. Several proposals can be submitted and several teams selected. Each selected team has one milestone per task. After confirmation the milestone is immutable; the server awards exactly **10 points once**. Git facts and AI comments do not replace the business's decision; `mode`, `provider`, `status`, `warning` must be shown without presenting them as a successful check.

## Git materials and criterion quotes

The private milestone screen is available to its team and the task owner. `milestone.evidence.snapshot` may contain `commitSha`, `inspectedAt`, `coverage`, `files` and `warnings`. A material contains `id`, `path`, `kind: readme|patch`, `sourceUrl`, `content`, `truncated`. The README is pinned to a SHA via a blob link, the patch to the comparison of base SHA and head SHA, including deleted lines. Show the text as untrusted content, without executing HTML or instructions from it.

The sample is limited to the README and the first page of the PR patch: up to 8 materials, 6000 characters per material, 24000 in total; each GitHub JSON response is limited to 256 KiB. `coverage=complete` applies only to this sample, `partial` means incomplete/truncated materials, `metadata_only` means metadata only. This is not an audit of the whole repository. For a repo/tree, the available README is read, not the entire source code. If the PR changes during reading or its state cannot be re-verified, the materials are discarded. Always show `warnings` and `truncated`, even with `status=verified`. The server does not run the repository's code or tests.

`milestone.review.criterionEvidence` links a criterion to quotes `{materialId, path, sourceUrl, quote}` and a `nextStep`. The status `materials_found` means a selected fragment exists, `insufficient_evidence` means there is no useful quote in the assessed materials, `not_assessed` means the criterion was not assessed with the available materials, for example due to fallback or a limit. One live call considers up to 12 criteria taken from separate lines; the rest are left to a human. Quotes are verified verbatim by the server, but the README remains an author's claim and the patch is the text of the changes. No status means acceptance or rejection of the result. The business checks the demo and decides manually; `approve` awards a fixed 10 points only once, `return` requires an explanation.

## Errors, cancellation and retries

An HTTP error has `{error: {code, message, fieldErrors, recovery}, meta}`. The client throws `ApiError` with the same fields, plus `status`, `requestId`, `idempotencyKey`. For transport errors: `status: 0`, `code: NETWORK_ERROR` or `REQUEST_ABORTED`; an unintelligible successful response is `INVALID_RESPONSE`. All methods accept `{signal}` as the last argument for `AbortController`.

```ts
try {
  await api.saveDraft(taskId, { expectedVersion: 1, fields: { title: 'New title' } });
} catch (error) {
  if (!(error instanceof ApiError)) throw error;
  if (error.code === 'STALE_VERSION') {
    const latest = (await api.workspace(taskId)).data;
    // Keep local edits, show the conflict and let the user apply them to latest.task.version.
  }
  // error.fieldErrors['fields.title'], error.fieldErrors.title and _form — field/form errors.
  // On SESSION_EXPIRED, clear the token and return to the login form.
  // error.message — text for the user; error.requestId — diagnostics.
}
```

`startTask`, `propose`, `createMilestone` automatically set a random `Idempotency-Key`. For a controlled retry, store the key **before sending**, for example in the form state; retry the same body with the same key. On an error with an automatically generated key, it is available in `error.idempotencyKey`. A repeated call without passing the key means a new action.

```ts
const idempotencyKey = crypto.randomUUID();
const input = { rawDescription: 'Reduce write-offs at the cafe' };
const send = () => api.startTask(input, { idempotencyKey });
// await send(); if the response is lost, a repeated send() returns the same task.
```

On `409 IDEMPOTENCY_CONFLICT`, do not retry a changed body with the old key. Keys are not needed for ordinary saving: it is protected by `expectedVersion`. Do not overwrite other people's changes with an automatic retry on `STALE_VERSION`.

For suggestions, on `409 ANALYSIS_STALE` (`recovery: 'reanalyze'`) re-read the workspace, keep the local input and offer an explicit new analysis or manual filling. Do not automatically plug the new version into the old `analysisId`. `409 FIELD_ALREADY_FILLED` also requires re-reading the data and keeping the already filled field. `422 INVALID_SUGGESTIONS` means unknown or duplicate IDs: restore the selection from the current analysis. After a network error in an AI operation, first load the workspace/milestone: the server may have already saved the result even if the browser did not receive it. Repeating the analysis requires a separate user action.

## Realtime and recovery

For realtime, install `socket.io-client` in the frontend project. The connection goes to the **origin**, not `/api/v1`, path `/socket.io`. The token is passed in `auth.token`; a guest does not need it. After login/logout, reconnect the socket so that permissions match the current tab.

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  path: '/socket.io',
  auth: done => {
    const token = sessionStorage.getItem('sana.token');
    done(token ? { token } : {});
  },
});

let pending: ReturnType<typeof setTimeout> | undefined;
function scheduleRefetch() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    void api.snapshot().then(({ data }) => {
      // Replace the main screens' cache with data.
      // Load the open workspace/review/task/milestone and the filtered catalog separately.
    }).catch(error => {
      // Show a connection error, or the login form on SESSION_EXPIRED.
      console.error(error);
    });
  }, 50);
}
socket.on('connect', scheduleRefetch);
socket.on('sync.required', scheduleRefetch);
socket.on('invalidate', (event: InvalidationEvent) => {
  // event.invalidate — cache keys; event.taskId/entityId help refresh the open screen.
  scheduleRefetch();
});
// After signIn or signOut: socket.disconnect().connect().
// On unmount: socket.disconnect(); clearTimeout(pending).
```

`invalidate` contains **only** `{type, taskId, entityId, version, invalidate}`. For task events, `version` is the shared activity revision; before a command, load the editor, proposal or milestone version via HTTP. `team.created` refreshes `scoreboard`, has `taskId: null`, the team's `entityId` and `version: 1`; do not open a task for such an event. The login code and token are never included in the event. Milestone events include the `milestone` key so the open result screen can be refreshed. Submitting for review and returning for rework publicly update catalog markers without transmitting the content of the materials.

`sync.required` reports `{reason: 'connected', refetch: ['bootstrap','catalog','dashboard','scoreboard']}`. Events are not a log: messages during a disconnect may be lost. Therefore every `connect` and `sync.required` triggers a snapshot read, and the open detail screen is refreshed separately. Only owners receive events for drafts; guests receive public invalidations. Real data is always loaded via authorized HTTP. When refreshing a screen, keep local form input that has not been sent yet; a network event must not erase what a person is typing.

## Integration check

From `backend/`: `npm run check`, `npm test`, `npm run build`, `npm run demo`. `npm run preflight` checks the availability of the model and public repos/PRs; `npm run demo -- --live` runs the HTTP scenario with live providers on a temporary database. For evals: `npm run eval` is the stub contract, `npm run eval -- --live --repeat=3` is a paid live series. The scenarios are in [backend/scripts/eval-cases.ts](../backend/scripts/eval-cases.ts), reports are in `docs/evals/`.

On September 23, 2026 the live check of model/repo/PR connectivity and the HTTP demo passed; public GitHub worked without a token. The demo confirmed Luna, material quotes, three history records and the confirmation command from the business: 10 points with no repeated award. The user's decision was simulated by the smoke script. [Live series report](evals/live-harness-report.json): 45/45 checks across 15 synthetic scenarios, no fallback, p95 4853 ms. This is a limited regression of field extraction, not proof of full semantic correctness or of UI or 3D readiness. Launch rules and backend boundaries are in [backend/README.md](../backend/README.md); architectural decisions are in the [harness design](superpowers/specs/2026-09-23-agent-harness-design.md).
