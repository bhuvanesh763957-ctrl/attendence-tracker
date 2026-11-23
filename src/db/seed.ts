import { sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  attendance,
  attendanceCorrections,
  attendancePolicies,
  departments,
  employees,
  holidays,
  leaveRequests,
  notifications,
  shifts,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

function formatDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function buildUtcTimestamp(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00.000Z`);
}

export async function ensureSeedData(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedIfNeeded().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeedIfNeeded(): Promise<void> {
  try {
    const deptCountRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(departments);
    if ((deptCountRes[0]?.count ?? 0) > 0) {
      return;
    }

    const insertedDepts = await db
      .insert(departments)
      .values([
        { name: 'Engineering', code: 'ENG', managerName: 'Marcus Vance', targetAttendancePct: 96 },
        { name: 'Product & Design', code: 'PRD', managerName: 'Elena Rostova', targetAttendancePct: 95 },
        { name: 'Operations', code: 'OPS', managerName: 'David Okafor', targetAttendancePct: 97 },
        { name: 'Finance & Legal', code: 'FIN', managerName: 'Priya Nair', targetAttendancePct: 98 },
        { name: 'Academic Research', code: 'ACA', managerName: 'Dr. Samuel Lin', targetAttendancePct: 94 },
      ])
      .onConflictDoNothing()
      .returning();

    const insertedShifts = await db
      .insert(shifts)
      .values([
        {
          name: 'Morning Core',
          startTime: '09:00',
          endTime: '17:30',
          gracePeriodMinutes: 15,
          breakMinutes: 45,
          halfDayHours: 4,
          overtimeThresholdHours: 8,
        },
        {
          name: 'Early Operations',
          startTime: '07:30',
          endTime: '16:00',
          gracePeriodMinutes: 10,
          breakMinutes: 45,
          halfDayHours: 4,
          overtimeThresholdHours: 8,
        },
        {
          name: 'Afternoon Research',
          startTime: '12:00',
          endTime: '20:30',
          gracePeriodMinutes: 15,
          breakMinutes: 45,
          halfDayHours: 4,
          overtimeThresholdHours: 8,
        },
      ])
      .onConflictDoNothing()
      .returning();

    const deptList =
      insertedDepts.length > 0 ? insertedDepts : await db.select().from(departments);
    const shiftList =
      insertedShifts.length > 0 ? insertedShifts : await db.select().from(shifts);

    const deptByCode = new Map(deptList.map((d) => [d.code, d.id]));
    const coreShiftId = shiftList[0]?.id ?? 1;
    const earlyShiftId = shiftList[1]?.id ?? coreShiftId;
    const researchShiftId = shiftList[2]?.id ?? coreShiftId;

    const insertedEmps = await db
      .insert(employees)
      .values([
        {
          code: 'EMP-1001',
          fullName: 'Marcus Vance',
          email: 'marcus.vance@northbridge.io',
          phone: '+1 415 555 0142',
          departmentId: deptByCode.get('ENG') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'VP of Engineering',
          memberType: 'employee',
          joiningDate: '2022-03-14',
          status: 'active',
        },
        {
          code: 'EMP-1002',
          fullName: 'Elena Rostova',
          email: 'elena.rostova@northbridge.io',
          phone: '+1 415 555 0188',
          departmentId: deptByCode.get('PRD') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'Principal Product Designer',
          memberType: 'employee',
          joiningDate: '2023-01-09',
          status: 'active',
        },
        {
          code: 'EMP-1003',
          fullName: 'David Okafor',
          email: 'david.okafor@northbridge.io',
          phone: '+1 415 555 0161',
          departmentId: deptByCode.get('OPS') ?? deptList[0].id,
          shiftId: earlyShiftId,
          designation: 'Operations Director',
          memberType: 'employee',
          joiningDate: '2021-08-23',
          status: 'active',
        },
        {
          code: 'EMP-1004',
          fullName: 'Priya Nair',
          email: 'priya.nair@northbridge.io',
          phone: '+1 415 555 0125',
          departmentId: deptByCode.get('FIN') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'Financial Controller',
          memberType: 'employee',
          joiningDate: '2022-11-01',
          status: 'active',
        },
        {
          code: 'EMP-1005',
          fullName: 'Hannah Gallagher',
          email: 'hannah.gallagher@northbridge.io',
          phone: '+1 415 555 0174',
          departmentId: deptByCode.get('ENG') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'Staff Backend Engineer',
          memberType: 'employee',
          joiningDate: '2023-06-12',
          status: 'active',
        },
        {
          code: 'EMP-1006',
          fullName: 'Kenji Takahashi',
          email: 'kenji.takahashi@northbridge.io',
          phone: '+1 415 555 0193',
          departmentId: deptByCode.get('ENG') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'Platform Reliability Engineer',
          memberType: 'employee',
          joiningDate: '2024-02-05',
          status: 'active',
        },
        {
          code: 'EMP-1007',
          fullName: 'Sofia Alverez',
          email: 'sofia.alverez@northbridge.io',
          phone: '+1 415 555 0119',
          departmentId: deptByCode.get('PRD') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'UX Research Lead',
          memberType: 'employee',
          joiningDate: '2023-09-18',
          status: 'active',
        },
        {
          code: 'EMP-1008',
          fullName: 'Lucas Meyer',
          email: 'lucas.meyer@northbridge.io',
          phone: '+1 415 555 0150',
          departmentId: deptByCode.get('OPS') ?? deptList[0].id,
          shiftId: earlyShiftId,
          designation: 'Facilities & Logistics Lead',
          memberType: 'employee',
          joiningDate: '2024-04-22',
          status: 'active',
        },
        {
          code: 'EMP-1009',
          fullName: 'Claire Moreau',
          email: 'claire.moreau@northbridge.io',
          phone: '+1 415 555 0136',
          departmentId: deptByCode.get('FIN') ?? deptList[0].id,
          shiftId: coreShiftId,
          designation: 'Compliance Counsel',
          memberType: 'employee',
          joiningDate: '2023-03-27',
          status: 'active',
        },
        {
          code: 'STU-2001',
          fullName: 'Aarav Patel',
          email: 'aarav.patel@northbridge.edu',
          phone: '+1 415 555 0211',
          departmentId: deptByCode.get('ACA') ?? deptList[0].id,
          shiftId: researchShiftId,
          designation: 'Graduate Research Fellow',
          memberType: 'student',
          joiningDate: '2025-09-01',
          status: 'active',
        },
        {
          code: 'STU-2002',
          fullName: 'Nadia Hassan',
          email: 'nadia.hassan@northbridge.edu',
          phone: '+1 415 555 0234',
          departmentId: deptByCode.get('ACA') ?? deptList[0].id,
          shiftId: researchShiftId,
          designation: 'Doctoral Candidate',
          memberType: 'student',
          joiningDate: '2025-09-01',
          status: 'active',
        },
        {
          code: 'STU-2003',
          fullName: 'Owen Kowalski',
          email: 'owen.kowalski@northbridge.edu',
          phone: '+1 415 555 0287',
          departmentId: deptByCode.get('ACA') ?? deptList[0].id,
          shiftId: researchShiftId,
          designation: 'Applied Data Intern',
          memberType: 'student',
          joiningDate: '2026-01-12',
          status: 'active',
        },
      ])
      .onConflictDoNothing()
      .returning();

    const empList =
      insertedEmps.length > 0 ? insertedEmps : await db.select().from(employees);

    // Seed 14 days of historical attendance records
    const attendanceRows: Array<typeof attendance.$inferInsert> = [];
    for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
      const dateStr = formatDateOffset(dayOffset);
      const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      empList.forEach((emp, idx) => {
        // Leave today mostly unlogged for a few people or logged realistically
        if (dayOffset === 0 && idx >= 10) return;

        let status = 'Present';
        let inTime = '08:54';
        let outTime: string | null = '17:38';
        let breakMins = 45;
        let workingMins = 479;
        let overtimeMins = 0;
        let isLate = false;
        let isEarly = false;
        let method = 'Web';
        let anomalyFlag: string | null = null;

        if ((idx + dayOffset) % 11 === 0) {
          status = 'Late';
          inTime = '09:34';
          outTime = '17:45';
          workingMins = 446;
          isLate = true;
          method = 'QR';
        } else if ((idx + dayOffset) % 13 === 0) {
          status = 'Work From Home';
          inTime = '08:58';
          outTime = '17:40';
          workingMins = 477;
          method = 'WFH';
        } else if ((idx + dayOffset) % 17 === 0) {
          status = 'On Leave';
          workingMins = 0;
          breakMins = 0;
          outTime = null;
          method = 'Manual';
        } else if ((idx + dayOffset) % 19 === 0) {
          status = 'Absent';
          workingMins = 0;
          breakMins = 0;
          outTime = null;
          method = 'Manual';
        } else if (dayOffset === 1 && idx === 5) {
          status = 'Present';
          inTime = '08:52';
          outTime = null;
          workingMins = 0;
          anomalyFlag = 'Missing check-out from prior shift';
          method = 'Geolocation';
        } else if ((idx + dayOffset) % 9 === 0) {
          status = 'Half Day';
          inTime = '09:02';
          outTime = '13:10';
          breakMins = 15;
          workingMins = 233;
          isEarly = true;
          method = 'Web';
        } else if (idx % 4 === 0 && dayOffset % 3 === 0) {
          outTime = '18:55';
          workingMins = 556;
          overtimeMins = 76;
          method = 'QR';
        }

        if (dayOffset === 0) {
          // Active shift today without check-out yet for some employees
          if (idx % 3 === 0) {
            outTime = null;
            workingMins = 0;
            overtimeMins = 0;
          }
        }

        const hasCheckIn = status !== 'Absent' && status !== 'On Leave' && status !== 'Holiday';

        attendanceRows.push({
          employeeId: emp.id,
          date: dateStr,
          status,
          checkInTime: hasCheckIn ? buildUtcTimestamp(dateStr, inTime) : null,
          checkOutTime: hasCheckIn && outTime ? buildUtcTimestamp(dateStr, outTime) : null,
          breakMinutes: breakMins,
          workingMinutes: workingMins,
          overtimeMinutes: overtimeMins,
          isLate,
          isEarlyDeparture: isEarly,
          checkInMethod: method,
          locationLabel:
            method === 'WFH'
              ? 'Remote Workspace'
              : method === 'Geolocation'
                ? 'HQ Campus Perimeter'
                : 'Main Reception',
          anomalyFlag,
          notes: '',
        });
      });
    }

    if (attendanceRows.length > 0) {
      await db.insert(attendance).values(attendanceRows).onConflictDoNothing();
    }

    await db.insert(attendancePolicies).values({
      organizationName: 'Northbridge Enterprise Corp',
      workdayStart: '09:00',
      workdayEnd: '17:30',
      graceMinutes: 15,
      halfDayMinHours: 4,
      fullDayMinHours: 8,
      overtimeAfterHours: 8,
      requireGeoConsent: true,
      allowWfh: true,
      allowQrCheckIn: true,
      autoAnomalyDetection: true,
    });

    await db
      .insert(holidays)
      .values([
        {
          name: 'Founders Convocation Day',
          date: '2026-11-27',
          category: 'Institutional',
          description: 'Annual company-wide briefing and campus holiday.',
        },
        {
          name: 'Winter Break Eve',
          date: '2026-12-24',
          category: 'Public',
          description: 'Facility closed after noon; full holiday credit applied.',
        },
        {
          name: 'Christmas Day',
          date: '2026-12-25',
          category: 'Public',
          description: 'Statutory public holiday across all global offices.',
        },
        {
          name: 'New Year Holiday',
          date: '2027-01-01',
          category: 'Public',
          description: 'Statutory New Year public holiday.',
        },
      ])
      .onConflictDoNothing();

    if (empList.length >= 6) {
      await db.insert(leaveRequests).values([
        {
          employeeId: empList[4].id,
          category: 'Casual Leave',
          startDate: formatDateOffset(-4),
          endDate: formatDateOffset(-3),
          totalDays: 2,
          reason: 'Family travel to Montreal for weekend graduation.',
          status: 'Pending',
        },
        {
          employeeId: empList[6].id,
          category: 'Sick Leave',
          startDate: formatDateOffset(0),
          endDate: formatDateOffset(0),
          totalDays: 1,
          reason: 'Dental surgery recovery; medical note uploaded.',
          attachmentName: 'dental-clinic-note.pdf',
          status: 'Pending',
        },
        {
          employeeId: empList[1].id,
          category: 'Earned Leave',
          startDate: formatDateOffset(-10),
          endDate: formatDateOffset(-14),
          totalDays: 5,
          reason: 'Scheduled annual autumn vacation.',
          status: 'Approved',
          reviewerNote: 'Coverage handed over to Sofia.',
        },
        {
          employeeId: empList[9].id,
          category: 'Personal Leave',
          startDate: formatDateOffset(5),
          endDate: formatDateOffset(5),
          totalDays: 1,
          reason: 'Embassy passport renewal appointment.',
          status: 'Approved',
        },
        {
          employeeId: empList[7].id,
          category: 'Emergency Leave',
          startDate: formatDateOffset(3),
          endDate: formatDateOffset(3),
          totalDays: 1,
          reason: 'Urgent residential plumbing repair.',
          status: 'Rejected',
          reviewerNote: 'Resolved remotely with partial shift swap.',
        },
      ]);

      await db.insert(attendanceCorrections).values([
        {
          employeeId: empList[5].id,
          date: formatDateOffset(1),
          requestedStatus: 'Present',
          requestedCheckIn: '08:52',
          requestedCheckOut: '17:35',
          reason: 'Badge reader failed to log departure at south turnstile.',
          status: 'Pending',
        },
      ]);
    }

    await db.insert(notifications).values([
      {
        recipientUid: null,
        type: 'announcement',
        title: 'Founders Convocation Holiday Scheduled',
        message: 'All offices and research labs will observe Founders Convocation Day on November 27, 2026.',
        isRead: false,
      },
      {
        recipientUid: null,
        type: 'missing_checkout',
        title: 'Missing Check-Out Detected',
        message: 'Kenji Takahashi has an open shift from yesterday without a recorded check-out timestamp.',
        isRead: false,
      },
      {
        recipientUid: null,
        type: 'late_arrival',
        title: 'Late Arrival Logged',
        message: 'A late check-in was recorded past the 15-minute morning grace window.',
        isRead: false,
      },
      {
        recipientUid: null,
        type: 'leave_approved',
        title: 'Earned Leave Request Approved',
        message: 'Elena Rostova’s 5-day earned leave schedule has been approved and synced.',
        isRead: true,
      },
    ]);
  } catch (error) {
    console.error('Database seed failed:', error);
    throw new Error('Failed to initialize workspace records.', { cause: error });
  }
}
