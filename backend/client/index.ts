// Browser entry point: every import is erased by TypeScript. No server code runs here.
import type { z } from 'zod';
import type { Actor, Team, commands, CatalogQuery, DomainEvent } from '../src/contracts.js';
import type {
  Views,
  BootstrapView,
  CatalogView,
  DashboardView,
  DetailView,
  MilestoneView,
  ReviewView,
  WorkspaceView,
} from '../src/views.js';
import type { WorldView } from '../src/world.js';

export type { Actor, Team, TaskFields, FieldKey, Score, Action } from '../src/contracts.js';
export type {
  BootstrapView,
  CatalogView,
  DashboardView,
  DetailView,
  MilestoneView,
  ReviewView,
  WorkspaceView,
} from '../src/views.js';
export type ScoreboardView = ReturnType<Views['scoreboard']>;
export type { WorldView, PlayerPresence, PlayerTick, TriumphInfo, MovementState, PresenceState } from '../src/world.js';
export type SnapshotView = {
  bootstrap: BootstrapView;
  catalog: CatalogView;
  dashboard: DashboardView | null;
  scoreboard: ScoreboardView;
};
export type SessionView = { token: string; expiresAt: string; actor: Actor };
export type TeamCreatedView = SessionView & { team: Team; code: string };
export type InvalidationEvent = Pick<DomainEvent, 'type' | 'taskId' | 'entityId' | 'version' | 'invalidate'>;
export type CatalogFilters = Partial<CatalogQuery>;

/** Input types preserve optional fields with server defaults. */
export type CommandInput<K extends keyof typeof commands> = z.input<(typeof commands)[K]>;
export type SessionInput = CommandInput<'session'>;
export type CreateTeamInput = CommandInput<'createTeam'>;
export type StartTaskInput = CommandInput<'start'>;
export type SaveDraftInput = CommandInput<'draft'>;
export type ApplyAnswersInput = CommandInput<'answers'>;
export type ApplySuggestionsInput = CommandInput<'applySuggestions'>;
export type VersionInput = CommandInput<'version'>;
export type ProposalInput = CommandInput<'proposal'>;
export type ProposalDecisionInput = CommandInput<'decision'>;
export type CreateMilestoneInput = CommandInput<'milestone'>;
export type EvidenceInput = CommandInput<'evidence'>;
export type MilestoneDecisionInput = CommandInput<'review'>;

export type ResponseMeta = { requestId: string; contractVersion: string };
export type ApiEnvelope<T> = {
  data: T;
  feedback: { kind: 'success'; message: string } | null;
  meta: ResponseMeta;
};
export type ApiErrorDetails = {
  code: string;
  message: string;
  fieldErrors: Record<string, string[]>;
  recovery: string | null;
};
export type ApiErrorEnvelope = { error: ApiErrorDetails; meta: ResponseMeta };
export type RequestOptions = { signal?: AbortSignal };
export type CreationOptions = RequestOptions & { idempotencyKey?: string };
export type SanaClientOptions = {
  /** Full API base, e.g. http://localhost:3001/api/v1. Defaults to same-origin /api/v1. */
  baseUrl?: string;
  /** Read the current tab's session each time. The client never stores tokens. */
  getToken?: () => string | null | undefined;
  /** Optional transport injection for tests or a custom fetch environment. */
  fetch?: typeof globalThis.fetch;
};

export class ApiError extends Error {
  readonly name = 'ApiError';
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;
  readonly recovery: string | null;
  constructor(
    readonly status: number,
    details: ApiErrorDetails,
    readonly requestId?: string,
    /** Reuse this key with exactly the same creation body after an uncertain response. */
    readonly idempotencyKey?: string,
    options?: ErrorOptions,
  ) {
    super(details.message, options);
    this.code = details.code;
    this.fieldErrors = details.fieldErrors;
    this.recovery = details.recovery;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function meta(value: unknown): value is ResponseMeta {
  return record(value) && typeof value.requestId === 'string' && typeof value.contractVersion === 'string';
}
function errorDetails(value: unknown): value is ApiErrorDetails {
  return (
    record(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.recovery === null || typeof value.recovery === 'string') &&
    record(value.fieldErrors) &&
    Object.values(value.fieldErrors).every(
      (errors) => Array.isArray(errors) && errors.every((error) => typeof error === 'string'),
    )
  );
}
function envelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    record(value) &&
    'data' in value &&
    meta(value.meta) &&
    (value.feedback === null ||
      (record(value.feedback) &&
        value.feedback.kind === 'success' &&
        typeof value.feedback.message === 'string'))
  );
}

