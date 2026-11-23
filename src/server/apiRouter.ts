import crypto from 'node:crypto';
import express, { Response } from 'express';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  attendance,
  attendanceCorrections,
  attendancePolicies,
  auditLogs,
  departments,
  employees,
  holidays,
  leaveRequests,
  notifications,
  qrSessions,
  shifts,
  users,
} from '../db/schema.ts';
import { isOwnerEmail, sanitizeDbUser } from '../db/users.ts';
import { logAuditEvent } from '../lib/audit.ts';
import {
  buildDateFromZonedTime,
  calculateDateRangeDays,
  DEFAULT_TIMEZONE,
  enumerateDates,
  evaluateCheckIn,
  evaluateCheckOut,
  getDateInTimeZone,
  isWeekendDate,
  parseBreaksJson,
  ShiftTiming,
} from '../lib/attendanceCalc.ts';
import {
  announcementCreateSchema,
  breakSchema,
  checkInSchema,
  checkOutSchema,
  correctionCreateSchema,
  departmentCreateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  holidayCreateSchema,
  leaveCreateSchema,
  markAttendanceSchema,
  normalizeAttendanceStatus,
  policyUpdateSchema,
  qrSessionCreateSchema,
  reviewDecisionSchema,
  shiftCreateSchema,
  updateAttendanceSchema,
  userRoleUpdateSchema,
} from '../lib/validation.ts';
import {
  AuthRequest,
  isStaffSelfRole,
  requireAuth,
  requireRole,
  UserRole,
} from '../middleware/auth.ts';

export const apiRouter = express.Router();

apiRouter.use(requireAuth);

function todayStr(tz: string = DEFAULT_TIMEZONE): string {
  return getDateInTimeZone(new Date(), tz);
}

function getPgErrorCode(error: unknown): string | undefined {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code || err?.cause?.code;
}

function handleApiError(res: Response, error: unknown, message: string) {
  const code = getPgErrorCode(error);
  if (code === '23505') {
    return res.status(409).json({ error: message });
  }
  if (code === '23503') {
    return res.status(400).json({ error: 'Referenced department, shift, or member does not exist.' });
  }
  console.error(message, error);
  res.status(500).json({ error: message });
}

async function getActivePolicy() {
  const rows = await db.select().from(attendancePolicies).limit(1);
  return rows[0] ?? null;
}

async function getEmployeeShiftOrDefault(
  shiftId: number | null | undefined,
  policy: Awaited<ReturnType<typeof getActivePolicy>>,
  tz: string
): Promise<ShiftTiming> {
  if (shiftId) {
    const shiftRows = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
    if (shiftRows[0]) return shiftRows[0];
  }
  return {
    startTime: policy?.workdayStart ?? '09:00',
    endTime: policy?.workdayEnd ?? '17:30',
    gracePeriodMinutes: policy?.graceMinutes ?? 15,
    breakMinutes: 45,
    halfDayHours: policy?.halfDayMinHours ?? 4,
    overtimeThresholdHours: policy?.overtimeAfterHours ?? 8,
    isOvernight: false,
    timezone: tz,
  };
}

async function getTargetUserUid(employeeId: number | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const rows = await db
    .select({ uid: users.uid })
    .from(users)
    .where(eq(users.employeeId, employeeId))
    .limit(1);
  return rows[0]?.uid ?? null;
}

// ---------------------------------------------------------------------------
// 1. Current Authenticated Profile & Role Management
// ---------------------------------------------------------------------------
apiRouter.get('/me', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const policy = await getActivePolicy();
    const linkedEmployee = dbUser.employeeId
      ? (await db.select().from(employees).where(eq(employees.id, dbUser.employeeId)).limit(1))[0] ?? null
      : null;

    res.json({
      user: dbUser,
      employee: linkedEmployee,
      policy,
      canSwitchTestRole: isOwnerEmail(dbUser.email),
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to load authenticated profile.');
  }
});

// Allows the verified workspace owner to switch between roles to test RBAC permissions
apiRouter.post('/me/test-role', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    if (!isOwnerEmail(dbUser.email)) {
      return res.status(403).json({ error: 'Only the workspace owner can switch test roles.' });
    }

    const { role } = req.body as { role?: string };
    const allowed: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE', 'STUDENT'];
    if (!role || !allowed.includes(role as UserRole)) {
      return res.status(400).json({ error: 'Invalid role specified.' });
    }

    let managedDepartmentId: number | null = null;
    if (role === 'MANAGER') {
      const firstDept = await db.select().from(departments).limit(1);
      managedDepartmentId = firstDept[0]?.id ?? null;
    }

    const updated = await db
      .update(users)
      .set({ role, managedDepartmentId, updatedAt: new Date() })
      .where(eq(users.id, dbUser.id))
      .returning();

    res.json({ user: sanitizeDbUser(updated[0]) });
  } catch (error) {
    handleApiError(res, error, 'Failed to switch role.');
  }
});

apiRouter.get('/users', requireRole('ADMIN'), async (_req: AuthRequest, res) => {
  try {
    const list = await db.select().from(users).orderBy(desc(users.createdAt));
    res.json({ users: list.map(sanitizeDbUser) });
  } catch (error) {
    handleApiError(res, error, 'Failed to load user accounts.');
  }
});

apiRouter.patch('/users/:id/role', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    const parsed = userRoleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid role payload.' });
    }
    const { role, managedDepartmentId, status } = parsed.data;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (role) {
      updates.role = role;
      updates.managedDepartmentId = role === 'MANAGER' ? managedDepartmentId ?? null : null;
    } else if (managedDepartmentId !== undefined) {
      updates.managedDepartmentId = managedDepartmentId;
    }
    if (status) {
      updates.status = status;
    }

    const updated = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, targetId))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'USER_ROLE_UPDATED',
      resourceType: 'user',
      resourceId: targetId,
      ipAddress: req.ip,
      metadata: { role, managedDepartmentId, status },
    });

    res.json({ user: sanitizeDbUser(updated[0]) });
  } catch (error) {
    handleApiError(res, error, 'Failed to update user role.');
  }
});

// ---------------------------------------------------------------------------
// 2. Dashboard Analytics & Anomalies
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard/employee', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    if (!dbUser.employeeId) {
      return res.status(404).json({ error: 'No employee or student profile linked to your account.' });
    }

    const policy = await getActivePolicy();
    const tz = policy?.timezone || DEFAULT_TIMEZONE;
    const today = todayStr(tz);
    const monthStart = `${today.slice(0, 7)}-01`;

    const empRows = await db
      .select()
      .from(employees)
      .where(eq(employees.id, dbUser.employeeId))
      .limit(1);
    const emp = empRows[0];
    if (!emp) return res.status(404).json({ error: 'Profile not found.' });

    const monthLogs = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, emp.id), gte(attendance.date, monthStart)))
      .orderBy(desc(attendance.date));

    const todayRecord = monthLogs.find((r) => r.date === today) ?? null;
    const presentDays = monthLogs.filter((r) =>
      ['Present', 'Late', 'Work From Home', 'Half Day'].includes(r.status)
    ).length;
    const totalWorkingMinutes = monthLogs.reduce((sum, r) => sum + r.workingMinutes, 0);
    const totalOvertimeMinutes = monthLogs.reduce((sum, r) => sum + r.overtimeMinutes, 0);
    const attendancePct =
      monthLogs.length > 0 ? Math.round((presentDays / monthLogs.length) * 1000) / 10 : 0;

    res.json({
      employee: emp,
      todayRecord,
      monthSummary: {
        daysLogged: monthLogs.length,
        presentDays,
        lateDays: monthLogs.filter((r) => r.isLate || r.status === 'Late').length,
        totalWorkingHours: Math.round((totalWorkingMinutes / 60) * 10) / 10,
        totalOvertimeHours: Math.round((totalOvertimeMinutes / 60) * 10) / 10,
        attendancePct,
      },
      leaveBalances: {
        casual: emp.casualLeaveBalance,
        sick: emp.sickLeaveBalance,
        earned: emp.earnedLeaveBalance,
        personal: emp.personalLeaveBalance,
        emergency: emp.emergencyLeaveBalance,
      },
      recentLogs: monthLogs.slice(0, 15),
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to load employee dashboard.');
  }
});

