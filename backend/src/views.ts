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
import { calculateScore, levelLabels, meaningful } from './domain/score.js';
import { Store } from './db.js';
import { invariant } from './errors.js';
import { Tasks } from './services/tasks.js';
import { mayRejectProposal } from './services/work.js';

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
  summary(task: Task, actor: Actor | null) {
    const fields = task.confirmedFields!;
    const score = calculateScore(fields);
    return {
      id: task.id,
      version: task.version,
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
    return {
      screen: 'task-detail' as const,
      card: {
        ...this.summary(task, actor),
        fields: task.confirmedFields!,
        score: calculateScore(task.confirmedFields!),
      },
      myProposals: actor?.teamId ? this.proposals(id).filter((p) => p.teamId === actor.teamId) : [],
      teamProgress: this.selected(id).map((team) => ({
        teamId: team.id,
        name: team.name,
        approvedStages: this.milestones(id).filter((m) => m.teamId === team.id && m.status === 'approved')
          .length,
      })),
      actions: [
        action('propose', 'Отправить предложение', actor?.role === 'team', 'Войдите под командой'),
        ...(owner ? [action('edit', 'Улучшить карточку'), action('review', 'Сравнить отклики')] : []),
      ],
    };
  }
  workspace(id: string, actor: Actor) {
    const task = this.tasks.own(actor, id);
    const officialScore = task.confirmedFields ? calculateScore(task.confirmedFields) : null;
    const forecast = calculateScore(task.draftFields);
    const hasUnconfirmedChanges = JSON.stringify(task.draftFields) !== JSON.stringify(task.confirmedFields);
    const titleValid = meaningful(task.draftFields.title) && meaningful(task.draftFields.industry);
    const needsInitialClarification = !task.clarifiedAt && !task.confirmedFields;
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
        input: field === 'noConstraints' ? 'checkbox' : field === 'dataAvailability' ? 'select' : 'text',
      })),
      clarification: task.clarification,
      steps: [
        { id: 'describe', label: 'Описание', complete: !!task.rawDescription },
        { id: 'clarify', label: 'Уточнения', complete: !!task.clarifiedAt },
        { id: 'confirm', label: 'Подтверждение', complete: !!task.confirmedFields && !hasUnconfirmedChanges },
        { id: 'publish', label: 'Публикация', complete: task.publicationStatus === 'published' },
      ],
      nextAction: needsInitialClarification
        ? {
            id: 'clarify',
            label: 'Уточнить задачу с ИИ',
            hint: 'Ответьте на вопросы, чтобы командам было проще начать работу',
          }
        : !task.confirmedFields || hasUnconfirmedChanges
          ? {
              id: 'confirm',
              label: 'Подтвердить сведения',
              hint: forecast.nextImprovement?.message ?? 'Проверьте сведения перед подтверждением',
            }
          : task.publicationStatus === 'draft'
            ? { id: 'publish', label: 'Опубликовать задачу', hint: 'Карточка станет доступна всем командам' }
            : {
                id: 'review',
                label: 'Посмотреть отклики',
                hint: 'Выберите одну, несколько или ни одной команды',
              },
      actions: [
        action('save_draft', 'Сохранить черновик'),
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
        ...p,
        team: this.team(p.teamId),
        actions: [
          action('select', 'Выбрать команду', p.status !== 'selected', 'Команда уже выбрана'),
          action(
            'reject',
            'Отклонить',
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
    return {
      ...item,
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
        tasks: tasks.map((t) => ({
          id: t.id,
          version: t.version,
          title: t.draftFields.title,
          publicationStatus: t.publicationStatus,
          readiness: calculateScore(t.confirmedFields ?? emptyFields()),
          hasUnconfirmedChanges: JSON.stringify(t.draftFields) !== JSON.stringify(t.confirmedFields),
          pendingProposals: this.proposals(t.id).filter((p) => p.status === 'pending').length,
          pendingReviews: this.milestones(t.id).filter((m) => m.status === 'in_review').length,
          actions: [action('edit', 'Открыть конструктор'), action('review', 'Сравнить отклики')],
        })),
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
        ...p,
        taskTitle: this.tasks.require(p.taskId).confirmedFields?.title ?? '',
      })),
      milestones: milestones.map((m) => this.milestoneView(m, actor)),
      selectedTasks: [...new Set(proposals.filter((p) => p.status === 'selected').map((p) => p.taskId))].map(
        (id) => ({
          id,
          title: this.tasks.require(id).confirmedFields!.title,
          canCreateMilestone: !milestones.some((m) => m.taskId === id),
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
