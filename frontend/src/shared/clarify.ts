// Контракт ИИ-уточнений (ТЗ 4.3): промпт, валидация ответа модели и локальный набор вопросов (режим stub).
// Используется и фронтенд-заглушкой API, и будущим сервером (server/ai.ts).
import { AI_FIELDS, type AiField, type Card, type ClarifyQuestion } from './types';
import { meaningful } from './scoring';

export const PROMPT =
  'Определи недостающие сведения в описании бизнес-задачи. Задай 3–5 коротких, относящихся к пробелам вопросов. ' +
  'Используй только факты из входного текста. Не придумывай цифры, сроки, контакты, источники данных и ответы. ' +
  'Верни JSON по заданной схеме: {"missingFields": [поле], "questions": [{"field": поле, "text": вопрос}]}. ' +
  `Разрешённые поля: ${AI_FIELDS.join(', ')}.`;

export const AI_FIELD_LABELS: Record<AiField, string> = {
  context: 'Контекст',
  need: 'Потребность',
  users: 'Пользователи',
  dataMaterials: 'Данные и материалы',
  constraints: 'Ограничения',
  expectedResult: 'Ожидаемый результат',
  successCriteria: 'Критерии успеха',
  contact: 'Контакт',
  interactionFormat: 'Формат взаимодействия',
};

// Приоритет пробелов = вес категории в рейтинге.
const PRIORITY: AiField[] = ['dataMaterials', 'expectedResult', 'successCriteria', 'context', 'need', 'constraints', 'users', 'contact', 'interactionFormat'];

const STUB_Q: Record<AiField, string> = {
  dataMaterials: 'Какие данные или материалы вы можете дать команде: записи, выгрузки, примеры? Если данных нет — так и напишите.',
  expectedResult: 'Что команда должна показать в конце работы?',
  successCriteria: 'По какому показателю или условию вы примете результат?',
  context: 'Как устроен процесс сейчас и что именно мешает?',
  need: 'Что должно измениться после работы команды?',
  constraints: 'Есть ли ограничения: сроки, доступы, обязательные технологии? Если нет — так и напишите.',
  users: 'Кто будет пользоваться решением?',
  contact: 'Как команде связаться с вами: e-mail, телефон или мессенджер?',
  interactionFormat: 'Как часто и в каком формате вы готовы консультировать команду?',
};

// Признак ищется только с начала слова: иначе «непроДАННой» ошибочно считалось упоминанием данных.
const startOfWord = (stems: string) => new RegExp(`(?:^|[^a-zа-яё0-9])(?:${stems})`, 'i');
const TEXT_HINTS: Partial<Record<AiField, RegExp>> = {
  dataMaterials: startOfWord('данн|excel|csv|выгруз|баз[аеуы]|1с|crm|таблиц|журнал|статистик|запис'),
  expectedResult: startOfWord('результат|прототип|дашборд|отч[её]т|приложени|сайт|сервис'),
  successCriteria: /%|(?:^|[^a-zа-яё0-9])(?:kpi|метрик|критери|успех|показател)/i,
  constraints: startOfWord('срок|недел|месяц|бюджет|огранич|nda|доступ|стек|технолог'),
  users: startOfWord('клиент|пользоват|сотрудник|менеджер|покупател|студент|пациент|гост|диспетчер|бариста|повар'),
  contact: /@|\+7|t\.me|(?:^|[^a-zа-яё0-9])телефон/i,
  interactionFormat: startOfWord('созвон|встреч|раз в|еженед|консультац'),
};

export function knownMissing(raw: string, card: Card): AiField[] {
  const has: Record<AiField, boolean> = {
    context: meaningful(card.context, 20),
    need: meaningful(card.need, 15),
    users: meaningful(card.users, 5),
    dataMaterials: card.dataAvailability === 'yes' || card.dataAvailability === 'no' || meaningful(card.dataSource, 8),
    constraints: card.noKnownConstraints || meaningful(card.constraints, 10),
    expectedResult: meaningful(card.expectedResult, 20),
    successCriteria: meaningful(card.acceptanceItem, 15) || meaningful(card.successTarget, 1),
    contact: meaningful(card.contactChannel, 5),
    interactionFormat: meaningful(card.interactionFormat, 10),
  };
  return PRIORITY.filter((f) => !has[f] && !(TEXT_HINTS[f]?.test(raw) ?? false));
}

