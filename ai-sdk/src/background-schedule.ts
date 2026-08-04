export type ParsedCron = {
  minute: ReadonlySet<number>;
  hour: ReadonlySet<number>;
  dayOfMonth: ReadonlySet<number>;
  month: ReadonlySet<number>;
  dayOfWeek: ReadonlySet<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
};

type CronField = { min: number; max: number; sunday?: boolean };
const FIELDS: CronField[] = [
  { min: 0, max: 59 }, { min: 0, max: 23 }, { min: 1, max: 31 }, { min: 1, max: 12 }, { min: 0, max: 7, sunday: true },
];

function fieldValue(raw: string, field: CronField) {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Cron value: ${raw}`);
  const value = Number(raw);
  if (value < field.min || value > field.max) throw new Error(`Cron value out of range: ${raw}`);
  return field.sunday && value === 7 ? 0 : value;
}

function parseField(source: string, field: CronField) {
  const values = new Set<number>();
  for (const part of source.split(",")) {
    if (!part) throw new Error("Cron field contains an empty list item");
    const [rangeSource, stepSource, extra] = part.split("/");
    if (extra !== undefined) throw new Error(`Invalid Cron step: ${part}`);
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) throw new Error(`Invalid Cron step: ${part}`);
    let start = field.min;
    let end = field.max;
    if (rangeSource !== "*") {
      const range = rangeSource.split("-");
      if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
      start = fieldValue(range[0], field);
      end = range.length === 2 ? fieldValue(range[1], field) : start;
      if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
      if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(field.sunday && value === 7 ? 0 : value);
  }
  return values;
}

export function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const parsed = parts.map((part, index) => parseField(part, FIELDS[index]));
  return {
    minute: parsed[0], hour: parsed[1], dayOfMonth: parsed[2], month: parsed[3], dayOfWeek: parsed[4],
    anyDayOfMonth: parts[2] === "*", anyDayOfWeek: parts[4] === "*",
  };
}

export function assertTimeZone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch (error) { throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error }); }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return { minute: value("minute"), hour: value("hour"), day: value("day"), month: value("month"), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "") };
}

export function cronMatches(parsed: ParsedCron, date: Date, timezone: string) {
  const value = zonedParts(date, timezone);
  const dayOfMonth = parsed.dayOfMonth.has(value.day);
  const dayOfWeek = parsed.dayOfWeek.has(value.weekday);
  const dayMatches = parsed.anyDayOfMonth ? dayOfWeek : parsed.anyDayOfWeek ? dayOfMonth : dayOfMonth || dayOfWeek;
  return parsed.minute.has(value.minute) && parsed.hour.has(value.hour) && parsed.month.has(value.month) && dayMatches;
}

export function nextCronOccurrence(expression: string | ParsedCron, timezone: string, after: Date, limitMinutes = 2 * 366 * 24 * 60) {
  assertTimeZone(timezone);
  const parsed = typeof expression === "string" ? parseCronExpression(expression) : expression;
  const cursor = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let index = 0; index < limitMinutes; index++, cursor.setTime(cursor.getTime() + 60_000)) {
    if (cronMatches(parsed, cursor, timezone)) return new Date(cursor);
  }
  throw new Error("Cron expression has no occurrence within the supported two-year window");
}


