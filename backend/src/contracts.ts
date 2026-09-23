import { z } from 'zod';

export const text = z.string().trim().max(4000);
export const nonempty = text.min(1, 'This field is required');
export const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .url('Enter a full URL')
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'An HTTP(S) URL without a username or password is required');

export const fieldsSchema = z
  .object({
    title: z.string().trim().max(160),
    industry: z.string().trim().max(80),
    context: text,
    need: text,
    users: text,
    dataAvailability: z.enum(['available', 'none', 'unknown']),
    dataSource: text,
    expectedResult: text,
    successMetric: text,
    successTarget: text,
    acceptanceCriteria: text,
    constraints: text,
    noConstraints: z.boolean(),
    contact: text,
    interactionFormat: text,
  })
  .strict();
export type TaskFields = z.infer<typeof fieldsSchema>;
export const emptyFields = (): TaskFields => ({
  title: '',
  industry: '',
  context: '',
  need: '',
  users: '',
  dataAvailability: 'unknown',
  dataSource: '',
  expectedResult: '',
  successMetric: '',
  successTarget: '',
  acceptanceCriteria: '',
  constraints: '',
  noConstraints: false,
  contact: '',
  interactionFormat: '',
});
export const fieldKeys = Object.keys(fieldsSchema.shape) as [keyof TaskFields, ...(keyof TaskFields)[]];
export const fieldKeySchema = z.enum(fieldKeys);
export type FieldKey = keyof TaskFields;
export const levels = ['draft', 'working', 'ready', 'priority'] as const;
export type Level = (typeof levels)[number];
export type Role = 'business' | 'team';
export type Actor = { id: string; role: Role; displayName: string; teamId: string | null };
export type Team = {
  id: string;
  name: string;
  interests: string[];
  skills: string[];
  technologies: string[];
  avatarPreset: string;
  color: string;
  confirmedPoints: number;
};
export type BreakdownItem = {
  key: string;
  label: string;
  earned: number;
  max: number;
  missingFields: FieldKey[];
  hint: string;
};
export type Score = {
  value: number;
  level: Level;
  label: string;
  breakdown: BreakdownItem[];
  missingFields: FieldKey[];
  nextImprovement: { field: FieldKey; message: string; possiblePoints: number } | null;
};

