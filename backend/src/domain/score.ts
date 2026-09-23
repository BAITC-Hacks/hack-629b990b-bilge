import type { BreakdownItem, FieldKey, Level, Score, TaskFields } from '../contracts.js';

export const levelLabels: Record<Level, string> = {
  draft: 'Черновик',
  working: 'Рабочая',
  ready: 'Готовая',
  priority: 'Приоритетная',
};
export const meaningful = (value: string): boolean => {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, '');
  return (
    clean.length >= 3 &&
    /[\p{L}\p{N}]/u.test(clean) &&
    !/^((?:пока )?не знаю|потом уточню|уточню|нет|не указано|todo|tbd|test|тест|unknown|n\/a|placeholder|пока нет)$/iu.test(
      clean,
    )
  );
};
export function getLevel(value: number): Level {
  return value >= 90 ? 'priority' : value >= 70 ? 'ready' : value >= 40 ? 'working' : 'draft';
}
export function hasMetricAndTarget(fields: TaskFields): boolean {
  const numericTarget = /^[<>≤≥=]*\s*[-+]?\d+(?:[.,]\d+)?\s*%?$/.test(fields.successTarget.trim());
  return meaningful(fields.successMetric) && (meaningful(fields.successTarget) || numericTarget);
}
export function calculateScore(fields: TaskFields): Score {
  const has = (key: FieldKey) => typeof fields[key] === 'string' && meaningful(fields[key] as string);
  const category = (
    key: string,
    label: string,
    parts: [boolean, number, FieldKey][],
    hint: string,
  ): BreakdownItem => ({
    key,
    label,
    earned: parts.reduce((sum, [ok, points]) => sum + (ok ? points : 0), 0),
    max: parts.reduce((sum, [, points]) => sum + points, 0),
    missingFields: parts.filter(([ok]) => !ok).map(([, , field]) => field),
    hint,
  });
  const criterion = has('acceptanceCriteria') || hasMetricAndTarget(fields);
  const breakdown = [
    category(
      'context',
      'Контекст и потребность',
      [
        [has('context'), 10, 'context'],
        [has('need'), 10, 'need'],
      ],
      'Опишите текущую ситуацию и нужное изменение',
    ),
    category(
      'data',
      'Данные и материалы',
      [
        [fields.dataAvailability !== 'unknown', 10, 'dataAvailability'],
        [fields.dataAvailability === 'available' && has('dataSource'), 10, 'dataSource'],
      ],
      'Укажите доступность данных и реальный источник, если он есть',
    ),
    category(
      'result',
      'Ожидаемый результат',
      [[has('expectedResult'), 15, 'expectedResult']],
      'Опишите, что команда должна показать в конце',
    ),
    category(
      'success',
      'Критерии успеха',
      [[criterion, 15, 'acceptanceCriteria']],
      'Укажите показатель с целью или проверяемое условие приёмки',
    ),
    category(
      'constraints',
      'Ограничения',
      [[has('constraints') || fields.noConstraints, 10, 'constraints']],
      'Опишите ограничения или подтвердите отсутствие известных ограничений',
    ),
    category(
      'users',
      'Пользователи',
      [[has('users'), 10, 'users']],
      'Назовите пользователей будущего решения',
    ),
    category(
      'contact',
      'Связь с бизнесом',
      [
        [has('contact'), 5, 'contact'],
        [has('interactionFormat'), 5, 'interactionFormat'],
      ],
      'Укажите канал связи и формат консультаций',
    ),
  ];
  const value = breakdown.reduce((sum, item) => sum + item.earned, 0);
  // Never suggest inventing a dataset when its absence was explicitly stated.
  const next = breakdown.find(
    (item) => item.earned < item.max && !(item.key === 'data' && fields.dataAvailability === 'none'),
  );
  return {
    value,
    level: getLevel(value),
    label: levelLabels[getLevel(value)],
    breakdown,
    missingFields: [...new Set(breakdown.flatMap((item) => item.missingFields))].filter(
      (field) => !(fields.dataAvailability === 'none' && field === 'dataSource'),
    ),
    nextImprovement: next
      ? { field: next.missingFields[0]!, message: next.hint, possiblePoints: next.max - next.earned }
      : null,
  };
}
