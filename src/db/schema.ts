import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  description: text('description').notNull().default(''),
  managerName: text('manager_name').notNull(),
  targetAttendancePct: integer('target_attendance_pct').notNull().default(95),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const shifts = pgTable('shifts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  startTime: text('start_time').notNull(), // HH:mm
  endTime: text('end_time').notNull(), // HH:mm
  gracePeriodMinutes: integer('grace_period_minutes').notNull().default(15),
  breakMinutes: integer('break_minutes').notNull().default(45),
  halfDayHours: integer('half_day_hours').notNull().default(4),
  overtimeThresholdHours: integer('overtime_threshold_hours').notNull().default(8),
  isOvernight: boolean('is_overnight').notNull().default(false),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const employees = pgTable(
  'employees',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(), // Employee ID or Student ID
    fullName: text('full_name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone').notNull().default(''),
    departmentId: integer('department_id')
      .references(() => departments.id, { onDelete: 'restrict' })
      .notNull(),
    shiftId: integer('shift_id')
      .references(() => shifts.id, { onDelete: 'restrict' })
      .notNull(),
    designation: text('designation').notNull(),
    memberType: text('member_type').notNull().default('employee'), // 'employee' | 'student'
    joiningDate: text('joining_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull().default('active'), // 'active' | 'inactive'
    casualLeaveBalance: integer('casual_leave_balance').notNull().default(8),
    sickLeaveBalance: integer('sick_leave_balance').notNull().default(10),
    earnedLeaveBalance: integer('earned_leave_balance').notNull().default(15),
    personalLeaveBalance: integer('personal_leave_balance').notNull().default(5),
    emergencyLeaveBalance: integer('emergency_leave_balance').notNull().default(4),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('employees_department_idx').on(table.departmentId)]
);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(), // Firebase Auth UID or local_<uuid>
    email: text('email').notNull(),
    displayName: text('display_name').notNull().default(''),
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('EMPLOYEE'), // 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'STUDENT'
    status: text('status').notNull().default('active'), // 'active' | 'suspended'
    managedDepartmentId: integer('managed_department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    employeeId: integer('employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    jti: text('jti').notNull().unique(),
    userAgent: text('user_agent').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('user_sessions_user_idx').on(table.userId)]
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email').notNull().default('system'),
    actorRole: text('actor_role').notNull().default('SYSTEM'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_created_idx').on(table.createdAt)]
);

export const attendance = pgTable(
  'attendance',
  {
    id: serial('id').primaryKey(),
    employeeId: integer('employee_id')
      .references(() => employees.id, { onDelete: 'cascade' })
      .notNull(),
    date: text('date').notNull(), // YYYY-MM-DD (Asia/Kolkata by default)
    status: text('status').notNull(), // Present | Absent | Late | Half Day | On Leave | Holiday | Weekly Off | Work From Home
    checkInTime: timestamp('check_in_time'),
    checkOutTime: timestamp('check_out_time'),
    breakMinutes: integer('break_minutes').notNull().default(0),
    breaksJson: text('breaks_json').notNull().default('[]'),
    workingMinutes: integer('working_minutes').notNull().default(0),
    overtimeMinutes: integer('overtime_minutes').notNull().default(0),
    arrivalDelayMinutes: integer('arrival_delay_minutes').notNull().default(0),
    earlyDepartureMinutes: integer('early_departure_minutes').notNull().default(0),
    isLate: boolean('is_late').notNull().default(false),
    isEarlyDeparture: boolean('is_early_departure').notNull().default(false),
    checkInMethod: text('check_in_method').notNull().default('Manual'), // Manual | Web | QR | Geolocation | WFH
    latitude: text('latitude'),
    longitude: text('longitude'),
    locationLabel: text('location_label'),
    anomalyFlag: text('anomaly_flag'),
    notes: text('notes').notNull().default(''),
    markedByUid: text('marked_by_uid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('attendance_employee_date_idx').on(table.employeeId, table.date),
    index('attendance_date_idx').on(table.date),
  ]
);

export const attendanceCorrections = pgTable('attendance_corrections', {
  id: serial('id').primaryKey(),
  attendanceId: integer('attendance_id').references(() => attendance.id, {
    onDelete: 'set null',
  }),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  date: text('date').notNull(),
  requestedStatus: text('requested_status').notNull(),
  requestedCheckIn: text('requested_check_in').notNull(), // HH:mm
  requestedCheckOut: text('requested_check_out').notNull(), // HH:mm
  reason: text('reason').notNull(),
  status: text('status').notNull().default('Pending'), // Pending | Approved | Rejected
  reviewedByUid: text('reviewed_by_uid'),
  reviewerNote: text('reviewer_note').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const leaveRequests = pgTable('leave_requests', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  category: text('category').notNull(),
  startDate: text('start_date').notNull(), // YYYY-MM-DD
  endDate: text('end_date').notNull(), // YYYY-MM-DD
  totalDays: integer('total_days').notNull(),
  reason: text('reason').notNull(),
  attachmentName: text('attachment_name'),
  status: text('status').notNull().default('Pending'), // Pending | Approved | Rejected
  reviewerNote: text('reviewer_note').notNull().default(''),
  reviewedByUid: text('reviewed_by_uid'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const holidays = pgTable('holidays', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  date: text('date').notNull().unique(), // YYYY-MM-DD
  category: text('category').notNull().default('Public'), // Public | Institutional | Optional
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  recipientUid: text('recipient_uid'), // null = org-wide broadcast
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const attendancePolicies = pgTable('attendance_policies', {
  id: serial('id').primaryKey(),
  policyName: text('policy_name').notNull().default('Standard Enterprise Policy'),
  organizationName: text('organization_name').notNull().default('Northbridge Enterprise Corp'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  weekendDays: text('weekend_days').notNull().default('0,6'),
  workdayStart: text('workday_start').notNull().default('09:00'),
  workdayEnd: text('workday_end').notNull().default('17:30'),
  graceMinutes: integer('grace_minutes').notNull().default(15),
  halfDayMinHours: integer('half_day_min_hours').notNull().default(4),
  fullDayMinHours: integer('full_day_min_hours').notNull().default(8),
  overtimeAfterHours: integer('overtime_after_hours').notNull().default(8),
  requireGeoConsent: boolean('require_geo_consent').notNull().default(true),
  allowWfh: boolean('allow_wfh').notNull().default(true),
  allowQrCheckIn: boolean('allow_qr_check_in').notNull().default(true),
  autoAnomalyDetection: boolean('auto_anomaly_detection').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const qrSessions = pgTable('qr_sessions', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  label: text('label').notNull(),
  departmentId: integer('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  expiresAt: timestamp('expires_at').notNull(),
  createdByUid: text('created_by_uid').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const departmentsRelations = relations(departments, ({ many }) => ({
  employees: many(employees),
}));

export const shiftsRelations = relations(shifts, ({ many }) => ({
  employees: many(employees),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  department: one(departments, {
    fields: [employees.departmentId],
    references: [departments.id],
  }),
  shift: one(shifts, {
    fields: [employees.shiftId],
    references: [shifts.id],
  }),
  attendanceRecords: many(attendance),
  leaveRequests: many(leaveRequests),
  corrections: many(attendanceCorrections),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  employee: one(employees, {
    fields: [users.employeeId],
    references: [employees.id],
  }),
  sessions: many(userSessions),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  employee: one(employees, {
    fields: [attendance.employeeId],
    references: [employees.id],
  }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [leaveRequests.employeeId],
    references: [employees.id],
  }),
}));

export const attendanceCorrectionsRelations = relations(attendanceCorrections, ({ one }) => ({
  employee: one(employees, {
    fields: [attendanceCorrections.employeeId],
    references: [employees.id],
  }),
  attendanceRecord: one(attendance, {
    fields: [attendanceCorrections.attendanceId],
    references: [attendance.id],
  }),
}));