apiRouter.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const policy = await getActivePolicy();
    const tz = policy?.timezone || DEFAULT_TIMEZONE;
    const today = todayStr(tz);

    const allDepts = await db.select().from(departments).orderBy(departments.name);
    const allEmps = await db.select().from(employees).where(eq(employees.status, 'active'));

    // Scope employees for MANAGER or EMPLOYEE/STUDENT
    const scopedEmps =
      dbUser.role === 'MANAGER' && dbUser.managedDepartmentId
        ? allEmps.filter((e) => e.departmentId === dbUser.managedDepartmentId)
        : isStaffSelfRole(dbUser.role) && dbUser.employeeId
          ? allEmps.filter((e) => e.id === dbUser.employeeId)
          : allEmps;

    const scopedIds = new Set(scopedEmps.map((e) => e.id));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    const monthMinDate = getDateInTimeZone(thirtyDaysAgo, tz);

    const monthAttendance = (
      await db
        .select()
        .from(attendance)
        .where(gte(attendance.date, monthMinDate))
        .orderBy(desc(attendance.date))
    ).filter((row) => scopedIds.has(row.employeeId));

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
    const minDate = getDateInTimeZone(fourteenDaysAgo, tz);

    const recentAttendance = monthAttendance.filter((row) => row.date >= minDate);

    const todayRecords = recentAttendance.filter((r) => r.date === today);

    const totalCount = scopedEmps.length;
    const presentCount = todayRecords.filter(
      (r) =>
        r.status === 'Present' ||
        r.status === 'Late' ||
        r.status === 'Work From Home' ||
        r.status === 'Half Day'
    ).length;
    const lateCount = todayRecords.filter((r) => r.isLate || r.status === 'Late').length;
    const onLeaveCount = todayRecords.filter((r) => r.status === 'On Leave').length;
    const explicitAbsent = todayRecords.filter((r) => r.status === 'Absent').length;
    const absentCount = Math.max(explicitAbsent, totalCount - presentCount - onLeaveCount);
    const attendancePct =
      totalCount > 0 ? Math.round((presentCount / totalCount) * 1000) / 10 : 0;

    // Weekly trend (last 7 days in active timezone)
    const datesMap = new Map<
      string,
      { date: string; present: number; late: number; absent: number; wfh: number; onLeave: number }
    >();
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const iso = getDateInTimeZone(d, tz);
      datesMap.set(iso, {
        date: iso,
        present: 0,
        late: 0,
        absent: 0,
        wfh: 0,
        onLeave: 0,
      });
    }

    for (const rec of recentAttendance) {
      const bucket = datesMap.get(rec.date);
      if (!bucket) continue;
      if (rec.status === 'Present' || rec.status === 'Half Day') bucket.present++;
      else if (rec.status === 'Late') bucket.late++;
      else if (rec.status === 'Work From Home') bucket.wfh++;
      else if (rec.status === 'On Leave') bucket.onLeave++;
      else if (rec.status === 'Absent') bucket.absent++;
    }

    // Monthly 30-day attendance rollup
    const monthlyMap = new Map<
      string,
      { date: string; present: number; late: number; absent: number; onLeave: number }
    >();
    for (let offset = 29; offset >= 0; offset--) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const iso = getDateInTimeZone(d, tz);
      monthlyMap.set(iso, { date: iso, present: 0, late: 0, absent: 0, onLeave: 0 });
    }
    for (const rec of monthAttendance) {
      const mBucket = monthlyMap.get(rec.date);
      if (!mBucket) continue;
      if (['Present', 'Half Day', 'Work From Home'].includes(rec.status)) mBucket.present++;
      else if (rec.status === 'Late') mBucket.late++;
      else if (rec.status === 'On Leave') mBucket.onLeave++;
      else if (rec.status === 'Absent') mBucket.absent++;
    }

    // Department-wise comparison
    const deptStats = allDepts
      .filter((dept) =>
        dbUser.role === 'MANAGER' && dbUser.managedDepartmentId
          ? dept.id === dbUser.managedDepartmentId
          : true
      )
      .map((dept) => {
        const deptEmps = allEmps.filter((e) => e.departmentId === dept.id);
        const deptIds = new Set(deptEmps.map((e) => e.id));
        const deptToday = todayRecords.filter((r) => deptIds.has(r.employeeId));
        const deptPresent = deptToday.filter((r) =>
          ['Present', 'Late', 'Work From Home', 'Half Day'].includes(r.status)
        ).length;
        const pct =
          deptEmps.length > 0 ? Math.round((deptPresent / deptEmps.length) * 100) : 0;
        return {
          department: dept.name,
          code: dept.code,
          headcount: deptEmps.length,
          present: deptPresent,
          absent: Math.max(0, deptEmps.length - deptPresent),
          attendancePct: pct,
          targetPct: dept.targetAttendancePct,
        };
      });

    // Status distribution across recent 14 days
    const statusCounts: Record<string, number> = {
      Present: 0,
      Late: 0,
      'Work From Home': 0,
      'Half Day': 0,
      'On Leave': 0,
      Absent: 0,
    };
    for (const r of recentAttendance) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }

    // Employee performance overview (punctuality + avg hours)
    const empById = new Map(scopedEmps.map((e) => [e.id, e]));
    const perfMap = new Map<
      number,
      {
        employeeId: number;
        code: string;
        fullName: string;
        designation: string;
        daysLogged: number;
        presentDays: number;
        lateDays: number;
        totalWorkingMins: number;
        overtimeMins: number;
      }
    >();

    for (const emp of scopedEmps) {
      perfMap.set(emp.id, {
        employeeId: emp.id,
        code: emp.code,
        fullName: emp.fullName,
        designation: emp.designation,
        daysLogged: 0,
        presentDays: 0,
        lateDays: 0,
        totalWorkingMins: 0,
        overtimeMins: 0,
      });
    }

    for (const rec of recentAttendance) {
      const p = perfMap.get(rec.employeeId);
      if (!p) continue;
      p.daysLogged++;
      if (['Present', 'Late', 'Work From Home', 'Half Day'].includes(rec.status)) {
        p.presentDays++;
      }
      if (rec.isLate || rec.status === 'Late') p.lateDays++;
      p.totalWorkingMins += rec.workingMinutes;
      p.overtimeMins += rec.overtimeMinutes;
    }

    const performanceOverview = Array.from(perfMap.values()).slice(0, 8);

    // Real anomaly detection
    const anomalies = recentAttendance
      .filter((r) => Boolean(r.anomalyFlag) || (r.date < today && r.checkInTime && !r.checkOutTime))
      .slice(0, 8)
      .map((r) => {
        const emp = empById.get(r.employeeId);
        return {
          id: r.id,
          date: r.date,
          employeeName: emp?.fullName ?? 'Staff Member',
          employeeCode: emp?.code ?? '',
          flag: r.anomalyFlag || 'Missing check-out from prior shift',
          status: r.status,
        };
      });

    // Pending leaves & corrections count
    const pendingLeavesRes = await db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.status, 'Pending'));
    const pendingCorrectionsRes = await db
      .select()
      .from(attendanceCorrections)
      .where(eq(attendanceCorrections.status, 'Pending'));

    res.json({
      kpis: {
        totalMembers: totalCount,
        presentToday: presentCount,
        absentToday: absentCount,
        lateArrivals: lateCount,
        onLeave: onLeaveCount,
        attendancePct,
      },
      weeklyTrend: Array.from(datesMap.values()),
      monthlyTrend: Array.from(monthlyMap.values()),
      departmentStats: deptStats,
      statusDistribution: Object.entries(statusCounts)
        .filter(([, count]) => count > 0)
        .map(([name, value]) => ({ name, value })),
      performanceOverview,
      anomalies,
      pendingApprovals: {
        leaves: pendingLeavesRes.filter((l) => scopedIds.has(l.employeeId)).length,
        corrections: pendingCorrectionsRes.filter((c) => scopedIds.has(c.employeeId)).length,
      },
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to load dashboard overview.');
  }
});

// ---------------------------------------------------------------------------
// 3. Departments & Shifts
// ---------------------------------------------------------------------------
apiRouter.get('/departments', async (_req: AuthRequest, res) => {
  try {
    const list = await db.select().from(departments).orderBy(departments.name);
    res.json({ departments: list });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch departments.');
  }
});

apiRouter.post('/departments', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const parsed = departmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid department details.' });
    }
    const { name, code, description, managerName, targetAttendancePct } = parsed.data;

    const created = await db
      .insert(departments)
      .values({
        name,
        code: code.toUpperCase(),
        description,
        managerName,
        targetAttendancePct,
      })
      .returning();

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'DEPARTMENT_CREATED',
      resourceType: 'department',
      resourceId: created[0].id,
      ipAddress: req.ip,
      metadata: { code: created[0].code, name: created[0].name },
    });

    res.status(201).json({ department: created[0] });
  } catch (error) {
    handleApiError(res, error, 'Department name and code must be unique.');
  }
});

apiRouter.get('/shifts', async (_req: AuthRequest, res) => {
  try {
    const list = await db.select().from(shifts).orderBy(shifts.startTime);
    res.json({ shifts: list });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch shifts.');
  }
});

apiRouter.post('/shifts', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const parsed = shiftCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid shift settings.' });
    }
    const data = parsed.data;

    const created = await db
      .insert(shifts)
      .values({
        name: data.name,
        startTime: data.startTime,
        endTime: data.endTime,
        gracePeriodMinutes: data.gracePeriodMinutes,
        breakMinutes: data.breakMinutes,
        halfDayHours: data.halfDayHours,
        overtimeThresholdHours: data.overtimeThresholdHours,
        isOvernight: data.isOvernight,
        timezone: data.timezone || DEFAULT_TIMEZONE,
      })
      .returning();

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'SHIFT_CREATED',
      resourceType: 'shift',
      resourceId: created[0].id,
      ipAddress: req.ip,
      metadata: { name: created[0].name, window: `${created[0].startTime}-${created[0].endTime}` },
    });

    res.status(201).json({ shift: created[0] });
  } catch (error) {
    handleApiError(res, error, 'Shift name must be unique.');
  }
});

// ---------------------------------------------------------------------------
// 4. Employees / Students Management
// ---------------------------------------------------------------------------
apiRouter.get('/employees', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const allDepts = await db.select().from(departments);
    const allShifts = await db.select().from(shifts);
    const deptMap = new Map(allDepts.map((d) => [d.id, d]));
    const shiftMap = new Map(allShifts.map((s) => [s.id, s]));

    let rows = await db.select().from(employees).orderBy(employees.code);

    if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
      rows = rows.filter((e) => e.departmentId === dbUser.managedDepartmentId);
    } else if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
      rows = rows.filter((e) => e.id === dbUser.employeeId);
    }

    const enriched = rows.map((e) => ({
      ...e,
      departmentName: deptMap.get(e.departmentId)?.name ?? 'General',
      departmentCode: deptMap.get(e.departmentId)?.code ?? '',
      shiftName: shiftMap.get(e.shiftId)?.name ?? 'Core Shift',
      shiftWindow: shiftMap.get(e.shiftId)
        ? `${shiftMap.get(e.shiftId)!.startTime}–${shiftMap.get(e.shiftId)!.endTime}`
        : '',
    }));

    res.json({ employees: enriched });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch directory records.');
  }
});

