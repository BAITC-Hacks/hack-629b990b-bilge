import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commands, type Actor, type GitProvider, type Milestone, type Proposal } from '../contracts.js';
import { AppError, assertVersion, invariant } from '../errors.js';
import { Tasks } from './tasks.js';
import type { Store } from '../db.js';

export function mayRejectProposal(store: Store, item: Proposal): boolean {
  if (item.status !== 'selected') return true;
  const approved = store
    .all<Milestone>('milestones')
    .some((m) => m.taskId === item.taskId && m.teamId === item.teamId && m.status === 'approved');
  const otherSelected = store
    .all<Proposal>('proposals')
    .some(
      (p) =>
        p.id !== item.id && p.taskId === item.taskId && p.teamId === item.teamId && p.status === 'selected',
    );
  return !approved || otherSelected;
}

export class Work {
  constructor(
    readonly tasks: Tasks,
    readonly git: GitProvider,
  ) {}
  get store() {
    return this.tasks.store;
  }
  team(actor: Actor): string {
    invariant(
      actor.role === 'team' && actor.teamId,
      403,
      'TEAM_REQUIRED',
      'Для этого действия войдите под командой',
    );
    return actor.teamId;
  }
  proposal(id: string) {
    const item = this.store.get<Proposal>('proposals', id);
    invariant(item, 404, 'PROPOSAL_NOT_FOUND', 'Отклик не найден');
    return item;
  }
  milestone(id: string) {
    const item = this.store.get<Milestone>('milestones', id);
    invariant(item, 404, 'MILESTONE_NOT_FOUND', 'Этап не найден');
    return item;
  }
  propose(actor: Actor, taskId: string, input: z.infer<typeof commands.proposal>, key?: string) {
    const teamId = this.team(actor);
    this.tasks.public(taskId);
    let created = false;
    const id = this.tasks.once(actor, `propose:${taskId}`, key, input, () => {
      const item: Proposal = {
        ...input,
        id: randomUUID(),
        taskId,
        teamId,
        status: 'pending',
        decisionNote: '',
        version: 1,
        createdAt: new Date().toISOString(),
      };
      this.store.saveProposal(item);
      const task = this.tasks.require(taskId);
      this.tasks.bumpActivity(task);
      created = true;
      return item.id;
    });
    if (created)
      this.tasks.announce(
        this.tasks.require(taskId),
        'proposal.created',
        true,
        id,
        this.store.teamUsers(teamId),
      );
    return this.proposal(id);
  }
  decide(actor: Actor, id: string, input: z.infer<typeof commands.decision>) {
    let changed = false;
    const item = this.store.transaction(() => {
      const item = this.proposal(id);
      const task = this.tasks.own(actor, item.taskId);
      const status = input.decision === 'select' ? 'selected' : 'rejected';
      if (item.status === status && item.decisionNote === input.note) return item;
      assertVersion(item.version, input.expectedVersion);
      if (status === 'rejected') {
        invariant(
          mayRejectProposal(this.store, item),
          409,
          'APPROVED_WORK',
          'Нельзя отменить выбор команды с подтверждённым этапом',
        );
      }
      item.status = status;
      item.decisionNote = input.note;
      item.version++;
      this.store.saveProposal(item);
      this.tasks.bumpActivity(task);
      changed = true;
      return item;
    });
    if (changed)
      this.tasks.announce(
        this.tasks.require(item.taskId),
        'proposal.decided',
        true,
        id,
        this.store.teamUsers(item.teamId),
      );
    return item;
  }
  createMilestone(actor: Actor, taskId: string, input: z.infer<typeof commands.milestone>, key?: string) {
    const teamId = this.team(actor);
    this.tasks.public(taskId);
    invariant(
      this.store.isSelected(taskId, teamId),
      403,
      'SELECTION_REQUIRED',
      'Сначала бизнес должен выбрать вашу команду',
    );
    let created = false;
    const id = this.tasks.once(actor, `milestone:${taskId}`, key, input, () => {
      invariant(
        !this.store.all<Milestone>('milestones').some((m) => m.taskId === taskId && m.teamId === teamId),
        409,
        'MILESTONE_EXISTS',
        'Для вашей команды уже создан этап по этой задаче',
      );
      const item: Milestone = {
        ...input,
        id: randomUUID(),
        taskId,
        teamId,
        points: 10,
        status: 'draft',
        evidenceUrl: '',
        description: '',
        evidence: null,
        review: null,
        feedback: '',
        version: 1,
        approvedBy: null,
        approvedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.store.saveMilestone(item);
      this.tasks.bumpActivity(this.tasks.require(taskId));
      created = true;
      return item.id;
    });
    if (created)
      this.tasks.announce(
        this.tasks.require(taskId),
        'milestone.changed',
        false,
        id,
        this.store.teamUsers(teamId),
      );
    return this.milestone(id);
  }
  async evidence(actor: Actor, id: string, input: z.infer<typeof commands.evidence>) {
    const teamId = this.team(actor);
    const validate = () => {
      const item = this.milestone(id);
      invariant(item.teamId === teamId, 403, 'FORBIDDEN', 'Это этап другой команды');
      invariant(
        this.store.isSelected(item.taskId, teamId),
        403,
        'SELECTION_REQUIRED',
        'Бизнес ещё не выбрал вашу команду или отменил выбор',
      );
      invariant(
        item.status === 'draft' || item.status === 'changes_requested',
        409,
        'EVIDENCE_LOCKED',
        'Изменить результат можно до отправки или после возврата на доработку',
      );
      assertVersion(item.version, input.expectedVersion);
      return item;
    };
    const before = validate();
    const evidence = await this.git.inspect(input.evidenceUrl);
    const review = await this.tasks.ai.reviewEvidence({
      title: before.title,
      acceptanceCriteria: before.acceptanceCriteria,
      description: input.description,
      evidence,
    });
    const item = this.tasks.commitAi(before.taskId, id, input.expectedVersion, review.run, () => {
      const item = validate();
      // Preserve return notes from older rows too; their original time is unknown.
      if (item.status === 'changes_requested' && item.feedback && !item.reviewHistory?.length)
        item.reviewHistory = [
          { decision: 'return', feedback: item.feedback, decidedAt: null, version: item.version },
        ];
      item.evidenceUrl = input.evidenceUrl;
      item.description = input.description;
      item.evidence = evidence;
      item.review = review;
      item.status = 'in_review';
      item.feedback = '';
      item.version++;
      this.store.saveMilestone(item);
      this.tasks.bumpActivity(this.tasks.require(item.taskId));
      return item;
    });
    this.tasks.announce(
      this.tasks.require(item.taskId),
      'milestone.changed',
      true,
      id,
      this.store.teamUsers(teamId),
    );
    return item;
  }
  review(actor: Actor, id: string, input: z.infer<typeof commands.review>) {
    let changed = false;
    const item = this.store.transaction(() => {
      const item = this.milestone(id);
      const task = this.tasks.own(actor, item.taskId);
      if (item.status === 'approved' && input.decision === 'approve') return item;
      assertVersion(item.version, input.expectedVersion);
      invariant(
        this.store.isSelected(item.taskId, item.teamId),
        409,
        'SELECTION_REQUIRED',
        'Команда должна быть выбрана перед подтверждением этапа',
      );
      invariant(
        item.status === 'in_review',
        409,
        'NOT_IN_REVIEW',
        'На проверку ещё не отправлен результат этапа',
      );
      if (input.decision === 'return' && !input.feedback.trim())
        throw new AppError(
          422,
          'FEEDBACK_REQUIRED',
          'Напишите, что нужно доработать',
          { feedback: ['Укажите, что команда должна изменить и как проверить результат'] },
          'correct_fields',
        );
      item.status = input.decision === 'approve' ? 'approved' : 'changes_requested';
      item.feedback = input.feedback;
      item.version++;
      const decidedAt = new Date().toISOString();
      item.reviewHistory = [
        ...(item.reviewHistory ?? []),
        {
          decision: input.decision,
          feedback: input.feedback,
          decidedAt,
          version: item.version,
        },
      ].slice(-20);
      if (item.status === 'approved') {
        item.approvedAt = decidedAt;
        item.approvedBy = actor.id;
        this.store.awardMilestone({ ...item, approvedAt: item.approvedAt });
      }
      this.store.saveMilestone(item);
      this.tasks.bumpActivity(task);
      changed = true;
      return item;
    });
    if (changed)
      this.tasks.announce(
        this.tasks.require(item.taskId),
        'milestone.decided',
        true,
        id,
        this.store.teamUsers(item.teamId),
      );
    return item;
  }
}
