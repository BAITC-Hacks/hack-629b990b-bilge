import { expect, it } from 'vitest';
import { commands, emptyFields, safeUrl } from '../src/contracts.js';
import { calculateScore } from '../src/domain/score.js';

it.each(['not-a-url', 'https://', ''])(
  'returns structured validation errors for malformed URL %s',
  (value) => {
    expect(() => safeUrl.safeParse(value)).not.toThrow();
    expect(safeUrl.safeParse(value).success).toBe(false);
  },
);
it('partial form edits never reset omitted fields to defaults', () => {
  expect(commands.draft.parse({ expectedVersion: 1, fields: { title: 'New title' } }).fields).toEqual({
    title: 'New title',
  });
});
it.each(['0', '5', '50', '5%', '>0', '<=5'])('accepts the short measurable target %s', (successTarget) => {
  expect(calculateScore({ ...emptyFields(), successMetric: 'NPS', successTarget }).value).toBe(15);
});
