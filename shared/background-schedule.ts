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
type CronRange = { start: number; end: number; step: number };

const FIELDS: CronField[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7, sunday: true },
];

function fieldValue(raw: string, field: CronField): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Cron value: ${raw}`);
  const value = Number(raw);
  if (value < field.min || value > field.max) throw new Error(`Cron value out of range: ${raw}`);
  return field.sunday && value === 7 ? 0 : value;
}

function parseStep(source: string | undefined, part: string, field: CronField): number {
  const step = source === undefined ? 1 : Number(source);
  if (!Number.isInteger(step) || step < 1 || step > field.max - field.min + 1) {
    throw new Error(`Invalid Cron step: ${part}`);
  }
  return step;
}

function parseRange(source: string, part: string, field: CronField, step: number): CronRange {
  if (source === "*") return { start: field.min, end: field.max, step };
  const range = source.split("-");
  if (range.length > 2) throw new Error(`Invalid Cron range: ${part}`);
  const start = fieldValue(range[0], field);
  let end = range.length === 2 ? fieldValue(range[1], field) : start;
  if (field.sunday && range.length === 2 && range[1] === "7") end = 7;
  if (start > end) throw new Error(`Descending Cron range is not supported: ${part}`);
  return { start, end, step };
}

function parsePart(part: string, field: CronField): CronRange {
  if (!part) throw new Error("Cron field contains an empty list item");
  const [rangeSource, stepSource, extra] = part.split("/");
  if (extra !== undefined) throw new Error(`Invalid Cron step: ${part}`);
  return parseRange(rangeSource, part, field, parseStep(stepSource, part, field));
}

function addRange(values: Set<number>, range: CronRange, field: CronField): void {
  for (let value = range.start; value <= range.end; value += range.step) {
    values.add(field.sunday && value === 7 ? 0 : value);
  }
}

function parseField(source: string, field: CronField): ReadonlySet<number> {
  const values = new Set<number>();
  for (const part of source.split(",")) addRange(values, parsePart(part, field), field);
  return values;
}

export function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const parsed = parts.map((part, index) => parseField(part, FIELDS[index]));
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    anyDayOfMonth: parts[2] === "*",
    anyDayOfWeek: parts[4] === "*",
  };
}

export function assertTimeZone(timezone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch (error) { throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error }); }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return {
    minute: value("minute"),
    hour: value("hour"),
    day: value("day"),
    month: value("month"),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? ""),
  };
}

export function cronMatches(parsed: ParsedCron, date: Date, timezone: string): boolean {
  const value = zonedParts(date, timezone);
  const dayOfMonth = parsed.dayOfMonth.has(value.day);
  const dayOfWeek = parsed.dayOfWeek.has(value.weekday);
  const dayMatches = parsed.anyDayOfMonth ? dayOfWeek : parsed.anyDayOfWeek ? dayOfMonth : dayOfMonth || dayOfWeek;
  return parsed.minute.has(value.minute) && parsed.hour.has(value.hour) && parsed.month.has(value.month) && dayMatches;
}

export function nextCronOccurrence(
  expression: string | ParsedCron,
  timezone: string,
  after: Date,
  limitMinutes = 2 * 366 * 24 * 60,
): Date {
  assertTimeZone(timezone);
  const parsed = typeof expression === "string" ? parseCronExpression(expression) : expression;
  const cursor = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let index = 0; index < limitMinutes; index++, cursor.setTime(cursor.getTime() + 60_000)) {
    if (cronMatches(parsed, cursor, timezone)) return new Date(cursor);
  }
  throw new Error("Cron expression has no occurrence within the supported two-year window");
}
