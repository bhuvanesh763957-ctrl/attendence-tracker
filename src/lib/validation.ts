import { z } from 'zod';

const STATUS_ALIASES: Record<string, string> = {
  PRESENT: 'Present',
  Present: 'Present',
  ABSENT: 'Absent',
  Absent: 'Absent',
  LATE: 'Late',
  Late: 'Late',
  HALF_DAY: 'Half Day',
  'Half Day': 'Half Day',
  ON_LEAVE: 'On Leave',
  'On Leave': 'On Leave',
  HOLIDAY: 'Holiday',
  Holiday: 'Holiday',
  WEEKLY_OFF: 'Weekly Off',
  'Weekly Off': 'Weekly Off',
  WORK_FROM_HOME: 'Work From Home',
  'Work From Home': 'Work From Home',
};

export function normalizeAttendanceStatus(input: string): string {
  return STATUS_ALIASES[input.trim()] ?? 'Present';
}

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128)
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: strongPasswordSchema,
  role: z.enum(['EMPLOYEE', 'STUDENT']).optional().default('EMPLOYEE'),
  memberCode: z.string().trim().min(2).max(32).optional(),
  phone: z.string().trim().max(32).optional().default(''),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(180),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16).max(256),
  newPassword: strongPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(32).optional(),
});

export const checkInSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  method: z.enum(['Web', 'QR', 'Geolocation', 'WFH']).optional().default('Web'),
  qrToken: z.string().trim().max(120).optional(),
  latitude: z.string().trim().max(40).optional(),
  longitude: z.string().trim().max(40).optional(),
  locationLabel: z.string().trim().max(180).optional(),
  geoConsent: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const checkOutSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  breakMinutes: z.number().int().min(0).max(360).optional(),
});

export const breakSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  addMinutes: z.number().int().min(1).max(240),
  label: z.string().trim().max(80).optional(),
});

export const markAttendanceSchema = z.object({
  employeeId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().trim().min(2).max(40),
  checkInTimeStr: z.string().trim().max(16).optional().nullable(),
  checkOutTimeStr: z.string().trim().max(16).optional().nullable(),
  breakMinutes: z.number().int().min(0).max(480).optional().default(0),
  notes: z.string().trim().max(500).optional().default(''),
});

export const updateAttendanceSchema = z.object({
  status: z.string().trim().min(2).max(40).optional(),
  checkInTimeStr: z.string().trim().max(16).optional().nullable(),
  checkOutTimeStr: z.string().trim().max(16).optional().nullable(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const correctionCreateSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedStatus: z.string().trim().min(2).max(40),
  requestedCheckIn: z.string().regex(/^\d{2}:\d{2}$/),
  requestedCheckOut: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(3).max(500),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(['Approved', 'Rejected']),
  reviewerNote: z.string().trim().max(500).optional(),
});

export const leaveCreateSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  category: z.enum([
    'Casual Leave',
    'Sick Leave',
    'Earned Leave',
    'Personal Leave',
    'Emergency Leave',
  ]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(600),
  attachmentName: z.string().trim().max(180).optional(),
});

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(16),
  description: z.string().trim().max(400).optional().default(''),
  managerName: z.string().trim().min(2).max(120),
  targetAttendancePct: z.coerce.number().int().min(50).max(100).optional().default(95),
});

export const shiftCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriodMinutes: z.coerce.number().int().min(0).max(180).optional().default(15),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional().default(45),
  halfDayHours: z.coerce.number().int().min(1).max(12).optional().default(4),
  overtimeThresholdHours: z.coerce.number().int().min(1).max(16).optional().default(8),
  isOvernight: z.boolean().optional().default(false),
  timezone: z.string().trim().min(2).max(64).optional().default('Asia/Kolkata'),
});

export const employeeCreateSchema = z.object({
  code: z.string().trim().min(2).max(32),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().max(32).optional().default(''),
  departmentId: z.coerce.number().int().positive(),
  shiftId: z.coerce.number().int().positive(),
  designation: z.string().trim().min(2).max(120),
  memberType: z.enum(['employee', 'student']).optional().default('employee'),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const employeeUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(180).optional(),
  phone: z.string().trim().max(32).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  designation: z.string().trim().min(2).max(120).optional(),
  memberType: z.enum(['employee', 'student']).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const holidayCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['Public', 'Institutional', 'Optional']).optional().default('Public'),
  description: z.string().trim().max(400).optional().default(''),
});

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  message: z.string().trim().min(3).max(1000),
});

export const policyUpdateSchema = z.object({
  organizationName: z.string().trim().min(2).max(160).optional(),
  policyName: z.string().trim().min(2).max(160).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  weekendDays: z
    .string()
    .trim()
    .regex(/^[0-6](,[0-6])*$/, 'Weekend days must be comma-separated digits 0–6.')
    .optional(),
  workdayStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workdayEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).optional(),
  halfDayMinHours: z.coerce.number().int().min(1).max(12).optional(),
  fullDayMinHours: z.coerce.number().int().min(1).max(16).optional(),
  overtimeAfterHours: z.coerce.number().int().min(1).max(16).optional(),
  requireGeoConsent: z.boolean().optional(),
  allowWfh: z.boolean().optional(),
  allowQrCheckIn: z.boolean().optional(),
  autoAnomalyDetection: z.boolean().optional(),
});

export const qrSessionCreateSchema = z.object({
  label: z.string().trim().min(2).max(120).optional().default('Main Lobby Turnstile'),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  validMinutes: z.coerce.number().int().min(5).max(480).optional().default(60),
});

export const userRoleUpdateSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE', 'STUDENT']).optional(),
  managedDepartmentId: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
