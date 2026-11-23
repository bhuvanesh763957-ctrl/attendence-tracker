import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Home,
  LogIn,
  LogOut,
  Percent,
  RefreshCw,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { AttendanceRecord, DashboardPayload, EmployeeDashboardPayload } from '../types/attendance.ts';
import { NavKey } from './AppShell.tsx';
import { StatusIndicator } from './StatusBadge.tsx';

interface DashboardViewProps {
  onNavigate: (nav: NavKey) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const CHART_COLORS: Record<string, string> = {
  Present: '#16A34A',
  Late: '#F59E0B',
  'Work From Home': '#2563EB',
  'Half Day': '#D97706',
  'On Leave': '#64748B',
  Absent: '#DC2626',
};

function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function DashboardView({ onNavigate, onNotify }: DashboardViewProps) {
  const { dbUser, employee, policy } = useAuth();
  const isStaffSelf = dbUser?.role === 'EMPLOYEE' || dbUser?.role === 'STUDENT';
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [empDash, setEmpDash] = useState<EmployeeDashboardPayload | null>(null);
  const [myToday, setMyToday] = useState<AttendanceRecord | null>(null);
  const [trendRange, setTrendRange] = useState<'7d' | '30d'>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dash, todayRes, empRes] = await Promise.all([
        apiFetch<DashboardPayload>('/api/dashboard'),
        employee
          ? apiFetch<{ records: AttendanceRecord[] }>('/api/attendance/today')
          : Promise.resolve({ records: [] }),
        isStaffSelf && employee
          ? apiFetch<EmployeeDashboardPayload>('/api/dashboard/employee').catch(() => null)
          : Promise.resolve(null),
      ]);
      setData(dash);
      setEmpDash(empRes);
      setMyToday(
        employee ? todayRes.records.find((r) => r.employeeId === employee.id) ?? null : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard analytics.');
    } finally {
      setLoading(false);
    }
  }, [employee, isStaffSelf]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleQuickCheckIn = async (method: 'Web' | 'WFH') => {
    setActionLoading(true);
    try {
      await apiFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ method }),
      });
      onNotify(method === 'WFH' ? 'Checked in as Work From Home.' : 'Checked in successfully.');
      await loadDashboard();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Check-in failed.', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickCheckOut = async () => {
    setActionLoading(true);
    try {
      await apiFetch('/api/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onNotify('Checked out and working hours calculated.');
      await loadDashboard();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Check-out failed.', true);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-28 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3"
            >
              <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="h-7 w-16 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 h-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
          <div className="lg:col-span-5 h-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-[#111827] p-6">
        <p className="text-sm font-medium text-[#DC2626] dark:text-rose-400">
          {error || 'Dashboard data unavailable.'}
        </p>
        <button
          type="button"
          onClick={loadDashboard}
          className="btn-press mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  const kpiCards = [
    {
      label: 'Total Members',
      value: data.kpis.totalMembers,
      icon: Users,
      accent: 'text-[#111827] dark:text-white',
    },
    {
      label: 'Present Today',
      value: data.kpis.presentToday,
      icon: UserCheck,
      accent: 'text-[#16A34A] dark:text-emerald-400',
    },
    {
      label: 'Absent Today',
      value: data.kpis.absentToday,
      icon: UserMinus,
      accent: 'text-[#DC2626] dark:text-rose-400',
    },
    {
      label: 'Late Arrivals',
      value: data.kpis.lateArrivals,
      icon: Clock,
      accent: 'text-[#D97706] dark:text-amber-400',
    },
    {
      label: 'On Leave',
      value: data.kpis.onLeave,
      icon: CalendarClock,
      accent: 'text-slate-600 dark:text-slate-300',
    },
    {
      label: 'Attendance Rate',
      value: `${data.kpis.attendancePct}%`,
      icon: Percent,
      accent: 'text-[#2563EB] dark:text-blue-400',
    },
  ];

  const trendChartData =
    trendRange === '30d' && data.monthlyTrend && data.monthlyTrend.length > 0
      ? data.monthlyTrend.map((d) => ({
          ...d,
          wfh: 0,
          label: d.date.slice(5),
        }))
      : data.weeklyTrend.map((d) => ({
          ...d,
          label: d.date.slice(5),
        }));

  return (
    <div className="space-y-6">
      {/* Header & Quick Self-Service Action Strip */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Executive Attendance Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {dbUser?.role === 'MANAGER'
              ? 'Department-scoped live attendance, shift punctuality, and exception metrics.'
              : isStaffSelf
                ? `Personal attendance log, monthly working hours (${empDash ? `${empDash.monthSummary.totalWorkingHours}h` : '0h'}), and shift status.`
                : 'Organization-wide live attendance, department compliance, and anomaly telemetry.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {employee && !myToday?.checkInTime && (
            <>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleQuickCheckIn('Web')}
                className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>Check In</span>
              </button>
              {policy?.allowWfh !== false && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleQuickCheckIn('WFH')}
                  className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  <Home aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span>WFH Check-In</span>
                </button>
              )}
            </>
          )}

          {employee && myToday?.checkInTime && !myToday.checkOutTime && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleQuickCheckOut}
              className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#111827] dark:bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Check Out</span>
            </button>
          )}

          {employee && myToday?.checkInTime && myToday.checkOutTime && (
            <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-[#16A34A] shrink-0" />
              <span className="tabular-nums">
                Shift completed ({(myToday.workingMinutes / 60).toFixed(1)}h logged)
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => onNavigate('attendance')}
            className="btn-press inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
          >
            <span>Attendance Console</span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Personal Employee / Student Overview Strip */}
      {isStaffSelf && empDash && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                My Month-to-Date Summary
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#111827] dark:text-slate-100">
                <span>
                  Today:{' '}
                  {empDash.todayRecord ? (
                    <span className="font-mono-tabular font-semibold">
                      {formatClockTime(empDash.todayRecord.checkInTime)} –{' '}
                      {formatClockTime(empDash.todayRecord.checkOutTime)}
                    </span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">Not checked in yet</span>
                  )}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span>
                  Logged:{' '}
                  <strong className="font-mono-tabular">
                    {empDash.monthSummary.totalWorkingHours}h
                  </strong>
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span>
                  Overtime:{' '}
                  <strong className="font-mono-tabular text-[#2563EB] dark:text-blue-400">
                    {empDash.monthSummary.totalOvertimeHours}h
                  </strong>
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span>
                  Present:{' '}
                  <strong className="font-mono-tabular">
                    {empDash.monthSummary.presentDays}/{empDash.monthSummary.daysLogged}
                  </strong>{' '}
                  days
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs shrink-0">
              <div className="space-y-0.5">
                <span className="text-slate-500 dark:text-slate-400">Leave Balances</span>
                <p className="font-mono-tabular text-slate-700 dark:text-slate-200">
                  Casual {empDash.leaveBalances.casual}d · Sick {empDash.leaveBalances.sick}d ·
                  Earned {empDash.leaveBalances.earned}d
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('leaves')}
                className="btn-press rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                Apply Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                  {card.label}
                </span>
                <Icon aria-hidden="true" className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
              </div>
              <p className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${card.accent}`}>
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Primary Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Weekly / Monthly Attendance Trend */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#111827] dark:text-white">
                {trendRange === '7d' ? '7-Day Attendance Trend' : '30-Day Attendance Trend'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {trendRange === '7d'
                  ? 'Daily breakdown across Present, WFH, Late, Leave, and Absent'
                  : 'Rolling 30-day attendance volume across Present, Late, Leave, and Absent'}
              </p>
            </div>

            <div
              role="group"
              aria-label="Trend window"
              className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-0.5 shrink-0"
            >
              <button
                type="button"
                onClick={() => setTrendRange('7d')}
                className={`btn-press rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                  trendRange === '7d'
                    ? 'bg-white dark:bg-[#111827] text-[#111827] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#111827] dark:hover:text-white'
                }`}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => setTrendRange('30d')}
                className={`btn-press rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                  trendRange === '30d'
                    ? 'bg-white dark:bg-[#111827] text-[#111827] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#111827] dark:hover:text-white'
                }`}
              >
                30 Days
              </button>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  interval={trendRange === '30d' ? 4 : 0}
                />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="present" name="Present" stackId="a" fill="#16A34A" radius={[0, 0, 0, 0]} />
                {trendRange === '7d' && (
                  <Bar dataKey="wfh" name="WFH" stackId="a" fill="#2563EB" />
                )}
                <Bar dataKey="late" name="Late" stackId="a" fill="#F59E0B" />
                <Bar dataKey="onLeave" name="On Leave" stackId="a" fill="#64748B" />
                <Bar dataKey="absent" name="Absent" stackId="a" fill="#DC2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution Donut */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col">
          <div>
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">
              14-Day Status Distribution
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Aggregate attendance classifications logged over the last two weeks
            </p>
          </div>

          {data.statusDistribution.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500 py-12">
              No attendance records logged in this window.
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 items-center gap-4 mt-2">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.statusDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {data.statusDistribution.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={CHART_COLORS[entry.name] || '#94A3B8'}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2.5 text-xs">
                {data.statusDistribution.map((item) => (
                  <li key={item.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: CHART_COLORS[item.name] || '#94A3B8' }}
                      />
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="font-mono-tabular font-semibold text-[#111827] dark:text-white shrink-0">
                      {item.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Department Comparison & Present vs Absent */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">
              Department Compliance vs Target (%)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Today&apos;s attendance rate benchmarked against departmental SLA
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.departmentStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="code" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="attendancePct" name="Actual %" fill="#2563EB" radius={[3, 3, 0, 0]} />
                <Bar dataKey="targetPct" name="Target %" fill="#94A3B8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">
              Present vs Absent Headcount by Department
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live daily headcount split across active teams
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.departmentStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="code" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="present" name="Present" fill="#16A34A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="absent" name="Absent / Unmarked" fill="#DC2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Employee Performance Overview & Anomaly Queue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#111827] dark:text-white">
                Member Performance Overview (Last 14 Days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Punctuality, working hours, and overtime breakdown
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="btn-press text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Full Reports
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3 text-right">Present</th>
                  <th className="px-4 py-3 text-right">Late</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3 text-right">Overtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.performanceOverview.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      No employee activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.performanceOverview.map((row) => (
                    <tr key={row.employeeId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#111827] dark:text-white">{row.fullName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{row.designation}</p>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600 dark:text-slate-300">
                        {row.code}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular">
                        {row.presentDays}/{row.daysLogged}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular text-[#D97706] dark:text-amber-400">
                        {row.lateDays}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular font-medium">
                        {(row.totalWorkingMins / 60).toFixed(1)}h
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular text-[#2563EB] dark:text-blue-400">
                        {(row.overtimeMins / 60).toFixed(1)}h
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">
              Pending Reviews
            </h2>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => onNavigate('leaves')}
                className="btn-press w-full flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
              >
                <span className="text-slate-700 dark:text-slate-300">Leave Requests</span>
                <span className="font-mono-tabular font-semibold text-[#2563EB] dark:text-blue-400">
                  {data.pendingApprovals.leaves}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="btn-press w-full flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
              >
                <span className="text-slate-700 dark:text-slate-300">Attendance Corrections</span>
                <span className="font-mono-tabular font-semibold text-[#2563EB] dark:text-blue-400">
                  {data.pendingApprovals.corrections}
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" className="h-4 w-4 text-[#D97706]" />
              <h2 className="text-base font-semibold text-[#111827] dark:text-white">
                Detected Anomalies
              </h2>
            </div>
            <div className="mt-3 space-y-2.5">
              {data.anomalies.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  No attendance anomalies detected across the active window.
                </p>
              ) : (
                data.anomalies.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#111827] dark:text-white truncate">
                        {item.employeeName}
                      </span>
                      <span className="font-mono-tabular text-slate-500 shrink-0">{item.date}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{item.flag}</p>
                    <div className="pt-0.5">
                      <StatusIndicator status={item.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
