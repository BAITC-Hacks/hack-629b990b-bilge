import type { FieldKey, TaskFields } from '../contracts.js';

export type QualityWarning = {
  id: string;
  field: FieldKey;
  relatedFields: FieldKey[];
  message: string;
  actionLabel: string;
};
// Generic phrases are matched in both Russian and English, since users may type either language.
const generic =
  /^(?:сделать лучше|улучшить|улучшить всё|решить проблему|всё хорошо|все хорошо|что-нибудь|не знаю|пока не знаю|test|тест|todo|tbd|нет информации|make it better|improve|improve everything|solve the problem|everything is fine|all good|something|anything|(?:i )?(?:don'?t|do not) know(?: yet)?|no information|n\/a|unknown)[.!?\s]*$/iu;
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
        message: 'A generic phrase does not explain the task. Add a concrete fact or an observable result.',
        actionLabel: 'Clarify the wording',
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
        message: 'The same text is repeated in several fields. Check that each field answers its own question.',
        actionLabel: 'Check repetitions',
      });
  if (fields.dataAvailability === 'none' && fields.dataSource.trim())
    warnings.push({
      id: 'conflict:data',
      field: 'dataAvailability',
      relatedFields: ['dataSource'],
      message:
        'Data is marked as unavailable, but a source is filled in. Clarify whether the data is already available or still needs to be collected.',
      actionLabel: 'Clarify data availability',
    });
  if (fields.noConstraints && fields.constraints.trim())
    warnings.push({
      id: 'conflict:constraints',
      field: 'noConstraints',
      relatedFields: ['constraints'],
      message: 'No constraints is checked, but constraint text is filled in. Check both values.',
      actionLabel: 'Check constraints',
    });
  return {
    warnings,
    notice:
      'The score reflects completeness under the hackathon rules. Hints help check the content and never change the score automatically.',
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
