# AI Sana: historical audit of AI features and the harness before implementation

**Status: historical snapshot; the implementation description below has been superseded by current documentation.** The audit was performed on September 23, 2026 at commit `2623249` of the `backend/bff` branch, before the next harness iteration. Wording such as "current", "not yet", the old model settings and test results below refer only to that commit. The text is kept as a record of findings and initial priorities, not as launch instructions for today's backend. No new paid OpenAI calls were made as part of this particular audit.

After the audit, the following were implemented: suggestions with exact quotes and manual application by ID, neutral server-side question texts, advisory quality checks, a private history of completed runs, limited GitHub README/patch reading with SHA and criterion quotes, preflight and an eval set. The current default model is `gpt-6-luna`, reasoning `low`, 30 seconds and 4096 output tokens per operation. Current settings, contracts and limits: [backend/README.md](../backend/README.md), [frontend integration](backend-integration.md), [harness design](superpowers/specs/2026-09-23-agent-harness-design.md).

Post-implementation check on September 23, 2026: live availability of the model, public repos/PRs and the HTTP demo was confirmed; GitHub worked without a token. The [live extraction series](evals/live-harness-report.json) passed 45/45 checks across 15 synthetic scenarios, no fallback, p95 4853 ms. This is a limited regression, not a full semantic evaluation or a check of the finished UI/3D. No autonomous agent loop, Git code execution or automatic acceptance of results was added; the decision and the award of 10 points remain manual. The original audit follows, without revising its historical conclusions.

## Conclusion

The project has a controlled AI workflow with two operations: generating clarifying questions and a preliminary list of checks for Git evidence. Its harness already provides structured output, domain constraints, a timeout, fallback, result persistence and manual human confirmation. The model does not choose tools or drive multi-step execution on its own.

The provided case does not require an autonomous agent, the Agents SDK, multi-agent orchestration or a separate harness. It requires at least one meaningful AI feature. Such a feature is implemented; its usefulness across different tasks and the absence of unconfirmed assumptions still need to be backed by semantic evals. The next useful step is to extract facts already provided into verifiable suggestions for the card, so the user does not have to enter them again.

## What exactly the jury evaluates

Primary source: `C:/Users/Tao/Downloads/HackAlem AI_ кейс по геймификации практических заданий.pdf`, section 5 on page 4, section 9 on pages 5–6. Text was extracted from all six pages; the pages with AI requirements and the scoring table were also reviewed visually. The local `TZ_AI_Sana_3D_platforma.md` is a project-level elaboration, not a separate rubric from the organizers.

| Criterion | Maximum | State and limits of confirmation |
| --- | ---: | --- |
| End-to-end scenario | 20 | The backend completes creation → confirmation → publication → proposals → manual selection. The user path in the shared interface needs to be checked with developer A. |
| Card quality | 15 | There are 3–5 questions, all fields, editing, saving answers. Weak point: facts from the original description are not distributed across fields; substance is evaluated only to a limited extent. |
| Business gamification | 25 | Transparent formula, breakdown, recalculation up/down after confirmation, sorting. It is necessary to show improvement of the business card specifically; Git milestone points do not replace this criterion. |
| Catalog and proposals | 15 | The backend supports a shared catalog, all levels, multiple proposals and manual selection of multiple teams. |
| AI feature | 10 | Real SDK, structured questions and fallback mode. Formal checks exist; guarantees of semantic correctness and variety of live answers are not yet proven. |
| Technical quality | 10 | There is a launch, documentation, Swagger, validation and tests. Missing: AI run history and quality/latency measurements, but the case does not make them mandatory. |
| Demonstration | 5 | An HTTP smoke test does not replace five minutes of live demo in the UI. This criterion cannot be assessed yet. |

This table is not a score prediction: a final project score cannot be justified for a backend in isolation from the interface. The case allows a fallback when the API is unavailable, provided the prompt, input/output format and handling of an invalid response are shown. Automatic team selection is prohibited; publication and confirmation remain with a human.

## What the current harness can do

