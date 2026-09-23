import { z } from 'zod';
import { commands, fieldsSchema } from './contracts.js';

type Schema = Record<string, unknown>;
type Parameter = {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description: string;
  schema: Schema;
};
type Security = Record<string, string[]>[];
type Operation = {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security: Security;
  parameters?: Parameter[];
  requestBody?: { required: boolean; content: { 'application/json': { schema: Schema } } };
  responses: Record<
    string,
    { description: string; content: { 'application/json': { schema: Schema; example?: unknown } } }
  >;
};

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const string: Schema = { type: 'string' };
const integer: Schema = { type: 'integer' };
const boolean: Schema = { type: 'boolean' };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const array = (items: Schema): Schema => ({ type: 'array', items });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
});
const screen = (name: string, type: string, properties: Record<string, Schema>): Schema => ({
  ...object({ screen: { const: name, type: 'string' }, ...properties }),
  description: `Экран BFF. Точный TypeScript-контракт: ${type} в backend/client/index.ts.`,
  'x-typescript-type': type,
});
const freeObject: Schema = { type: 'object', additionalProperties: true };
const actions = array(ref('Action'));

const schemas: Record<string, Schema> = {
  // Input mode keeps defaulted properties optional, just like the actual HTTP validators.
  ...Object.fromEntries(
    Object.entries(commands)
      .filter(([name]) => name !== 'catalog')
      .map(([name, schema]) => [`${name}Input`, z.toJSONSchema(schema, { io: 'input' })]),
  ),
  TaskFields: z.toJSONSchema(fieldsSchema, { io: 'output' }),
  Meta: object({ requestId: string, contractVersion: { type: 'string', const: '1.0' } }),
  Feedback: nullable(object({ kind: { type: 'string', const: 'success' }, message: string })),
  Error: object({
    error: object({
      code: string,
      message: string,
      fieldErrors: { type: 'object', additionalProperties: array(string) },
      recovery: nullable(string),
    }),
    meta: ref('Meta'),
  }),
  Action: object({ id: string, label: string, enabled: boolean, reason: nullable(string) }),
  Actor: object({
    id: string,
    role: { type: 'string', enum: ['business', 'team'] },
    displayName: string,
    teamId: nullable(string),
  }),
  Team: object({
    id: string,
    name: string,
    interests: array(string),
    skills: array(string),
    technologies: array(string),
    avatarPreset: string,
    color: string,
    confirmedPoints: integer,
  }),
  Session: object({ token: string, expiresAt: { type: 'string', format: 'date-time' }, actor: ref('Actor') }),
  TeamCreated: {
    allOf: [
      ref('Session'),
      object({
        team: ref('Team'),
        code: {
          type: 'string',
          description: 'Показывается только при создании. Сохраните для следующего входа.',
        },
      }),
    ],
  },
  Health: object({
    status: { const: 'ok', type: 'string' },
    database: { type: 'string', enum: ['ready', 'unavailable'] },
  }),
  SignedOut: object({ signedOut: { type: 'boolean', const: true } }),
  Score: object({
    value: { type: 'integer', minimum: 0, maximum: 100 },
    level: { type: 'string', enum: ['draft', 'working', 'ready', 'priority'] },
    label: string,
    breakdown: array(
      object({
        key: string,
        label: string,
        earned: integer,
        max: integer,
        missingFields: array(string),
        hint: string,
      }),
    ),
    missingFields: array(string),
    nextImprovement: nullable(object({ field: string, message: string, possiblePoints: integer })),
  }),
  Card: object({
    id: string,
    version: {
      ...integer,
      description:
        'Ревизия всей активности задачи. Для expectedVersion редактора используйте workspace.task.version.',
    },
    title: string,
    industry: string,
    summary: string,
    readinessScore: integer,
    readinessLevel: string,
    readinessLabel: string,
    needsClarification: boolean,
    offersCount: integer,
    selectedTeams: array(object({ id: string, name: string, avatarPreset: string, color: string })),
    approvedMilestones: integer,
    pendingMilestones: {
      ...integer,
      description: 'Этапы выбранных команд на проверке. Маркер ожидания для 2D/3D; очки ещё не начислены.',
    },
    publishedAt: nullable(string),
    actions,
  }),
  Proposal: object({
    id: string,
    taskId: string,
    teamId: string,
    idea: string,
    plan: string,
    estimatedTime: string,
    prototypeUrl: string,
    status: { type: 'string', enum: ['pending', 'selected', 'rejected'] },
    statusLabel: string,
    statusHint: string,
    decisionNote: string,
    version: integer,
    createdAt: string,
  }),
  Evidence: object(
    {
      provider: { type: 'string', enum: ['github', 'manual', 'mock'] },
      status: { type: 'string', enum: ['verified', 'unavailable', 'manual', 'mock'] },
      url: string,
      title: string,
      summary: string,
      facts: array(string),
      warning: nullable(string),
      snapshot: nullable(ref('GitSnapshot')),
    },
    ['provider', 'status', 'url', 'title', 'summary', 'facts', 'warning'],
  ),
  GitSnapshot: object({
    commitSha: string,
    inspectedAt: string,
    coverage: {
      type: 'string',
      enum: ['complete', 'partial', 'metadata_only'],
      description: 'Полнота доступной выборки материалов. Не означает аудит всего репозитория.',
    },
    files: array(
      object({
        id: string,
        path: string,
        kind: { type: 'string', enum: ['readme', 'patch'] },
        sourceUrl: string,
        content: string,
        truncated: boolean,
      }),
    ),
    warnings: array(string),
  }),
  AiRun: object({
    id: string,
    operation: { type: 'string', enum: ['analyze', 'clarify', 'review_evidence'] },
    model: nullable(string),
    promptVersion: string,
    startedAt: string,
    durationMs: integer,
    mode: { type: 'string', enum: ['openai', 'stub'] },
    outcome: { type: 'string', enum: ['completed', 'fallback'] },
    fallbackReason: nullable({
      type: 'string',
      enum: ['disabled', 'missing_key', 'timeout', 'rate_limit', 'provider_error', 'invalid_output'],
    }),
    inputTokens: nullable(integer),
    outputTokens: nullable(integer),
    validation: { type: 'string', enum: ['passed', 'failed', 'not_run'] },
  }),
  Analysis: object(
    {
      id: string,
      sourceVersion: integer,
      applicableVersion: integer,
      resolved: boolean,
      status: { type: 'string', enum: ['ready', 'empty', 'resolved', 'stale'] },
      canApply: boolean,
      notice: string,
      mode: { type: 'string', enum: ['openai', 'stub'] },
      warning: nullable(string),
      suggestions: array(
        object({
          id: string,
          field: string,
          value: string,
          source: object({ id: { const: 'rawDescription', type: 'string' }, quote: string }),
        }),
      ),
      run: ref('AiRun'),
    },
    [
      'id',
      'sourceVersion',
      'applicableVersion',
      'resolved',
      'status',
      'canApply',
      'notice',
      'mode',
      'warning',
      'suggestions',
    ],
  ),
  CriterionEvidence: object({
    criterion: string,
    status: { type: 'string', enum: ['materials_found', 'insufficient_evidence', 'not_assessed'] },
    citations: array(object({ materialId: string, path: string, sourceUrl: string, quote: string })),
    nextStep: string,
  }),
  EvidenceReview: object(
    {
      mode: { type: 'string', enum: ['openai', 'stub'] },
      summary: string,
      checks: array(string),
      warning: nullable(string),
      criterionEvidence: array(ref('CriterionEvidence')),
      run: ref('AiRun'),
    },
    ['mode', 'summary', 'checks', 'warning'],
  ),
  MilestoneItem: object({
    id: string,
    taskId: string,
    teamId: string,
    title: string,
    acceptanceCriteria: string,
    points: { type: 'integer', const: 10 },
    status: { type: 'string', enum: ['draft', 'in_review', 'changes_requested', 'approved'] },
    statusLabel: string,
    statusHint: string,
    evidenceUrl: string,
    description: string,
    evidence: nullable(ref('Evidence')),
    review: nullable(ref('EvidenceReview')),
    feedback: string,
    reviewHistory: array(
      object({
        decision: { type: 'string', enum: ['approve', 'return'] },
        feedback: string,
        decidedAt: nullable(string),
        version: integer,
      }),
    ),
    previousFeedback: nullable(string),
    reviewNotice: nullable(object({ kind: { type: 'string', const: 'manual' }, message: string })),
    version: integer,
    approvedBy: nullable(string),
    approvedAt: nullable(string),
    createdAt: string,
    teamName: string,
    confirmedPoints: integer,
    actions,
  }),
  BootstrapView: screen('bootstrap', 'BootstrapView', {
    actor: nullable(ref('Actor')),
    contractVersion: string,
    features: object({
      teamProgress: boolean,
      teamCreation: boolean,
      gitEvidence: boolean,
      worldPageSize: { type: 'integer', const: 5 },
    }),
    navigation: array(string),
    realtime: object({ path: string, event: string, refetchOnConnect: boolean }),
    login: object({ method: string, hint: string }),
  }),
  CatalogView: screen('catalog', 'CatalogView', {
    title: string,
    filters: {
      ...freeObject,
      description:
        'Текущие search, industry, level (если выбран), page, pageSize, worldPage; варианты industries/levels; sort=score_desc.',
    },
    cards: array(ref('Card')),
    pagination: object({ page: integer, pageSize: integer, total: integer, totalPages: integer }),
    world: object({
      page: integer,
      pageSize: { type: 'integer', const: 5 },
      totalPages: integer,
      order: { type: 'string', const: 'publication_asc' },
      stations: array({
        allOf: [
          ref('Card'),
          object({
            slot: integer,
            position: object({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }),
          }),
        ],
      }),
    }),
    emptyState: nullable(object({ title: string, message: string, action: string })),
  }),
  DetailView: screen('task-detail', 'DetailView', {
    card: { allOf: [ref('Card'), object({ fields: ref('TaskFields'), score: ref('Score') })] },
    myProposals: array(ref('Proposal')),
    participation: nullable(ref('Participation')),
    teamProgress: array(
      object({
        teamId: string,
        name: string,
        approvedStages: integer,
        pendingStages: integer,
        status: { type: 'string', enum: ['working', 'in_review', 'approved'] },
        statusLabel: string,
      }),
    ),
    actions,
  }),
  ParticipationAction: object({
    id: { type: 'string', enum: ['propose', 'open_dashboard', 'create_milestone', 'open_milestone'] },
    label: string,
    hint: string,
    taskId: string,
    milestoneId: nullable(string),
  }),
  Participation: object({
    status: {
      type: 'string',
      enum: [
        'not_applied',
        'pending',
        'rejected',
        'selected',
        'draft',
        'in_review',
        'changes_requested',
        'approved',
        'paused',
      ],
    },
    statusLabel: string,
    statusHint: string,
    nextAction: ref('ParticipationAction'),
  }),
  WorkspaceView: screen('task-workspace', 'WorkspaceView', {
    task: object({
      id: string,
      version: {
        ...integer,
        description: 'Версия редактора для expectedVersion. Отклики и этапы её не меняют.',
      },
      publicationStatus: { type: 'string', enum: ['draft', 'published'] },
      rawDescription: string,
      updatedAt: string,
    }),
    draft: object({ fields: ref('TaskFields'), hasUnconfirmedChanges: boolean }),
    confirmedFields: nullable(ref('TaskFields')),
    officialScore: nullable(ref('Score')),
    forecast: {
      allOf: [ref('Score'), object({ isForecast: { const: true, type: 'boolean' }, delta: integer })],
    },
    preview: object({ fields: ref('TaskFields'), score: ref('Score'), notice: string }),
    fieldGuide: array(
      object({
        field: string,
        label: string,
        missing: boolean,
        input: { type: 'string', enum: ['checkbox', 'select', 'text'] },
        options: nullable(array(object({ value: string, label: string }))),
      }),
    ),
    clarification: nullable(ref('Clarification')),
    analysis: nullable(ref('Analysis')),
    quality: object({
      warnings: array(
        object({
          id: string,
          field: string,
          relatedFields: array(string),
          message: string,
          actionLabel: string,
        }),
      ),
      notice: string,
      nextAction: nullable(
        object({ id: { type: 'string', const: 'edit_field' }, field: string, label: string, hint: string }),
      ),
    }),
    aiRuns: array({
      allOf: [
        ref('AiRun'),
        object({
          taskId: string,
          entityId: string,
          sourceVersion: integer,
          disposition: { type: 'string', enum: ['applied', 'stale'] },
        }),
      ],
    }),
    steps: array(object({ id: string, label: string, complete: boolean })),
    nextAction: object({ id: string, label: string, hint: string }),
    actions,
  }),
  ClarificationQuestion: object({
    field: string,
    text: string,
    index: integer,
    value: { anyOf: [string, boolean] },
    answered: boolean,
    skipped: boolean,
    input: { type: 'string', enum: ['checkbox', 'select', 'text'] },
    options: nullable(array(object({ value: string, label: string }))),
  }),
  Clarification: object({
    reviewed: boolean,
    missingFields: array(string),
    questions: array(ref('ClarificationQuestion')),
    nextQuestion: nullable(ref('ClarificationQuestion')),
    progress: object({ total: integer, answered: integer, skipped: integer, remaining: integer }),
    mode: { type: 'string', enum: ['openai', 'stub'] },
    warning: nullable(string),
  }),
  ReviewView: screen('review-desk', 'ReviewView', {
    task: object({ id: string, title: string, version: integer }),
    selectionPolicy: string,
    proposals: array({ allOf: [ref('Proposal'), object({ team: ref('Team'), actions })] }),
    milestones: array(ref('MilestoneItem')),
    comparison: object({ columns: array(object({ key: string, label: string })) }),
  }),
  MilestoneView: screen('milestone', 'MilestoneView', { milestone: ref('MilestoneItem') }),
  BusinessDashboardView: screen('business-dashboard', 'DashboardView', {
    actor: ref('Actor'),
    tasks: array(
      object({
        id: string,
        version: integer,
        title: string,
        publicationStatus: string,
        readiness: ref('Score'),
        hasUnconfirmedChanges: boolean,
        pendingProposals: integer,
        pendingReviews: integer,
        pausedMilestones: integer,
        nextAction: object({ id: string, label: string, hint: string, taskId: string }),
        actions,
      }),
    ),
    actions,
  }),
  TeamDashboardView: screen('team-dashboard', 'DashboardView', {
    actor: ref('Actor'),
    team: ref('Team'),
    proposals: array({ allOf: [ref('Proposal'), object({ taskTitle: string })] }),
    milestones: array(ref('MilestoneItem')),
    selectedTasks: array(
      object({
        id: string,
        title: string,
        canCreateMilestone: boolean,
        nextAction: ref('ParticipationAction'),
      }),
    ),
    actions,
  }),
  DashboardView: {
    oneOf: [ref('BusinessDashboardView'), ref('TeamDashboardView')],
    discriminator: {
      propertyName: 'screen',
      mapping: {
        'business-dashboard': '#/components/schemas/BusinessDashboardView',
        'team-dashboard': '#/components/schemas/TeamDashboardView',
      },
    },
  },
  ScoreboardView: screen('scoreboard', 'ScoreboardView', {
    teams: array(object({ name: string, confirmedPoints: integer, rank: integer })),
  }),
  SnapshotView: object({
    bootstrap: ref('BootstrapView'),
    catalog: ref('CatalogView'),
    dashboard: nullable(ref('DashboardView')),
    scoreboard: ref('ScoreboardView'),
  }),
};

