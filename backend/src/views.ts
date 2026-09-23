import {
  action,
  commands,
  emptyFields,
  type Actor,
  type CatalogQuery,
  type FieldKey,
  type Milestone,
  type Proposal,
  type Task,
  type TaskFields,
  type Team,
} from './contracts.js';
import {
  calculateScore,
  hasMetricAndTarget,
  levelLabels,
  meaningful,
  validCardHeading,
} from './domain/score.js';
import { Store } from './db.js';
import { invariant } from './errors.js';
import { Tasks } from './services/tasks.js';
import { mayRejectProposal } from './services/work.js';
import { checkQuality } from './domain/quality.js';

const fieldLabels: Record<FieldKey, string> = {
  title: 'Title',
  industry: 'Industry',
  context: 'What is happening now',
  need: 'What needs to change',
  users: 'Future users',
  dataAvailability: 'Data availability',
  dataSource: 'Data source or sample',
  expectedResult: 'Expected result',
  successMetric: 'Success metric',
  successTarget: 'Target value',
  acceptanceCriteria: 'Acceptance condition',
  constraints: 'Constraints',
  noConstraints: 'No known constraints',
  contact: 'Contact channel',
  interactionFormat: 'Consultation format',
};
const fieldInput = (field: FieldKey) => ({
  input:
    field === 'noConstraints'
      ? ('checkbox' as const)
      : field === 'dataAvailability'
        ? ('select' as const)
        : ('text' as const),
  options:
    field === 'dataAvailability'
      ? [
          { value: 'available', label: 'Data is available' },
          { value: 'none', label: 'No data yet' },
          { value: 'unknown', label: 'Not sure yet' },
        ]
      : null,
});

