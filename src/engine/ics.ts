import type { ISODate } from './dates';
import type { TimelineItem } from './timeline';

const LINE_LIMIT_OCTETS = 75;

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** UTF-8 byte length of one code point, computed without allocating. */
function octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  let limit = LINE_LIMIT_OCTETS;
  for (const char of line) {
    const bytes = octets(char.codePointAt(0) ?? 0);
    if (size + bytes > limit) {
      chunks.push(current);
      current = '';
      size = 0;
      limit = LINE_LIMIT_OCTETS - 1; // continuation lines start with one space
    }
    current += char;
    size += bytes;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

function compactDate(value: ISODate): string {
  return value.replaceAll('-', '');
}

/** All-day calendar events for every timeline item. `today` stamps the file; the clock is never read. */
export function buildIcs(
  calendarName: string,
  items: readonly TimelineItem[],
  today: ISODate,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//utsav AI//Event Planner//EN',
    'CALSCALE:GREGORIAN',
  ];
  lines.push(`X-WR-CALNAME:${escapeIcsText(calendarName)}`);
  for (const item of items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.kind}-${item.id}@utsav.local`,
      `DTSTAMP:${compactDate(today)}T000000Z`,
      `DTSTART;VALUE=DATE:${compactDate(item.dueISO)}`,
      `SUMMARY:${escapeIcsText(item.title)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
