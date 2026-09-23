import type { BreakdownItem, FieldKey, Level, Score, TaskFields } from '../contracts.js';

export const levelLabels: Record<Level, string> = {
  draft: 'Draft',
  working: 'Working',
  ready: 'Ready',
  priority: 'Priority',
};
// Placeholder answers are matched in both Russian and English, since users may type either language.
const meaningfulText = (value: string, minimumLength: number): boolean => {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, '');
  return (
    clean.length >= minimumLength &&
    /[\p{L}\p{N}]/u.test(clean) &&
    !/^((?:пока )?не знаю|потом уточню|уточню|нет|не указано|todo|tbd|test|тест|unknown|n\/a|placeholder|пока нет|(?:i )?(?:don'?t|do not) know(?: yet)?|not sure|later|will clarify later|to be clarified|no|none|not specified|not yet|none yet)$/iu.test(
      clean,
    )
  );
};
export const meaningful = (value: string): boolean => meaningfulText(value, 3);
/** Headings can be short acronyms (IT, AI); descriptive score fields retain their existing rules. */
export const validCardHeading = (value: string): boolean => meaningfulText(value, 2);
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
      'Context and need',
      [
        [has('context'), 10, 'context'],
        [has('need'), 10, 'need'],
      ],
      'Describe the current situation and the change you need',
    ),
    category(
      'data',
      'Data and materials',
      [
        [fields.dataAvailability !== 'unknown', 10, 'dataAvailability'],
        [fields.dataAvailability === 'available' && has('dataSource'), 10, 'dataSource'],
      ],
      'State whether data is available and the real source, if any',
    ),
    category(
      'result',
      'Expected result',
      [[has('expectedResult'), 15, 'expectedResult']],
      'Describe what the team should show at the end',
    ),
    category(
      'success',
      'Success criteria',
      [[criterion, 15, 'acceptanceCriteria']],
      'Give a metric with a target or a testable acceptance condition',
    ),
    category(
      'constraints',
      'Constraints',
      [[has('constraints') || fields.noConstraints, 10, 'constraints']],
      'Describe the constraints or confirm there are no known constraints',
    ),
    category(
      'users',
      'Users',
      [[has('users'), 10, 'users']],
      'Name the users of the future solution',
    ),
    category(
      'contact',
      'Business contact',
      [
        [has('contact'), 5, 'contact'],
        [has('interactionFormat'), 5, 'interactionFormat'],
      ],
      'Give a contact channel and consultation format',
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