apiRouter.post('/employees', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const parsed = employeeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'All required employee/student fields must be valid.' });
    }
    const data = parsed.data;

    const created = await db
      .insert(employees)
      .values({
        code: data.code.toUpperCase(),
        fullName: data.fullName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        departmentId: data.departmentId,
        shiftId: data.shiftId,
        designation: data.designation,
        memberType: data.memberType,
        joiningDate: data.joiningDate || todayStr(),
        status: 'active',
      })
      .returning();

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'EMPLOYEE_CREATED',
      resourceType: 'employee',
      resourceId: created[0].id,
      ipAddress: req.ip,
      metadata: { code: created[0].code, email: created[0].email },
    });

    res.status(201).json({ employee: created[0] });
  } catch (error) {
    handleApiError(res, error, 'Member ID and email must be unique.');
  }
});

apiRouter.patch('/employees/:id', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid employee ID.' });
    }

    const parsed = employeeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload.' });
    }
    const data = parsed.data;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.fullName !== undefined) updates.fullName = data.fullName;
    if (data.email !== undefined) updates.email = data.email.toLowerCase();
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.departmentId !== undefined) updates.departmentId = data.departmentId;
    if (data.shiftId !== undefined) updates.shiftId = data.shiftId;
    if (data.designation !== undefined) updates.designation = data.designation;
    if (data.memberType !== undefined) updates.memberType = data.memberType;
    if (data.joiningDate !== undefined) updates.joiningDate = data.joiningDate;
    if (data.status !== undefined) updates.status = data.status;

    const updated = await db
      .update(employees)
      .set(updates)
      .where(eq(employees.id, id))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'EMPLOYEE_UPDATED',
      resourceType: 'employee',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ employee: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Email or member profile conflict while updating record.');
  }
});

apiRouter.delete('/employees/:id', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid employee ID.' });
    }

    const mode = req.query.mode;
    if (mode === 'permanent') {
      const deleted = await db.delete(employees).where(eq(employees.id, id)).returning();
      if (deleted.length === 0) return res.status(404).json({ error: 'Record not found.' });
      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: 'EMPLOYEE_DELETED',
        resourceType: 'employee',
        resourceId: id,
        ipAddress: req.ip,
        metadata: { code: deleted[0].code },
      });
      return res.json({ deleted: true, id });
    }

    const updated = await db
      .update(employees)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();

    if (updated.length === 0) return res.status(404).json({ error: 'Record not found.' });
    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'EMPLOYEE_DEACTIVATED',
      resourceType: 'employee',
      resourceId: id,
      ipAddress: req.ip,
    });
    res.json({ employee: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to deactivate or remove record.');
  }
});

apiRouter.get('/employees/:id/history', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid ID.' });
    }

    const dbUser = req.dbUser!;
    if (isStaffSelfRole(dbUser.role) && dbUser.employeeId !== id) {
      return res.status(403).json({ error: 'Members can only view their own profile history.' });
    }

    const empRows = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const emp = empRows[0];
    if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId && emp.departmentId !== dbUser.managedDepartmentId) {
      return res.status(403).json({ error: 'Managers can only view records inside their assigned department.' });
    }

    const records = await db
      .select()
      .from(attendance)
      .where(eq(attendance.employeeId, id))
      .orderBy(desc(attendance.date))
      .limit(45);

    const leaves = await db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.employeeId, id))
      .orderBy(desc(leaveRequests.createdAt));

    res.json({ employee: emp, attendance: records, leaves });
  } catch (error) {
    handleApiError(res, error, 'Failed to load profile history.');
  }
});

// ---------------------------------------------------------------------------
// 5. Smart Attendance Tracking (Check-In / Out / Break / Manual / QR / Geo / WFH)
// ---------------------------------------------------------------------------
apiRouter.get('/attendance', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const { date, startDate, endDate, status, departmentId, employeeId } = req.query as Record<
      string,
      string | undefined
    >;

    const allEmps = await db.select().from(employees);
    const allDepts = await db.select().from(departments);
    const allShifts = await db.select().from(shifts);

    const empMap = new Map(allEmps.map((e) => [e.id, e]));
    const deptMap = new Map(allDepts.map((d) => [d.id, d]));
    const shiftMap = new Map(allShifts.map((s) => [s.id, s]));

    const conditions = [];
    if (date) conditions.push(eq(attendance.date, date));
    if (startDate) conditions.push(gte(attendance.date, startDate));
    if (endDate) conditions.push(lte(attendance.date, endDate));
    if (status && status !== 'ALL') conditions.push(eq(attendance.status, status));
    if (employeeId && Number.isInteger(Number(employeeId))) {
      conditions.push(eq(attendance.employeeId, Number(employeeId)));
    }

    const rawRows =
      conditions.length > 0
        ? await db
            .select()
            .from(attendance)
            .where(and(...conditions))
            .orderBy(desc(attendance.date), desc(attendance.id))
            .limit(300)
        : await db
            .select()
            .from(attendance)
            .orderBy(desc(attendance.date), desc(attendance.id))
            .limit(300);

    const filtered = rawRows
      .filter((row) => {
        const emp = empMap.get(row.employeeId);
        if (!emp) return false;
        if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
          if (emp.departmentId !== dbUser.managedDepartmentId) return false;
        }
        if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
          if (emp.id !== dbUser.employeeId) return false;
        }
        if (departmentId && departmentId !== 'ALL' && emp.departmentId !== Number(departmentId)) {
          return false;
        }
        return true;
      })
      .map((row) => {
        const emp = empMap.get(row.employeeId)!;
        const dept = deptMap.get(emp.departmentId);
        const shift = shiftMap.get(emp.shiftId);
        return {
          ...row,
          employeeCode: emp.code,
          employeeName: emp.fullName,
          designation: emp.designation,
          departmentId: emp.departmentId,
          departmentName: dept?.name ?? 'General',
          shiftName: shift?.name ?? 'Morning Core',
        };
      });

    res.json({ records: filtered });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch attendance logs.');
  }
});

// GET /api/attendance/today — Scoped today's attendance & summary
apiRouter.get('/attendance/today', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const policy = await getActivePolicy();
    const today = todayStr(policy?.timezone || DEFAULT_TIMEZONE);

    const allEmps = await db.select().from(employees).where(eq(employees.status, 'active'));
    const scopedEmps = allEmps.filter((e) => {
      if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
        return e.departmentId === dbUser.managedDepartmentId;
      }
      if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
        return e.id === dbUser.employeeId;
      }
      return true;
    });
    const empMap = new Map(scopedEmps.map((e) => [e.id, e]));

    const rows = (await db.select().from(attendance).where(eq(attendance.date, today))).filter((r) =>
      empMap.has(r.employeeId)
    );

    res.json({
      date: today,
      records: rows.map((r) => ({
        ...r,
        employeeCode: empMap.get(r.employeeId)?.code,
        employeeName: empMap.get(r.employeeId)?.fullName,
      })),
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch today attendance.');
  }
});

// GET /api/attendance/history — Scoped historical attendance logs
apiRouter.get('/attendance/history', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const { startDate, endDate, employeeId } = req.query as Record<string, string | undefined>;
    const allEmps = await db.select().from(employees);
    const empMap = new Map(allEmps.map((e) => [e.id, e]));

    const conditions = [];
    if (startDate) conditions.push(gte(attendance.date, startDate));
    if (endDate) conditions.push(lte(attendance.date, endDate));
    if (employeeId && Number.isInteger(Number(employeeId)) && !isStaffSelfRole(dbUser.role)) {
      conditions.push(eq(attendance.employeeId, Number(employeeId)));
    }

    const rawRows =
      conditions.length > 0
        ? await db
            .select()
            .from(attendance)
            .where(and(...conditions))
            .orderBy(desc(attendance.date))
            .limit(300)
        : await db.select().from(attendance).orderBy(desc(attendance.date)).limit(300);

    const records = rawRows
      .filter((r) => {
        const emp = empMap.get(r.employeeId);
        if (!emp) return false;
        if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
          return emp.departmentId === dbUser.managedDepartmentId;
        }
        if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
          return emp.id === dbUser.employeeId;
        }
        return true;
      })
      .map((r) => ({
        ...r,
        employeeCode: empMap.get(r.employeeId)?.code,
        employeeName: empMap.get(r.employeeId)?.fullName,
      }));

    res.json({ records });
  } catch (error) {
    handleApiError(res, error, 'Failed to load attendance history.');
  }
});

