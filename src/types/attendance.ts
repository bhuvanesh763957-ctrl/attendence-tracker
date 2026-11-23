export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'STUDENT';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status?: 'active' | 'suspended';
  managedDepartmentId: number | null;
  employeeId: number | null;
  hasPassword?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description?: string;
  managerName: string;
  targetAttendancePct: number;
}

export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakMinutes: number;
  halfDayHours: number;
  overtimeThresholdHours: number;
  isOvernight?: boolean;
  timezone?: string;
}

export interface Employee {
  id: number;
  code: string;
  fullName: string;
  email: string;
  phone: string;
  departmentId: number;
  departmentName?: string;
  departmentCode?: string;
  shiftId: number;
  shiftName?: string;
  shiftWindow?: string;
  designation: string;
  memberType: 'employee' | 'student';
  joiningDate: string;
  status: 'active' | 'inactive';
  casualLeaveBalance: number;
  sickLeaveBalance: number;
  earnedLeaveBalance: number;
  personalLeaveBalance: number;
  emergencyLeaveBalance: number;
}

export type AttendanceStatus =
  | 'Present'
  | 'Absent'
  | 'Late'
  | 'Half Day'
  | 'On Leave'
  | 'Holiday'
  | 'Weekly Off'
  | 'Work From Home';

export interface AttendanceRecord {
  id: number;
  employeeId: number;
  employeeCode?: string;
  employeeName?: string;
  designation?: string;
  departmentId?: number;
  departmentName?: string;
  shiftName?: string;
  date: string;
  status: AttendanceStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes: number;
  breaksJson?: string;
  workingMinutes: number;
  overtimeMinutes: number;
  arrivalDelayMinutes?: number;
  earlyDepartureMinutes?: number;
  isLate: boolean;
  isEarlyDeparture: boolean;
  checkInMethod: string;
  latitude: string | null;
  longitude: string | null;
  locationLabel: string | null;
  anomalyFlag: string | null;
  notes: string;
}

export interface CorrectionRequest {
  id: number;
  attendanceId: number | null;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  date: string;
  requestedStatus: string;
  requestedCheckIn: string;
  requestedCheckOut: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewerNote: string;
  createdAt: string;
}

export type LeaveCategory =
  | 'Casual Leave'
  | 'Sick Leave'
  | 'Earned Leave'
  | 'Personal Leave'
  | 'Emergency Leave';

export interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  departmentName?: string;
  category: LeaveCategory;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  attachmentName: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewerNote: string;
  createdAt: string;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  category: 'Public' | 'Institutional' | 'Optional';
  description: string;
}

export interface NotificationItem {
  id: number;
  recipientUid: string | null;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface AttendancePolicy {
  id: number;
  organizationName: string;
  policyName?: string;
  timezone?: string;
  weekendDays?: string;
  workdayStart: string;
  workdayEnd: string;
  graceMinutes: number;
  halfDayMinHours: number;
  fullDayMinHours: number;
  overtimeAfterHours: number;
  requireGeoConsent: boolean;
  allowWfh: boolean;
  allowQrCheckIn: boolean;
  autoAnomalyDetection: boolean;
}

export interface QrSession {
  id: number;
  token: string;
  label: string;
  departmentId: number | null;
  expiresAt: string;
  createdAt: string;
}

export interface AuditLogItem {
  id: number;
  actorUserId: number | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  metadataJson: string;
  createdAt: string;
}

export interface UserSessionItem {
  id: number;
  userAgent: string;
  ipAddress: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface EmployeeDashboardPayload {
  employee: Employee;
  todayRecord: AttendanceRecord | null;
  monthSummary: {
    daysLogged: number;
    presentDays: number;
    lateDays: number;
    totalWorkingHours: number;
    totalOvertimeHours: number;
    attendancePct: number;
  };
  leaveBalances: {
    casual: number;
    sick: number;
    earned: number;
    personal: number;
    emergency: number;
  };
  recentLogs: AttendanceRecord[];
}

export interface DashboardPayload {
  kpis: {
    totalMembers: number;
    presentToday: number;
    absentToday: number;
    lateArrivals: number;
    onLeave: number;
    attendancePct: number;
  };
  weeklyTrend: Array<{
    date: string;
    present: number;
    late: number;
    absent: number;
    wfh: number;
    onLeave: number;
  }>;
  monthlyTrend?: Array<{
    date: string;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
  }>;
  departmentStats: Array<{
    department: string;
    code: string;
    headcount: number;
    present: number;
    absent: number;
    attendancePct: number;
    targetPct: number;
  }>;
  statusDistribution: Array<{
    name: string;
    value: number;
  }>;
  performanceOverview: Array<{
    employeeId: number;
    code: string;
    fullName: string;
    designation: string;
    daysLogged: number;
    presentDays: number;
    lateDays: number;
    totalWorkingMins: number;
    overtimeMins: number;
  }>;
  anomalies: Array<{
    id: number;
    date: string;
    employeeName: string;
    employeeCode: string;
    flag: string;
    status: string;
  }>;
  pendingApprovals: {
    leaves: number;
    corrections: number;
  };
}

export interface ReportsPayload {
  range: { startDate: string; endDate: string };
  summary: {
    totalRecords: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    leaveCount: number;
    totalWorkingHours: number;
    totalOvertimeHours: number;
  };
  byEmployee: Array<{
    employeeId: number;
    code: string;
    fullName: string;
    departmentName: string;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    workingHours: number;
    overtimeHours: number;
    attendancePct: number;
  }>;
  byDepartment: Array<{
    departmentId: number;
    name: string;
    code: string;
    records: number;
    present: number;
    absent: number;
    late: number;
    attendancePct: number;
  }>;
  detailedRecords: AttendanceRecord[];
  leaves: LeaveRequest[];
}
