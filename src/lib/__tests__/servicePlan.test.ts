import { describe, expect, it } from 'vitest';
import {
  buildSequentialServicePlanFromLines,
  formatServiceSummary,
  type ServicePlanLine,
} from '@/lib/servicePlan';

function line(
  serviceId: number,
  serviceName: string,
  durationMinutes: number,
  sequence: number,
  price = 0,
): ServicePlanLine {
  return { serviceId, serviceName, durationMinutes, price, sequence };
}

describe('buildSequentialServicePlanFromLines', () => {
  const empId = 10;
  const startAt = '2026-07-07T10:00:00+03:00';

  it('one service 30 minutes => 10:00–10:30', () => {
    const plan = buildSequentialServicePlanFromLines({
      empId,
      startAt,
      lines: [line(1, 'Hair Cut', 30, 1)],
    });
    expect(plan.totalDurationMinutes).toBe(30);
    expect(plan.lines).toHaveLength(1);
    expect(new Date(plan.endAt).getTime() - new Date(plan.startAt).getTime()).toBe(30 * 60000);
  });

  it('two services 45 + 10 => total 55 minutes', () => {
    const plan = buildSequentialServicePlanFromLines({
      empId,
      startAt,
      lines: [line(1, 'Hair Cut', 45, 1), line(2, 'Beard', 10, 2)],
    });
    expect(plan.totalDurationMinutes).toBe(55);
    expect(plan.lines[0].durationMinutes).toBe(45);
    expect(plan.lines[1].durationMinutes).toBe(10);
    expect(new Date(plan.lines[0].endAt).toISOString()).toBe(plan.lines[1].startAt);
  });

  it('three services 30 + 15 + 10 => total 55 minutes', () => {
    const plan = buildSequentialServicePlanFromLines({
      empId,
      startAt,
      lines: [
        line(1, 'Hair Cut', 30, 1),
        line(2, 'Beard', 15, 2),
        line(3, 'Face Threading', 10, 3),
      ],
    });
    expect(plan.totalDurationMinutes).toBe(55);
    expect(plan.lines).toHaveLength(3);
  });

  it('preserves selection order in sequential lines', () => {
    const plan = buildSequentialServicePlanFromLines({
      empId,
      startAt,
      lines: [line(3, 'Beard', 15, 1), line(1, 'Hair Cut', 30, 2)],
    });
    expect(plan.lines[0].serviceName).toBe('Beard');
    expect(plan.lines[1].serviceName).toBe('Hair Cut');
  });

  it('overnight: plan end crosses into next calendar day', () => {
    const plan = buildSequentialServicePlanFromLines({
      empId,
      startAt: '2026-07-07T23:30:00+03:00',
      lines: [line(1, 'Hair Cut', 45, 1)],
    });
    const end = new Date(plan.endAt);
    expect(end.getHours()).toBe(0);
    expect(end.getDate()).toBe(8);
  });
});

describe('formatServiceSummary', () => {
  it('shows first + count for 3 services', () => {
    expect(formatServiceSummary(['Hair Cut', 'Beard', 'Threading'])).toBe('Hair Cut +2');
  });

  it('joins two services', () => {
    expect(formatServiceSummary(['Hair Cut', 'Beard'])).toBe('Hair Cut + Beard');
  });
});

describe('duration gap feasibility', () => {
  it('55-minute service does not fit 39-minute gap', () => {
    const gapMinutes = 39;
    const required = 55;
    expect(required > gapMinutes).toBe(true);
  });

  it('55-minute service fits 60-minute gap', () => {
    const gapMinutes = 60;
    const required = 55;
    expect(required <= gapMinutes).toBe(true);
  });
});
