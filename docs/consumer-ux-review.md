# Review of business and team scenarios

Date: 2026-09-23. The current version of the backend/BFF after the harness was reviewed, not just the diff of the last commit. Two independent reviews: requirements compliance from the business side and implementation from the team side. Heuristics for status clarity, control, error prevention and recovery were used. User stories were reproduced over HTTP on an isolated SQLite database; the local demo data was not changed.

This is an expert review of scenarios and screen data. It does not replace observing real users or reviewing developer A's finished visual interface.

## Requirements compliance — business

| UX priority (0–4) | Found | Fix and result |
|---|---|---|
| 3 | The industry `IT` was saved but blocked confirmation with the error "Specify the industry" | Title and industry are validated separately from the scored descriptive fields. Meaningful values of two or more characters pass confirmation and publication. |
| 2 | After a team was deselected, the dashboard kept showing the milestone as "in review", although nothing could be decided on it | `pendingReviews` counts only selected teams. Paused milestones are listed separately in `pausedMilestones`; the state matches the card and the available actions. |
| 2 | Returning without an explanation did not indicate which field to fix | `FEEDBACK_REQUIRED` contains `fieldErrors.feedback` and `recovery=correct_fields`. Entered data does not have to be lost. |

All three defects existed before the last harness commit and surfaced when checking the full path. No new violations of the manual confirmation rules or data isolation were found.

## Implementation and UX — team

| UX priority (0–4) | Found | Fix and result |
|---|---|---|
| 2 | After a team was selected, the card kept leading to the proposal form without pointing to the transition to work | `participation` shows the team's own status and an addressed next step: dashboard, milestone creation, existing milestone or comments. Additional proposals remain available. |
| 2 | After resubmission, previous business comments disappeared | Private `reviewHistory` (up to 20 decisions) and `previousFeedback` preserve the rework context. A repeated confirmation does not duplicate the history. Old comments without a date are kept with an explicit `null`. |
| 2 | The general instructions promised a repeat AI check of an already submitted and locked milestone | The documentation distinguishes repeating analysis/clarifications from the manual review of a submitted milestone. `reviewNotice` explains that the materials are saved; resubmission is possible after it is returned. |

No separate consequences of code-smell heuristics requiring refactoring were found. The changes found concern contract clarity, not code cosmetics.

## Additional fixes during the scenario walkthrough

- In a draft milestone, the business received the instruction "Add Git", although this is a team action. Hints now match the role.
- A repeated `approve` showed a notification about awarding another 10 points. The award was already protected on the server; now the text also says there is no repeated award.
- The business dashboard suggests first reviewing results, then considering proposals, then continuing the card.

## Verifiable guarantees

New HTTP regressions in `backend/test/consumer-journeys.test.ts` first reproduced seven faulty scenarios, then passed after the fixes: short industry; team navigation; deselection/reselection; return form error; history retention and its privacy; role/fallback hints; repeated confirmation without new points. The history and comments do not appear for another team or in the public card.

Final check: **169 tests in 10 files**, TypeScript, Prettier and the build pass; the HTTP demo in stub/mock completed with a one-time award of 10 points. Independent repeat checks additionally confirmed routing of two different teams to their own milestones, retention of exactly the 20 most recent decisions, carry-over of old undated comments, and no pausing when only one of several selected proposals is deselected.

The frontend needs to wire up the new fields according to the [integration guide](backend-integration.md). On the finished UI it remains to check readability, mobile input, focus after errors, preservation of typed text while waiting, and real transitions between screens. Editing already created proposals/milestone conditions and server-side drafts of unsubmitted materials remain separate improvements; the current MVP supports new proposals and resubmission after a return.