function clarificationView(task: Task) {
  if (!task.clarification) return null;
  const { answeredFields = [], reviewed = false, ...result } = task.clarification;
  const questions = result.questions.map((question, index) => {
    const skipped =
      (question.field === 'dataSource' && task.draftFields.dataAvailability === 'none') ||
      (question.field === 'constraints' && task.draftFields.noConstraints) ||
      (question.field === 'acceptanceCriteria' && hasMetricAndTarget(task.draftFields)) ||
      (['successMetric', 'successTarget'].includes(question.field) &&
        meaningful(task.draftFields.acceptanceCriteria));
    return {
      ...question,
      ...fieldInput(question.field),
      index: index + 1,
      value: task.draftFields[question.field],
      answered: !skipped && answeredFields.includes(question.field),
      skipped,
    };
  });
  const pending = questions.filter((question) => !question.answered && !question.skipped);
  return {
    ...result,
    reviewed,
    missingFields: calculateScore(task.draftFields).missingFields,
    questions,
    nextQuestion: pending[0] ?? null,
    progress: {
      total: questions.length,
      answered: questions.filter((question) => question.answered).length,
      skipped: questions.filter((question) => question.skipped).length,
      remaining: pending.length,
    },
  };
}
export class Views {
  constructor(
    readonly store: Store,
    readonly tasks: Tasks,
  ) {}
  proposals(taskId: string) {
    return this.store.all<Proposal>('proposals').filter((p) => p.taskId === taskId);
  }
  milestones(taskId: string) {
    return this.store.all<Milestone>('milestones').filter((p) => p.taskId === taskId);
  }
  team(id: string) {
    const team = this.store.get<Team>('teams', id)!;
    return { ...team, confirmedPoints: this.store.points(id) };
  }
  selected(taskId: string) {
    return [
      ...new Set(
        this.proposals(taskId)
          .filter((p) => p.status === 'selected')
          .map((p) => p.teamId),
      ),
    ].map((id) => this.team(id));
  }
  proposalView(item: Proposal) {
    const labels = {
      pending: 'Awaiting decision',
      selected: 'Proposal selected',
      rejected: 'Proposal rejected',
    };
    const hints = {
      pending: 'The business has not decided yet. The proposal is saved.',
      selected: 'The business selected this proposal. The current work status is shown separately.',
      rejected:
        'The proposal was rejected. The team can propose another approach; decisions on other proposals are kept.',
    };
    return { ...item, statusLabel: labels[item.status], statusHint: hints[item.status] };
  }
  participation(taskId: string, actor: Actor | null) {
    if (actor?.role !== 'team' || !actor.teamId) return null;
    const proposals = this.proposals(taskId).filter((p) => p.teamId === actor.teamId);
    const selected = this.store.isSelected(taskId, actor.teamId);
    const milestone = this.milestones(taskId).find((m) => m.teamId === actor.teamId);
    const status =
      milestone && !selected
        ? 'paused'
        : selected
          ? (milestone?.status ?? 'selected')
          : proposals.some((p) => p.status === 'pending')
            ? 'pending'
            : proposals.length
              ? 'rejected'
              : 'not_applied';
    const labels = {
      not_applied: 'You have not applied yet',
      pending: 'Awaiting decision',
      rejected: 'Proposals rejected',
      selected: 'Your team is selected',
      draft: 'Preparing the result',
      in_review: 'Result under review',
      changes_requested: 'Changes requested',
      approved: 'Milestone approved',
      paused: 'Work paused',
    };
    const hints = {
      not_applied: 'Describe your idea and plan. A low card readiness does not block proposals.',
      pending: 'The business is reviewing the proposal. Meanwhile you can browse other tasks.',
      rejected: 'Read the business comment. You can send a new approach or find another task.',
      selected: 'Create a milestone and state which result the business will be able to check.',
      draft: 'Open the milestone, attach the result and send it to the business.',
      in_review: 'The result is saved and awaiting the business decision. Points appear after approval.',
      changes_requested: 'Open the business feedback, rework the result and send it again.',
      approved: 'Result accepted, 10 points awarded. You can pick the next task.',
      paused: 'Team selection was cancelled. Materials are saved; you can continue if the business selects you again.',
    };
    const nextAction = {
      id: milestone
        ? 'open_milestone'
        : selected
          ? 'create_milestone'
          : status === 'pending'
            ? 'open_dashboard'
            : 'propose',
      label: milestone
        ? status === 'changes_requested'
          ? 'View feedback'
          : 'Open milestone'
        : selected
          ? 'Create milestone'
          : status === 'pending'
            ? 'View my proposals'
            : 'Send proposal',
      hint: hints[status],
      taskId,
      milestoneId: milestone?.id ?? null,
    };
    return { status, statusLabel: labels[status], statusHint: hints[status], nextAction };
  }
  summary(task: Task, actor: Actor | null) {
    const fields = task.confirmedFields!;
    const score = calculateScore(fields);
    return {
      id: task.id,
      version: task.revision ?? task.version,
      title: fields.title,
      industry: fields.industry,
      summary: fields.need || fields.context,
      readinessScore: score.value,
      readinessLevel: score.level,
      readinessLabel: score.label,
      needsClarification: score.value < 40,
      offersCount: this.proposals(task.id).length,
      selectedTeams: this.selected(task.id).map((t) => ({
        id: t.id,
        name: t.name,
        avatarPreset: t.avatarPreset,
        color: t.color,
      })),
      approvedMilestones: this.milestones(task.id).filter((m) => m.status === 'approved').length,
      pendingMilestones: this.milestones(task.id).filter(
        (m) => m.status === 'in_review' && this.store.isSelected(task.id, m.teamId),
      ).length,
      publishedAt: task.publishedAt,
      actions: [
        action('open', 'Open card'),
        action('propose', 'Send proposal', actor?.role === 'team', 'Sign in as a team'),
      ],
    };
  }
  catalog(actor: Actor | null, query: CatalogQuery = commands.catalog.parse({})) {
    const published = this.store
      .all<Task>('tasks')
      .filter((t) => t.publicationStatus === 'published' && t.confirmedFields);
    let filtered = published.filter((t) => !query.industry || t.confirmedFields!.industry === query.industry);
    if (query.level)
      filtered = filtered.filter((t) => calculateScore(t.confirmedFields!).level === query.level);
    if (query.search)
      filtered = filtered.filter((t) =>
        [t.confirmedFields!.title, t.confirmedFields!.context, t.confirmedFields!.need]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.search.toLocaleLowerCase()),
      );
    const world = [...filtered].sort(
      (a, b) => a.publishedAt!.localeCompare(b.publishedAt!) || a.id.localeCompare(b.id),
    );
    filtered.sort(
      (a, b) =>
        calculateScore(b.confirmedFields!).value - calculateScore(a.confirmedFields!).value ||
        b.publishedAt!.localeCompare(a.publishedAt!) ||
        a.id.localeCompare(b.id),
    );
    const coords = [
      [-4, -2],
      [0, -3],
      [4, -2],
      [-2, 2],
      [2, 2],
    ];
    return {
      screen: 'catalog' as const,
      title: 'Task Square',
      filters: {
        ...query,
        industries: [...new Set(published.map((t) => t.confirmedFields!.industry))].sort(),
        levels: Object.entries(levelLabels).map(([value, label]) => ({ value, label })),
        sort: 'score_desc',
      },
      cards: filtered
        .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
        .map((t) => this.summary(t, actor)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / query.pageSize),
      },
      world: {
        page: query.worldPage,
        pageSize: 5,
        totalPages: Math.ceil(world.length / 5),
        order: 'publication_asc',
        stations: world.slice((query.worldPage - 1) * 5, query.worldPage * 5).map((t, index) => ({
          ...this.summary(t, actor),
          slot: index,
          position: { x: coords[index]![0], y: 0, z: coords[index]![1] },
        })),
      },
      emptyState: filtered.length
        ? null
        : {
            title: 'No tasks yet',
            message: published.length
              ? 'Try resetting the filters'
              : 'Published tasks will appear here',
            action: 'reset_filters',
          },
    };
  }
  detail(id: string, actor: Actor | null) {
    const task = this.tasks.public(id);
    const owner = task.businessUserId === actor?.id;
    const participation = this.participation(id, actor);
    return {
      screen: 'task-detail' as const,
      card: {
        ...this.summary(task, actor),
        fields: task.confirmedFields!,
        score: calculateScore(task.confirmedFields!),
      },
      myProposals: actor?.teamId
        ? this.proposals(id)
            .filter((p) => p.teamId === actor.teamId)
            .map((p) => this.proposalView(p))
        : [],
      participation,
      teamProgress: this.selected(id).map((team) => {
        const stages = this.milestones(id).filter((m) => m.teamId === team.id);
        const approvedStages = stages.filter((m) => m.status === 'approved').length;
        const pendingStages = stages.filter((m) => m.status === 'in_review').length;
        return {
          teamId: team.id,
          name: team.name,
          approvedStages,
          pendingStages,
          status: pendingStages
            ? ('in_review' as const)
            : approvedStages
              ? ('approved' as const)
              : ('working' as const),
          statusLabel: pendingStages ? 'Under review' : approvedStages ? 'Milestone approved' : 'In progress',
        };
      }),
      actions: [
        ...(participation && participation.nextAction.id !== 'propose'
          ? [action(participation.nextAction.id, participation.nextAction.label)]
          : []),
        action(
          'propose',
          participation && participation.status !== 'not_applied'
            ? 'Propose another approach'
            : 'Send proposal',
          actor?.role === 'team',
          'Sign in as a team',
        ),
        ...(owner ? [action('edit', 'Improve card'), action('review', 'Compare proposals')] : []),
      ],
    };
  }
  workspace(id: string, actor: Actor) {
    const task = this.tasks.own(actor, id);
    const officialScore = task.confirmedFields ? calculateScore(task.confirmedFields) : null;
    const forecast = calculateScore(task.draftFields);
    const hasUnconfirmedChanges = JSON.stringify(task.draftFields) !== JSON.stringify(task.confirmedFields);
    const titleValid =
      validCardHeading(task.draftFields.title) && validCardHeading(task.draftFields.industry);
    const needsInitialClarification = !task.clarifiedAt && !task.confirmedFields;
    const clarification = clarificationView(task);
    const continueQuestions = clarification?.nextQuestion && !clarification.reviewed;
    const analysis = task.analysis
      ? {
          ...task.analysis,
          status: task.analysis.resolved
            ? ('resolved' as const)
            : task.analysis.applicableVersion !== task.version
              ? ('stale' as const)
              : task.analysis.suggestions.length
                ? ('ready' as const)
                : ('empty' as const),
          canApply: !task.analysis.resolved && task.analysis.applicableVersion === task.version,
          notice:
            'Check the quotes and choose what to add. Fields you already filled in are kept. You can dismiss all suggestions.',
        }
      : null;
    const quality = checkQuality(task.draftFields);
    return {
      screen: 'task-workspace' as const,
      task: {
        id: task.id,
        version: task.version,
        publicationStatus: task.publicationStatus,
        rawDescription: task.rawDescription,
        updatedAt: task.updatedAt,
      },
      draft: { fields: task.draftFields, hasUnconfirmedChanges },
      confirmedFields: task.confirmedFields,
      officialScore,
      forecast: { ...forecast, isForecast: true, delta: forecast.value - (officialScore?.value ?? 0) },
      preview: {
        fields: task.draftFields,
        score: forecast,
        notice: 'Preview: changes become official after confirmation',
      },
      fieldGuide: (Object.keys(fieldLabels) as FieldKey[]).map((field) => ({
        field,
        label: fieldLabels[field],
        missing: forecast.missingFields.includes(field),
        ...fieldInput(field),
      })),
      clarification,
      analysis,
      quality,
      aiRuns: this.store.aiRuns(id),
      steps: [
        { id: 'describe', label: 'Description', complete: !!task.rawDescription },
        {
          id: 'clarify',
          label: 'Clarification',
          complete: !!clarification && (clarification.reviewed || clarification.progress.remaining === 0),
        },
        { id: 'confirm', label: 'Confirmation', complete: !!task.confirmedFields && !hasUnconfirmedChanges },
        { id: 'publish', label: 'Publication', complete: task.publicationStatus === 'published' },
      ],
      nextAction:
        !analysis && needsInitialClarification
          ? {
              id: 'analyze',
              label: 'Analyze description',
              hint: 'We will find details you already gave so you do not have to enter them again',
            }
          : analysis?.status === 'ready'
            ? {
                id: 'review_suggestions',
                label: 'Review suggestions',
                hint: 'Pick the quotes that fit or continue without them',
              }
            : needsInitialClarification
              ? {
                  id: 'clarify',
                  label: 'Clarify the task with AI',
                  hint: 'Answer the questions so teams can get started more easily',
                }
              : continueQuestions
                ? {
                    id: 'answer_question',
                    label: 'Continue clarifying',
                    hint: `Questions left: ${clarification!.progress.remaining}. Answers are saved; you can come back later.`,
                  }
                : !task.confirmedFields || hasUnconfirmedChanges || (clarification && !clarification.reviewed)
                  ? {
                      id: 'confirm',
                      label: 'Confirm details',
                      hint: forecast.nextImprovement?.message ?? 'Review the details before confirming',
                    }
                  : task.publicationStatus === 'draft'
                    ? {
                        id: 'publish',
                        label: 'Publish task',
                        hint: 'The card will become visible to all teams',
                      }
                    : {
                        id: 'review',
                        label: 'View proposals',
                        hint: 'Select one, several or no teams',
                      },
      actions: [
        action('save_draft', 'Save draft'),
        action('analyze', 'Analyze description'),
        action('clarify', 'Help me clarify'),
        action('confirm', 'Confirm details', titleValid, 'Enter a title and industry'),
        action(
          'publish',
          'Publish',
          !!task.confirmedFields && !hasUnconfirmedChanges && task.publicationStatus === 'draft',
          'Confirm the changes; a published card is already visible to everyone',
        ),
      ],
    };
  }
  review(id: string, actor: Actor) {
    const task = this.tasks.own(actor, id);
    return {
      screen: 'review-desk' as const,
      task: { id, title: (task.confirmedFields ?? task.draftFields).title, version: task.version },
      selectionPolicy:
        'You can select several teams or none. Other teams can still send proposals.',
      proposals: this.proposals(id).map((p) => ({
        ...this.proposalView(p),
        team: this.team(p.teamId),
        actions: [
          action('select', 'Select team', p.status !== 'selected', 'Team already selected'),
          action(
            'reject',
            p.status === 'selected' ? 'Cancel proposal selection' : 'Reject',
            p.status !== 'rejected' && mayRejectProposal(this.store, p),
            'The proposal is already rejected or the selected team has an approved milestone',
          ),
        ],
      })),
      milestones: this.milestones(id).map((m) => this.milestoneView(m, actor)),
      comparison: {
        columns: [
          { key: 'idea', label: 'Idea' },
          { key: 'plan', label: 'Plan' },
          { key: 'estimatedTime', label: 'Timeline' },
          { key: 'prototypeUrl', label: 'Prototype' },
        ],
      },
    };
  }
  milestoneView(item: Milestone, actor: Actor) {
    const task = this.tasks.require(item.taskId);
    const owner = task.businessUserId === actor.id;
    invariant(
      owner || actor.teamId === item.teamId,
      403,
      'FORBIDDEN',
      'The milestone is available only to its team and the task owner',
    );
    const selected = this.store.isSelected(item.taskId, item.teamId);
    const statusLabels = {
      draft: 'Preparing the result',
      in_review: 'Under review',
      changes_requested: 'Changes requested',
      approved: 'Milestone approved',
    };
    const statusHints = {
      draft: owner
        ? 'The team is preparing the result. Once submitted, you can review it and decide.'
        : 'Add a Git/PR link and describe the work done.',
      in_review: owner
        ? 'Check the result against the milestone criteria and make a decision.'
        : 'The business is reviewing the result. Points appear after approval.',
      changes_requested: owner
        ? 'The team received feedback. Wait for a resubmission.'
        : 'Address the business feedback and submit an updated result.',
      approved: 'Result accepted. The team earned 10 points.',
    };
    return {
      ...item,
      reviewHistory: item.reviewHistory ?? [],
      previousFeedback:
        item.reviewHistory
          ?.slice()
          .reverse()
          .find((decision) => decision.decision === 'return')?.feedback ??
        (item.status === 'changes_requested' ? item.feedback : null),
      reviewNotice:
        item.evidence &&
        item.status !== 'approved' &&
        (item.evidence.status !== 'verified' || item.review?.mode !== 'openai')
          ? {
              kind: 'manual' as const,
              message: owner
                ? 'Automatic review is incomplete. Materials are saved: check the link and criteria manually. AI or Git being unavailable does not by itself mean a poor result.'
                : 'Materials are saved. Automatic review is incomplete, so the business makes the final decision manually.',
            }
          : null,
      statusLabel: selected ? statusLabels[item.status] : 'Work paused',
      statusHint: !selected
        ? 'Team selection was cancelled. You can continue if the business selects you again.'
        : statusHints[item.status],
      teamName: this.team(item.teamId).name,
      confirmedPoints: this.store.points(item.teamId),
      actions: owner
        ? [
            action(
              'approve',
              'Approve result',
              selected && item.status === 'in_review',
              'Requires a submitted result from a selected team',
            ),
            action(
              'return',
              'Return for rework',
              selected && item.status === 'in_review',
              'The milestone is not awaiting review',
            ),
          ]
        : [
            action(
              'submit_evidence',
              'Submit for review',
              selected && (item.status === 'draft' || item.status === 'changes_requested'),
              'Requires business selection; the result is under review or already approved',
            ),
          ],
    };
  }
  milestone(id: string, actor: Actor) {
    const item = this.store.get<Milestone>('milestones', id);
    invariant(item, 404, 'MILESTONE_NOT_FOUND', 'Milestone not found');
    return { screen: 'milestone' as const, milestone: this.milestoneView(item, actor) };
  }
  dashboard(actor: Actor) {
    if (actor.role === 'business') {
      const tasks = this.store.all<Task>('tasks').filter((t) => t.businessUserId === actor.id);
      return {
        screen: 'business-dashboard' as const,
        actor,
        tasks: tasks.map((t) => {
          const stages = this.milestones(t.id);
          const pendingReviews = stages.filter(
            (m) => m.status === 'in_review' && this.store.isSelected(t.id, m.teamId),
          ).length;
          const pausedMilestones = stages.filter((m) => !this.store.isSelected(t.id, m.teamId)).length;
          const pendingProposals = this.proposals(t.id).filter((p) => p.status === 'pending').length;
          const hasUnconfirmedChanges = JSON.stringify(t.draftFields) !== JSON.stringify(t.confirmedFields);
          return {
            id: t.id,
            version: t.version,
            title: t.draftFields.title,
            publicationStatus: t.publicationStatus,
            readiness: calculateScore(t.confirmedFields ?? emptyFields()),
            hasUnconfirmedChanges,
            pendingProposals,
            pendingReviews,
            pausedMilestones,
            nextAction: pendingReviews
              ? {
                  id: 'review',
                  label: 'Review result',
                  hint: `Milestones under review: ${pendingReviews}`,
                  taskId: t.id,
                }
              : pendingProposals
                ? {
                    id: 'review',
                    label: 'Compare proposals',
                    hint: `New proposals: ${pendingProposals}`,
                    taskId: t.id,
                  }
                : {
                    id: 'edit',
                    label:
                      t.publicationStatus === 'draft' || hasUnconfirmedChanges
                        ? 'Continue card'
                        : 'Open card',
                    hint: 'Details and progress are saved',
                    taskId: t.id,
                  },
            actions: [action('edit', 'Open builder'), action('review', 'Compare proposals')],
          };
        }),
        actions: [action('start_task', 'Describe a new task')],
      };
    }
    const proposals = this.store.all<Proposal>('proposals').filter((p) => p.teamId === actor.teamId);
    const milestones = this.store.all<Milestone>('milestones').filter((m) => m.teamId === actor.teamId);
    return {
      screen: 'team-dashboard' as const,
      actor,
      team: this.team(actor.teamId!),
      proposals: proposals.map((p) => ({
        ...this.proposalView(p),
        taskTitle: this.tasks.require(p.taskId).confirmedFields?.title ?? '',
      })),
      milestones: milestones.map((m) => this.milestoneView(m, actor)),
      selectedTasks: [...new Set(proposals.filter((p) => p.status === 'selected').map((p) => p.taskId))].map(
        (id) => ({
          id,
          title: this.tasks.require(id).confirmedFields!.title,
          canCreateMilestone: !milestones.some((m) => m.taskId === id),
          nextAction: this.participation(id, actor)!.nextAction,
        }),
      ),
      actions: [action('browse', 'Find a task')],
    };
  }
  scoreboard() {
    return {
      screen: 'scoreboard' as const,
      teams: this.store
        .all<Team>('teams')
        .map((t) => ({ name: t.name, confirmedPoints: this.store.points(t.id) }))
        .sort((a, b) => b.confirmedPoints - a.confirmedPoints || a.name.localeCompare(b.name))
        .map((team, index) => ({ ...team, rank: index + 1 })),
    };
  }
  bootstrap(actor: Actor | null) {
    return {
      screen: 'bootstrap' as const,
      actor,
      contractVersion: '1.0',
      features: { teamProgress: true, teamCreation: true, gitEvidence: true, worldPageSize: 5 },
      navigation:
        actor?.role === 'business'
          ? ['dashboard', 'catalog', 'scoreboard']
          : ['catalog', 'dashboard', 'scoreboard'],
      realtime: { path: '/socket.io', event: 'invalidate', refetchOnConnect: true },
      login: { method: 'code', hint: 'Enter a code from the local demo accounts file or your team code' },
    };
  }
}
export type WorkspaceView = ReturnType<Views['workspace']>;
export type CatalogView = ReturnType<Views['catalog']>;
export type DetailView = ReturnType<Views['detail']>;
export type DashboardView = ReturnType<Views['dashboard']>;
export type ReviewView = ReturnType<Views['review']>;
export type MilestoneView = ReturnType<Views['milestone']>;
export type BootstrapView = ReturnType<Views['bootstrap']>;