// GET /api/attendance/summary — Aggregated attendance metrics & missing check-outs
apiRouter.get('/attendance/summary', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const policy = await getActivePolicy();
    const today = todayStr(policy?.timezone || DEFAULT_TIMEZONE);
    const { startDate, endDate } = req.query as Record<string, string | undefined>;

    const allEmps = await db.select().from(employees);
    const scopedIds = new Set(
      allEmps
        .filter((e) => {
          if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
            return e.departmentId === dbUser.managedDepartmentId;
          }
          if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
            return e.id === dbUser.employeeId;
          }
          return true;
        })
        .map((e) => e.id)
    );

    const conditions = [];
    if (startDate) conditions.push(gte(attendance.date, startDate));
    if (endDate) conditions.push(lte(attendance.date, endDate));

    const rows = (
      conditions.length > 0
        ? await db.select().from(attendance).where(and(...conditions))
        : await db.select().from(attendance).orderBy(desc(attendance.date)).limit(400)
    ).filter((r) => scopedIds.has(r.employeeId));

    const missingCheckouts = rows.filter(
      (r) => r.date < today && Boolean(r.checkInTime) && !r.checkOutTime
    );

    res.json({
      totalRecords: rows.length,
      present: rows.filter((r) => r.status === 'Present').length,
      late: rows.filter((r) => r.isLate || r.status === 'Late').length,
      absent: rows.filter((r) => r.status === 'Absent').length,
      halfDay: rows.filter((r) => r.status === 'Half Day').length,
      workFromHome: rows.filter((r) => r.status === 'Work From Home').length,
      onLeave: rows.filter((r) => r.status === 'On Leave').length,
      missingCheckoutCount: missingCheckouts.length,
      totalWorkingHours:
        Math.round((rows.reduce((s, r) => s + r.workingMinutes, 0) / 60) * 10) / 10,
      totalOvertimeHours:
        Math.round((rows.reduce((s, r) => s + r.overtimeMinutes, 0) / 60) * 10) / 10,
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to compute attendance summary.');
  }
});

apiRouter.post('/attendance/check-in', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const parsed = checkInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid check-in payload.' });
    }
    const {
      employeeId: requestedEmpId,
      method,
      qrToken,
      latitude,
      longitude,
      locationLabel,
      geoConsent,
      notes,
    } = parsed.data;

    const targetEmployeeId =
      isStaffSelfRole(dbUser.role)
        ? dbUser.employeeId
        : requestedEmpId ?? dbUser.employeeId;

    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'No employee or student profile linked for check-in.' });
    }

    const empRows = await db
      .select()
      .from(employees)
      .where(eq(employees.id, targetEmployeeId))
      .limit(1);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }
    const emp = empRows[0];

    if (
      dbUser.role === 'MANAGER' &&
      dbUser.managedDepartmentId &&
      emp.departmentId !== dbUser.managedDepartmentId
    ) {
      return res.status(403).json({ error: 'Managers can only check in members of their department.' });
    }

    const policy = await getActivePolicy();
    const checkMethod = method || 'Web';

    if (checkMethod === 'WFH' && policy && !policy.allowWfh) {
      return res.status(403).json({ error: 'Work-From-Home check-in is disabled by attendance policy.' });
    }

    if (checkMethod === 'QR') {
      if (policy && !policy.allowQrCheckIn) {
        return res.status(403).json({ error: 'QR attendance check-in is disabled by attendance policy.' });
      }
      if (!qrToken?.trim()) {
        return res.status(400).json({ error: 'A valid QR session token is required.' });
      }
      const qrRows = await db
        .select()
        .from(qrSessions)
        .where(eq(qrSessions.token, qrToken.trim()))
        .limit(1);
      if (qrRows.length === 0) {
        return res.status(400).json({ error: 'QR token was not recognized.' });
      }
      if (new Date(qrRows[0].expiresAt) < new Date()) {
        return res.status(400).json({ error: 'This QR check-in code has expired.' });
      }
    }

    if (checkMethod === 'Geolocation') {
      if (policy?.requireGeoConsent && !geoConsent) {
        return res.status(400).json({ error: 'Explicit geolocation consent is required before recording coordinates.' });
      }
      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'GPS coordinates are required for geolocation check-in.' });
      }
    }

    const tz = policy?.timezone || DEFAULT_TIMEZONE;
    const today = todayStr(tz);
    // Duplicate check-in prevention
    const existing = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, emp.id), eq(attendance.date, today)))
      .limit(1);

    if (existing.length > 0 && existing[0].checkInTime) {
      return res.status(409).json({
        error: `Duplicate check-in blocked: ${emp.fullName} is already checked in for ${today}.`,
      });
    }

    const holidayRows = await db
      .select()
      .from(holidays)
      .where(eq(holidays.date, today))
      .limit(1);
    const isHoliday = holidayRows.length > 0;
    const isWeeklyOff = isWeekendDate(today, policy?.weekendDays || '0,6');

    const shift = await getEmployeeShiftOrDefault(emp.shiftId, policy, tz);

    const now = new Date();
    const { isLate, arrivalDelayMinutes, status, anomalyFlag } = evaluateCheckIn(
      now,
      shift,
      checkMethod,
      { isHoliday, isWeeklyOff }
    );

    const inserted =
      existing.length > 0
        ? await db
            .update(attendance)
            .set({
              status,
              checkInTime: now,
              arrivalDelayMinutes,
              isLate,
              checkInMethod: checkMethod,
              latitude: latitude ?? null,
              longitude: longitude ?? null,
              locationLabel:
                locationLabel ||
                (checkMethod === 'WFH'
                  ? 'Remote Workspace'
                  : checkMethod === 'Geolocation'
                    ? `${latitude}, ${longitude}`
                    : 'Web Portal'),
              anomalyFlag: policy?.autoAnomalyDetection ? anomalyFlag : null,
              notes: notes?.trim() ?? '',
              markedByUid: dbUser.uid,
              updatedAt: now,
            })
            .where(eq(attendance.id, existing[0].id))
            .returning()
        : await db
            .insert(attendance)
            .values({
              employeeId: emp.id,
              date: today,
              status,
              checkInTime: now,
              breakMinutes: 0,
              breaksJson: '[]',
              workingMinutes: 0,
              overtimeMinutes: 0,
              arrivalDelayMinutes,
              earlyDepartureMinutes: 0,
              isLate,
              isEarlyDeparture: false,
              checkInMethod: checkMethod,
              latitude: latitude ?? null,
              longitude: longitude ?? null,
              locationLabel:
                locationLabel ||
                (checkMethod === 'WFH'
                  ? 'Remote Workspace'
                  : checkMethod === 'Geolocation'
                    ? `${latitude}, ${longitude}`
                    : 'Web Portal'),
              anomalyFlag: policy?.autoAnomalyDetection ? anomalyFlag : null,
              notes: notes?.trim() ?? '',
              markedByUid: dbUser.uid,
            })
            .returning();

    await db.insert(notifications).values({
      recipientUid: dbUser.uid,
      type: isLate ? 'late_arrival' : 'check_in',
      title: isLate ? `Late Arrival: ${emp.fullName}` : `Checked In: ${emp.fullName}`,
      message: `${emp.fullName} checked in via ${checkMethod}${arrivalDelayMinutes > 0 ? ` (${arrivalDelayMinutes}m after shift start)` : ''}.`,
    });

    await logAuditEvent({
      actorUserId: dbUser.id,
      actorEmail: dbUser.email,
      actorRole: dbUser.role,
      action: 'ATTENDANCE_CHECK_IN',
      resourceType: 'attendance',
      resourceId: inserted[0].id,
      ipAddress: req.ip,
      metadata: { employeeId: emp.id, method: checkMethod, status, arrivalDelayMinutes },
    });

    res.status(201).json({ record: inserted[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to process check-in.');
  }
});

apiRouter.post('/attendance/check-out', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const parsed = checkOutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid check-out input.' });
    }
    const { employeeId: requestedEmpId, breakMinutes } = parsed.data;

    const targetEmployeeId =
      isStaffSelfRole(dbUser.role)
        ? dbUser.employeeId
        : requestedEmpId ?? dbUser.employeeId;

    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'No employee profile selected for check-out.' });
    }

    const policy = await getActivePolicy();
    const today = todayStr(policy?.timezone || DEFAULT_TIMEZONE);
    const existing = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, targetEmployeeId), eq(attendance.date, today)))
      .limit(1);

    if (existing.length === 0 || !existing[0].checkInTime) {
      return res.status(400).json({ error: 'Cannot check out before checking in today.' });
    }
    if (existing[0].checkOutTime) {
      return res.status(409).json({ error: 'Check-out has already been recorded for today.' });
    }

    const empRows = await db
      .select()
      .from(employees)
      .where(eq(employees.id, targetEmployeeId))
      .limit(1);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }
    const emp = empRows[0];

    if (
      dbUser.role === 'MANAGER' &&
      dbUser.managedDepartmentId &&
      emp.departmentId !== dbUser.managedDepartmentId
    ) {
      return res.status(403).json({ error: 'Managers can only check out members of their department.' });
    }

    const shift = await getEmployeeShiftOrDefault(
      emp.shiftId,
      policy,
      policy?.timezone || DEFAULT_TIMEZONE
    );

    const now = new Date();
    const effectiveBreak =
      typeof breakMinutes === 'number' && breakMinutes >= 0
        ? breakMinutes
        : existing[0].breakMinutes;

    const calc = evaluateCheckOut(
      new Date(existing[0].checkInTime),
      now,
      effectiveBreak,
      shift,
      existing[0].status
    );

    const updated = await db
      .update(attendance)
      .set({
        checkOutTime: now,
        breakMinutes: effectiveBreak,
        workingMinutes: calc.workingMinutes,
        overtimeMinutes: calc.overtimeMinutes,
        earlyDepartureMinutes: calc.earlyDepartureMinutes,
        isEarlyDeparture: calc.isEarlyDeparture,
        status: calc.resolvedStatus,
        anomalyFlag:
          policy?.autoAnomalyDetection && calc.anomalyFlag
            ? calc.anomalyFlag
            : existing[0].anomalyFlag,
        updatedAt: now,
      })
      .where(eq(attendance.id, existing[0].id))
      .returning();

    const hoursStr = (calc.workingMinutes / 60).toFixed(1);
    await db.insert(notifications).values({
      recipientUid: dbUser.uid,
      type: 'check_out',
      title: `Checked Out: ${emp.fullName}`,
      message: `${emp.fullName} completed ${hoursStr}h today${calc.overtimeMinutes > 0 ? ` (${calc.overtimeMinutes}m overtime)` : ''}.`,
    });

    await logAuditEvent({
      actorUserId: dbUser.id,
      actorEmail: dbUser.email,
      actorRole: dbUser.role,
      action: 'ATTENDANCE_CHECK_OUT',
      resourceType: 'attendance',
      resourceId: updated[0].id,
      ipAddress: req.ip,
      metadata: {
        workingMinutes: calc.workingMinutes,
        overtimeMinutes: calc.overtimeMinutes,
        earlyDepartureMinutes: calc.earlyDepartureMinutes,
      },
    });

    res.json({ record: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to process check-out.');
  }
});