| Part | Implementation |
| --- | --- |
| Model context | Original text, current fields and the list of gaps per the server formula. The raw text is stored separately; the full dialogue history is not passed to the model. |
| Main AI operation | OpenAI Responses API + Zod Structured Outputs: 3–5 questions on allowed fields; gaps first, then explicitly marked verification questions. |
| Output checks | Number/uniqueness of questions, match of the gap list, field applicability, interrogative form; lexical check for new numbers and dates. |
| User state | SQLite stores the card, questions, marked answers, progress and clarification completion. The next question, field type, options and hints are provided. |
| Fault tolerance | Default AI timeout of 15 seconds, output limit of 2000 tokens, then a labelled stub. No automatic SDK retries. |
| External tool | The server calls GitProvider before the AI milestone check. Public GitHub repos/PRs/trees are checked via REST; other valid Git links go to manual mode. The model does not call this tool itself. |
| AI milestone check | The model selects indexes of verified metadata and items from the server's check catalog. No free-form verdict on work readiness is generated. |
| Action control | The AI does not publish the card, select a team or award points. Permissions, versions, team selection and uniqueness of the award are checked by the server. |
| Limitations | No automatic extraction of facts into fields, semantic audit of the card, task recommendations by skills, reading of README/diff/tests, autonomous tool loop, AI run history or set of live semantic evals. |

Sources in code: `backend/src/integrations/ai.ts` (prompts and checks), `integrations/runtime.ts` (deadline), `integrations/git.ts` (Git metadata), `services/tasks.ts` (input, answers, confirmation), `services/work.ts` (milestones), `views.ts` (BFF), `db.ts` (persistence). In `config.ts` the default model is `gpt-4o-mini`. The last full check before the audit: 119 tests, build and HTTP demo; these are application tests, not 119 quality checks of the live model.

## Three reproduced limitations

The checks were run in isolation: SQLite `:memory:`, synthetic data and a substituted HTTP model response. The demo database was not changed.

1. **Re-entering information already known.** The original text explicitly mentions cafe managers, a sales CSV, a purchasing forecast and acceptance via CSV. After `Tasks.start`, the fields `users`, `dataSource`, `expectedResult` remain empty and the rating forecast is 10. Reason: start copies the text only into `context`, and the AI must return the list of gaps computed from the fields unchanged (`services/tasks.ts:122`, `:175`, `integrations/ai.ts:23`). This is not a schema error, but a noticeable loss of convenience and AI usefulness.

2. **Filled in does not mean quality.** For a synthetic card, all string fields are filled with the phrase "Make it better", `dataAvailability=available`. `calculateScore` returns 100 and an empty gap list. After manual confirmation, exactly this result would become official. The current check filters out short strings and known placeholders but does not evaluate the specificity and verifiability of the text (`domain/score.ts`).

3. **A form check does not rule out semantic fabrication.** A valid response was substituted with the question "Which employees will work with the SAP system you have already implemented?". The user only mentioned unsold food. The validator accepted the question: it contains no new numbers/dates, and the other formal conditions are met. This proves a gap in the check, not a claim that the live model produced such an answer (`integrations/ai.ts:166`, `:277`).

The Git check has a separate practical limitation: confirming that a PR exists and the number of changed files does not verify that the milestone criteria are met. The code honestly labels this as preliminary metadata. For now, this feature is correctly presented as preparation for manual review, not as automated code review.

## Improvement priorities

### 1. Fact extraction and convenient application — first priority

Add an operation that suggests distributing facts from the original text/answer across fields. For each suggestion store `field`, `value`, `sourceQuote` and the source/version of the text. The quote must actually be present in the source; this is not enough to prove meaning, so domain checks and human review remain. Known facts, missing information and ambiguities are shown separately. Unreported deadlines, goals and technologies stay empty.

UX: "Found in the description: users — managers; data — CSV. Review and apply". A single field can be accepted, the value corrected, or rejected. After applying, questions are asked about actual gaps. Suggestions do not change the official rating or the published card until the usual manual confirmation. This directly strengthens card quality and the AI feature (25 rubric points combined), and also speeds up the demo.

### 2. Checking substance and contradictions

Add help for vague wording and conflicts: "Make it better" → "What will change and how will you verify it?", "no data" together with a claim of an available CSV → a question about the actual state. Return the reason, a reference to the field and one useful next action. The AI check remains a recommendation; the score continues to be calculated by the published server rules and the confirmed card. Do not introduce an opaque second rating from the model.

### 3. Semantic evals and run log

Start with 15–20 labelled tasks from different industries: weak and detailed descriptions, unknown data, no data, a short numeric target, contradictions, an instruction inside user text, an API failure. For each, specify in advance the reported facts, expected gaps, unacceptable assumptions and expected recovery after a failure. Evaluate questions by meaning, not exact text match. Run three independent live-model passes and a separate stub report; do not present the fallback rate as model quality. This is an initial regression, not statistical proof of reliability.

Collect `runId`, operation, card version, model/prompt version, duration, usage, check results and fallback category. Currently AI exceptions are reduced to a generic message; timeout/schema/semantic validation reasons are not stored. Private inputs, keys and internal reasoning must not end up in a public report. For the interface, an "analyzing / done / fallback questions shown" status is enough; the technical trace is needed by the developer and for the defense.

