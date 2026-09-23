import type { FieldKey, TaskFields } from '../contracts.js';

export type QualityWarning = {
  id: string;
  field: FieldKey;
  relatedFields: FieldKey[];
  message: string;
  actionLabel: string;
};
const generic =
  /^(?:сделать лучше|улучшить|улучшить всё|решить проблему|всё хорошо|все хорошо|что-нибудь|не знаю|пока не знаю|test|тест|todo|tbd|нет информации)[.!?\s]*$/iu;
const descriptionFields: FieldKey[] = [
  'context',
  'need',
  'users',
  'dataSource',
  'expectedResult',
  'successMetric',
  'successTarget',
  'acceptanceCriteria',
  'constraints',
  'contact',
  'interactionFormat',
];

/** Advisory, explainable checks. The published readiness formula stays unchanged. */
export function checkQuality(fields: TaskFields) {
  const warnings: QualityWarning[] = [];
  for (const field of descriptionFields) {
    const value = fields[field];
    if (typeof value === 'string' && generic.test(value.trim()))
      warnings.push({
        id: `vague:${field}`,
        field,
        relatedFields: [],
        message: 'Общая фраза не объясняет задачу. Добавьте конкретный факт или наблюдаемый результат.',
        actionLabel: 'Уточнить формулировку',
      });
  }
  const groups = new Map<string, FieldKey[]>();
  for (const field of descriptionFields) {
    const value = String(fields[field]).trim().toLocaleLowerCase('ru');
    if (value.length >= 3) groups.set(value, [...(groups.get(value) ?? []), field]);
  }
  for (const duplicates of groups.values())
    if (duplicates.length >= 3)
      warnings.push({
        id: `repeated:${duplicates[0]}`,
        field: duplicates[0]!,
        relatedFields: duplicates.slice(1),
        message: 'Один текст повторяется в разных полях. Проверьте, что каждое поле отвечает на свой вопрос.',
        actionLabel: 'Проверить повторения',
      });
  if (fields.dataAvailability === 'none' && fields.dataSource.trim())
    warnings.push({
      id: 'conflict:data',
      field: 'dataAvailability',
      relatedFields: ['dataSource'],
      message:
        'Указано, что данных нет, но источник заполнен. Уточните: данные уже доступны или их только предстоит собрать.',
      actionLabel: 'Уточнить доступность данных',
    });
  if (fields.noConstraints && fields.constraints.trim())
    warnings.push({
      id: 'conflict:constraints',
      field: 'noConstraints',
      relatedFields: ['constraints'],
      message: 'Отмечено отсутствие ограничений, но текст ограничений заполнен. Проверьте оба значения.',
      actionLabel: 'Проверить ограничения',
    });
  return {
    warnings,
    notice:
      'Балл отражает заполненность по правилам хакатона. Подсказки помогают проверить содержание и не меняют баллы автоматически.',
    nextAction: warnings[0]
      ? {
          id: 'edit_field',
          field: warnings[0].field,
          label: warnings[0].actionLabel,
          hint: warnings[0].message,
        }
      : null,
  };
}