/** Локальный набор: 3–5 вопросов по реально отсутствующим категориям. */
export function stubQuestions(raw: string, card: Card): { missingFields: AiField[]; questions: ClarifyQuestion[] } {
  const missing = knownMissing(raw, card);
  const pick = missing.slice(0, 5);
  for (const f of PRIORITY) {
    if (pick.length >= 3) break;
    if (!pick.includes(f)) pick.push(f);
  }
  return { missingFields: missing, questions: pick.map((field) => ({ field, text: STUB_Q[field] })) };
}

/** Проверка ответа модели: объект, разрешённые поля, 3–5 непустых уникальных вопросов. */
export function validateClarify(obj: unknown): { missingFields: AiField[]; questions: ClarifyQuestion[] } {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ответ не является объектом');
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.missingFields) || !Array.isArray(o.questions)) throw new Error('нет missingFields или questions');
  const allowed = new Set<string>(AI_FIELDS);
  const missingFields = o.missingFields.map((f) => {
    if (typeof f !== 'string' || !allowed.has(f)) throw new Error(`неизвестное поле ${String(f)}`);
    return f as AiField;
  });
  const seen = new Set<string>();
  const questions = o.questions.map((q, i) => {
    const qq = (q ?? {}) as Record<string, unknown>;
    if (typeof qq.field !== 'string' || !allowed.has(qq.field)) throw new Error(`вопрос ${i + 1}: неизвестное поле`);
    const text = typeof qq.text === 'string' ? qq.text.trim() : '';
    if (text.length < 8 || text.length > 300) throw new Error(`вопрос ${i + 1}: пустой или слишком длинный текст`);
    if (seen.has(text.toLowerCase())) throw new Error(`вопрос ${i + 1}: повтор`);
    seen.add(text.toLowerCase());
    return { field: qq.field as AiField, text };
  });
  if (questions.length < 3 || questions.length > 5) throw new Error(`вопросов ${questions.length}, нужно 3–5`);
  return { missingFields, questions };
}

/** Первичная карточка из исходного текста: только дословные предложения пользователя, без генерации фактов. */
export function draftFromRaw(raw: string, base: Card): Card {
  const sentences = raw.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  const needRe = /хотим|хотели бы|нужно|нужен|нужна|надо|необходимо|требуется|понять|снизить|сократить|увеличить|уменьшить/i;
  const need = sentences.filter((s) => needRe.test(s));
  const context = sentences.filter((s) => !needRe.test(s));
  const first = (sentences[0] ?? '').replace(/[.!?]+$/, '');
  return {
    ...base,
    title: base.title || (first.length > 80 ? first.slice(0, 78).replace(/\s+\S*$/, '') + '…' : first),
    context: base.context || context.join(' ') || raw.trim(),
    need: base.need || need.join(' '),
  };
}

/** Перенос ответов на вопросы в рабочую копию карточки (дословно, с дописыванием к уже введённому). */
export function applyAnswers(card: Card, answers: Record<string, string>): Card {
  const c = { ...card };
  const add = (cur: string, v: string) => (cur.trim() ? `${cur.trim()} ${v}` : v);
  for (const [field, raw] of Object.entries(answers)) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    switch (field as AiField) {
      case 'context': c.context = add(c.context, v); break;
      case 'need': c.need = add(c.need, v); break;
      case 'users': c.users = add(c.users, v); break;
      case 'dataMaterials': c.dataSource = add(c.dataSource, v); break;
      case 'constraints': c.constraints = add(c.constraints, v); break;
      case 'expectedResult': c.expectedResult = add(c.expectedResult, v); break;
      case 'successCriteria': c.acceptanceItem = add(c.acceptanceItem, v); break;
      case 'contact': c.contactChannel = add(c.contactChannel, v); break;
      case 'interactionFormat': c.interactionFormat = add(c.interactionFormat, v); break;
    }
  }
  return c;
}

/** Предварительная сводка по ссылке на результат этапа (P1): не скачивает и не утверждает, что результат достигнут. */
export function evidenceSummary(url: string, criteria: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    const pr = u.pathname.match(/\/pull\/(\d+)/);
    const seen = [`ссылка на ${u.hostname}`, repo && `репозиторий ${repo}`, pr && `pull request #${pr[1]}`].filter(Boolean).join(', ');
    return `Что видно по ссылке: ${seen}. Содержимое автоматически не проверялось. Требует проверки бизнесом по критерию: «${criteria}».`;
  } catch {
    return 'Ссылку не удалось разобрать — требует ручной проверки.';
  }
}
