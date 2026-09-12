import { describe, expect, it } from 'vitest';
import { computeGanttBarColumns, parseIsoDate, isoDate } from '../src/main/mcp/office-tools-gantt';

function d(iso: string): Date {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(`bad test date: ${iso}`);
  return parsed;
}

function headerRange(startIso: string, endIso: string): Date[] {
  const start = d(startIso);
  const end = d(endIso);
  const dates: Date[] = [];
  for (
    const cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 1)
  ) {
    dates.push(new Date(cur));
  }
  return dates;
}

describe('computeGanttBarColumns', () => {
  const header = headerRange('2026-01-01', '2026-01-10'); // 10 days -> columns 2..11

  it('maps a task fully inside the header range', () => {
    expect(computeGanttBarColumns(header, d('2026-01-03'), d('2026-01-05'))).toEqual({
      startCol: 4,
      endCol: 6,
    });
  });

  it('maps a single-day task to one column', () => {
    expect(computeGanttBarColumns(header, d('2026-01-01'), d('2026-01-01'))).toEqual({
      startCol: 2,
      endCol: 2,
    });
  });

  it('maps a task spanning the entire header range', () => {
    expect(computeGanttBarColumns(header, d('2026-01-01'), d('2026-01-10'))).toEqual({
      startCol: 2,
      endCol: 11,
    });
  });

  it('clamps a task that starts before the header range', () => {
    expect(computeGanttBarColumns(header, d('2025-12-25'), d('2026-01-03'))).toEqual({
      startCol: 2,
      endCol: 4,
    });
  });

  it('clamps a task that ends after the header range', () => {
    expect(computeGanttBarColumns(header, d('2026-01-08'), d('2026-01-20'))).toEqual({
      startCol: 9,
      endCol: 11,
    });
  });

  it('returns null for a task entirely before the header range', () => {
    expect(computeGanttBarColumns(header, d('2025-12-01'), d('2025-12-31'))).toBeNull();
  });

  it('returns null for a task entirely after the header range', () => {
    expect(computeGanttBarColumns(header, d('2026-02-01'), d('2026-02-10'))).toBeNull();
  });

  it('returns null for an empty header', () => {
    expect(computeGanttBarColumns([], d('2026-01-01'), d('2026-01-05'))).toBeNull();
  });
});

describe('parseIsoDate / isoDate round-trip', () => {
  it('parses a valid YYYY-MM-DD string and round-trips it', () => {
    const parsed = parseIsoDate('2026-03-15');
    expect(parsed).not.toBeNull();
    expect(isoDate(parsed as Date)).toBe('2026-03-15');
  });

  it('rejects non-date-shaped input', () => {
    expect(parseIsoDate('not a date')).toBeNull();
    expect(parseIsoDate('2026/03/15')).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
    expect(parseIsoDate(42)).toBeNull();
  });
});