apiRouter.post('/attendance/break', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const parsed = breakSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid break input.' });
    }
    const { employeeId: requestedEmpId, addMinutes: mins, label } = parsed.data;

    const targetEmployeeId =
      isStaffSelfRole(dbUser.role) ? dbUser.employeeId : requestedEmpId ?? dbUser.employeeId;
    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'Employee ID required.' });
    }

    const empRows = await db
      .select()
      .from(employees)
      .where(eq(employees.id, targetEmployeeId))
      .limit(1);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }
    if (
      dbUser.role === 'MANAGER' &&
      dbUser.managedDepartmentId &&
      empRows[0].departmentId !== dbUser.managedDepartmentId
    ) {
      return res.status(403).json({ error: 'Managers can only log breaks for their department.' });
    }

    const policy = await getActivePolicy();
    const today = todayStr(policy?.timezone || DEFAULT_TIMEZONE);
    const existing = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, targetEmployeeId), eq(attendance.date, today)))
      .limit(1);

    if (existing.length === 0) {
      return res.status(400).json({ error: 'Check in first before logging break time.' });
    }

    const existingBreaks = parseBreaksJson(existing[0].breaksJson);
    existingBreaks.push({
      minutes: mins,
      label: label || 'Break',
      loggedAt: new Date().toISOString(),
    });
    const totalBreakMins = existing[0].breakMinutes + mins;

    const updated = await db
      .update(attendance)
      .set({
        breakMinutes: totalBreakMins,
        breaksJson: JSON.stringify(existingBreaks),
        updatedAt: new Date(),
      })
      .where(eq(attendance.id, existing[0].id))
      .returning();

    res.json({ record: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to log break duration.');
  }
});

apiRouter.post(
  '/attendance/mark',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const parsed = markAttendanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid attendance payload.' });
      }
      const {
        employeeId,
        date,
        status: rawStatus,
        checkInTimeStr,
        checkOutTimeStr,
        breakMinutes,
        notes,
      } = parsed.data;
      const status = normalizeAttendanceStatus(rawStatus);

      const empRows = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found.' });
      const emp = empRows[0];

      if (
        dbUser.role === 'MANAGER' &&
        dbUser.managedDepartmentId &&
        emp.departmentId !== dbUser.managedDepartmentId
      ) {
        return res.status(403).json({ error: 'Managers can only mark attendance for their department.' });
      }

      const policy = await getActivePolicy();
      const tz = policy?.timezone || DEFAULT_TIMEZONE;
      const shift = await getEmployeeShiftOrDefault(emp.shiftId, policy, tz);

      const checkInDt = checkInTimeStr ? buildDateFromZonedTime(date, checkInTimeStr, tz) : null;
      let checkOutDt = checkOutTimeStr ? buildDateFromZonedTime(date, checkOutTimeStr, tz) : null;
      if (checkInDt && checkOutDt && checkOutDt <= checkInDt) {
        // Overnight shift check-out on the next calendar day
        checkOutDt = new Date(checkOutDt.getTime() + 24 * 60 * 60 * 1000);
      }
      const brk = Number(breakMinutes) || 0;

      let workingMinutes = 0;
      let overtimeMinutes = 0;
      let arrivalDelayMinutes = 0;
      let earlyDepartureMinutes = 0;
      let isLate = status === 'Late';
      let isEarlyDeparture = false;

      if (checkInDt) {
        const inEval = evaluateCheckIn(checkInDt, shift, 'Manual');
        isLate = isLate || inEval.isLate;
        arrivalDelayMinutes = inEval.arrivalDelayMinutes;
      }

      if (checkInDt && checkOutDt && checkOutDt > checkInDt) {
        const outEval = evaluateCheckOut(checkInDt, checkOutDt, brk, shift, status);
        workingMinutes = outEval.workingMinutes;
        overtimeMinutes = outEval.overtimeMinutes;
        earlyDepartureMinutes = outEval.earlyDepartureMinutes;
        isEarlyDeparture = outEval.isEarlyDeparture;
      } else if (status === 'Present' || status === 'Work From Home') {
        workingMinutes = (policy?.fullDayMinHours ?? 8) * 60;
      } else if (status === 'Half Day') {
        workingMinutes = shift.halfDayHours * 60;
      }

      const existing = await db
        .select()
        .from(attendance)
        .where(and(eq(attendance.employeeId, employeeId), eq(attendance.date, date)))
        .limit(1);

      const saved =
        existing.length > 0
          ? await db
              .update(attendance)
              .set({
                status,
                checkInTime: checkInDt,
                checkOutTime: checkOutDt,
                breakMinutes: brk,
                workingMinutes,
                overtimeMinutes,
                arrivalDelayMinutes,
                earlyDepartureMinutes,
                isLate,
                isEarlyDeparture,
                checkInMethod: 'Manual',
                notes: (notes || '').trim(),
                markedByUid: dbUser.uid,
                updatedAt: new Date(),
              })
              .where(eq(attendance.id, existing[0].id))
              .returning()
          : await db
              .insert(attendance)
              .values({
                employeeId,
                date,
                status,
                checkInTime: checkInDt,
                checkOutTime: checkOutDt,
                breakMinutes: brk,
                breaksJson: brk > 0 ? JSON.stringify([{ minutes: brk, label: 'Scheduled Break', loggedAt: new Date().toISOString() }]) : '[]',
                workingMinutes,
                overtimeMinutes,
                arrivalDelayMinutes,
                earlyDepartureMinutes,
                isLate,
                isEarlyDeparture,
                checkInMethod: 'Manual',
                notes: (notes || '').trim(),
                markedByUid: dbUser.uid,
              })
              .returning();

      await logAuditEvent({
        actorUserId: dbUser.id,
        actorEmail: dbUser.email,
        actorRole: dbUser.role,
        action: 'ATTENDANCE_MARKED',
        resourceType: 'attendance',
        resourceId: saved[0].id,
        ipAddress: req.ip,
        metadata: { employeeId, date, status, workingMinutes },
      });

      res.status(201).json({ record: saved[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to save manual attendance entry.');
    }
  }
);

// GET /api/attendance/:id — Individual attendance record (role & isolation verified)
apiRouter.get('/attendance/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid attendance ID.' });
    }
    const dbUser = req.dbUser!;
    const rows = await db.select().from(attendance).where(eq(attendance.id, id)).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Attendance record not found.' });
    const record = rows[0];

    const empRows = await db.select().from(employees).where(eq(employees.id, record.employeeId)).limit(1);
    const emp = empRows[0];
    if (isStaffSelfRole(dbUser.role) && dbUser.employeeId !== record.employeeId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access another member record.' });
    }
    if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId && emp?.departmentId !== dbUser.managedDepartmentId) {
      return res.status(403).json({ error: 'Forbidden: Outside your managed department.' });
    }

    res.json({ record: { ...record, employeeCode: emp?.code, employeeName: emp?.fullName } });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch attendance record.');
  }
});

