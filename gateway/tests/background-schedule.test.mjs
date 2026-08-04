import assert from "node:assert/strict";
import test from "node:test";
import { assertTimeZone, cronMatches, nextCronOccurrence, parseCronExpression } from "../src/background-schedule.ts";

test("parses strict five-field Cron expressions and Sunday aliases", () => {
  const parsed = parseCronExpression("*/15 9-17 * * 1-5,7");
  assert.deepEqual([...parsed.minute], [0, 15, 30, 45]);
  assert.equal(parsed.dayOfWeek.has(0), true);
  assert.equal(parsed.dayOfWeek.has(6), false);
  assert.throws(() => parseCronExpression("0 9 * *"), /five fields/);
  assert.throws(() => parseCronExpression("60 9 * * *"), /out of range/);
  assert.throws(() => parseCronExpression("0 9 * * MON"), /Invalid Cron value/);
});

test("calculates occurrences in the declared IANA timezone", () => {
  const next = nextCronOccurrence("0 9 * * 1-5", "Asia/Shanghai", new Date("2026-08-02T12:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-08-03T01:00:00.000Z");
  assert.equal(cronMatches(parseCronExpression("0 9 * * 1-5"), next, "Asia/Shanghai"), true);
  assert.throws(() => assertTimeZone("Mars/Olympus"), /Invalid IANA timezone/);
});

test("skips nonexistent local times across daylight-saving transitions", () => {
  const next = nextCronOccurrence("30 2 * * *", "America/New_York", new Date("2026-03-08T05:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-03-09T06:30:00.000Z");
});

