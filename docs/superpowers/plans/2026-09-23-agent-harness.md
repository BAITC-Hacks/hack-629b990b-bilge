# Harness and Git implementation plan

> Execution: subagent-driven-development, one independent implementation subagent at a time, followed by spec review and quality review. User authorization has already been obtained.

**Goal:** implement the design in ../specs/2026-09-23-agent-harness-design.md and confirm it with an end-to-end live scenario.

1. Extend shared contracts: analysis, quotes, run metadata, Git snapshot. Keep backward compatibility with stored JSON. Write boundary and source checks. Review the design separately.
2. Git adapter: public repo/tree/PR, pinned README and PR patches, bounded reads, partial sampling and protection against head changes. Isolated tests with an HTTP fixture + a real smoke test. Ownership: integrations/git.ts and a new test/git-materials.test.ts.
3. AI runtime: gpt-6-luna, low reasoning, structured output, timeout/limit, metadata and fallback categories. Analysis via quotes only, neutral clarifications via the server-side catalog, linking criteria to material quotes. Isolated SDK transport tests.
4. UX and persistence: quality warnings, analyze/apply commands, optimistic version guards, private run history, workspace next actions and milestone hints. User-path tests with in-memory SQLite, conflicts and privacy.
5. Update the client/OpenAPI/docs, .env.example and the ignored .env without exposing the key. Add preflight and an eval CLI with at least 15 cases and a report on real mode/quality/latency.
6. Verification: typecheck, relevant tests → full suite, format/build, stub HTTP demo, live Luna+Git flow, live evals. Design compliance review, then quality review; fix significant findings. Restart the local backend, check Swagger and health.
7. Record results, limitations and metrics in docs; commit/push to backend/bff after checking the diff for secrets. Summary for the user with capabilities and honest limitations.

## Execution result

- Items 1–5 implemented: Luna runtime, quote analysis, apply/reject, card quality, private history, real GitHub materials, client and 26 OpenAPI operations.
- Spec review and the subsequent quality review are complete. Fixed patch links to the pinned comparison, the status of unassessed criteria and clarification progress after applying quotes.
- A separate UX defect was found and fixed: "Don't know yet" previously gave points for a text field. The regression first reproduced 25 extra points, then passed after the fix.
- Live preflight: gpt-6-luna is available; public repositories and PRs were read with SHA and materials without GITHUB_TOKEN.
- Live HTTP demo: analysis → quote selection → clarifications → publication → two proposals → Git → check with quotes → manual acceptance; 10 points awarded once, 3 private AI runs in the history.
- Live eval: [45/45 scenarios, 0 fallback, p50 2781 ms, p95 4853 ms](../../evals/live-harness-report.json). This is a limited set of extraction regressions, not a full evaluation of semantic quality or interface usability.
- The user delegated the decision on private Git: automatic checking of public repos/PRs is kept; private links are accepted for manual review. The project repository itself remains private.
- The local backend runs on 127.0.0.1:3001 with Luna; Swagger and health were checked in the browser. Frontend/3D remain developer A's area.
