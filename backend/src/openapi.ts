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
  description: `BFF screen. Exact TypeScript contract: ${type} in backend/client/index.ts.`,
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
          description: 'Shown only on creation. Save it for the next sign-in.',
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
        'Revision of all task activity. For the editor expectedVersion use workspace.task.version.',
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
      description: 'Milestones of selected teams under review. Pending marker for 2D/3D; no points awarded yet.',
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
      description: 'Completeness of the available material sample. Does not mean a full repository audit.',
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
        'Current search, industry, level (if selected), page, pageSize, worldPage; industries/levels options; sort=score_desc.',
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
        description: 'Editor version for expectedVersion. Proposals and milestones do not change it.',
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
  WorldView: screen('world', 'WorldView', {
    teams: array(object({ id: string, name: string, color: string, avatarPreset: string, confirmedPoints: integer })),
    achievements: array(
      object({
        id: string,
        teamId: string,
        teamName: string,
        teamColor: string,
        taskId: string,
        taskTitle: string,
        milestoneTitle: string,
        at: string,
      }),
    ),
    netHz: integer,
    worldHalf: { type: 'number' },
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
    description: 'Guest or member with a Bearer session; an invalid/expired token returns 401.',
  },
  public: { security: [] as Security, description: 'Public route, no session required.' },
  member: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Requires a valid business or team Bearer session.',
  },
  owner: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Business role and task owner only; otherwise 403.',
  },
  business: { security: [{ bearerAuth: [] }] as Security, description: 'Business role only; otherwise 403.' },
  team: { security: [{ bearerAuth: [] }] as Security, description: 'Team role only; otherwise 403.' },
  participant: {
    security: [{ bearerAuth: [] }] as Security,
    description: 'Task owner (business) or milestone team (team); other members get 403.',
  },
};
const idParameter: Parameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Task, proposal or milestone ID from an API response.',
  schema: string,
};
const retryParameter: Parameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Save a random key before the request and resend it with the same body if the response is lost. A new action needs a new key. A different body with the same key returns 409 IDEMPOTENCY_CONFLICT.',
  schema: { type: 'string', minLength: 8, maxLength: 120, pattern: '^[A-Za-z0-9_-]+$' },
};
const queryDescriptions: Record<string, string> = {
  search: 'Search by confirmed title, context and need.',
  industry: 'Exact industry value from filters.industries.',
  level: 'Official readiness level.',
  page: 'Card list page, starting at 1.',
  pageSize: 'Cards per list page, from 1 to 50.',
  worldPage: 'World page; separate pagination of 5 stations.',
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
        description: `Updated ${result} data in data; feedback.message for the UI message.`,
        content: { 'application/json': { schema: resultSchema } },
      },
      '400': errorResponse('Invalid JSON (INVALID_JSON).'),
      '401': errorResponse(
        'No session, wrong code or expired session. With recovery=sign_in, offer sign-in.',
      ),
      '403': errorResponse('Role, ownership, team selection or Origin not allowed.'),
      '404': errorResponse('Entity not found or not published.'),
      '409': errorResponse(
        'Version/state conflict. STALE_VERSION + recovery=refetch: reload the screen and keep local edits to reapply.',
      ),
      '413': errorResponse('Body larger than 64 KB.'),
      '422': errorResponse('Field errors in error.fieldErrors; dots separate nested fields.'),
      '429': errorResponse('Rate limit. recovery=retry_later.'),
      '500': errorResponse('Internal error. Report meta.requestId for diagnostics.'),
    },
  };
}

