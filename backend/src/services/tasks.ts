import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  commands,
  emptyFields,
  fieldsSchema,
  type Actor,
  type AiProvider,
  type DomainEvent,
  type Task,
} from '../contracts.js';
import { Store } from '../db.js';
import { assertVersion, invariant, AppError } from '../errors.js';
import { calculateScore, meaningful } from '../domain/score.js';

export type Emit = (event: DomainEvent) => void;
export class Tasks {
  constructor(
    readonly store: Store,
    readonly ai: AiProvider,
    readonly emit: Emit,
  ) {}
  require(id: string): Task {
    const task = this.store.get<Task>('tasks', id);
    invariant(task, 404, 'TASK_NOT_FOUND', 'Задача не найдена');
    return task;
  }
  own(actor: Actor, id: string): Task {
    const task = this.require(id);
    invariant(
      actor.role === 'business' && task.businessUserId === actor.id,
      403,
      'FORBIDDEN',
      'Только владелец бизнеса может изменить эту задачу',
    );
    return task;
  }
  public(id: string): Task {
    const task = this.require(id);
    invariant(
      task.publicationStatus === 'published' && task.confirmedFields,
      404,
      'TASK_NOT_FOUND',
      'Опубликованная задача не найдена',
    );
    return task;
  }
  bump(task: Task) {
    task.version++;
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
  }
  announce(
    task: Task,
    type: DomainEvent['type'],
    publicChange = false,
    entityId = task.id,
    userIds: string[] = [],
  ) {
    this.emit({
      type,
      taskId: task.id,
      entityId,
      version: task.version,
      visibility: publicChange && task.publicationStatus === 'published' ? 'public' : 'private',
      userIds: [task.businessUserId, ...userIds],
      invalidate: ['catalog', 'task', 'workspace', 'dashboard', 'review', 'scoreboard'],
    });
  }
  once(actor: Actor, command: string, key: string | undefined, input: unknown, create: () => string): string {
    return this.store.transaction(() => {
      if (!key) return create();
      invariant(
        /^[\w-]{8,120}$/.test(key),
        422,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key должен содержать 8–120 букв, цифр, дефисов или подчёркиваний',
      );
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = this.store.db
        .prepare('SELECT fingerprint,result_id FROM idempotency WHERE user_id=? AND command=? AND key=?')
        .get(actor.id, command, key) as { fingerprint: string; result_id: string } | undefined;
      if (previous) {
        invariant(
          previous.fingerprint === fingerprint,
          409,
          'IDEMPOTENCY_CONFLICT',
          'Этот ключ повтора уже использован с другим содержимым',
        );
        return previous.result_id;
      }
      const id = create();
      this.store.db
        .prepare('INSERT INTO idempotency(user_id,command,key,fingerprint,result_id) VALUES(?,?,?,?,?)')
        .run(actor.id, command, key, fingerprint, id);
      return id;
    });
  }
  start(actor: Actor, input: z.infer<typeof commands.start>, key?: string): Task {
    invariant(
      actor.role === 'business',
      403,
      'BUSINESS_REQUIRED',
      'Создавать задачи может представитель бизнеса',
    );
    let created = false;
    const id = this.once(actor, 'start', key, input, () => {
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        businessUserId: actor.id,
        rawDescription: input.rawDescription,
        draftFields: {
          ...emptyFields(),
          context: input.rawDescription.slice(0, 4000),
          title: input.title || input.rawDescription.slice(0, 100),
          industry: input.industry || 'Другое',
        },
        confirmedFields: null,
        publicationStatus: 'draft',
        version: 1,
        clarification: null,
        clarifiedAt: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      };
      this.store.saveTask(task);
      created = true;
      return task.id;
    });
    const task = this.require(id);
    if (created) this.announce(task, 'task.changed');
    return task;
  }
  draft(actor: Actor, id: string, input: z.infer<typeof commands.draft>): Task {
    const task = this.store.transaction(() => {
      const task = this.own(actor, id);
      assertVersion(task.version, input.expectedVersion);
      task.draftFields = fieldsSchema.parse({ ...task.draftFields, ...input.fields });
      task.clarification = null;
      this.bump(task);
      return task;
    });
    this.announce(task, 'task.changed');
    return task;
  }
  answers(actor: Actor, id: string, input: z.infer<typeof commands.answers>): Task {
    const fields: Record<string, unknown> = {};
    for (const answer of input.answers) fields[answer.field] = answer.value;
    const parsed = fieldsSchema.partial().parse(fields);
    return this.draft(actor, id, { expectedVersion: input.expectedVersion, fields: parsed });
  }
  async clarify(actor: Actor, id: string, expected: number): Promise<Task> {
    const before = this.own(actor, id);
    assertVersion(before.version, expected);
    const clarification = await this.ai.clarify({
      rawDescription: before.rawDescription,
      fields: before.draftFields,
      missingFields: calculateScore(before.draftFields).missingFields,
    });
    const task = this.store.transaction(() => {
      const task = this.own(actor, id);
      assertVersion(task.version, expected);
      task.clarification = clarification;
      task.clarifiedAt = new Date().toISOString();
      this.bump(task);
      return task;
    });
    this.announce(task, 'task.changed');
    return task;
  }
  confirm(actor: Actor, id: string, expected: number): Task {
    const task = this.store.transaction(() => {
      const task = this.own(actor, id);
      assertVersion(task.version, expected);
      const fieldErrors: Record<string, string[]> = {};
      if (!meaningful(task.draftFields.title)) fieldErrors.title = ['Укажите понятное название задачи'];
      if (!meaningful(task.draftFields.industry)) fieldErrors.industry = ['Укажите отрасль'];
      if (Object.keys(fieldErrors).length)
        throw new AppError(422, 'REVIEW_REQUIRED', 'Проверьте карточку перед подтверждением', fieldErrors);
      task.confirmedFields = structuredClone(task.draftFields);
      this.bump(task);
      return task;
    });
    this.announce(task, 'task.changed', true);
    return task;
  }
  publish(actor: Actor, id: string, expected: number): Task {
    let changed = false;
    const task = this.store.transaction(() => {
      const task = this.own(actor, id);
      if (task.publicationStatus === 'published') return task;
      assertVersion(task.version, expected);
      invariant(task.confirmedFields, 409, 'CONFIRM_FIRST', 'Сначала подтвердите сведения карточки');
      invariant(
        JSON.stringify(task.confirmedFields) === JSON.stringify(task.draftFields),
        409,
        'UNCONFIRMED_CHANGES',
        'Подтвердите последние правки перед публикацией',
      );
      task.publicationStatus = 'published';
      task.publishedAt = new Date().toISOString();
      this.bump(task);
      changed = true;
      return task;
    });
    if (changed) this.announce(task, 'task.published', true);
    return task;
  }
}
