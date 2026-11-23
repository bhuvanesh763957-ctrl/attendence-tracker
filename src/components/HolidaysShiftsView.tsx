import { Building2, CalendarDays, Clock, Plus, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { Department, Holiday, Shift } from '../types/attendance.ts';
import { ConfirmModal, Modal } from './Modal.tsx';

interface HolidaysShiftsViewProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

export function HolidaysShiftsView({ onNotify }: HolidaysShiftsViewProps) {
  const { dbUser } = useAuth();
  const isAdmin = dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN';

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    date: new Date().toISOString().slice(0, 10),
    category: 'Public',
    description: '',
  });

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    name: '',
    startTime: '09:00',
    endTime: '17:30',
    gracePeriodMinutes: 15,
    breakMinutes: 45,
    halfDayHours: 4,
    overtimeThresholdHours: 8,
    isOvernight: false,
  });

  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({
    name: '',
    code: '',
    description: '',
    managerName: '',
    targetAttendancePct: 95,
  });

  const [submitting, setSubmitting] = useState(false);
  const [deleteHolidayTarget, setDeleteHolidayTarget] = useState<Holiday | null>(null);
  const [deletingHoliday, setDeletingHoliday] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, sRes, dRes] = await Promise.all([
        apiFetch<{ holidays: Holiday[] }>('/api/holidays'),
        apiFetch<{ shifts: Shift[] }>('/api/shifts'),
        apiFetch<{ departments: Department[] }>('/api/departments'),
      ]);
      setHolidays(hRes.holidays);
      setShifts(sRes.shifts);
      setDepartments(dRes.departments);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load schedules.', true);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleAddHoliday = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/holidays', {
        method: 'POST',
        body: JSON.stringify(holidayForm),
      });
      onNotify(`Added holiday: ${holidayForm.name}.`);
      setHolidayModalOpen(false);
      setHolidayForm((p) => ({ ...p, name: '', description: '' }));
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add holiday.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeleteHoliday = async () => {
    if (!deleteHolidayTarget) return;
    setDeletingHoliday(true);
    try {
      await apiFetch(`/api/holidays/${deleteHolidayTarget.id}`, { method: 'DELETE' });
      onNotify(`Holiday "${deleteHolidayTarget.name}" removed.`);
      setDeleteHolidayTarget(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true);
    } finally {
      setDeletingHoliday(false);
    }
  };

  const handleAddShift = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/shifts', {
        method: 'POST',
        body: JSON.stringify(shiftForm),
      });
      onNotify(`Created shift: ${shiftForm.name}.`);
      setShiftModalOpen(false);
      setShiftForm((p) => ({ ...p, name: '' }));
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create shift.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDepartment = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/departments', {
        method: 'POST',
        body: JSON.stringify(deptForm),
      });
      onNotify(`Created department: ${deptForm.name}.`);
      setDeptModalOpen(false);
      setDeptForm({ name: '', code: '', description: '', managerName: '', targetAttendancePct: 95 });
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create department.', true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
        <div className="h-48 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
          Holiday Calendar, Shifts &amp; Departments
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure official institutional holidays, shift schedules, and departmental attendance targets.
        </p>
      </div>

      {/* Holiday Calendar */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">Holiday Calendar</h2>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setHolidayModalOpen(true)}
              className="btn-press inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Add Holiday</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Holiday Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                {isAdmin && <th className="px-4 py-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-slate-500">
                    No holidays scheduled.
                  </td>
                </tr>
              ) : (
                holidays.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 font-mono-tabular text-xs font-medium">{h.date}</td>
                    <td className="px-4 py-3 font-medium">{h.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {h.category}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {h.description || '—'}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDeleteHolidayTarget(h)}
                          aria-label={`Delete ${h.name}`}
                          className="btn-press inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-[#DC2626] hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Management */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Clock aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">Shift Schedules</h2>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShiftModalOpen(true)}
              className="btn-press inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Add Shift</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Shift Name</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3 text-right">Grace</th>
                <th className="px-4 py-3 text-right">Break</th>
                <th className="px-4 py-3 text-right">Half-Day Threshold</th>
                <th className="px-4 py-3 text-right">Overtime After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono-tabular text-xs">
                    {s.startTime} – {s.endTime}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs">
                    {s.gracePeriodMinutes}m
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs">
                    {s.breakMinutes}m
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs">
                    {s.halfDayHours}h
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs">
                    {s.overtimeThresholdHours}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Departments */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">Departments</h2>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeptModalOpen(true)}
              className="btn-press inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Add Department</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Department Name</th>
                <th className="px-4 py-3">Lead / Coordinator</th>
                <th className="px-4 py-3 text-right">Target SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {departments.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[#2563EB]">
                    {d.code}
                  </td>
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {d.managerName}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs font-semibold">
                    {d.targetAttendancePct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Holiday Modal */}
      <Modal
        open={holidayModalOpen}
        onClose={() => setHolidayModalOpen(false)}
        title="Add Official Holiday"
      >
        <form onSubmit={handleAddHoliday} className="space-y-4">
          <div>
            <label htmlFor="holiday-name" className="block text-xs font-medium mb-1">
              Holiday Name
            </label>
            <input
              id="holiday-name"
              type="text"
              required
              value={holidayForm.name}
              onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="holiday-date" className="block text-xs font-medium mb-1">
                Date
              </label>
              <input
                id="holiday-date"
                type="date"
                required
                value={holidayForm.date}
                onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="holiday-category" className="block text-xs font-medium mb-1">
                Category
              </label>
              <select
                id="holiday-category"
                value={holidayForm.category}
                onChange={(e) => setHolidayForm({ ...holidayForm, category: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="Public">Public</option>
                <option value="Institutional">Institutional</option>
                <option value="Optional">Optional</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="holiday-desc" className="block text-xs font-medium mb-1">
              Description
            </label>
            <input
              id="holiday-desc"
              type="text"
              value={holidayForm.description}
              onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHolidayModalOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              Save Holiday
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Shift Modal */}
      <Modal
        open={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title="Create Shift Schedule"
      >
        <form onSubmit={handleAddShift} className="space-y-4">
          <div>
            <label htmlFor="shift-name" className="block text-xs font-medium mb-1">
              Shift Name
            </label>
            <input
              id="shift-name"
              type="text"
              required
              value={shiftForm.name}
              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
              placeholder="e.g. Evening Support Shift"
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shift-start" className="block text-xs font-medium mb-1">
                Start Time
              </label>
              <input
                id="shift-start"
                type="time"
                required
                value={shiftForm.startTime}
                onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="shift-end" className="block text-xs font-medium mb-1">
                End Time
              </label>
              <input
                id="shift-end"
                type="time"
                required
                value={shiftForm.endTime}
                onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shift-grace" className="block text-xs font-medium mb-1">
                Grace Period (min)
              </label>
              <input
                id="shift-grace"
                type="number"
                value={shiftForm.gracePeriodMinutes}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, gracePeriodMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="shift-break" className="block text-xs font-medium mb-1">
                Break Allowance (min)
              </label>
              <input
                id="shift-break"
                type="number"
                value={shiftForm.breakMinutes}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, breakMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shift-halfday" className="block text-xs font-medium mb-1">
                Half-Day Min Hours
              </label>
              <input
                id="shift-halfday"
                type="number"
                value={shiftForm.halfDayHours}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, halfDayHours: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="shift-overtime" className="block text-xs font-medium mb-1">
                Overtime After (h)
              </label>
              <input
                id="shift-overtime"
                type="number"
                value={shiftForm.overtimeThresholdHours}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, overtimeThresholdHours: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <label
            htmlFor="shift-overnight"
            className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            <input
              id="shift-overnight"
              type="checkbox"
              checked={shiftForm.isOvernight}
              onChange={(e) => setShiftForm({ ...shiftForm, isOvernight: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
            />
            <span>Overnight shift (crosses midnight)</span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShiftModalOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              Create Shift
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Department Modal */}
      <Modal
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        title="Add Department"
      >
        <form onSubmit={handleAddDepartment} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="dept-name" className="block text-xs font-medium mb-1">
                Department Name
              </label>
              <input
                id="dept-name"
                type="text"
                required
                value={deptForm.name}
                onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="dept-code" className="block text-xs font-medium mb-1">
                Code
              </label>
              <input
                id="dept-code"
                type="text"
                required
                spellCheck={false}
                value={deptForm.code}
                onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })}
                placeholder="ENG"
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dept-manager" className="block text-xs font-medium mb-1">
                Department Manager
              </label>
              <input
                id="dept-manager"
                type="text"
                required
                value={deptForm.managerName}
                onChange={(e) => setDeptForm({ ...deptForm, managerName: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="dept-target" className="block text-xs font-medium mb-1">
                Target Attendance (%)
              </label>
              <input
                id="dept-target"
                type="number"
                min={50}
                max={100}
                value={deptForm.targetAttendancePct}
                onChange={(e) =>
                  setDeptForm({ ...deptForm, targetAttendancePct: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div>
            <label htmlFor="dept-desc" className="block text-xs font-medium mb-1">
              Description (Optional)
            </label>
            <input
              id="dept-desc"
              type="text"
              value={deptForm.description}
              onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
              placeholder="Department scope or division notes"
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeptModalOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              Create Department
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteHolidayTarget)}
        onClose={() => setDeleteHolidayTarget(null)}
        onConfirm={confirmDeleteHoliday}
        loading={deletingHoliday}
        title="Delete Holiday"
        message={
          deleteHolidayTarget
            ? `Remove "${deleteHolidayTarget.name}" (${deleteHolidayTarget.date}) from the institutional holiday calendar?`
            : ''
        }
        confirmLabel="Remove Holiday"
      />
    </div>
  );
}
