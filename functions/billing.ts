export type CycleUnit = "day" | "month" | "year";

export interface DateRange {
  start: string;
  endExclusive: string;
}

export interface BillingPeriods {
  currentMonth: DateRange;
  nextMonth: DateRange;
  currentYear: DateRange;
  nextYear: DateRange;
}

const MILLISECONDS_PER_DAY = 86_400_000;

export function getBillingPeriods(todayDateOnly: string): BillingPeriods {
  const [year, month] = todayDateOnly.split("-").map(Number);
  const currentMonthStart = formatDateOnly(year, month, 1);
  const nextMonthStart = addMonths(currentMonthStart, 1);
  const followingMonthStart = addMonths(nextMonthStart, 1);
  const currentYearStart = formatDateOnly(year, 1, 1);
  const nextYearStart = formatDateOnly(year + 1, 1, 1);
  const followingYearStart = formatDateOnly(year + 2, 1, 1);

  return {
    currentMonth: { start: currentMonthStart, endExclusive: nextMonthStart },
    nextMonth: { start: nextMonthStart, endExclusive: followingMonthStart },
    currentYear: { start: currentYearStart, endExclusive: nextYearStart },
    nextYear: { start: nextYearStart, endExclusive: followingYearStart }
  };
}

export function calculateRecurringDue(
  cycleAmount: number,
  firstDueDate: string,
  cycleCount: number,
  cycleUnit: CycleUnit,
  range: DateRange
): number {
  return cycleAmount * countRenewalsInRange(
    firstDueDate,
    cycleCount,
    cycleUnit,
    range
  );
}

export function countRenewalsInRange(
  firstDueDate: string,
  cycleCount: number,
  cycleUnit: CycleUnit,
  range: DateRange
): number {
  if (!Number.isInteger(cycleCount) || cycleCount <= 0) {
    throw new RangeError("cycleCount must be a positive integer");
  }

  if (firstDueDate >= range.endExclusive) {
    return 0;
  }

  if (cycleUnit === "day") {
    return countDayRenewalsInRange(firstDueDate, cycleCount, range);
  }

  let dueDate = firstDueDate;
  while (dueDate < range.start) {
    dueDate = addCycle(dueDate, cycleCount, cycleUnit);
  }

  let renewalCount = 0;
  while (dueDate < range.endExclusive) {
    renewalCount += 1;
    dueDate = addCycle(dueDate, cycleCount, cycleUnit);
  }

  return renewalCount;
}

export function addCycle(dateOnly: string, count: number, unit: CycleUnit): string {
  if (unit === "day") {
    const date = parseDateOnly(dateOnly);
    date.setUTCDate(date.getUTCDate() + count);
    return toDateOnly(date);
  }

  return addMonths(dateOnly, unit === "month" ? count : count * 12);
}

function countDayRenewalsInRange(
  firstDueDate: string,
  cycleDays: number,
  range: DateRange
): number {
  const firstDueTime = parseDateOnly(firstDueDate).getTime();
  const rangeStartTime = parseDateOnly(range.start).getTime();
  const rangeEndTime = parseDateOnly(range.endExclusive).getTime();
  const cycleTime = cycleDays * MILLISECONDS_PER_DAY;
  const cyclesToRange = Math.max(0, Math.ceil((rangeStartTime - firstDueTime) / cycleTime));
  const firstDueInRange = firstDueTime + cyclesToRange * cycleTime;

  if (firstDueInRange >= rangeEndTime) {
    return 0;
  }

  return Math.ceil((rangeEndTime - firstDueInRange) / cycleTime);
}

function addMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  return formatDateOnly(targetYear, targetMonth, Math.min(day, maxDay));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
