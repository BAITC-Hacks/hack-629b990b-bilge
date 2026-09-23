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
  title: 'Название',
  industry: 'Отрасль',
  context: 'Что происходит сейчас',
  need: 'Что нужно изменить',
  users: 'Будущие пользователи',
  dataAvailability: 'Доступность данных',
  dataSource: 'Источник или пример данных',
  expectedResult: 'Ожидаемый результат',
  successMetric: 'Показатель успеха',
  successTarget: 'Целевое значение',
  acceptanceCriteria: 'Условие приёмки',
  constraints: 'Ограничения',
  noConstraints: 'Известных ограничений нет',
  contact: 'Канал связи',
  interactionFormat: 'Формат консультаций',
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
          { value: 'available', label: 'Данные есть' },
          { value: 'none', label: 'Данных пока нет' },
          { value: 'unknown', label: 'Пока не знаю' },
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
      pending: 'Ожидает решения',
      selected: 'Предложение выбрано',
      rejected: 'Предложение отклонено',
    };
    const hints = {
      pending: 'Бизнес ещё не принял решение. Предложение сохранено.',
      selected: 'Предложение выбрано бизнесом. Текущее состояние работы указано отдельно.',
      rejected:
        'Предложение отклонено. Команда может предложить другой подход; решения по остальным предложениям сохраняются.',
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
      not_applied: 'Вы ещё не откликались',
      pending: 'Ожидает решения',
      rejected: 'Предложения отклонены',
      selected: 'Ваша команда выбрана',
      draft: 'Подготовка результата',
      in_review: 'Результат на проверке',
      changes_requested: 'Нужна доработка',
      approved: 'Этап подтверждён',
      paused: 'Работа приостановлена',
    };
    const hints = {
      not_applied: 'Опишите идею и план. Низкая готовность карточки не мешает отклику.',
      pending: 'Бизнес изучает предложение. Пока можно посмотреть другие задачи.',
      rejected: 'Посмотрите комментарий бизнеса. Можно отправить новый подход или найти другую задачу.',
      selected: 'Создайте этап и укажите, какой результат бизнес сможет проверить.',
      draft: 'Откройте этап, приложите результат и отправьте его бизнесу.',
      in_review: 'Результат сохранён и ожидает решения бизнеса. Очки появятся после подтверждения.',
      changes_requested: 'Откройте замечания бизнеса, доработайте результат и отправьте его снова.',
      approved: 'Результат принят, 10 очков начислены. Можно выбрать следующую задачу.',
      paused:
        'Выбор команды отменён. Материалы сохранены; продолжить можно после повторного выбора бизнесом.',
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
          ? 'Посмотреть замечания'
          : 'Открыть этап'
        : selected
          ? 'Создать этап'
          : status === 'pending'
            ? 'Посмотреть мои отклики'
            : 'Отправить предложение',
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
        action('open', 'Открыть карточку'),
        action('propose', 'Отправить предложение', actor?.role === 'team', 'Войдите под командой'),
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
      title: 'Площадь задач',
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
            title: 'Задач пока нет',
            message: published.length
              ? 'Попробуйте сбросить фильтры'
              : 'Опубликованные задачи появятся здесь',
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
          statusLabel: pendingStages ? 'На проверке' : approvedStages ? 'Этап подтверждён' : 'В работе',
        };
      }),
      actions: [
        ...(participation && participation.nextAction.id !== 'propose'
          ? [action(participation.nextAction.id, participation.nextAction.label)]
          : []),
        action(
          'propose',
          participation && participation.status !== 'not_applied'
            ? 'Предложить другой подход'
            : 'Отправить предложение',
          actor?.role === 'team',
          'Войдите под командой',
        ),
        ...(owner ? [action('edit', 'Улучшить карточку'), action('review', 'Сравнить отклики')] : []),
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
            'Проверьте цитаты и выберите, что добавить. Уже заполненные поля сохранятся. Можно отклонить все предложения.',
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
        notice: 'Предпросмотр: изменения станут официальными после подтверждения',
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
        { id: 'describe', label: 'Описание', complete: !!task.rawDescription },
        {
          id: 'clarify',
          label: 'Уточнения',
          complete: !!clarification && (clarification.reviewed || clarification.progress.remaining === 0),
        },
        { id: 'confirm', label: 'Подтверждение', complete: !!task.confirmedFields && !hasUnconfirmedChanges },
        { id: 'publish', label: 'Публикация', complete: task.publicationStatus === 'published' },
      ],
      nextAction:
        !analysis && needsInitialClarification
          ? {
              id: 'analyze',
              label: 'Разобрать описание',
              hint: 'Найдём уже указанные сведения, чтобы вам не вводить их повторно',
            }
          : analysis?.status === 'ready'
            ? {
                id: 'review_suggestions',
                label: 'Проверить предложения',
                hint: 'Выберите подходящие цитаты или продолжите без них',
              }
            : needsInitialClarification
              ? {
                  id: 'clarify',
                  label: 'Уточнить задачу с ИИ',
                  hint: 'Ответьте на вопросы, чтобы командам было проще начать работу',
                }
              : continueQuestions
                ? {
                    id: 'answer_question',
                    label: 'Продолжить уточнение',
                    hint: `Осталось вопросов: ${clarification!.progress.remaining}. Ответы сохранены, можно вернуться позже.`,
                  }
                : !task.confirmedFields || hasUnconfirmedChanges || (clarification && !clarification.reviewed)
                  ? {
                      id: 'confirm',
                      label: 'Подтвердить сведения',
                      hint: forecast.nextImprovement?.message ?? 'Проверьте сведения перед подтверждением',
                    }
                  : task.publicationStatus === 'draft'
                    ? {
                        id: 'publish',
                        label: 'Опубликовать задачу',
                        hint: 'Карточка станет доступна всем командам',
                      }
                    : {
                        id: 'review',
                        label: 'Посмотреть отклики',
                        hint: 'Выберите одну, несколько или ни одной команды',
                      },
      actions: [
        action('save_draft', 'Сохранить черновик'),
        action('analyze', 'Разобрать описание'),
        action('clarify', 'Помочь уточнить'),
        action('confirm', 'Подтвердить сведения', titleValid, 'Укажите название и отрасль'),
        action(
          'publish',
          'Опубликовать',
          !!task.confirmedFields && !hasUnconfirmedChanges && task.publicationStatus === 'draft',
          'Подтвердите изменения; опубликованная карточка уже видна всем',
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
        'Можно выбрать несколько команд или никого. Остальные команды сохраняют право на отклик.',
      proposals: this.proposals(id).map((p) => ({
        ...this.proposalView(p),
        team: this.team(p.teamId),
        actions: [
          action('select', 'Выбрать команду', p.status !== 'selected', 'Команда уже выбрана'),
          action(
            'reject',
            p.status === 'selected' ? 'Отменить выбор предложения' : 'Отклонить',
            p.status !== 'rejected' && mayRejectProposal(this.store, p),
            'Отклик уже отклонён или у выбранной команды подтверждён этап',
          ),
        ],
      })),
      milestones: this.milestones(id).map((m) => this.milestoneView(m, actor)),
      comparison: {
        columns: [
          { key: 'idea', label: 'Идея' },
          { key: 'plan', label: 'План' },
          { key: 'estimatedTime', label: 'Срок' },
          { key: 'prototypeUrl', label: 'Прототип' },
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
      'Этап доступен только команде и владельцу задачи',
    );
    const selected = this.store.isSelected(item.taskId, item.teamId);
    const statusLabels = {
      draft: 'Подготовка результата',
      in_review: 'На проверке',
      changes_requested: 'Нужна доработка',
      approved: 'Этап подтверждён',
    };
    const statusHints = {
      draft: owner
        ? 'Команда готовит результат. После отправки вы сможете проверить его и принять решение.'
        : 'Добавьте ссылку на Git/PR и опишите выполненную работу.',
      in_review: owner
        ? 'Проверьте результат по критериям этапа и примите решение.'
        : 'Бизнес проверяет результат. Очки появятся после подтверждения.',
      changes_requested: owner
        ? 'Команда получила замечания. Дождитесь повторной отправки.'
        : 'Учтите замечания бизнеса и отправьте обновлённый результат.',
      approved: 'Результат принят. Команде начислено 10 очков.',
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
                ? 'Автоматическая проверка неполная. Материалы сохранены: проверьте ссылку и критерии вручную. Недоступность AI или Git сама по себе не означает плохой результат.'
                : 'Материалы сохранены. Автоматическая проверка неполная, поэтому окончательное решение принимает бизнес вручную.',
            }
          : null,
      statusLabel: selected ? statusLabels[item.status] : 'Работа приостановлена',
      statusHint: !selected
        ? 'Выбор команды отменён. Продолжить можно после повторного выбора бизнесом.'
        : statusHints[item.status],
      teamName: this.team(item.teamId).name,
      confirmedPoints: this.store.points(item.teamId),
      actions: owner
        ? [
            action(
              'approve',
              'Подтвердить результат',
              selected && item.status === 'in_review',
              'Нужен отправленный результат выбранной команды',
            ),
            action(
              'return',
              'Вернуть на доработку',
              selected && item.status === 'in_review',
              'Этап не ожидает проверки',
            ),
          ]
        : [
            action(
              'submit_evidence',
              'Отправить на проверку',
              selected && (item.status === 'draft' || item.status === 'changes_requested'),
              'Нужен выбор бизнеса; результат на проверке или уже подтверждён',
            ),
          ],
    };
  }
  milestone(id: string, actor: Actor) {
    const item = this.store.get<Milestone>('milestones', id);
    invariant(item, 404, 'MILESTONE_NOT_FOUND', 'Этап не найден');
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
                  label: 'Проверить результат',
                  hint: `Этапов на проверке: ${pendingReviews}`,
                  taskId: t.id,
                }
              : pendingProposals
                ? {
                    id: 'review',
                    label: 'Сравнить отклики',
                    hint: `Новых предложений: ${pendingProposals}`,
                    taskId: t.id,
                  }
                : {
                    id: 'edit',
                    label:
                      t.publicationStatus === 'draft' || hasUnconfirmedChanges
                        ? 'Продолжить карточку'
                        : 'Открыть карточку',
                    hint: 'Сведения и прогресс сохранены',
                    taskId: t.id,
                  },
            actions: [action('edit', 'Открыть конструктор'), action('review', 'Сравнить отклики')],
          };
        }),
        actions: [action('start_task', 'Описать новую задачу')],
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
      actions: [action('browse', 'Найти задачу')],
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
      login: { method: 'code', hint: 'Введите код из локального файла демо-аккаунтов или код своей команды' },
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