route('get', '/health', 'health', 'Check the server and database', 'Health', 'public');
route('get', '/bootstrap', 'bootstrap', 'Initial interface state', 'BootstrapView', 'guest');
route('post', '/session/start', 'startSession', 'Sign in with a code', 'Session', 'public', {
  body: 'session',
  description:
    'Codes for prepared profiles are in the local backend/demo-accounts.local.json after seeding. The response contains token and expiresAt; the client chooses how to store the token.',
});
route('post', '/session/end', 'endSession', 'End the current session', 'SignedOut', 'member', {
  description: 'Delete the current tab token after a successful response; bound sockets are disconnected.',
});
route('post', '/teams/start', 'createTeam', 'Create a team and issue a code', 'TeamCreated', 'public', {
  body: 'createTeam',
  created: true,
  description:
    'The code is returned only here. Save it. The team gets a session immediately. This route does not support Idempotency-Key: a retry may create another team.',
});
route('get', '/catalog', 'catalog', 'Catalog and five world stations', 'CatalogView', 'guest', {
  parameters: catalogParameters,
  description:
    'Only published confirmed snapshots. The list is sorted by official score; the world by publication time. The paginations are independent.',
});
route('get', '/dashboard', 'dashboard', 'Dashboard for the current role', 'DashboardView', 'member');
route('get', '/scoreboard', 'scoreboard', 'Confirmed team points', 'ScoreboardView', 'public', {
  description: 'Only name, confirmedPoints, rank; no contacts or milestone materials.',
});
route('get', '/world', 'world', 'Teams and achievements for the 3D world', 'WorldView', 'public', {
  description:
    'Public: team color and look for their bases, confirmed points and the latest business-approved results (Hall of Achievements). Player presence goes over Socket.IO: world.player.join/move/action/interact/leave → world.player.join/update/state/action/leave; world.triumph only after the first approval of a milestone.',
});
route('get', '/snapshot', 'snapshot', 'Snapshot of the main screens', 'SnapshotView', 'guest', {
  description:
    'Aggregates bootstrap, catalog with default filters, dashboard (null for a guest) and scoreboard. After a reconnect also refresh the open detail screen.',
});
route('post', '/tasks/start', 'startTask', 'Save the original description', 'WorkspaceView', 'business', {
  body: 'start',
  created: true,
  idempotent: true,
  description: 'Creates a private draft. rawDescription is immutable; corrections live in draft.fields.',
});
route('get', '/tasks/{id}', 'task', 'Published task card', 'DetailView', 'guest', {
  description:
    'A draft returns 404 even to its owner: use workspace for editing. myProposals contains only the current team proposals.',
});
route('get', '/tasks/{id}/workspace', 'workspace', 'Task builder', 'WorkspaceView', 'owner');
route('get', '/tasks/{id}/review', 'reviewDesk', 'Compare proposals and results', 'ReviewView', 'owner');
route(
  'post',
  '/tasks/{id}/analyze',
  'analyzeTask',
  'Break the description into quoted suggestions',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'AI suggests verbatim values for empty fields. User review and selection are required. The response contains analysis, quality and private aiRuns. Filled fields are not changed.',
  },
);
route(
  'post',
  '/tasks/{id}/suggestions/apply',
  'applySuggestions',
  'Add selected details to the draft',
  'WorkspaceView',
  'owner',
  {
    body: 'applySuggestions',
    description:
      'Pass analysisId and the selected suggestionIds from the current workspace. An empty list dismisses all suggestions. A selection resolves the analysis; a retry or applying after edits returns a conflict. Official details change only after confirm.',
  },
);
route('post', '/tasks/{id}/draft', 'saveDraft', 'Save partial edits', 'WorkspaceView', 'owner', {
  body: 'draft',
  description:
    'Partial fields are merged into the draft. The score and public title/industry do not change until confirm. Take expectedVersion from workspace.task.version.',
});
route(
  'post',
  '/tasks/{id}/answers',
  'applyAnswers',
  'Move answers into the draft',
  'WorkspaceView',
  'owner',
  {
    body: 'answers',
    description:
      'One or more answers are saved together with progress; nextQuestion points to the next question. value: noConstraints is boolean; dataAvailability is available/none/unknown; the rest are strings. The official snapshot does not change yet.',
  },
);
route(
  'post',
  '/tasks/{id}/clarify',
  'clarifyTask',
  'Get questions about gaps',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'Starts a new session of 3–5 questions with progress and nextQuestion. To resume, use GET workspace. clarification.mode/warning show OpenAI or the fallback stub. Take expectedVersion from workspace.task.version.',
  },
);
route('post', '/tasks/{id}/confirm', 'confirmTask', 'Confirm the details', 'WorkspaceView', 'owner', {
  body: 'version',
  description:
    'Replaces confirmedFields entirely and recalculates the official score, including downward. Ends the current clarification session (reviewed=true); incomplete answers are allowed. For a published task it updates the public card immediately.',
});
route(
  'post',
  '/tasks/{id}/publish',
  'publishTask',
  'Publish the confirmed card',
  'WorkspaceView',
  'owner',
  {
    body: 'version',
    description:
      'The latest changes must be confirmed. A low score does not block publishing. Republishing an already published task is safe.',
  },
);
route('post', '/tasks/{id}/proposals', 'propose', 'Send a team proposal', 'DetailView', 'team', {
  body: 'proposal',
  created: true,
  idempotent: true,
  description:
    'Published tasks only; a low score does not block proposals. The number of independent proposals is unlimited. prototypeUrl is HTTP(S) without username/password.',
});
route(
  'post',
  '/proposals/{id}/decision',
  'decideProposal',
  'Select or reject a proposal',
  'ReviewView',
  'owner',
  {
    body: 'decision',
    description:
      'expectedVersion refers to the proposal, not the task. Several teams can be selected. The last selection of a team with an approved milestone cannot be undone.',
  },
);
route(
  'post',
  '/tasks/{id}/milestones',
  'createMilestone',
  'Create a milestone for a selected team',
  'MilestoneView',
  'team',
  {
    body: 'milestone',
    created: true,
    idempotent: true,
    description:
      'Requires a selected proposal from this team. One milestone per task/team pair; points are always 10 and are not accepted from the client.',
  },
);
route('get', '/milestones/{id}', 'milestone', 'Open a milestone and its materials', 'MilestoneView', 'participant');
route(
  'post',
  '/milestones/{id}/evidence',
  'submitEvidence',
  'Submit a result for review',
  'MilestoneView',
  'team',
  {
    body: 'evidence',
    description:
      'Own selected team only. expectedVersion refers to the milestone. evidenceUrl is HTTP(S) without username/password. Git and AI provide preliminary details; no points are awarded yet. An approved milestone is immutable.',
  },
);
route(
  'post',
  '/milestones/{id}/decision',
  'decideMilestone',
  'Approve or return a result',
  'MilestoneView',
  'owner',
  {
    body: 'review',
    description:
      'expectedVersion refers to the milestone. decision=return requires non-empty feedback. Approval awards exactly 10 points once; a repeated approve is safe. Requires a selected team and in_review.',
  },
);

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AI Sana BFF',
    version: '1.0',
    description:
      'Screens and user commands. All successful responses: {data, feedback, meta}; errors: {error, meta}. Browser client: backend/client/index.ts. Contract and integration guide: docs/backend-integration.md.',
  },
  servers: [{ url: '/api/v1' }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Opaque token from session/start or teams/start; this is not a JWT.',
      },
    },
    schemas,
  },
};
