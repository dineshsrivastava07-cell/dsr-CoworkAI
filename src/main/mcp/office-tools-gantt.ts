/**
 * Pure date/column math for the Gantt-chart visual in office-tools-server.ts.
 * Kept in its own side-effect-free module (rather than in office-tools-server.ts
 * itself, which calls serveStdio() at module load) so it can be unit tested
 * with a direct import.
 */

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Maps a task's [start, end] date span onto column indices within a Gantt
 * sheet's day-by-day header (column 1 is the task-name column, so header day 0
 * lives in column 2). Clamps a partially-overlapping task to the header's
 * actual bounds; returns null if the task falls entirely outside the header
 * range.
 */
export function computeGanttBarColumns(
  headerDates: Date[],
  taskStart: Date,
  taskEnd: Date
): { startCol: number; endCol: number } | null {
  if (headerDates.length === 0) return null;
  const first = headerDates[0].getTime();
  const last = headerDates[headerDates.length - 1].getTime();
  const start = taskStart.getTime();
  const end = taskEnd.getTime();
  if (end < first || start > last) return null;
  const clampedStart = Math.max(start, first);
  const clampedEnd = Math.min(end, last);
  let startIdx = headerDates.findIndex((d) => d.getTime() >= clampedStart);
  if (startIdx === -1) startIdx = headerDates.length - 1;
  let endIdx = 0;
  for (let i = headerDates.length - 1; i >= 0; i--) {
    if (headerDates[i].getTime() <= clampedEnd) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < startIdx) return null;
  return { startCol: startIdx + 2, endCol: endIdx + 2 };
}