const auth = {
  guest: {
    security: [{}, { bearerAuth: [] }] as Security,
    description: 'Гость или участник с Bearer-сессией; при неверном/истёкшем токене — 401.',
  },
  public: { security: [] as Security, description: 'Публичный маршрут, сессия не требуется.' },
  member: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Нужна действующая Bearer-сессия business или team.',
  },
  owner: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Только роль business и владелец задачи; иначе 403.',
  },
  business: { security: [{ bearerAuth: [] }] as Security, description: 'Только роль business; иначе 403.' },
  team: { security: [{ bearerAuth: [] }] as Security, description: 'Только роль team; иначе 403.' },
  participant: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Владелец задачи (business) или команда этапа (team); остальные участники получают 403.',
  },
};
const idParameter: Parameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'ID задачи, отклика или этапа из ответа API.',
  schema: string,
};
const retryParameter: Parameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Сохраните случайный ключ до запроса и повторите его с тем же телом при потере ответа. Новое действие — новый ключ. Другое тело с прежним ключом даёт 409 IDEMPOTENCY_CONFLICT.',
  schema: { type: 'string', minLength: 8, maxLength: 120, pattern: '^[A-Za-z0-9_-]+$' },
};
const queryDescriptions: Record<string, string> = {
  search: 'Поиск по подтверждённым названию, контексту и потребности.',
  industry: 'Точное значение отрасли из filters.industries.',
  level: 'Уровень официальной готовности.',
  page: 'Страница списка карточек, начиная с 1.',
  pageSize: 'Карточек в списке, от 1 до 50.',
  worldPage: 'Страница мира; отдельная пагинация по 5 станций.',
};
const catalogParameters: Parameter[] = Object.entries(commands.catalog.shape).map(([name, schema]) => ({
  name,
  in: 'query',
  required: false,
  description: queryDescriptions[name]!,
  // Query strings are coerced by the validator. Document the accepted numeric domain, not unknown input.
  schema: z.toJSONSchema(schema, { io: 'output' }),
}));

