// Формула готовности 0–100 (ТЗ 4.2). Чистая функция: сервер считает официальный балл,
// клиент — только помеченный прогноз для рабочей копии.
import type { Card, LevelKey, Score } from './types';

const PLACEHOLDERS = new Set([
  'не знаю', 'незнаю', 'потом', 'потом уточню', 'уточню', 'уточним', 'уточним позже', 'позже', 'tbd', 'todo',
  'n/a', 'нет', 'пока нет', '-', '—', '?', '...', 'xxx', 'тест', 'test', 'заглушка', 'нужно уточнить',
]);

/** Осмысленно заполнено: не пусто, не заглушка, не короче порога, есть буквы или цифры. */
export function meaningful(value: string | undefined | null, min = 3): boolean {
  const t = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (t.length < min) return false;
  const norm = t.toLowerCase().replace(/[.!?…]+$/, '').trim();
  if (PLACEHOLDERS.has(norm)) return false;
  return /[a-zа-яёәғқңөұүһі0-9]/i.test(t);
}

const CONTACT_RE = /@|\+?\d[\d\s()-]{6,}|t\.me|telegram|whatsapp|телеграм/i;

interface Rule {
  key: string;
  label: string;
  points: number;
  hint: string;
  test: (c: Card) => boolean;
}
interface Category {
  key: string;
  label: string;
  max: number;
  rules: Rule[];
}

export const CATEGORIES: Category[] = [
  {
    key: 'context_need', label: 'Контекст и потребность', max: 20, rules: [
      { key: 'context', label: 'Описана текущая ситуация', points: 10, hint: 'Опишите, что происходит сейчас (от 20 символов)', test: (c) => meaningful(c.context, 20) },
      { key: 'need', label: 'Понятно, что нужно изменить', points: 10, hint: 'Сформулируйте, что должно измениться (от 15 символов)', test: (c) => meaningful(c.need, 15) },
    ],
  },
  {
    key: 'data', label: 'Данные и материалы', max: 20, rules: [
      { key: 'dataAvailability', label: 'Ясно, есть ли данные', points: 10, hint: 'Ответьте, есть ли данные: «есть» или честное «данных нет»', test: (c) => c.dataAvailability === 'yes' || c.dataAvailability === 'no' },
      { key: 'dataSource', label: 'Назван доступный источник или пример', points: 10, hint: 'Назовите источник, пример или материал, который получит команда', test: (c) => c.dataAvailability === 'yes' && meaningful(c.dataSource, 8) },
    ],
  },
  {
    key: 'result', label: 'Ожидаемый результат', max: 15, rules: [
      { key: 'expectedResult', label: 'Конкретный проверяемый результат', points: 15, hint: 'Опишите, что команда покажет в конце работы (от 20 символов)', test: (c) => meaningful(c.expectedResult, 20) },
    ],
  },
  {
    key: 'success', label: 'Критерии успеха', max: 15, rules: [
      {
        key: 'successCriteria', label: 'Измеримый показатель или условие приёмки', points: 15,
        hint: 'Укажите показатель с целевым значением (например, «списания» → «−20%») или проверяемое условие приёмки',
        test: (c) => (meaningful(c.successMetric, 3) && meaningful(c.successTarget, 1) && /\d/.test(c.successTarget)) || meaningful(c.acceptanceItem, 15),
      },
    ],
  },
  {
    key: 'constraints', label: 'Ограничения', max: 10, rules: [
      { key: 'constraints', label: 'Указаны границы или их отсутствие', points: 10, hint: 'Укажите сроки, доступы, технологии — или отметьте «известных ограничений нет»', test: (c) => c.noKnownConstraints || meaningful(c.constraints, 10) },
    ],
  },
  {
    key: 'users', label: 'Пользователи', max: 10, rules: [
      { key: 'users', label: 'Обозначена группа пользователей', points: 10, hint: 'Укажите, для кого создаётся решение', test: (c) => meaningful(c.users, 5) },
    ],
  },
  {
    key: 'contact', label: 'Связь с бизнесом', max: 10, rules: [
      { key: 'contactChannel', label: 'Рабочий канал связи', points: 5, hint: 'Укажите e-mail, телефон или мессенджер', test: (c) => meaningful(c.contactChannel, 5) && CONTACT_RE.test(c.contactChannel) },
      { key: 'interactionFormat', label: 'Формат консультаций и обратной связи', points: 5, hint: 'Опишите, как часто и где вы консультируете команду (от 10 символов)', test: (c) => meaningful(c.interactionFormat, 10) },
    ],
  },
];

export const LEVELS: { min: number; key: LevelKey; label: string; note: string }[] = [
  { min: 90, key: 'priority', label: 'Приоритетная', note: 'Полностью готова, выделена в каталоге' },
  { min: 70, key: 'ready', label: 'Готовая', note: 'Более высокая позиция в каталоге' },
  { min: 40, key: 'work', label: 'Рабочая', note: 'Отклик и рекомендации доступны' },
  { min: 0, key: 'draft', label: 'Черновик', note: 'Нужны уточнения; отклик доступен' },
];

export function levelOf(total: number) {
  return LEVELS.find((l) => total >= l.min)!;
}

export function calculateScore(card: Card): Score {
  let total = 0;
  const missing: { text: string; points: number }[] = [];
  const categories = CATEGORIES.map((cat) => {
    let got = 0;
    const items = cat.rules.map((r) => {
      const earned = r.test(card) ? r.points : 0;
      got += earned;
      if (!earned) missing.push({ text: r.hint, points: r.points });
      return { key: r.key, label: r.label, points: r.points, earned, hint: r.hint };
    });
    total += got;
    return { key: cat.key, label: cat.label, max: cat.max, got, items };
  });
  missing.sort((a, b) => b.points - a.points);
  const lv = levelOf(total);
  return { total, levelKey: lv.key, level: lv.label, categories, missing, next: missing[0] ?? null };
}

/** Порядок каталога (FR-07): балл по убыванию → более новая публикация → id. */
export function compareCatalog(a: { score: { total: number }; publishedAt: string; id: string }, b: { score: { total: number }; publishedAt: string; id: string }) {
  return b.score.total - a.score.total || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
}