// PUT /api/attendance/:id — Update attendance record & recalculate hours server-side
apiRouter.put(
  '/attendance/:id',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid attendance ID.' });
      }
      const parsed = updateAttendanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update data.' });
      }

      const existingRows = await db.select().from(attendance).where(eq(attendance.id, id)).limit(1);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Attendance record not found.' });
      }
      const existing = existingRows[0];
      const empRows = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
      const emp = empRows[0];

      const dbUser = req.dbUser!;
      if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId && emp?.departmentId !== dbUser.managedDepartmentId) {
        return res.status(403).json({ error: 'Managers can only update records in their department.' });
      }

      const policy = await getActivePolicy();
      const tz = policy?.timezone || DEFAULT_TIMEZONE;
      const shift = await getEmployeeShiftOrDefault(emp?.shiftId, policy, tz);

      const nextStatus = parsed.data.status
        ? normalizeAttendanceStatus(parsed.data.status)
        : existing.status;
      const checkInDt =
        parsed.data.checkInTimeStr !== undefined
          ? parsed.data.checkInTimeStr
            ? buildDateFromZonedTime(existing.date, parsed.data.checkInTimeStr, tz)
            : null
          : existing.checkInTime;
      let checkOutDt =
        parsed.data.checkOutTimeStr !== undefined
          ? parsed.data.checkOutTimeStr
            ? buildDateFromZonedTime(existing.date, parsed.data.checkOutTimeStr, tz)
            : null
          : existing.checkOutTime;
      if (checkInDt && checkOutDt && checkOutDt <= checkInDt) {
        checkOutDt = new Date(checkOutDt.getTime() + 24 * 60 * 60 * 1000);
      }

      const brk = parsed.data.breakMinutes ?? existing.breakMinutes;
      let workingMinutes = existing.workingMinutes;
      let overtimeMinutes = existing.overtimeMinutes;
      let arrivalDelayMinutes = existing.arrivalDelayMinutes;
      let earlyDepartureMinutes = existing.earlyDepartureMinutes;
      let isLate = nextStatus === 'Late';
      let isEarlyDeparture = existing.isEarlyDeparture;

      if (checkInDt) {
        const inEval = evaluateCheckIn(checkInDt, shift, 'Manual');
        isLate = isLate || inEval.isLate;
        arrivalDelayMinutes = inEval.arrivalDelayMinutes;
      }
      if (checkInDt && checkOutDt && checkOutDt > checkInDt) {
        const outEval = evaluateCheckOut(checkInDt, checkOutDt, brk, shift, nextStatus);
        workingMinutes = outEval.workingMinutes;
        overtimeMinutes = outEval.overtimeMinutes;
        earlyDepartureMinutes = outEval.earlyDepartureMinutes;
        isEarlyDeparture = outEval.isEarlyDeparture;
      }

      const updated = await db
        .update(attendance)
        .set({
          status: nextStatus,
          checkInTime: checkInDt,
          checkOutTime: checkOutDt,
          breakMinutes: brk,
          workingMinutes,
          overtimeMinutes,
          arrivalDelayMinutes,
          earlyDepartureMinutes,
          isLate,
          isEarlyDeparture,
          notes: parsed.data.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(attendance.id, id))
        .returning();

      await logAuditEvent({
        actorUserId: dbUser.id,
        actorEmail: dbUser.email,
        actorRole: dbUser.role,
        action: 'ATTENDANCE_UPDATED',
        resourceType: 'attendance',
        resourceId: id,
        ipAddress: req.ip,
        metadata: { status: nextStatus, workingMinutes },
      });

      res.json({ record: updated[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to update attendance record.');
    }
  }
);

// DELETE /api/attendance/:id — Admin / Super Admin only
apiRouter.delete('/attendance/:id', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid attendance ID.' });
    }
    const deleted = await db.delete(attendance).where(eq(attendance.id, id)).returning();
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Attendance record not found.' });
    }

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'ATTENDANCE_DELETED',
      resourceType: 'attendance',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ deleted: true, id });
  } catch (error) {
    handleApiError(res, error, 'Failed to delete attendance record.');
  }
});

// ---------------------------------------------------------------------------
// 6. Attendance Corrections
// ---------------------------------------------------------------------------
apiRouter.get('/corrections', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const allEmps = await db.select().from(employees);
    const empMap = new Map(allEmps.map((e) => [e.id, e]));

    const rows = await db
      .select()
      .from(attendanceCorrections)
      .orderBy(desc(attendanceCorrections.createdAt));

    const filtered = rows
      .filter((r) => {
        const emp = empMap.get(r.employeeId);
        if (!emp) return false;
        if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
          return emp.departmentId === dbUser.managedDepartmentId;
        }
        if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
          return emp.id === dbUser.employeeId;
        }
        return true;
      })
      .map((r) => ({
        ...r,
        employeeName: empMap.get(r.employeeId)?.fullName ?? 'Unknown',
        employeeCode: empMap.get(r.employeeId)?.code ?? '',
      }));

    res.json({ corrections: filtered });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch correction requests.');
  }
});

apiRouter.post('/corrections', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const parsed = correctionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'All correction request fields are required.' });
    }
    const {
      employeeId: reqEmpId,
      date,
      requestedStatus: rawRequestedStatus,
      requestedCheckIn,
      requestedCheckOut,
      reason,
    } = parsed.data;
    const requestedStatus = normalizeAttendanceStatus(rawRequestedStatus);

    const empId = isStaffSelfRole(dbUser.role) ? dbUser.employeeId : reqEmpId ?? dbUser.employeeId;
    if (!empId) {
      return res.status(400).json({ error: 'No member profile linked.' });
    }

    const existingAttendance = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, empId), eq(attendance.date, date)))
      .limit(1);

    const created = await db
      .insert(attendanceCorrections)
      .values({
        attendanceId: existingAttendance[0]?.id ?? null,
        employeeId: empId,
        date,
        requestedStatus,
        requestedCheckIn,
        requestedCheckOut,
        reason: reason.trim(),
        status: 'Pending',
      })
      .returning();

    res.status(201).json({ correction: created[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to submit attendance correction.');
  }
});

apiRouter.patch(
  '/corrections/:id',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid correction ID.' });
      }
      const parsed = reviewDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Decision must be Approved or Rejected.' });
      }
      const { decision, reviewerNote } = parsed.data;

      const existingRows = await db
        .select()
        .from(attendanceCorrections)
        .where(eq(attendanceCorrections.id, id))
        .limit(1);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Correction request not found.' });
      }
      const corr = existingRows[0];
      if (corr.status !== 'Pending') {
        return res.status(400).json({ error: 'This correction request has already been processed.' });
      }

      const empRows = await db
        .select()
        .from(employees)
        .where(eq(employees.id, corr.employeeId))
        .limit(1);
      const emp = empRows[0];

      if (
        req.dbUser!.role === 'MANAGER' &&
        req.dbUser!.managedDepartmentId &&
        emp?.departmentId !== req.dbUser!.managedDepartmentId
      ) {
        return res.status(403).json({ error: 'Managers can only review corrections in their department.' });
      }

      const updated = await db
        .update(attendanceCorrections)
        .set({
          status: decision,
          reviewedByUid: req.dbUser!.uid,
          reviewerNote: reviewerNote || '',
        })
        .where(eq(attendanceCorrections.id, id))
        .returning();

      if (decision === 'Approved') {
        const policy = await getActivePolicy();
        const tz = policy?.timezone || DEFAULT_TIMEZONE;
        const shift = await getEmployeeShiftOrDefault(emp?.shiftId, policy, tz);

        const inDt = buildDateFromZonedTime(corr.date, corr.requestedCheckIn, tz);
        let outDt = buildDateFromZonedTime(corr.date, corr.requestedCheckOut, tz);
        if (outDt <= inDt) {
          outDt = new Date(outDt.getTime() + 24 * 60 * 60 * 1000);
        }

        const existingAtt = await db
          .select()
          .from(attendance)
          .where(and(eq(attendance.employeeId, corr.employeeId), eq(attendance.date, corr.date)))
          .limit(1);

        const brk = existingAtt[0]?.breakMinutes ?? shift.breakMinutes;
        const inEval = evaluateCheckIn(inDt, shift, 'Manual');
        const outEval = evaluateCheckOut(inDt, outDt, brk, shift, corr.requestedStatus);
        const isLate = corr.requestedStatus === 'Late' || inEval.isLate;

        if (existingAtt.length > 0) {
          await db
            .update(attendance)
            .set({
              status: corr.requestedStatus,
              checkInTime: inDt,
              checkOutTime: outDt,
              breakMinutes: brk,
              workingMinutes: outEval.workingMinutes,
              overtimeMinutes: outEval.overtimeMinutes,
              arrivalDelayMinutes: inEval.arrivalDelayMinutes,
              earlyDepartureMinutes: outEval.earlyDepartureMinutes,
              isLate,
              isEarlyDeparture: outEval.isEarlyDeparture,
              anomalyFlag: null,
              notes: existingAtt[0].notes
                ? `${existingAtt[0].notes} · Applied from correction #${corr.id}`
                : `Applied from correction #${corr.id}`,
              updatedAt: new Date(),
            })
            .where(eq(attendance.id, existingAtt[0].id));
        } else {
          await db.insert(attendance).values({
            employeeId: corr.employeeId,
            date: corr.date,
            status: corr.requestedStatus,
            checkInTime: inDt,
            checkOutTime: outDt,
            breakMinutes: brk,
            workingMinutes: outEval.workingMinutes,
            overtimeMinutes: outEval.overtimeMinutes,
            arrivalDelayMinutes: inEval.arrivalDelayMinutes,
            earlyDepartureMinutes: outEval.earlyDepartureMinutes,
            isLate,
            isEarlyDeparture: outEval.isEarlyDeparture,
            checkInMethod: 'Manual',
            notes: `Applied from correction #${corr.id}`,
            markedByUid: req.dbUser!.uid,
          });
        }
      }

      const targetUid = await getTargetUserUid(corr.employeeId);
      if (targetUid) {
        await db.insert(notifications).values({
          recipientUid: targetUid,
          type: 'correction',
          title: `Correction ${decision}: ${emp?.fullName ?? 'Member'}`,
          message: `Attendance correction for ${corr.date} was ${decision.toLowerCase()}.`,
        });
      }

      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: `CORRECTION_${decision.toUpperCase()}`,
        resourceType: 'correction',
        resourceId: id,
        ipAddress: req.ip,
        metadata: { employeeId: corr.employeeId, date: corr.date },
      });

      res.json({ correction: updated[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to review correction request.');
    }
  }
);

