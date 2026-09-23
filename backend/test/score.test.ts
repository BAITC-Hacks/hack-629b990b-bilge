import { describe, expect, it } from 'vitest';
import { emptyFields } from '../src/contracts.js';
import { calculateScore, getLevel } from '../src/domain/score.js';

describe('confirmed readiness rules', () => {
  it.each([
    [0, 'draft'],
    [39, 'draft'],
    [40, 'working'],
    [69, 'working'],
    [70, 'ready'],
    [89, 'ready'],
    [90, 'priority'],
    [100, 'priority'],
  ])('maps boundary %s to %s', (score, level) => {
    expect(getLevel(Number(score))).toBe(level);
  });
  it('gives an empty card no points and explains the next useful improvement', () => {
    const score = calculateScore(emptyFields());
    expect(score.value).toBe(0);
    expect(score.nextImprovement).not.toBeNull();
    expect(score.breakdown.reduce((sum, item) => sum + item.max, 0)).toBe(100);
  });
  it('distinguishes honest absence of data from an available dataset', () => {
    expect(calculateScore({ ...emptyFields(), dataAvailability: 'none', dataSource: 'fiction' }).value).toBe(
      10,
    );
    expect(
      calculateScore({ ...emptyFields(), dataAvailability: 'available', dataSource: 'weekly sales CSV' })
        .value,
    ).toBe(20);
  });
  it('does not ask for an existing dataset after the business explicitly says none exists', () => {
    const score = calculateScore({ ...emptyFields(), dataAvailability: 'none' });
    expect(score.missingFields).not.toContain('dataSource');
  });
  it('rejects placeholder text and lowers score when useful information is removed', () => {
    expect(
      calculateScore({ ...emptyFields(), context: 'не знаю', need: 'потом уточню', users: 'TODO' }).value,
    ).toBe(0);
    const fields = {
      ...emptyFields(),
      acceptanceCriteria: 'Показать прогноз и таблицу фактических списаний',
    };
    expect(calculateScore(fields).value).toBe(15);
    expect(calculateScore({ ...fields, acceptanceCriteria: '' }).value).toBe(0);
  });
  it('requires both metric and target, or a checkable acceptance criterion', () => {
    expect(calculateScore({ ...emptyFields(), successMetric: 'MAE' }).value).toBe(0);
    expect(calculateScore({ ...emptyFields(), successMetric: 'MAE', successTarget: '< 10%' }).value).toBe(15);
  });
  it('keeps an honest unknown answer from earning readiness points', () => {
    expect(
      calculateScore({ ...emptyFields(), users: 'Пока не знаю', acceptanceCriteria: 'Пока не знаю!' }).value,
    ).toBe(0);
  });
});
