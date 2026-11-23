import { Check, FileText, Paperclip, Plus, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { Employee, LeaveCategory, LeaveRequest } from '../types/attendance.ts';
import { Modal } from './Modal.tsx';
import { StatusIndicator } from './StatusBadge.tsx';

function getBalanceForCategory(emp: Employee | null, category: LeaveCategory): number | null {
  if (!emp) return null;
  switch (category) {
    case 'Casual Leave':
      return emp.casualLeaveBalance;
    case 'Sick Leave':
      return emp.sickLeaveBalance;
    case 'Earned Leave':
      return emp.earnedLeaveBalance;
    case 'Personal Leave':
      return emp.personalLeaveBalance;
    case 'Emergency Leave':
      return emp.emergencyLeaveBalance;
    default:
      return null;
  }
}

interface LeavesViewProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

const LEAVE_CATEGORIES: LeaveCategory[] = [
  'Casual Leave',
  'Sick Leave',
  'Earned Leave',
  'Personal Leave',
  'Emergency Leave',
];

function computeInclusiveDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.floor((e - s) / 86400000) + 1;
}

export function LeavesView({ onNotify }: LeavesViewProps) {
  const { dbUser, employee, refreshProfile } = useAuth();
  const isManagerOrAdmin =
    dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN' || dbUser?.role === 'MANAGER';

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const [applyOpen, setApplyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applyForm, setApplyForm] = useState({
    employeeId: '',
    category: 'Casual Leave' as LeaveCategory,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    reason: '',
    attachmentName: '',
  });

  const [reviewTarget, setReviewTarget] = useState<{
    leave: LeaveRequest;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [leavesRes, empRes] = await Promise.all([
        apiFetch<{ leaves: LeaveRequest[] }>('/api/leaves'),
        apiFetch<{ employees: Employee[] }>('/api/employees'),
      ]);
      setLeaves(leavesRes.leaves);
      setEmployees(empRes.employees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leave records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaves();
  }, [loadLeaves]);

  const filtered = useMemo(() => {
    return leaves.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false;
      return true;
    });
  }, [leaves, statusFilter, categoryFilter]);

  const requestedDays = computeInclusiveDays(applyForm.startDate, applyForm.endDate);

  const selectedEmployeeForApply = useMemo(() => {
    if (applyForm.employeeId) {
      return employees.find((e) => String(e.id) === applyForm.employeeId) ?? employee ?? null;
    }
    return employee ?? null;
  }, [applyForm.employeeId, employees, employee]);

  const availableBalance = getBalanceForCategory(selectedEmployeeForApply, applyForm.category);
  const exceedsBalance = availableBalance !== null && requestedDays > availableBalance;

  const handleApplySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/leaves', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: applyForm.employeeId ? Number(applyForm.employeeId) : employee?.id,
          category: applyForm.category,
          startDate: applyForm.startDate,
          endDate: applyForm.endDate,
          reason: applyForm.reason,
          attachmentName: applyForm.attachmentName || undefined,
        }),
      });
      onNotify('Leave application submitted.');
      setApplyOpen(false);
      setApplyForm((prev) => ({ ...prev, reason: '', attachmentName: '' }));
      await loadLeaves();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to submit leave request.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/leaves/${reviewTarget.leave.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: reviewTarget.decision,
          reviewerNote,
        }),
      });
      onNotify(
        `Leave request ${reviewTarget.decision.toLowerCase()}. ${
          reviewTarget.decision === 'Approved' ? 'Balances and attendance synced.' : ''
        }`
      );
      setReviewTarget(null);
      setReviewerNote('');
      await Promise.all([loadLeaves(), refreshProfile()]);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to process decision.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const balanceCards = employee
    ? [
        { label: 'Casual Leave', count: employee.casualLeaveBalance },
        { label: 'Sick Leave', count: employee.sickLeaveBalance },
        { label: 'Earned Leave', count: employee.earnedLeaveBalance },
        { label: 'Personal Leave', count: employee.personalLeaveBalance },
        { label: 'Emergency Leave', count: employee.emergencyLeaveBalance },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Leave Management
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Submit leave requests, track remaining category balances, and synchronize approved absences with daily attendance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setApplyForm((prev) => ({
              ...prev,
              employeeId: employee?.id ? String(employee.id) : employees[0]?.id ? String(employees[0].id) : '',
            }));
            setApplyOpen(true);
          }}
          className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap"
        >
          <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Apply for Leave</span>
        </button>
      </div>

      {/* Leave Balances */}
      {balanceCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {balanceCards.map((b) => (
            <div
              key={b.label}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4"
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{b.label}</p>
              <p className="mt-2 text-2xl font-bold font-mono-tabular text-[#111827] dark:text-white">
                {b.count}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">days</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>

        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Categories</option>
          {LEAVE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-[#DC2626] dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Leave History & Approval Queue */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3">Reason &amp; Attachment</th>
                <th className="px-4 py-3">Status</th>
                {isManagerOrAdmin && <th className="px-4 py-3 text-right">Review</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={isManagerOrAdmin ? 7 : 6} className="px-4 py-3.5">
                      <div className="h-5 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 7 : 6}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    <p>No leave requests match your active filters.</p>
                    {(statusFilter !== 'ALL' || categoryFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('ALL');
                          setCategoryFilter('ALL');
                        }}
                        className="btn-press mt-3 inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#111827] dark:text-white">{l.employeeName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-tabular">{l.employeeCode}</span> · {l.departmentName}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{l.category}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs whitespace-nowrap">
                      {l.startDate} → {l.endDate}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                      {l.totalDays}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-xs">
                      <p>{l.reason}</p>
                      {l.attachmentName && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#2563EB] dark:text-blue-400">
                          <Paperclip aria-hidden="true" className="h-3 w-3" />
                          <span>{l.attachmentName}</span>
                        </p>
                      )}
                      {l.reviewerNote && (
                        <p className="mt-1 text-[11px] text-slate-400">Note: {l.reviewerNote}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={l.status} />
                    </td>
                    {isManagerOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        {l.status === 'Pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setReviewerNote('');
                                setReviewTarget({ leave: l, decision: 'Approved' });
                              }}
                              className="btn-press inline-flex items-center gap-1 rounded bg-[#16A34A] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <Check aria-hidden="true" className="h-3.5 w-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewerNote('');
                                setReviewTarget({ leave: l, decision: 'Rejected' });
                              }}
                              className="btn-press inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-900 px-2.5 py-1.5 text-xs font-medium text-[#DC2626] dark:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            >
                              <X aria-hidden="true" className="h-3.5 w-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Reviewed</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal */}
      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Apply for Leave"
        subtitle="Leave balance is validated automatically against your remaining allocation."
      >
        <form onSubmit={handleApplySubmit} className="space-y-4">
          {isManagerOrAdmin && employees.length > 0 && (
            <div>
              <label htmlFor="leave-member" className="block text-xs font-medium mb-1">
                Member
              </label>
              <select
                id="leave-member"
                value={applyForm.employeeId}
                onChange={(e) => setApplyForm({ ...applyForm, employeeId: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} — {emp.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="leave-category" className="block text-xs font-medium mb-1">
              Leave Category
            </label>
            <select
              id="leave-category"
              value={applyForm.category}
              onChange={(e) =>
                setApplyForm({ ...applyForm, category: e.target.value as LeaveCategory })
              }
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              {LEAVE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="leave-start" className="block text-xs font-medium mb-1">
                Start Date
              </label>
              <input
                id="leave-start"
                type="date"
                required
                value={applyForm.startDate}
                onChange={(e) => setApplyForm({ ...applyForm, startDate: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="leave-end" className="block text-xs font-medium mb-1">
                End Date
              </label>
              <input
                id="leave-end"
                type="date"
                required
                value={applyForm.endDate}
                onChange={(e) => setApplyForm({ ...applyForm, endDate: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <p>
              Duration:{' '}
              <span className="font-mono-tabular font-semibold text-[#2563EB] dark:text-blue-400">
                {requestedDays} {requestedDays === 1 ? 'day' : 'days'}
              </span>
            </p>
            {availableBalance !== null && (
              <p>
                Remaining balance:{' '}
                <strong
                  className={`font-mono-tabular ${
                    exceedsBalance ? 'text-[#DC2626] dark:text-rose-400' : 'text-[#111827] dark:text-white'
                  }`}
                >
                  {availableBalance} {availableBalance === 1 ? 'day' : 'days'}
                </strong>
              </p>
            )}
          </div>

          {exceedsBalance && (
            <div
              role="alert"
              className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-[#DC2626] dark:text-rose-400"
            >
              Requested {requestedDays} days exceeds your available {availableBalance}-day{' '}
              {applyForm.category} balance.
            </div>
          )}

          <div>
            <label htmlFor="leave-reason" className="block text-xs font-medium mb-1">
              Reason
            </label>
            <textarea
              id="leave-reason"
              required
              rows={3}
              value={applyForm.reason}
              onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
              placeholder="Provide context for your manager or department coordinator…"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <span className="block text-xs font-medium mb-1">Supporting Document (Optional)</span>
            <div className="flex items-center gap-2">
              <label
                htmlFor="leave-attachment"
                className="btn-press inline-flex min-h-[38px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <FileText aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
                <span>Select File</span>
                <input
                  id="leave-attachment"
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setApplyForm({ ...applyForm, attachmentName: file.name });
                    }
                  }}
                />
              </label>
              <span className="text-xs text-slate-500 truncate">
                {applyForm.attachmentName || 'No file selected'}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setApplyOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || requestedDays <= 0 || exceedsBalance}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Submit Application
            </button>
          </div>
        </form>
      </Modal>

      {/* Review Decision Modal */}
      <Modal
        open={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        title={
          reviewTarget
            ? `${reviewTarget.decision === 'Approved' ? 'Approve' : 'Reject'} Leave Request`
            : 'Review Leave'
        }
        subtitle={
          reviewTarget
            ? `${reviewTarget.leave.employeeName} · ${reviewTarget.leave.category} (${reviewTarget.leave.totalDays}d)`
            : ''
        }
      >
        <form onSubmit={handleReviewSubmit} className="space-y-4">
          <div>
            <label htmlFor="leave-reviewer-note" className="block text-xs font-medium mb-1">
              Reviewer Note (Optional)
            </label>
            <textarea
              id="leave-reviewer-note"
              rows={3}
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              placeholder="Add an approval comment or rejection reason…"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReviewTarget(null)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`btn-press min-h-[40px] rounded-md px-4 py-2 text-sm font-medium text-white cursor-pointer ${
                reviewTarget?.decision === 'Approved'
                  ? 'bg-[#16A34A] hover:bg-emerald-700'
                  : 'bg-[#DC2626] hover:bg-red-700'
              }`}
            >
              Confirm {reviewTarget?.decision}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
