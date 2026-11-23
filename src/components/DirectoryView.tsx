import {
  Edit2,
  Eye,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import {
  AttendanceRecord,
  Department,
  Employee,
  LeaveRequest,
  Shift,
} from '../types/attendance.ts';
import { ConfirmModal, Modal } from './Modal.tsx';
import { StatusIndicator } from './StatusBadge.tsx';

interface DirectoryViewProps {
  initialProfileId?: number | null;
  onClearInitialProfile?: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function DirectoryView({
  initialProfileId,
  onClearInitialProfile,
  onNotify,
}: DirectoryViewProps) {
  const { dbUser } = useAuth();
  const isAdmin = dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Add/Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Employee | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState({
    code: '',
    fullName: '',
    email: '',
    phone: '',
    departmentId: '',
    shiftId: '',
    designation: '',
    memberType: 'employee' as 'employee' | 'student',
    joiningDate: new Date().toISOString().slice(0, 10),
  });

  // Individual Profile Modal
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileData, setProfileData] = useState<{
    employee: Employee;
    attendance: AttendanceRecord[];
    leaves: LeaveRequest[];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [empRes, deptRes, shiftRes] = await Promise.all([
        apiFetch<{ employees: Employee[] }>('/api/employees'),
        apiFetch<{ departments: Department[] }>('/api/departments'),
        apiFetch<{ shifts: Shift[] }>('/api/shifts'),
      ]);
      setEmployees(empRes.employees);
      setDepartments(deptRes.departments);
      setShifts(shiftRes.shifts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const openProfile = useCallback(
    async (empId: number) => {
      setProfileOpen(true);
      setProfileLoading(true);
      try {
        const res = await apiFetch<{
          employee: Employee;
          attendance: AttendanceRecord[];
          leaves: LeaveRequest[];
        }>(`/api/employees/${empId}/history`);
        const match = employees.find((e) => e.id === empId);
        setProfileData({
          ...res,
          employee: {
            ...res.employee,
            departmentName: match?.departmentName,
            shiftName: match?.shiftName,
            shiftWindow: match?.shiftWindow,
          },
        });
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Unable to load profile.', true);
        setProfileOpen(false);
      } finally {
        setProfileLoading(false);
      }
    },
    [employees, onNotify]
  );

  useEffect(() => {
    if (initialProfileId && employees.length > 0) {
      void openProfile(initialProfileId);
      onClearInitialProfile?.();
    }
  }, [initialProfileId, employees.length, openProfile, onClearInitialProfile]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (deptFilter !== 'ALL' && e.departmentId !== Number(deptFilter)) return false;
      if (typeFilter !== 'ALL' && e.memberType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (q) {
        const hay = `${e.code} ${e.fullName} ${e.email} ${e.designation}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, deptFilter, typeFilter, statusFilter, search]);

  const openCreateModal = () => {
    setEditingMember(null);
    setFormState({
      code: `EMP-${Math.floor(1050 + Math.random() * 8900)}`,
      fullName: '',
      email: '',
      phone: '',
      departmentId: departments[0]?.id ? String(departments[0].id) : '',
      shiftId: shifts[0]?.id ? String(shifts[0].id) : '',
      designation: '',
      memberType: 'employee',
      joiningDate: new Date().toISOString().slice(0, 10),
    });
    setFormModalOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingMember(emp);
    setFormState({
      code: emp.code,
      fullName: emp.fullName,
      email: emp.email,
      phone: emp.phone,
      departmentId: String(emp.departmentId),
      shiftId: String(emp.shiftId),
      designation: emp.designation,
      memberType: emp.memberType,
      joiningDate: emp.joiningDate,
    });
    setFormModalOpen(true);
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingMember) {
        await apiFetch(`/api/employees/${editingMember.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: formState.fullName,
            email: formState.email,
            phone: formState.phone,
            departmentId: Number(formState.departmentId),
            shiftId: Number(formState.shiftId),
            designation: formState.designation,
            memberType: formState.memberType,
            joiningDate: formState.joiningDate,
          }),
        });
        onNotify(`Updated ${formState.fullName}.`);
      } else {
        await apiFetch('/api/employees', {
          method: 'POST',
          body: JSON.stringify({
            ...formState,
            departmentId: Number(formState.departmentId),
            shiftId: Number(formState.shiftId),
          }),
        });
        onNotify(`Added ${formState.fullName} to directory.`);
      }
      setFormModalOpen(false);
      await loadDirectory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Save failed.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (emp: Employee) => {
    try {
      if (emp.status === 'active') {
        await apiFetch(`/api/employees/${emp.id}`, { method: 'DELETE' });
        onNotify(`${emp.fullName} deactivated.`);
      } else {
        await apiFetch(`/api/employees/${emp.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'active' }),
        });
        onNotify(`${emp.fullName} reactivated.`);
      }
      await loadDirectory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status update failed.', true);
    }
  };

  const confirmDeletePermanent = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/employees/${deleteTarget.id}?mode=permanent`, { method: 'DELETE' });
      onNotify(`Removed ${deleteTarget.fullName} permanently.`);
      setDeleteTarget(null);
      await loadDirectory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Employees &amp; Students Directory
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage organizational profiles, designations, shifts, leave balances, and individual attendance histories.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap"
          >
            <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Add Member</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
          />
          <input
            id="directory-search"
            aria-label="Search directory"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, name, email, or designation…"
            className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <select
          aria-label="Filter by department"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by member type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Types</option>
          <option value="employee">Employees</option>
          <option value="student">Students</option>
        </select>

        <select
          aria-label="Filter by member status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-[#DC2626] dark:text-rose-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Department &amp; Role</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7} className="px-4 py-3.5">
                      <div className="h-5 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    <p>No records match your filters.</p>
                    {(search || deptFilter !== 'ALL' || typeFilter !== 'ALL' || statusFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          setDeptFilter('ALL');
                          setTypeFilter('ALL');
                          setStatusFilter('ALL');
                        }}
                        className="btn-press mt-2.5 inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[#2563EB] dark:text-blue-400">
                      {emp.code}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#111827] dark:text-white">{emp.fullName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{emp.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        {emp.departmentName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {emp.designation} · {emp.memberType === 'student' ? 'Student' : 'Employee'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p>{emp.shiftName}</p>
                      <p className="font-mono-tabular text-slate-400">{emp.shiftWindow}</p>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600 dark:text-slate-300">
                      {emp.joiningDate}
                    </td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={emp.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openProfile(emp.id)}
                          title="View profile"
                          aria-label={`View profile for ${emp.fullName}`}
                          className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Eye aria-hidden="true" className="h-4 w-4" />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(emp)}
                              title="Edit profile"
                              aria-label={`Edit ${emp.fullName}`}
                              className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(emp)}
                              title={emp.status === 'active' ? 'Deactivate' : 'Reactivate'}
                              aria-label={
                                emp.status === 'active'
                                  ? `Deactivate ${emp.fullName}`
                                  : `Reactivate ${emp.fullName}`
                              }
                              className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              {emp.status === 'active' ? (
                                <UserX aria-hidden="true" className="h-4 w-4 text-[#D97706]" />
                              ) : (
                                <UserCheck aria-hidden="true" className="h-4 w-4 text-[#16A34A]" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(emp)}
                              title="Delete permanently"
                              aria-label={`Delete ${emp.fullName}`}
                              className="btn-press inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-[#DC2626] dark:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Member Modal */}
      <Modal
        open={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        title={editingMember ? `Edit ${editingMember.fullName}` : 'Add Employee or Student'}
        subtitle="Changes sync directly with attendance logs, shift rules, and leave balances."
      >
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dir-code" className="block text-xs font-medium mb-1">Member ID</label>
              <input
                id="dir-code"
                name="memberCode"
                type="text"
                required
                spellCheck={false}
                disabled={Boolean(editingMember)}
                value={formState.code}
                onChange={(e) => setFormState({ ...formState, code: e.target.value })}
                placeholder="EMP-1015 or STU-2010"
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="dir-type" className="block text-xs font-medium mb-1">Type</label>
              <select
                id="dir-type"
                value={formState.memberType}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    memberType: e.target.value as 'employee' | 'student',
                  })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="employee">Employee</option>
                <option value="student">Student</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dir-fullname" className="block text-xs font-medium mb-1">Full Name</label>
            <input
              id="dir-fullname"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              value={formState.fullName}
              onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dir-email" className="block text-xs font-medium mb-1">Email</label>
              <input
                id="dir-email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                required
                value={formState.email}
                onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="dir-phone" className="block text-xs font-medium mb-1">Phone</label>
              <input
                id="dir-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={formState.phone}
                onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                placeholder="+1-555-0100"
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dir-dept" className="block text-xs font-medium mb-1">Department</label>
              <select
                id="dir-dept"
                required
                value={formState.departmentId}
                onChange={(e) => setFormState({ ...formState, departmentId: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dir-shift" className="block text-xs font-medium mb-1">Assigned Shift</label>
              <select
                id="dir-shift"
                required
                value={formState.shiftId}
                onChange={(e) => setFormState({ ...formState, shiftId: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dir-designation" className="block text-xs font-medium mb-1">Designation</label>
              <input
                id="dir-designation"
                type="text"
                required
                value={formState.designation}
                onChange={(e) => setFormState({ ...formState, designation: e.target.value })}
                placeholder="e.g. Senior Engineer or Graduate Fellow"
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="dir-joining" className="block text-xs font-medium mb-1">Joining Date</label>
              <input
                id="dir-joining"
                type="date"
                required
                value={formState.joiningDate}
                onChange={(e) => setFormState({ ...formState, joiningDate: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFormModalOpen(false)}
              className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {editingMember ? 'Update Member' : 'Create Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Individual Profile Modal */}
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title={profileData?.employee.fullName || 'Member Profile'}
        subtitle={
          profileData
            ? `${profileData.employee.code} · ${profileData.employee.designation}`
            : 'Loading profile details…'
        }
        maxWidthClass="max-w-3xl"
      >
        {profileLoading || !profileData ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading profile history…</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-xs">
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Mail aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  <span>{profileData.employee.email}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-mono-tabular">
                  <Phone aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  <span>{profileData.employee.phone || 'Not provided'}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <p>
                  <span className="text-slate-500">Department:</span>{' '}
                  <span className="font-medium">{profileData.employee.departmentName || 'Assigned'}</span>
                </p>
                <p>
                  <span className="text-slate-500">Shift:</span>{' '}
                  <span className="font-medium">
                    {profileData.employee.shiftName || 'Core'} ({profileData.employee.shiftWindow || ''})
                  </span>
                </p>
                <p>
                  <span className="text-slate-500">Joined:</span>{' '}
                  <span className="font-mono-tabular font-medium">
                    {profileData.employee.joiningDate}
                  </span>
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
                Leave Balances (Days Remaining)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[
                  { label: 'Casual', val: profileData.employee.casualLeaveBalance },
                  { label: 'Sick', val: profileData.employee.sickLeaveBalance },
                  { label: 'Earned', val: profileData.employee.earnedLeaveBalance },
                  { label: 'Personal', val: profileData.employee.personalLeaveBalance },
                  { label: 'Emergency', val: profileData.employee.emergencyLeaveBalance },
                ].map((b) => (
                  <div
                    key={b.label}
                    className="rounded-md border border-slate-200 dark:border-slate-800 p-3 text-center"
                  >
                    <p className="text-[11px] text-slate-500">{b.label}</p>
                    <p className="mt-1 text-lg font-bold font-mono-tabular text-[#2563EB] dark:text-blue-400">
                      {b.val}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
                Recent Attendance History
              </h3>
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Worked</th>
                      <th className="px-3 py-2 text-right">OT</th>
                      <th className="px-3 py-2">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {profileData.attendance.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          No attendance logs recorded yet.
                        </td>
                      </tr>
                    ) : (
                      profileData.attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="px-3 py-2 font-mono-tabular">{a.date}</td>
                          <td className="px-3 py-2">
                            <StatusIndicator status={a.status} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular">
                            {(a.workingMinutes / 60).toFixed(1)}h
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular">
                            {(a.overtimeMinutes / 60).toFixed(1)}h
                          </td>
                          <td className="px-3 py-2">{a.checkInMethod}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeletePermanent}
        loading={deleting}
        title="Permanently Delete Member"
        message={
          deleteTarget
            ? `Permanently delete ${deleteTarget.fullName} (${deleteTarget.code}) and all associated attendance, leave, and correction history? Consider deactivating instead if you need audit retention.`
            : ''
        }
        confirmLabel="Delete Permanently"
      />
    </div>
  );
}