const paths: Record<string, Partial<Record<'get' | 'post', Operation>>> = {};
function route(
  method: 'get' | 'post',
  path: string,
  operationId: string,
  summary: string,
  result: string,
  permission: keyof typeof auth,
  options: {
    body?: Exclude<keyof typeof commands, 'catalog'>;
    description?: string;
    created?: boolean;
    idempotent?: boolean;
    parameters?: Parameter[];
  } = {},
) {
  const parameters = [
    ...(path.includes('{id}') ? [idParameter] : []),
    ...(options.idempotent ? [retryParameter] : []),
    ...(options.parameters ?? []),
  ];
  const resultSchema = object({ data: ref(result), feedback: ref('Feedback'), meta: ref('Meta') });
  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ref('Error') } },
  });
  (paths[path] ??= {})[method] = {
    operationId,
    summary,
    description: [auth[permission].description, options.description].filter(Boolean).join(' '),
    tags: [path.split('/')[1]!],
    security: auth[permission].security,
    ...(parameters.length ? { parameters } : {}),
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(`${options.body}Input`) } },
          },
        }
      : {}),
    responses: {
      [options.created ? '201' : '200']: {
        description: `Обновлённые данные ${result} в data; feedback.message для сообщения интерфейса.`,
        content: { 'application/json': { schema: resultSchema } },
      },
      '400': errorResponse('Невалидный JSON (INVALID_JSON).'),
      '401': errorResponse(
        'Нет сессии, код неверен или сессия истекла. При recovery=sign_in предложите вход.',
      ),
      '403': errorResponse('Не разрешены роль, владелец, выбор команды или Origin.'),
      '404': errorResponse('Сущность не найдена или не опубликована.'),
      '409': errorResponse(
        'Конфликт версии/состояния. STALE_VERSION + recovery=refetch: загрузите экран, сохраните локальные правки для повторного применения.',
      ),
      '413': errorResponse('Тело больше 64 KB.'),
      '422': errorResponse('Ошибки полей в error.fieldErrors; точки разделяют вложенные поля.'),
      '429': errorResponse('Лимит запросов. recovery=retry_later.'),
      '500': errorResponse('Внутренняя ошибка. Сообщите meta.requestId для диагностики.'),
    },
  };
}