// ---------------------------------------------------------------------------
// 7. Leave Management
// ---------------------------------------------------------------------------
apiRouter.get('/leaves', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const allEmps = await db.select().from(employees);
    const allDepts = await db.select().from(departments);
    const empMap = new Map(allEmps.map((e) => [e.id, e]));
    const deptMap = new Map(allDepts.map((d) => [d.id, d]));

    const rows = await db.select().from(leaveRequests).orderBy(desc(leaveRequests.createdAt));

    const filtered = rows
      .filter((r) => {
        const emp = empMap.get(r.employeeId);
        if (!emp) return false;
        if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
          return emp.departmentId === dbUser.managedDepartmentId;
        }
        if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
          return emp.id === dbUser.employeeId;
        }
        return true;
      })
      .map((r) => {
        const emp = empMap.get(r.employeeId)!;
        return {
          ...r,
          employeeName: emp.fullName,
          employeeCode: emp.code,
          departmentName: deptMap.get(emp.departmentId)?.name ?? 'General',
        };
      });

    res.json({ leaves: filtered });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch leave requests.');
  }
});

apiRouter.post('/leaves', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const parsed = leaveCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Category, date range, and reason are required.' });
    }
    const {
      employeeId: reqEmpId,
      category,
      startDate,
      endDate,
      reason,
      attachmentName,
    } = parsed.data;

    const empId = isStaffSelfRole(dbUser.role) ? dbUser.employeeId : reqEmpId ?? dbUser.employeeId;
    if (!empId) {
      return res.status(400).json({ error: 'Member ID required.' });
    }

    const totalDays = calculateDateRangeDays(startDate, endDate);
    if (totalDays <= 0 || totalDays > 60) {
      return res.status(400).json({ error: 'End date must be on or after start date (max 60 days).' });
    }

    const empRows = await db.select().from(employees).where(eq(employees.id, empId)).limit(1);
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found.' });
    const emp = empRows[0];

    if (
      dbUser.role === 'MANAGER' &&
      dbUser.managedDepartmentId &&
      emp.departmentId !== dbUser.managedDepartmentId
    ) {
      return res.status(403).json({
        error: 'Managers can only submit leave requests for members in their department.',
      });
    }

    const balanceByCategory: Record<string, number> = {
      'Casual Leave': emp.casualLeaveBalance,
      'Sick Leave': emp.sickLeaveBalance,
      'Earned Leave': emp.earnedLeaveBalance,
      'Personal Leave': emp.personalLeaveBalance,
      'Emergency Leave': emp.emergencyLeaveBalance,
    };

    const available = balanceByCategory[category] ?? 0;
    if (totalDays > available) {
      return res.status(400).json({
        error: `Insufficient ${category} balance (${available} days remaining, requested ${totalDays}).`,
      });
    }

    const created = await db
      .insert(leaveRequests)
      .values({
        employeeId: empId,
        category,
        startDate,
        endDate,
        totalDays,
        reason: reason.trim(),
        attachmentName: attachmentName?.trim() || null,
        status: 'Pending',
      })
      .returning();

    res.status(201).json({ leave: created[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to submit leave request.');
  }
});

apiRouter.patch(
  '/leaves/:id',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid leave request ID.' });
      }
      const parsed = reviewDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Decision must be Approved or Rejected.' });
      }
      const { decision, reviewerNote } = parsed.data;

      const leaveRows = await db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, id))
        .limit(1);
      if (leaveRows.length === 0) {
        return res.status(404).json({ error: 'Leave request not found.' });
      }
      const leave = leaveRows[0];
      if (leave.status !== 'Pending') {
        return res.status(400).json({ error: 'This leave request has already been processed.' });
      }

      const empRows = await db
        .select()
        .from(employees)
        .where(eq(employees.id, leave.employeeId))
        .limit(1);
      const emp = empRows[0];

      if (
        req.dbUser!.role === 'MANAGER' &&
        req.dbUser!.managedDepartmentId &&
        emp?.departmentId !== req.dbUser!.managedDepartmentId
      ) {
        return res.status(403).json({ error: 'Managers can only approve leaves for their department.' });
      }

      const updated = await db
        .update(leaveRequests)
        .set({
          status: decision,
          reviewerNote: (reviewerNote || '').trim(),
          reviewedByUid: req.dbUser!.uid,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();

      if (decision === 'Approved' && emp) {
        // Deduct leave balance
        const balanceUpdate: Record<string, number> = {};
        if (leave.category === 'Casual Leave') {
          balanceUpdate.casualLeaveBalance = Math.max(0, emp.casualLeaveBalance - leave.totalDays);
        } else if (leave.category === 'Sick Leave') {
          balanceUpdate.sickLeaveBalance = Math.max(0, emp.sickLeaveBalance - leave.totalDays);
        } else if (leave.category === 'Earned Leave') {
          balanceUpdate.earnedLeaveBalance = Math.max(0, emp.earnedLeaveBalance - leave.totalDays);
        } else if (leave.category === 'Personal Leave') {
          balanceUpdate.personalLeaveBalance = Math.max(0, emp.personalLeaveBalance - leave.totalDays);
        } else if (leave.category === 'Emergency Leave') {
          balanceUpdate.emergencyLeaveBalance = Math.max(0, emp.emergencyLeaveBalance - leave.totalDays);
        }

        if (Object.keys(balanceUpdate).length > 0) {
          await db.update(employees).set(balanceUpdate).where(eq(employees.id, emp.id));
        }

        // Sync On Leave status into attendance records for each leave date
        const leaveDates = enumerateDates(leave.startDate, leave.endDate);
        for (const d of leaveDates) {
          await db
            .insert(attendance)
            .values({
              employeeId: emp.id,
              date: d,
              status: 'On Leave',
              breakMinutes: 0,
              workingMinutes: 0,
              overtimeMinutes: 0,
              isLate: false,
              isEarlyDeparture: false,
              checkInMethod: 'Manual',
              notes: `${leave.category} approved`,
              markedByUid: req.dbUser!.uid,
            })
            .onConflictDoUpdate({
              target: [attendance.employeeId, attendance.date],
              set: {
                status: 'On Leave',
                notes: `${leave.category} approved`,
                updatedAt: new Date(),
              },
            });
        }
      }

      const targetUid = await getTargetUserUid(leave.employeeId);
      if (targetUid) {
        await db.insert(notifications).values({
          recipientUid: targetUid,
          type: decision === 'Approved' ? 'leave_approved' : 'leave_rejected',
          title: `Leave ${decision}: ${emp?.fullName ?? 'Member'}`,
          message: `${leave.category} (${leave.startDate} to ${leave.endDate}) was ${decision.toLowerCase()}.`,
        });
      }

      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: `LEAVE_${decision.toUpperCase()}`,
        resourceType: 'leave',
        resourceId: id,
        ipAddress: req.ip,
        metadata: { employeeId: leave.employeeId, category: leave.category, totalDays: leave.totalDays },
      });

      res.json({ leave: updated[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to process leave decision.');
    }
  }
);

// ---------------------------------------------------------------------------
// 8. Advanced Analytics & Reports
// ---------------------------------------------------------------------------
apiRouter.get('/reports', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const { startDate, endDate, departmentId, employeeId } = req.query as Record<
      string,
      string | undefined
    >;

    const policy = await getActivePolicy();
    const tz = policy?.timezone || DEFAULT_TIMEZONE;
    const defaultEnd = todayStr(tz);
    const dStart = new Date();
    dStart.setDate(dStart.getDate() - 30);
    const defaultStart = getDateInTimeZone(dStart, tz);

    const from = startDate || defaultStart;
    const to = endDate || defaultEnd;

    const allEmps = await db.select().from(employees);
    const allDepts = await db.select().from(departments);
    const deptMap = new Map(allDepts.map((d) => [d.id, d]));

    const scopedEmps = allEmps.filter((e) => {
      if (dbUser.role === 'MANAGER' && dbUser.managedDepartmentId) {
        if (e.departmentId !== dbUser.managedDepartmentId) return false;
      }
      if (isStaffSelfRole(dbUser.role) && dbUser.employeeId) {
        if (e.id !== dbUser.employeeId) return false;
      }
      if (departmentId && departmentId !== 'ALL' && e.departmentId !== Number(departmentId)) {
        return false;
      }
      if (employeeId && employeeId !== 'ALL' && e.id !== Number(employeeId)) {
        return false;
      }
      return true;
    });

    const empMap = new Map(scopedEmps.map((e) => [e.id, e]));

    const rows = (
      await db
        .select()
        .from(attendance)
        .where(and(gte(attendance.date, from), lte(attendance.date, to)))
        .orderBy(desc(attendance.date))
    ).filter((r) => empMap.has(r.employeeId));

    const leaveRows = (
      await db
        .select()
        .from(leaveRequests)
        .where(and(lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
        .orderBy(desc(leaveRequests.createdAt))
    ).filter((l) => empMap.has(l.employeeId));

    // Summary rollups
    const summary = {
      totalRecords: rows.length,
      presentCount: rows.filter((r) =>
        ['Present', 'Late', 'Work From Home', 'Half Day'].includes(r.status)
      ).length,
      lateCount: rows.filter((r) => r.isLate || r.status === 'Late').length,
      absentCount: rows.filter((r) => r.status === 'Absent').length,
      leaveCount: rows.filter((r) => r.status === 'On Leave').length,
      totalWorkingHours:
        Math.round((rows.reduce((sum, r) => sum + r.workingMinutes, 0) / 60) * 10) / 10,
      totalOvertimeHours:
        Math.round((rows.reduce((sum, r) => sum + r.overtimeMinutes, 0) / 60) * 10) / 10,
    };

    // Individual summary
    const byEmployee = scopedEmps.map((emp) => {
      const empRows = rows.filter((r) => r.employeeId === emp.id);
      const present = empRows.filter((r) =>
        ['Present', 'Late', 'Work From Home', 'Half Day'].includes(r.status)
      ).length;
      const late = empRows.filter((r) => r.isLate || r.status === 'Late').length;
      const absent = empRows.filter((r) => r.status === 'Absent').length;
      const onLeave = empRows.filter((r) => r.status === 'On Leave').length;
      const hrs = Math.round((empRows.reduce((s, r) => s + r.workingMinutes, 0) / 60) * 10) / 10;
      const ot = Math.round((empRows.reduce((s, r) => s + r.overtimeMinutes, 0) / 60) * 10) / 10;
      return {
        employeeId: emp.id,
        code: emp.code,
        fullName: emp.fullName,
        departmentName: deptMap.get(emp.departmentId)?.name ?? 'General',
        present,
        late,
        absent,
        onLeave,
        workingHours: hrs,
        overtimeHours: ot,
        attendancePct: empRows.length > 0 ? Math.round((present / empRows.length) * 100) : 0,
      };
    });

    // Department summary
    const byDepartment = allDepts
      .filter((d) =>
        dbUser.role === 'MANAGER' && dbUser.managedDepartmentId
          ? d.id === dbUser.managedDepartmentId
          : departmentId && departmentId !== 'ALL'
            ? d.id === Number(departmentId)
            : true
      )
      .map((dept) => {
        const deptEmpIds = new Set(
          scopedEmps.filter((e) => e.departmentId === dept.id).map((e) => e.id)
        );
        const deptRows = rows.filter((r) => deptEmpIds.has(r.employeeId));
        const present = deptRows.filter((r) =>
          ['Present', 'Late', 'Work From Home', 'Half Day'].includes(r.status)
        ).length;
        const absent = deptRows.filter((r) => r.status === 'Absent').length;
        const late = deptRows.filter((r) => r.isLate || r.status === 'Late').length;
        return {
          departmentId: dept.id,
          name: dept.name,
          code: dept.code,
          records: deptRows.length,
          present,
          absent,
          late,
          attendancePct: deptRows.length > 0 ? Math.round((present / deptRows.length) * 100) : 0,
        };
      });

    const detailedRecords = rows.map((r) => {
      const emp = empMap.get(r.employeeId)!;
      return {
        ...r,
        employeeCode: emp.code,
        employeeName: emp.fullName,
        departmentName: deptMap.get(emp.departmentId)?.name ?? 'General',
      };
    });

    res.json({
      range: { startDate: from, endDate: to },
      summary,
      byEmployee,
      byDepartment,
      detailedRecords,
      leaves: leaveRows.map((l) => ({
        ...l,
        employeeName: empMap.get(l.employeeId)?.fullName ?? '',
        employeeCode: empMap.get(l.employeeId)?.code ?? '',
      })),
    });
  } catch (error) {
    handleApiError(res, error, 'Failed to generate analytics report.');
  }
});