export type Task = {
  id: string;
  businessUserId: string;
  rawDescription: string;
  draftFields: TaskFields;
  confirmedFields: TaskFields | null;
  publicationStatus: 'draft' | 'published';
  /** Editor version: changes only when the business edits, clarifies, confirms or publishes. */
  version: number;
  /** Revision of all task activity, used by public cards and realtime. Older rows fall back to version. */
  revision?: number;
  clarification: (ClarificationResult & { answeredFields?: FieldKey[]; reviewed?: boolean }) | null;
  clarifiedAt?: string | null;
  analysis?: TaskAnalysis | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type Proposal = {
  id: string;
  taskId: string;
  teamId: string;
  idea: string;
  plan: string;
  estimatedTime: string;
  prototypeUrl: string;
  status: 'pending' | 'selected' | 'rejected';
  decisionNote: string;
  version: number;
  createdAt: string;
};
export type Milestone = {
  id: string;
  taskId: string;
  teamId: string;
  title: string;
  acceptanceCriteria: string;
  points: number;
  status: 'draft' | 'in_review' | 'changes_requested' | 'approved';
  evidenceUrl: string;
  description: string;
  evidence: EvidenceResult | null;
  review: EvidenceReview | null;
  feedback: string;
  reviewHistory?: {
    decision: 'approve' | 'return';
    feedback: string;
    /** Null only for a return imported from a legacy row without a timestamp. */
    decidedAt: string | null;
    version: number;
  }[];
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export const questionSchema = z
  .object({ field: fieldKeySchema, text: z.string().trim().min(8).max(500) })
  .strict();
export const clarificationSchema = z
  .object({
    missingFields: z.array(fieldKeySchema),
    questions: z.array(questionSchema).min(3).max(5),
  })
  .strict();
export type ClarificationResult = z.infer<typeof clarificationSchema> & {
  mode: 'openai' | 'stub';
  warning: string | null;
  run?: AiRun;
};
export type AiOperation = 'analyze' | 'clarify' | 'review_evidence';
export type AiRun = {
  id: string;
  operation: AiOperation;
  model: string | null;
  promptVersion: string;
  startedAt: string;
  durationMs: number;
  mode: 'openai' | 'stub';
  outcome: 'completed' | 'fallback';
  fallbackReason:
    'disabled' | 'missing_key' | 'timeout' | 'rate_limit' | 'provider_error' | 'invalid_output' | null;
  inputTokens: number | null;
  outputTokens: number | null;
  validation: 'passed' | 'failed' | 'not_run';
};
export type StoredAiRun = AiRun & {
  taskId: string;
  entityId: string;
  sourceVersion: number;
  disposition: 'applied' | 'stale';
};
export const suggestionFieldSchema = fieldKeySchema.exclude(['dataAvailability', 'noConstraints']);
export type FieldSuggestion = {
  id: string;
  field: z.infer<typeof suggestionFieldSchema>;
  value: string;
  source: { id: 'rawDescription'; quote: string };
};
export type AnalysisResult = {
  suggestions: FieldSuggestion[];
  mode: 'openai' | 'stub';
  warning: string | null;
  run?: AiRun;
};
export type TaskAnalysis = AnalysisResult & {
  id: string;
  sourceVersion: number;
  applicableVersion: number;
  resolved: boolean;
};
export type GitMaterial = {
  id: string;
  path: string;
  kind: 'readme' | 'patch';
  sourceUrl: string;
  content: string;
  truncated: boolean;
};
export type GitSnapshot = {
  commitSha: string;
  inspectedAt: string;
  coverage: 'complete' | 'partial' | 'metadata_only';
  files: GitMaterial[];
  warnings: string[];
};
export type EvidenceResult = {
  provider: 'github' | 'manual' | 'mock';
  status: 'verified' | 'unavailable' | 'manual' | 'mock';
  url: string;
  title: string;
  summary: string;
  facts: string[];
  warning: string | null;
  snapshot?: GitSnapshot | null;
};
export type CriterionEvidence = {
  criterion: string;
  status: 'materials_found' | 'insufficient_evidence' | 'not_assessed';
  citations: { materialId: string; path: string; sourceUrl: string; quote: string }[];
  nextStep: string;
};
export type EvidenceReview = {
  mode: 'openai' | 'stub';
  summary: string;
  checks: string[];
  warning: string | null;
  criterionEvidence?: CriterionEvidence[];
  run?: AiRun;
};
export interface AiProvider {
  analyze(input: { rawDescription: string; fields: TaskFields }): Promise<AnalysisResult>;
  clarify(input: {
    rawDescription: string;
    fields: TaskFields;
    missingFields: FieldKey[];
  }): Promise<ClarificationResult>;
  reviewEvidence(input: {
    title: string;
    acceptanceCriteria: string;
    description: string;
    evidence: EvidenceResult;
  }): Promise<EvidenceReview>;
}
export interface GitProvider {
  inspect(url: string): Promise<EvidenceResult>;
}

export const versionSchema = z.number().int().positive();
export const commands = {
  session: z.object({ code: z.string().trim().min(1).max(120) }).strict(),
  start: z
    .object({
      rawDescription: nonempty.max(8000),
      title: z.string().trim().max(160).optional(),
      industry: z.string().trim().max(80).optional(),
    })
    .strict(),
  draft: z.object({ expectedVersion: versionSchema, fields: fieldsSchema.partial() }).strict(),
  version: z.object({ expectedVersion: versionSchema }).strict(),
  applySuggestions: z
    .object({
      expectedVersion: versionSchema,
      analysisId: z.string().uuid(),
      suggestionIds: z.array(z.string().max(100)).max(14),
    })
    .strict(),
  answers: z
    .object({
      expectedVersion: versionSchema,
      answers: z
        .array(z.object({ field: fieldKeySchema, value: z.union([text, z.boolean()]) }).strict())
        .min(1)
        .max(20),
    })
    .strict(),
  proposal: z
    .object({ idea: nonempty, plan: nonempty, estimatedTime: nonempty.max(200), prototypeUrl: safeUrl })
    .strict(),
  decision: z
    .object({
      expectedVersion: versionSchema,
      decision: z.enum(['select', 'reject']),
      note: text.default(''),
    })
    .strict(),
  milestone: z.object({ title: nonempty.max(160), acceptanceCriteria: nonempty }).strict(),
  evidence: z
    .object({ expectedVersion: versionSchema, evidenceUrl: safeUrl, description: nonempty })
    .strict(),
  review: z
    .object({
      expectedVersion: versionSchema,
      decision: z.enum(['approve', 'return']),
      feedback: text.default(''),
    })
    .strict(),
  catalog: z
    .object({
      search: z.string().trim().max(160).default(''),
      industry: z.string().trim().max(80).default(''),
      level: z.enum(levels).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(12),
      worldPage: z.coerce.number().int().min(1).default(1),
    })
    .strict(),
  createTeam: z
    .object({
      name: nonempty.max(100),
      interests: z.array(nonempty.max(100)).max(10).default([]),
      skills: z.array(nonempty.max(100)).max(15).default([]),
      technologies: z.array(nonempty.max(100)).max(15).default([]),
      avatarPreset: z.enum(['fox', 'owl', 'robot', 'cat', 'bear']).default('robot'),
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default('#4f46e5'),
    })
    .strict(),
};
export type CatalogQuery = z.infer<typeof commands.catalog>;
export type DomainEvent = {
  type:
    | 'team.created'
    | 'task.changed'
    | 'task.published'
    | 'proposal.created'
    | 'proposal.decided'
    | 'milestone.decided'
    | 'milestone.changed';
  taskId: string | null;
  entityId: string;
  version: number;
  visibility: 'public' | 'private';
  userIds: string[];
  invalidate: string[];
};

export type Action = { id: string; label: string; enabled: boolean; reason: string | null };
export const action = (id: string, label: string, enabled = true, reason: string | null = null): Action => ({
  id,
  label,
  enabled,
  reason: enabled ? null : reason,
});