route('get', '/health', 'health', 'Проверить сервер и базу', 'Health', 'public');
route('get', '/bootstrap', 'bootstrap', 'Начальное состояние интерфейса', 'BootstrapView', 'guest');
route('post', '/session/start', 'startSession', 'Войти по коду', 'Session', 'public', {
  body: 'session',
  description:
    'Коды подготовленных профилей находятся в локальном backend/demo-accounts.local.json после seed. Ответ содержит token и expiresAt; хранение токена выбирает клиент.',
});
route('post', '/session/end', 'endSession', 'Завершить текущую сессию', 'SignedOut', 'member', {
  description: 'Удалите токен текущей вкладки после успешного ответа; привязанные сокеты отключаются.',
});
route('post', '/teams/start', 'createTeam', 'Создать команду и выдать код', 'TeamCreated', 'public', {
  body: 'createTeam',
  created: true,
  description:
    'Код возвращается только здесь. Сохраните его. Команда сразу получает сессию. Этот маршрут не поддерживает Idempotency-Key: повтор может создать ещё одну команду.',
});
route('get', '/catalog', 'catalog', 'Каталог и пять станций мира', 'CatalogView', 'guest', {
  parameters: catalogParameters,
  description:
    'Только опубликованные подтверждённые снимки. Список сортируется по официальному баллу; мир — по времени публикации. Пагинации независимы.',
});
route('get', '/dashboard', 'dashboard', 'Личный кабинет текущей роли', 'DashboardView', 'member');
route('get', '/scoreboard', 'scoreboard', 'Подтверждённые очки команд', 'ScoreboardView', 'public', {
  description: 'Только name, confirmedPoints, rank; без контактов и материалов этапа.',
});
route('get', '/snapshot', 'snapshot', 'Снимок основных экранов', 'SnapshotView', 'guest', {
  description:
    'Агрегирует bootstrap, catalog с фильтрами по умолчанию, dashboard (null для гостя) и scoreboard. После reconnect обновите также открытый детальный экран.',
});
route('post', '/tasks/start', 'startTask', 'Сохранить исходное описание', 'WorkspaceView', 'business', {
  body: 'start',
  created: true,
  idempotent: true,
  description: 'Создаёт личный черновик. rawDescription неизменяемо; исправления живут в draft.fields.',
});
route('get', '/tasks/{id}', 'task', 'Карточка опубликованной задачи', 'DetailView', 'guest', {
  description:
    'Черновик возвращает 404 даже владельцу: для редактирования используйте workspace. myProposals содержит только отклики текущей команды.',
});
route('get', '/tasks/{id}/workspace', 'workspace', 'Конструктор задачи', 'WorkspaceView', 'owner');
route('get', '/tasks/{id}/review', 'reviewDesk', 'Сравнение откликов и результатов', 'ReviewView', 'owner');
route(
  'post',
  '/tasks/{id}/analyze',
  'analyzeTask',
  'Разобрать описание на предложения с цитатами',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'AI предлагает дословные значения для пустых полей. Проверка и выбор пользователя обязательны. Ответ содержит analysis, quality и приватную aiRuns. Заполненные поля не меняются.',
  },
);
route(
  'post',
  '/tasks/{id}/suggestions/apply',
  'applySuggestions',
  'Добавить выбранные сведения в черновик',
  'WorkspaceView',
  'owner',
  {
    body: 'applySuggestions',
    description:
      'Передайте analysisId и выбранные suggestionIds из актуального workspace. Пустой список отклоняет все предложения. Выбор завершает анализ; повтор или применение после правок возвращает конфликт. Официальные сведения меняются только после confirm.',
  },
);
route('post', '/tasks/{id}/draft', 'saveDraft', 'Сохранить частичные правки', 'WorkspaceView', 'owner', {
  body: 'draft',
  description:
    'Частичный fields объединяется с черновиком. Балл и публичные title/industry не меняются до confirm. expectedVersion берите из workspace.task.version.',
});
route(
  'post',
  '/tasks/{id}/answers',
  'applyAnswers',
  'Перенести ответы в черновик',
  'WorkspaceView',
  'owner',
  {
    body: 'answers',
    description:
      'Один или несколько ответов сохраняются вместе с прогрессом; nextQuestion указывает следующий вопрос. value: noConstraints — boolean; dataAvailability — available/none/unknown; остальные — строки. Официальный снимок ещё не меняется.',
  },
);
route(
  'post',
  '/tasks/{id}/clarify',
  'clarifyTask',
  'Получить вопросы по пробелам',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'Начинает новый сеанс из 3–5 вопросов с progress и nextQuestion. Для возобновления используйте GET workspace. clarification.mode/warning показывают OpenAI или резервный stub. expectedVersion берите из workspace.task.version.',
  },
);
route('post', '/tasks/{id}/confirm', 'confirmTask', 'Подтвердить сведения', 'WorkspaceView', 'owner', {
  body: 'version',
  description:
    'Заменяет confirmedFields целиком и пересчитывает официальный балл, в том числе вниз. Завершает текущий сеанс уточнений (reviewed=true), неполные ответы допустимы. Для опубликованной задачи сразу обновляет публичную карточку.',
});
route(
  'post',
  '/tasks/{id}/publish',
  'publishTask',
  'Опубликовать подтверждённую карточку',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'Нужны подтверждённые последние изменения. Низкий балл не блокирует публикацию. Повторная публикация уже опубликованной задачи безопасна.',
  },
);
route('post', '/tasks/{id}/proposals', 'propose', 'Отправить отклик команды', 'DetailView', 'team', {
  body: 'proposal',
  created: true,
  idempotent: true,
  description:
    'Только опубликованная задача; низкий балл не блокирует отклик. Количество независимых откликов не ограничено. prototypeUrl — HTTP(S) без логина/пароля.',
});
route(
  'post',
  '/proposals/{id}/decision',
  'decideProposal',
  'Выбрать или отклонить отклик',
  'ReviewView',
  'owner',
  {
    body: 'decision',
    description:
      'expectedVersion относится к отклику, не задаче. Можно выбрать несколько команд. Нельзя отменить последний выбор команды с подтверждённым этапом.',
  },
);
route(
  'post',
  '/tasks/{id}/milestones',
  'createMilestone',
  'Создать этап выбранной команды',
  'MilestoneView',
  'team',
  {
    body: 'milestone',
    created: true,
    idempotent: true,
    description:
      'Нужен выбранный отклик этой команды. Один этап на пару задача/команда; points всегда 10 и не принимается от клиента.',
  },
);
route('get', '/milestones/{id}', 'milestone', 'Открыть этап и материалы', 'MilestoneView', 'participant');
route(
  'post',
  '/milestones/{id}/evidence',
  'submitEvidence',
  'Отправить результат на проверку',
  'MilestoneView',
  'team',
  {
    body: 'evidence',
    description:
      'Только своя выбранная команда. expectedVersion относится к этапу. evidenceUrl — HTTP(S) без логина/пароля. Git и AI дают предварительные сведения, очки пока не начисляются. Подтверждённый этап неизменяем.',
  },
);
route(
  'post',
  '/milestones/{id}/decision',
  'decideMilestone',
  'Подтвердить или вернуть результат',
  'MilestoneView',
  'owner',
  {
    body: 'review',
    description:
      'expectedVersion относится к этапу. decision=return требует непустой feedback. Подтверждение начисляет ровно 10 очков один раз; повтор approve безопасен. Требуется выбранная команда и in_review.',
  },
);

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AI Sana BFF',
    version: '1.0',
    description:
      'Экраны и пользовательские команды. Все успешные ответы: {data, feedback, meta}; ошибки: {error, meta}. Браузерный клиент: backend/client/index.ts. Контракт и сценарий подключения: docs/backend-integration.md.',
  },
  servers: [{ url: '/api/v1' }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Непрозрачный token из session/start или teams/start; это не JWT.',
      },
    },
    schemas,
  },
};
