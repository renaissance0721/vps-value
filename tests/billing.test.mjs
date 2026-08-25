import assert from "node:assert/strict";
import test from "node:test";

import {
  addCycle,
  calculateRecurringDue,
  countRenewalsInRange,
  getBillingPeriods
} from "../functions/billing.ts";

const periods = getBillingPeriods("2026-08-25");

test("builds natural month and year ranges", () => {
  assert.deepEqual(periods, {
    currentMonth: { start: "2026-08-01", endExclusive: "2026-09-01" },
    nextMonth: { start: "2026-09-01", endExclusive: "2026-10-01" },
    currentYear: { start: "2026-01-01", endExclusive: "2027-01-01" },
    nextYear: { start: "2027-01-01", endExclusive: "2028-01-01" }
  });
});

test("projects a monthly subscription through this year and next year", () => {
  assert.equal(
    calculateRecurringDue(100, "2026-08-30", 1, "month", periods.currentYear),
    500
  );
  assert.equal(
    calculateRecurringDue(100, "2026-08-30", 1, "month", periods.nextYear),
    1200
  );
});

test("projects annual and multi-year subscriptions across year boundaries", () => {
  assert.equal(countRenewalsInRange("2026-12-11", 1, "year", periods.currentYear), 1);
  assert.equal(countRenewalsInRange("2026-12-11", 1, "year", periods.nextYear), 1);
  assert.equal(countRenewalsInRange("2027-02-15", 1, "year", periods.currentYear), 0);
  assert.equal(countRenewalsInRange("2027-02-15", 1, "year", periods.nextYear), 1);
  assert.equal(countRenewalsInRange("2026-12-11", 2, "year", periods.nextYear), 0);
});

test("counts every weekly renewal in the target month", () => {
  assert.equal(countRenewalsInRange("2026-08-25", 7, "day", periods.currentMonth), 1);
  assert.equal(countRenewalsInRange("2026-08-25", 7, "day", periods.nextMonth), 5);
});

test("efficiently advances an old daily schedule into the target year", () => {
  assert.equal(countRenewalsInRange("2025-01-01", 1, "day", periods.currentYear), 365);
  assert.equal(countRenewalsInRange("2025-01-01", 1, "day", periods.nextYear), 365);
});

test("uses the same month-end clamping as the renew action", () => {
  const februaryDue = addCycle("2027-01-31", 1, "month");
  const marchDue = addCycle(februaryDue, 1, "month");

  assert.equal(februaryDue, "2027-02-28");
  assert.equal(marchDue, "2027-03-28");
});

test("rejects an invalid renewal interval", () => {
  assert.throws(
    () => countRenewalsInRange("2026-08-25", 0, "day", periods.currentMonth),
    /positive integer/
  );
});