export function createSanaClient(options: SanaClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/+$/, '');
  const pathId = (id: string) => encodeURIComponent(id);

  async function request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    requestOptions: CreationOptions = {},
  ): Promise<ApiEnvelope<T>> {
    const isAborted = (cause: unknown) =>
      requestOptions.signal?.aborted || (record(cause) && cause.name === 'AbortError');
    const headers = new Headers({ Accept: 'application/json' });
    const token = options.getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (requestOptions.idempotencyKey) headers.set('Idempotency-Key', requestOptions.idempotencyKey);
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestOptions.signal,
        credentials: 'omit',
      });
    } catch (cause) {
      const aborted = isAborted(cause);
      throw new ApiError(
        0,
        {
          code: aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
          message: aborted ? 'Request cancelled' : 'Could not reach the server',
          fieldErrors: {},
          recovery: aborted ? null : 'retry',
        },
        undefined,
        requestOptions.idempotencyKey,
        { cause },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      if (isAborted(cause)) {
        throw new ApiError(
          0,
          {
            code: 'REQUEST_ABORTED',
            message: 'Request cancelled',
            fieldErrors: {},
            recovery: null,
          },
          response.headers.get('X-Request-Id') ?? undefined,
          requestOptions.idempotencyKey,
          { cause },
        );
      }
      payload = null;
    }
    const requestId =
      record(payload) && meta(payload.meta)
        ? payload.meta.requestId
        : (response.headers.get('X-Request-Id') ?? undefined);
    if (!response.ok) {
      const details =
        record(payload) && errorDetails(payload.error)
          ? payload.error
          : {
              code: 'HTTP_ERROR',
              message: `The server returned error ${response.status}`,
              fieldErrors: {},
              recovery: response.status >= 500 ? 'retry' : null,
            };
      throw new ApiError(response.status, details, requestId, requestOptions.idempotencyKey);
    }
    if (!envelope(payload)) {
      throw new ApiError(
        response.status,
        {
          code: 'INVALID_RESPONSE',
          message: 'The server returned a response in an unknown format',
          fieldErrors: {},
          recovery: 'retry',
        },
        requestId,
        requestOptions.idempotencyKey,
      );
    }
    return payload as ApiEnvelope<T>;
  }

  const get = <T>(path: string, opts?: RequestOptions) => request<T>(path, 'GET', undefined, opts);
  const post = <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, 'POST', body, opts);
  const create = <T>(path: string, body: unknown, opts: CreationOptions = {}) =>
    request<T>(path, 'POST', body, {
      ...opts,
      idempotencyKey: opts.idempotencyKey ?? globalThis.crypto.randomUUID(),
    });

  return {
    health: (opts?: RequestOptions) => get<{ status: string; database: string }>('/health', opts),
    bootstrap: (opts?: RequestOptions) => get<BootstrapView>('/bootstrap', opts),
    startSession: (input: SessionInput, opts?: RequestOptions) =>
      post<SessionView>('/session/start', input, opts),
    endSession: (opts?: RequestOptions) => post<{ signedOut: boolean }>('/session/end', {}, opts),
    // This server command is not idempotent; do not retry team creation automatically.
    createTeam: (input: CreateTeamInput, opts?: RequestOptions) =>
      post<TeamCreatedView>('/teams/start', input, opts),
    catalog: (filters: CatalogFilters = {}, opts?: RequestOptions) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined) query.set(key, String(value));
      const suffix = query.toString();
      return get<CatalogView>(`/catalog${suffix ? `?${suffix}` : ''}`, opts);
    },
    dashboard: (opts?: RequestOptions) => get<DashboardView>('/dashboard', opts),
    scoreboard: (opts?: RequestOptions) => get<ScoreboardView>('/scoreboard', opts),
    world: (opts?: RequestOptions) => get<WorldView>('/world', opts),
    snapshot: (opts?: RequestOptions) => get<SnapshotView>('/snapshot', opts),
    startTask: (input: StartTaskInput, opts?: CreationOptions) =>
      create<WorkspaceView>('/tasks/start', input, opts),
    task: (id: string, opts?: RequestOptions) => get<DetailView>(`/tasks/${pathId(id)}`, opts),
    workspace: (id: string, opts?: RequestOptions) =>
      get<WorkspaceView>(`/tasks/${pathId(id)}/workspace`, opts),
    reviewDesk: (id: string, opts?: RequestOptions) => get<ReviewView>(`/tasks/${pathId(id)}/review`, opts),
    saveDraft: (id: string, input: SaveDraftInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/draft`, input, opts),
    applyAnswers: (id: string, input: ApplyAnswersInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/answers`, input, opts),
    clarifyTask: (id: string, input: VersionInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/clarify`, input, opts),
    analyzeTask: (id: string, input: VersionInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/analyze`, input, opts),
    applySuggestions: (id: string, input: ApplySuggestionsInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/suggestions/apply`, input, opts),
    confirmTask: (id: string, input: VersionInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/confirm`, input, opts),
    publishTask: (id: string, input: VersionInput, opts?: RequestOptions) =>
      post<WorkspaceView>(`/tasks/${pathId(id)}/publish`, input, opts),
    propose: (id: string, input: ProposalInput, opts?: CreationOptions) =>
      create<DetailView>(`/tasks/${pathId(id)}/proposals`, input, opts),
    decideProposal: (id: string, input: ProposalDecisionInput, opts?: RequestOptions) =>
      post<ReviewView>(`/proposals/${pathId(id)}/decision`, input, opts),
    createMilestone: (id: string, input: CreateMilestoneInput, opts?: CreationOptions) =>
      create<MilestoneView>(`/tasks/${pathId(id)}/milestones`, input, opts),
    milestone: (id: string, opts?: RequestOptions) => get<MilestoneView>(`/milestones/${pathId(id)}`, opts),
    submitEvidence: (id: string, input: EvidenceInput, opts?: RequestOptions) =>
      post<MilestoneView>(`/milestones/${pathId(id)}/evidence`, input, opts),
    decideMilestone: (id: string, input: MilestoneDecisionInput, opts?: RequestOptions) =>
      post<MilestoneView>(`/milestones/${pathId(id)}/decision`, input, opts),
  };
}

export type SanaClient = ReturnType<typeof createSanaClient>;