### 4. Git materials analysis — after the card builder

If time remains, add limited reading of the README and changed PR files with size limits and pinning to a specific SHA. For each criterion return "evidence found / insufficient data / demo needed" with links to the verified fragments. The README is the author's claim, not proof of a working result. Automatically executing someone else's code would require a separate environment and is not needed for the current case. The decision and the award of points remain manual.

## Minimal target flow

Input → extraction of suggestions with sources → structure and domain-constraint checks → human review and application → current gaps → questions one at a time → preview → manual confirmation → server rating and publication.

If the response check fails: one limited correction attempt only if time budget remains, then a clear fallback that preserves input. A retry is not required for the hackathon; its benefit should be checked against success rate and latency. A fixed workflow is sufficient as long as there is no user task that requires autonomous tool selection.

## Research: which harness is useful for AI Sana

Sources were checked on September 23, 2026. This section describes architectural reference points; whether the listed capabilities exist in the current code and match the hackathon criteria must be established separately. The recommendations below are engineering conclusions for the project, not requirements from the organizers.

**Workflow vs. autonomous agent.** Anthropic distinguishes a workflow, where the order of LLM and tool calls is set by code, from an agent, where the model itself chooses the next actions and tools. A fixed process suits tasks with known stages; autonomy is useful when the path and number of steps are not known in advance. "Deterministic workflow" means predictable orchestration, not identical LLM answers. The authors recommend starting with a simple solution and adding complexity after a measurable improvement in results. Therefore, the absence of the Agents SDK, multiple agents or a free tool loop is not in itself a shortcoming of the harness. The original article was published in 2024; we use its architectural distinctions, not as a catalog of today's tools. [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

**Response shape vs. correctness of content.** Structured Outputs constrains the response to a supported JSON schema, but the documentation explicitly allows for errors inside a valid result. In addition, the application must handle model refusals and incomplete responses. Practical conclusion: separate structure checks, domain checks and quality evaluation. Number ranges, required fields, references to existing objects and consistency of totals can be checked by code; correctness of an explanation and fidelity to the source data require separate references or human review. A repeated request can fix the format, but a successful parse does not prove a semantic error has been eliminated. [OpenAI — Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

**State and human participation.** OpenAI separately describes conversation history, an interrupted run with tools awaiting a decision, and a serializable snapshot for continuing after approval/rejection. Stored conversation and resuming execution are different tasks. For AI Sana we recommend storing `run_id`, stage, status, input version, intermediate result and the user's decision in durable storage. If confirmation is required, the server must block the corresponding action until the decision is made, and continue from the saved stage after a restart. A simple "ask the user" instruction in the prompt does not provide such a guarantee. Protection against repeated execution of an action should be implemented separately, for example with an idempotency key. This can be done in the existing backend; the SDK is one implementation option. [OpenAI — Results and state](https://developers.openai.com/api/docs/guides/agents/results).

**Observability and semantic evaluation.** OpenAI suggests using traces to analyze the whole chain of calls and checks, then repeatable datasets/evals to compare changes. For the project we recommend a small labelled set of real scenarios: normal input, incomplete and contradictory data, an ambiguous request, a refusal and a provider failure. What needs checking is achievement of the user's goal, factual correctness, groundedness of the answer and correct handling of uncertainty. A test with a stub response is useful for checking integration but does not measure live model quality. Minimal trace: `run_id`, stage, model and prompt version, time, check results, number of attempts and error category; store only the necessary data. If an LLM evaluator is used, disputed scores should be cross-checked with a human. [OpenAI — Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals).

**Latency and cost.** OpenAI recommends reducing the number of requests and the amount of generation, parallelizing independent steps and using ordinary code where an LLM is not needed. Smaller models are usually faster and cheaper, but the choice requires a quality check. For AI Sana we recommend measuring the total time of a successful scenario, p50/p95 on a sufficient sample, tokens, retries and estimated cost, separately marking cold starts and errors. Calculate cost from actual usage and the current pricing, with the calculation date. Limit execution time, number of attempts and maximum response size. Showing the execution stage to the user is helpful, but it does not replace measuring real latency. [OpenAI — Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

Practical priority for the next iteration: a measurable end-to-end scenario → domain check of the response → state persistence and recovery after failure → trace and a small set of semantic evals → latency and cost optimization. Autonomous tool selection is worth adding if a specific user scenario requires adaptive actions and comparison with the fixed workflow shows a benefit.
