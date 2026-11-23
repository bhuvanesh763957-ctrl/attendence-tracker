export interface ShiftTiming {
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  gracePeriodMinutes: number;
  breakMinutes: number;
  halfDayHours: number;
  overtimeThresholdHours: number;
  isOvernight?: boolean;
  timezone?: string;
}

export interface BreakSegment {
  minutes: number;
  label?: string;
  loggedAt: string;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function getDateInTimeZone(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function getMinutesOfDayInTimeZone(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE
): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? date.getUTCHours()) % 24;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? date.getUTCMinutes());
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

export function getDayOfWeekFromDateStr(dateStr: string): number {
  const dt = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(dt.getTime()) ? 1 : dt.getUTCDay();
}

export function isWeekendDate(dateStr: string, weekendDaysCsv: string = '0,6'): boolean {
  const day = getDayOfWeekFromDateStr(dateStr);
  const weekendSet = new Set(
    weekendDaysCsv
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n))
  );
  return weekendSet.has(day);
}

/**
 * Converts a YYYY-MM-DD + HH:mm pair in a target timezone (default Asia/Kolkata +05:30)
 * into a UTC Date object accurately.
 */
export function buildDateFromZonedTime(
  dateStr: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIMEZONE
): Date {
  const cleanTime = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  if (timeZone === 'Asia/Kolkata') {
    return new Date(`${dateStr}T${cleanTime}+05:30`);
  }
  const probe = new Date(`${dateStr}T${cleanTime}Z`);
  try {
    const tzText = probe.toLocaleString('en-US', { timeZone: 'UTC' });
    const zonedText = probe.toLocaleString('en-US', { timeZone });
    const diff = new Date(tzText).getTime() - new Date(zonedText).getTime();
    return new Date(probe.getTime() + diff);
  } catch {
    return probe;
  }
}

export function parseHhmmToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 9 * 60;
  return h * 60 + m;
}

export function parseBreaksJson(raw: string | null | undefined): BreakSegment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function evaluateCheckIn(
  checkIn: Date,
  shift: ShiftTiming,
  requestedMode: 'Web' | 'QR' | 'Geolocation' | 'WFH' | 'Manual',
  options?: { isHoliday?: boolean; isWeeklyOff?: boolean }
): {
  isLate: boolean;
  arrivalDelayMinutes: number;
  status: string;
  anomalyFlag: string | null;
} {
  const tz = shift.timezone || DEFAULT_TIMEZONE;
  const shiftStartMins = parseHhmmToMinutes(shift.startTime);
  const shiftEndMins = parseHhmmToMinutes(shift.endTime);
  const isOvernight = Boolean(shift.isOvernight) || shiftEndMins <= shiftStartMins;

  let checkInMins = getMinutesOfDayInTimeZone(checkIn, tz);
  // If overnight shift starts late at night (e.g. 22:00) and check-in happens just after midnight (e.g. 00:15)
  if (isOvernight && checkInMins < 12 * 60 && shiftStartMins >= 12 * 60) {
    checkInMins += 24 * 60;
  }

  const rawDelay = Math.max(0, checkInMins - shiftStartMins);
  const isLate = rawDelay > shift.gracePeriodMinutes;

  let status = isLate ? 'Late' : 'Present';
  if (requestedMode === 'WFH') {
    status = 'Work From Home';
  }

  let anomalyFlag: string | null = null;
  if (options?.isHoliday) {
    anomalyFlag = 'Checked in on institutional holiday';
  } else if (options?.isWeeklyOff) {
    anomalyFlag = 'Checked in on weekly off';
  } else if (checkInMins < shiftStartMins - 180) {
    anomalyFlag = 'Unusually early check-in (>3h before shift)';
  } else if (rawDelay > 180) {
    anomalyFlag = 'Severely delayed arrival (>3h past shift start)';
  }

  return { isLate, arrivalDelayMinutes: rawDelay, status, anomalyFlag };
}

export function evaluateCheckOut(
  checkIn: Date,
  checkOut: Date,
  breakMinutes: number,
  shift: ShiftTiming,
  currentStatus: string
): {
  workingMinutes: number;
  overtimeMinutes: number;
  earlyDepartureMinutes: number;
  isEarlyDeparture: boolean;
  resolvedStatus: string;
  anomalyFlag: string | null;
} {
  const tz = shift.timezone || DEFAULT_TIMEZONE;
  const rawElapsed = Math.max(
    0,
    Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)
  );
  const effectiveBreak = Math.min(rawElapsed, Math.max(0, breakMinutes));
  const workingMinutes = Math.max(0, rawElapsed - effectiveBreak);

  const overtimeThresholdMins = shift.overtimeThresholdHours * 60;
  const overtimeMinutes = Math.max(0, workingMinutes - overtimeThresholdMins);

  const shiftStartMins = parseHhmmToMinutes(shift.startTime);
  let shiftEndMins = parseHhmmToMinutes(shift.endTime);
  const isOvernight = Boolean(shift.isOvernight) || shiftEndMins <= shiftStartMins;
  if (isOvernight) {
    shiftEndMins += 24 * 60;
  }

  const checkInMins = getMinutesOfDayInTimeZone(checkIn, tz);
  let checkOutMins = getMinutesOfDayInTimeZone(checkOut, tz);
  if (isOvernight || checkOutMins < checkInMins) {
    checkOutMins += 24 * 60;
  }

  const earlyDepartureMinutes = Math.max(0, shiftEndMins - checkOutMins);
  const isEarlyDeparture = earlyDepartureMinutes > 15;

  const halfDayMaxMins = shift.halfDayHours * 60;
  let resolvedStatus = currentStatus;
  if (
    workingMinutes > 0 &&
    workingMinutes < halfDayMaxMins &&
    currentStatus !== 'Work From Home'
  ) {
    resolvedStatus = 'Half Day';
  }

  let anomalyFlag: string | null = null;
  if (workingMinutes > 12 * 60) {
    anomalyFlag = 'Extended shift duration (>12h logged)';
  }

  return {
    workingMinutes,
    overtimeMinutes,
    earlyDepartureMinutes,
    isEarlyDeparture,
    resolvedStatus,
    anomalyFlag,
  };
}

export function calculateDateRangeDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return result;
  }
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 60) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return result;
}