// Audit Logs (Admin / Super Admin only)
apiRouter.get('/audit-logs', requireRole('ADMIN'), async (_req: AuthRequest, res) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    res.json({ logs });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch audit logs.');
  }
});

// ---------------------------------------------------------------------------
// 9. Holidays, Notifications, Policies & QR Sessions
// ---------------------------------------------------------------------------
apiRouter.get('/holidays', async (_req: AuthRequest, res) => {
  try {
    const list = await db.select().from(holidays).orderBy(holidays.date);
    res.json({ holidays: list });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch holiday calendar.');
  }
});

apiRouter.post('/holidays', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const parsed = holidayCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Holiday name and date are required.' });
    }
    const { name, date, category, description } = parsed.data;
    const created = await db
      .insert(holidays)
      .values({
        name,
        date,
        category,
        description,
      })
      .returning();

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'HOLIDAY_CREATED',
      resourceType: 'holiday',
      resourceId: created[0].id,
      ipAddress: req.ip,
      metadata: { name, date },
    });

    res.status(201).json({ holiday: created[0] });
  } catch (error) {
    handleApiError(res, error, 'A holiday is already scheduled on this date.');
  }
});

apiRouter.delete('/holidays/:id', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid holiday ID.' });
    const deleted = await db.delete(holidays).where(eq(holidays.id, id)).returning();
    if (deleted.length === 0) return res.status(404).json({ error: 'Holiday not found.' });

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'HOLIDAY_DELETED',
      resourceType: 'holiday',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ deleted: true });
  } catch (error) {
    handleApiError(res, error, 'Failed to delete holiday.');
  }
});

apiRouter.get('/notifications', async (req: AuthRequest, res) => {
  try {
    const uid = req.dbUser!.uid;
    const allRecent = await db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const visible = allRecent.filter((n) => n.recipientUid === null || n.recipientUid === uid);
    res.json({ notifications: visible });
  } catch (error) {
    handleApiError(res, error, 'Failed to load notifications.');
  }
});

apiRouter.patch('/notifications/:id/read', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid notification ID.' });
    const existing = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    if (existing[0].recipientUid !== null && existing[0].recipientUid !== req.dbUser!.uid) {
      return res.status(403).json({ error: 'Forbidden: Cannot modify another user notification.' });
    }
    const updated = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning();
    res.json({ notification: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to mark notification as read.');
  }
});

apiRouter.post('/notifications/read-all', async (req: AuthRequest, res) => {
  try {
    const uid = req.dbUser!.uid;
    const allRecent = await db
      .select({ id: notifications.id, recipientUid: notifications.recipientUid })
      .from(notifications)
      .where(eq(notifications.isRead, false));
    const ids = allRecent
      .filter((n) => n.recipientUid === null || n.recipientUid === uid)
      .map((n) => n.id);
    if (ids.length > 0) {
      await db.update(notifications).set({ isRead: true }).where(inArray(notifications.id, ids));
    }
    res.json({ updatedCount: ids.length });
  } catch (error) {
    handleApiError(res, error, 'Failed to mark notifications read.');
  }
});

apiRouter.post(
  '/notifications/announcement',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = announcementCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Title and message are required.' });
      }
      const { title, message } = parsed.data;
      const created = await db
        .insert(notifications)
        .values({
          recipientUid: null,
          type: 'announcement',
          title,
          message,
          isRead: false,
        })
        .returning();

      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: 'ANNOUNCEMENT_PUBLISHED',
        resourceType: 'notification',
        resourceId: created[0].id,
        ipAddress: req.ip,
      });

      res.status(201).json({ notification: created[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to publish announcement.');
    }
  }
);

apiRouter.get('/policy', async (_req: AuthRequest, res) => {
  try {
    const policy = await getActivePolicy();
    res.json({ policy });
  } catch (error) {
    handleApiError(res, error, 'Failed to fetch attendance policy.');
  }
});

apiRouter.patch('/policy', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const existing = await getActivePolicy();
    if (!existing) {
      return res.status(404).json({ error: 'Policy record missing.' });
    }
    const parsed = policyUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid policy configuration.' });
    }
    const p = parsed.data;

    const updated = await db
      .update(attendancePolicies)
      .set({
        organizationName: p.organizationName ?? existing.organizationName,
        policyName: p.policyName ?? existing.policyName,
        timezone: p.timezone ?? existing.timezone,
        weekendDays: p.weekendDays ?? existing.weekendDays,
        workdayStart: p.workdayStart ?? existing.workdayStart,
        workdayEnd: p.workdayEnd ?? existing.workdayEnd,
        graceMinutes: p.graceMinutes ?? existing.graceMinutes,
        halfDayMinHours: p.halfDayMinHours ?? existing.halfDayMinHours,
        fullDayMinHours: p.fullDayMinHours ?? existing.fullDayMinHours,
        overtimeAfterHours: p.overtimeAfterHours ?? existing.overtimeAfterHours,
        requireGeoConsent: p.requireGeoConsent ?? existing.requireGeoConsent,
        allowWfh: p.allowWfh ?? existing.allowWfh,
        allowQrCheckIn: p.allowQrCheckIn ?? existing.allowQrCheckIn,
        autoAnomalyDetection: p.autoAnomalyDetection ?? existing.autoAnomalyDetection,
        updatedAt: new Date(),
      })
      .where(eq(attendancePolicies.id, existing.id))
      .returning();

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'POLICY_UPDATED',
      resourceType: 'policy',
      resourceId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ policy: updated[0] });
  } catch (error) {
    handleApiError(res, error, 'Failed to update attendance policy.');
  }
});

apiRouter.get('/qr-sessions', async (_req: AuthRequest, res) => {
  try {
    const now = new Date();
    const list = await db
      .select()
      .from(qrSessions)
      .where(gte(qrSessions.expiresAt, now))
      .orderBy(desc(qrSessions.createdAt))
      .limit(10);
    res.json({ sessions: list });
  } catch (error) {
    handleApiError(res, error, 'Failed to load active QR sessions.');
  }
});

apiRouter.post(
  '/qr-sessions',
  requireRole('ADMIN', 'MANAGER'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = qrSessionCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid QR session settings.' });
      }
      const { label, departmentId, validMinutes } = parsed.data;
      const token = `APQR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + validMinutes * 60000);

      const created = await db
        .insert(qrSessions)
        .values({
          token,
          label,
          departmentId: departmentId ?? null,
          expiresAt,
          createdByUid: req.dbUser!.uid,
        })
        .returning();

      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: 'QR_SESSION_CREATED',
        resourceType: 'qr_session',
        resourceId: created[0].id,
        ipAddress: req.ip,
        metadata: { label, validMinutes },
      });

      res.status(201).json({ session: created[0] });
    } catch (error) {
      handleApiError(res, error, 'Failed to create QR attendance session.');
    }
  }
);
