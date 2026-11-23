import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { Department, Employee, ReportsPayload } from '../types/attendance.ts';
import { StatusIndicator } from './StatusBadge.tsx';

type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'individual'
  | 'department'
  | 'late'
  | 'absenteeism'
  | 'leave'
  | 'workingHours';

const REPORT_TYPES: Array<{ id: ReportType; label: string }> = [
  { id: 'daily', label: 'Daily Attendance' },
  { id: 'weekly', label: 'Weekly Attendance' },
  { id: 'monthly', label: 'Monthly Attendance' },
  { id: 'individual', label: 'Individual Attendance' },
  { id: 'department', label: 'Department-wise' },
  { id: 'late', label: 'Late Arrival' },
  { id: 'absenteeism', label: 'Absenteeism' },
  { id: 'leave', label: 'Leave Report' },
  { id: 'workingHours', label: 'Working-Hour Report' },
];

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ReportsView() {
  const { dbUser } = useAuth();
  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [startDate, setStartDate] = useState(() => isoDateDaysAgo(6));
  const [endDate, setEndDate] = useState(() => isoDateDaysAgo(0));
  const [departmentId, setDepartmentId] = useState('ALL');
  const [employeeId, setEmployeeId] = useState('ALL');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [report, setReport] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<{ departments: Department[] }>('/api/departments'),
      apiFetch<{ employees: Employee[] }>('/api/employees'),
    ])
      .then(([dRes, eRes]) => {
        setDepartments(dRes.departments);
        setEmployees(eRes.employees);
      })
      .catch(() => {});
  }, []);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        departmentId,
        employeeId,
      });
      const res = await apiFetch<ReportsPayload>(`/api/reports?${params.toString()}`);
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate report.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, departmentId, employeeId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleSelectReportType = (next: ReportType) => {
    setReportType(next);
    const today = isoDateDaysAgo(0);
    if (next === 'daily') {
      setStartDate(today);
      setEndDate(today);
    } else if (next === 'weekly') {
      setStartDate(isoDateDaysAgo(6));
      setEndDate(today);
    } else if (next === 'monthly') {
      setStartDate(isoDateDaysAgo(29));
      setEndDate(today);
    }
  };

  const tableRows = useMemo(() => {
    if (!report) return [];
    if (reportType === 'late') {
      return report.detailedRecords.filter((r) => r.isLate || r.status === 'Late');
    }
    if (reportType === 'absenteeism') {
      return report.detailedRecords.filter((r) => r.status === 'Absent');
    }
    return report.detailedRecords;
  }, [report, reportType]);

  const handleExportPdf = () => {
    if (!report) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    const title = REPORT_TYPES.find((t) => t.id === reportType)?.label || 'Attendance Report';

    doc.setFontSize(15);
    doc.text(`Attendance Pro — ${title}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Range: ${report.range.startDate} to ${report.range.endDate}`, 14, 22);

    if (reportType === 'department') {
      autoTable(doc, {
        startY: 28,
        head: [['Code', 'Department', 'Records', 'Present', 'Late', 'Absent', 'Compliance %']],
        body: report.byDepartment.map((d) => [
          d.code,
          d.name,
          d.records,
          d.present,
          d.late,
          d.absent,
          `${d.attendancePct}%`,
        ]),
      });
    } else if (reportType === 'leave') {
      autoTable(doc, {
        startY: 28,
        head: [['ID', 'Member', 'Category', 'Start', 'End', 'Days', 'Status']],
        body: report.leaves.map((l) => [
          l.employeeCode || '',
          l.employeeName || '',
          l.category,
          l.startDate,
          l.endDate,
          l.totalDays,
          l.status,
        ]),
      });
    } else if (reportType === 'individual' || reportType === 'workingHours') {
      autoTable(doc, {
        startY: 28,
        head: [['ID', 'Member', 'Department', 'Present', 'Late', 'Absent', 'Hours', 'OT Hours', 'Rate %']],
        body: report.byEmployee.map((e) => [
          e.code,
          e.fullName,
          e.departmentName,
          e.present,
          e.late,
          e.absent,
          e.workingHours,
          e.overtimeHours,
          `${e.attendancePct}%`,
        ]),
      });
    } else {
      autoTable(doc, {
        startY: 28,
        head: [['Date', 'ID', 'Member', 'Department', 'Status', 'Worked (h)', 'OT (h)', 'Method']],
        body: tableRows.map((r) => [
          r.date,
          r.employeeCode || '',
          r.employeeName || '',
          r.departmentName || '',
          r.status,
          (r.workingMinutes / 60).toFixed(1),
          (r.overtimeMinutes / 60).toFixed(1),
          r.checkInMethod,
        ]),
      });
    }

    doc.save(`attendance-pro-${reportType}-${report.range.endDate}.pdf`);
  };

  const handleExportExcel = () => {
    if (!report) return;
    let exportData: Array<Record<string, unknown>> = [];

    if (reportType === 'department') {
      exportData = report.byDepartment.map((d) => ({
        Code: d.code,
        Department: d.name,
        TotalRecords: d.records,
        Present: d.present,
        Late: d.late,
        Absent: d.absent,
        AttendancePct: d.attendancePct,
      }));
    } else if (reportType === 'leave') {
      exportData = report.leaves.map((l) => ({
        MemberID: l.employeeCode,
        MemberName: l.employeeName,
        Category: l.category,
        StartDate: l.startDate,
        EndDate: l.endDate,
        Days: l.totalDays,
        Status: l.status,
        Reason: l.reason,
      }));
    } else if (reportType === 'individual' || reportType === 'workingHours') {
      exportData = report.byEmployee.map((e) => ({
        MemberID: e.code,
        FullName: e.fullName,
        Department: e.departmentName,
        PresentDays: e.present,
        LateDays: e.late,
        AbsentDays: e.absent,
        OnLeaveDays: e.onLeave,
        WorkingHours: e.workingHours,
        OvertimeHours: e.overtimeHours,
        AttendancePct: e.attendancePct,
      }));
    } else {
      exportData = tableRows.map((r) => ({
        Date: r.date,
        MemberID: r.employeeCode,
        FullName: r.employeeName,
        Department: r.departmentName,
        Status: r.status,
        WorkingHours: Number((r.workingMinutes / 60).toFixed(2)),
        OvertimeHours: Number((r.overtimeMinutes / 60).toFixed(2)),
        Method: r.checkInMethod,
        Anomaly: r.anomalyFlag || '',
      }));
    }

    const sheet = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Report');
    XLSX.writeFile(wb, `attendance-pro-${reportType}-${report.range.endDate}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Advanced Analytics &amp; Reports
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Generate audit-ready workforce and student reports with PDF, Excel, and print output.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            disabled={!report}
            onClick={handleExportPdf}
            className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Download aria-hidden="true" className="h-4 w-4 text-[#DC2626]" />
            <span>Export PDF</span>
          </button>

          <button
            type="button"
            disabled={!report}
            onClick={handleExportExcel}
            className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet aria-hidden="true" className="h-4 w-4 text-[#16A34A]" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#111827] dark:bg-[#2563EB] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 cursor-pointer whitespace-nowrap"
          >
            <Printer aria-hidden="true" className="h-4 w-4" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Report Type Selector */}
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-2 no-print">
        {REPORT_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelectReportType(t.id)}
            className={`btn-press rounded-md px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              reportType === t.id
                ? 'bg-[#2563EB] text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-2">
          <label htmlFor="report-start-date" className="text-xs font-medium text-slate-500">
            From
          </label>
          <input
            id="report-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="report-end-date" className="text-xs font-medium text-slate-500">
            To
          </label>
          <input
            id="report-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
          />
        </div>

        {(dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN') && (
          <select
            aria-label="Filter report by department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        {dbUser?.role !== 'EMPLOYEE' && dbUser?.role !== 'STUDENT' && (
          <select
            aria-label="Filter report by member"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="ALL">All Members</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} — {e.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-[#DC2626] dark:text-rose-400">
          {error}
        </div>
      )}

      {loading || !report ? (
        <div className="h-64 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
      ) : (
        <>
          {/* Summary Strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Records', val: report.summary.totalRecords },
              { label: 'Present', val: report.summary.presentCount },
              { label: 'Late', val: report.summary.lateCount },
              { label: 'Absent', val: report.summary.absentCount },
              { label: 'Working Hours', val: `${report.summary.totalWorkingHours}h` },
              { label: 'Overtime Hours', val: `${report.summary.totalOvertimeHours}h` },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4"
              >
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                <p className="mt-1.5 text-xl font-bold font-mono-tabular text-[#111827] dark:text-white">
                  {s.val}
                </p>
              </div>
            ))}
          </div>

          {/* Interactive Visualization */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
            <h2 className="text-base font-semibold text-[#111827] dark:text-white mb-4">
              {reportType === 'department'
                ? 'Department Compliance (%)'
                : reportType === 'workingHours'
                  ? 'Logged Working & Overtime Hours by Member'
                  : 'Member Attendance Summary'}
            </h2>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {reportType === 'department' ? (
                  <BarChart data={report.byDepartment}>
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
                    <Bar dataKey="attendancePct" name="Attendance %" fill="#2563EB" radius={[3, 3, 0, 0]} />
                  </BarChart>
                ) : reportType === 'workingHours' ? (
                  <BarChart data={report.byEmployee}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                    <XAxis dataKey="code" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="workingHours" name="Working Hours" fill="#2563EB" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="overtimeHours" name="Overtime Hours" fill="#16A34A" radius={[3, 3, 0, 0]} />
                  </BarChart>
                ) : (
                  <BarChart data={report.byEmployee}>
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
                    <Bar dataKey="late" name="Late" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="absent" name="Absent" fill="#DC2626" radius={[3, 3, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Report Table */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="overflow-x-auto">
              {reportType === 'department' ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3 text-right">Records</th>
                      <th className="px-4 py-3 text-right">Present</th>
                      <th className="px-4 py-3 text-right">Late</th>
                      <th className="px-4 py-3 text-right">Absent</th>
                      <th className="px-4 py-3 text-right">Compliance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {report.byDepartment.map((d) => (
                      <tr key={d.departmentId}>
                        <td className="px-4 py-3 font-mono-tabular text-xs font-semibold">{d.code}</td>
                        <td className="px-4 py-3 font-medium">{d.name}</td>
                        <td className="px-4 py-3 text-right font-mono-tabular">{d.records}</td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#16A34A]">
                          {d.present}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#D97706]">
                          {d.late}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#DC2626]">
                          {d.absent}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                          {d.attendancePct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : reportType === 'leave' ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Period</th>
                      <th className="px-4 py-3 text-right">Days</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {report.leaves.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No leave entries in scope.
                        </td>
                      </tr>
                    ) : (
                      report.leaves.map((l) => (
                        <tr key={l.id}>
                          <td className="px-4 py-3">
                            <p className="font-medium">{l.employeeName}</p>
                            <p className="font-mono-tabular text-xs text-slate-500">{l.employeeCode}</p>
                          </td>
                          <td className="px-4 py-3 text-xs">{l.category}</td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">
                            {l.startDate} → {l.endDate}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular">{l.totalDays}</td>
                          <td className="px-4 py-3">
                            <StatusIndicator status={l.status} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : reportType === 'individual' || reportType === 'workingHours' ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3 text-right">Present</th>
                      <th className="px-4 py-3 text-right">Late</th>
                      <th className="px-4 py-3 text-right">Absent</th>
                      <th className="px-4 py-3 text-right">Hours</th>
                      <th className="px-4 py-3 text-right">Overtime</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {report.byEmployee.map((e) => (
                      <tr key={e.employeeId}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{e.fullName}</p>
                          <p className="font-mono-tabular text-xs text-slate-500">{e.code}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{e.departmentName}</td>
                        <td className="px-4 py-3 text-right font-mono-tabular">{e.present}</td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#D97706]">
                          {e.late}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#DC2626]">
                          {e.absent}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-medium">
                          {e.workingHours}h
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-[#2563EB]">
                          {e.overtimeHours}h
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                          {e.attendancePct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Worked</th>
                      <th className="px-4 py-3 text-right">Overtime</th>
                      <th className="px-4 py-3">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {tableRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          No records found for this report view.
                        </td>
                      </tr>
                    ) : (
                      tableRows.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-3 font-mono-tabular text-xs">{r.date}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{r.employeeName}</p>
                            <p className="font-mono-tabular text-xs text-slate-500">
                              {r.employeeCode}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs">{r.departmentName}</td>
                          <td className="px-4 py-3">
                            <StatusIndicator status={r.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular">
                            {(r.workingMinutes / 60).toFixed(1)}h
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-[#2563EB]">
                            {(r.overtimeMinutes / 60).toFixed(1)}h
                          </td>
                          <td className="px-4 py-3 text-xs">{r.checkInMethod}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
