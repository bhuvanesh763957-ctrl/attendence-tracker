import {
  Activity,
  KeyRound,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import {
  AttendancePolicy,
  AuditLogItem,
  DbUser,
  Department,
  UserRole,
  UserSessionItem,
} from '../types/attendance.ts';

interface SettingsViewProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

export function SettingsView({ onNotify }: SettingsViewProps) {
  const { dbUser, employee, refreshProfile } = useAuth();
  const isAdmin = dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN';

  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [users, setUsers] = useState<DbUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Profile form
  const [displayNameInput, setDisplayNameInput] = useState(dbUser?.displayName || '');
  const [phoneInput, setPhoneInput] = useState(employee?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Admin issued reset token banner
  const [issuedResetInfo, setIssuedResetInfo] = useState<{
    email: string;
    token: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    if (dbUser?.displayName) setDisplayNameInput(dbUser.displayName);
    if (employee?.phone !== undefined) setPhoneInput(employee.phone || '');
  }, [dbUser?.displayName, employee?.phone]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [polRes, deptRes, sessRes] = await Promise.all([
        apiFetch<{ policy: AttendancePolicy }>('/api/policy'),
        apiFetch<{ departments: Department[] }>('/api/departments'),
        apiFetch<{ sessions: UserSessionItem[] }>('/api/auth/sessions'),
      ]);
      setPolicy(polRes.policy);
      setDepartments(deptRes.departments);
      setSessions(sessRes.sessions);

      if (isAdmin) {
        const [usersRes, logsRes] = await Promise.all([
          apiFetch<{ users: DbUser[] }>('/api/users'),
          apiFetch<{ logs: AuditLogItem[] }>('/api/audit-logs'),
        ]);
        setUsers(usersRes.users);
        setAuditLogs(logsRes.logs);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load settings.', true);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, onNotify]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    setSavingPolicy(true);
    try {
      const res = await apiFetch<{ policy: AttendancePolicy }>('/api/policy', {
        method: 'PATCH',
        body: JSON.stringify(policy),
      });
      setPolicy(res.policy);
      await refreshProfile();
      onNotify('Attendance policies updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save policy.', true);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayNameInput.trim(),
          phone: phoneInput.trim(),
        }),
      });
      await refreshProfile();
      onNotify('Profile updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Profile update failed.', true);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: currentPassword || 'initial-sso-set',
          newPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      await refreshProfile();
      onNotify(res.message);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update password.', true);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: number) => {
    try {
      await apiFetch(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      onNotify('Session revoked.');
      await loadSettings();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to revoke session.', true);
    }
  };

  const handleRoleUpdate = async (
    targetUserId: number,
    role: UserRole,
    managedDepartmentId: number | null,
    status?: 'active' | 'suspended'
  ) => {
    try {
      const res = await apiFetch<{ user: DbUser }>(`/api/users/${targetUserId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, managedDepartmentId, status }),
      });
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? res.user : u)));
      onNotify(`Updated access settings for ${res.user.displayName}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Role update failed.', true);
    }
  };

  const handleIssueResetCode = async (targetUser: DbUser) => {
    try {
      const res = await apiFetch<{ resetToken: string; expiresAt: string }>(
        '/api/auth/admin-reset-token',
        {
          method: 'POST',
          body: JSON.stringify({ userId: targetUser.id }),
        }
      );
      setIssuedResetInfo({
        email: targetUser.email,
        token: res.resetToken,
        expiresAt: res.expiresAt,
      });
      onNotify(`Issued one-time reset code for ${targetUser.email}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to generate reset code.', true);
    }
  };

  if (loading || !policy) {
    return (
      <div className="h-64 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse" />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
          Attendance Policies, Account Security &amp; Governance
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {isAdmin
            ? 'Configure workday thresholds, smart check-in options, account security, RBAC roles, and audit logs.'
            : 'Manage your personal profile, password, active sessions, and view organization attendance rules.'}
        </p>
      </div>

      {/* Account Profile & Password Security */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form
          onSubmit={handleSaveProfile}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <UserCheck aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">My Profile</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="settings-display-name" className="block text-xs font-medium mb-1">
                Display Name
              </label>
              <input
                id="settings-display-name"
                type="text"
                autoComplete="name"
                required
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="settings-phone" className="block text-xs font-medium mb-1">
                Phone Number
              </label>
              <input
                id="settings-phone"
                type="tel"
                autoComplete="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500">
              {dbUser?.email} · Role: <strong className="text-[#111827] dark:text-white">{dbUser?.role}</strong>
            </span>
            <button
              type="submit"
              disabled={savingProfile}
              className="btn-press inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#2563EB] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <Save aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Save Profile</span>
            </button>
          </div>
        </form>

        <form
          onSubmit={handleChangePassword}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <KeyRound aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">
              {dbUser?.hasPassword ? 'Change Password' : 'Set Password for Direct Sign-In'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dbUser?.hasPassword && (
              <div>
                <label htmlFor="settings-current-password" className="block text-xs font-medium mb-1">
                  Current Password
                </label>
                <input
                  id="settings-current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                />
              </div>
            )}
            <div className={dbUser?.hasPassword ? '' : 'sm:col-span-2'}>
              <label htmlFor="settings-new-password" className="block text-xs font-medium mb-1">
                New Password (8+ chars, upper, lower &amp; number)
              </label>
              <input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={savingPassword}
              className="btn-press inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#111827] dark:bg-slate-700 px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{dbUser?.hasPassword ? 'Update Password' : 'Enable Password Login'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Policy Form */}
      <form
        onSubmit={handleSavePolicy}
        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-6"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <Sliders aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
          <h2 className="text-base font-semibold">Organization Attendance Rules</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="policy-org-name" className="block text-xs font-medium mb-1">
              Organization Name
            </label>
            <input
              id="policy-org-name"
              type="text"
              disabled={!isAdmin}
              value={policy.organizationName}
              onChange={(e) => setPolicy({ ...policy, organizationName: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-name" className="block text-xs font-medium mb-1">
              Policy Name
            </label>
            <input
              id="policy-name"
              type="text"
              disabled={!isAdmin}
              value={policy.policyName || 'Default Enterprise Policy'}
              onChange={(e) => setPolicy({ ...policy, policyName: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-timezone" className="block text-xs font-medium mb-1">
              Timezone
            </label>
            <input
              id="policy-timezone"
              type="text"
              spellCheck={false}
              disabled={!isAdmin}
              value={policy.timezone || 'Asia/Kolkata'}
              onChange={(e) => setPolicy({ ...policy, timezone: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-workday-start" className="block text-xs font-medium mb-1">
              Workday Start
            </label>
            <input
              id="policy-workday-start"
              type="time"
              disabled={!isAdmin}
              value={policy.workdayStart}
              onChange={(e) => setPolicy({ ...policy, workdayStart: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-workday-end" className="block text-xs font-medium mb-1">
              Workday End
            </label>
            <input
              id="policy-workday-end"
              type="time"
              disabled={!isAdmin}
              value={policy.workdayEnd}
              onChange={(e) => setPolicy({ ...policy, workdayEnd: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-grace" className="block text-xs font-medium mb-1">
              Grace Period (minutes)
            </label>
            <input
              id="policy-grace"
              type="number"
              disabled={!isAdmin}
              value={policy.graceMinutes}
              onChange={(e) => setPolicy({ ...policy, graceMinutes: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-halfday" className="block text-xs font-medium mb-1">
              Half-Day Min Hours
            </label>
            <input
              id="policy-halfday"
              type="number"
              disabled={!isAdmin}
              value={policy.halfDayMinHours}
              onChange={(e) => setPolicy({ ...policy, halfDayMinHours: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-overtime" className="block text-xs font-medium mb-1">
              Overtime Threshold (hours)
            </label>
            <input
              id="policy-overtime"
              type="number"
              disabled={!isAdmin}
              value={policy.overtimeAfterHours}
              onChange={(e) =>
                setPolicy({ ...policy, overtimeAfterHours: Number(e.target.value) })
              }
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="policy-weekends" className="block text-xs font-medium mb-1">
              Weekend Days (0=Sun,6=Sat)
            </label>
            <input
              id="policy-weekends"
              type="text"
              spellCheck={false}
              disabled={!isAdmin}
              value={policy.weekendDays || '0,6'}
              onChange={(e) => setPolicy({ ...policy, weekendDays: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {[
            {
              key: 'allowWfh' as const,
              label: 'Allow Work-From-Home Check-In',
            },
            {
              key: 'allowQrCheckIn' as const,
              label: 'Allow QR Code Turnstile Attendance',
            },
            {
              key: 'requireGeoConsent' as const,
              label: 'Require Explicit Consent for Geolocation Capture',
            },
            {
              key: 'autoAnomalyDetection' as const,
              label: 'Automated Attendance Anomaly Detection',
            },
          ].map((toggle) => (
            <label
              key={toggle.key}
              htmlFor={`policy-toggle-${toggle.key}`}
              className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm cursor-pointer"
            >
              <input
                id={`policy-toggle-${toggle.key}`}
                type="checkbox"
                disabled={!isAdmin}
                checked={policy[toggle.key]}
                onChange={(e) => setPolicy({ ...policy, [toggle.key]: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
              />
              <span>{toggle.label}</span>
            </label>
          ))}
        </div>

        {isAdmin && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPolicy}
              className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              <span>Save Policy</span>
            </button>
          </div>
        )}
      </form>

      {/* Active Sessions */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <MonitorSmartphone aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
          <h2 className="text-base font-semibold">Recent Password Login Sessions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Client / Browser</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                    No direct password sessions recorded yet.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-xs max-w-xs truncate">
                      {s.userAgent || 'API Client'} {s.isCurrent ? '(Current)' : ''}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">{s.ipAddress || '—'}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.revokedAt ? (
                        <span className="text-slate-400">Revoked</span>
                      ) : new Date(s.expiresAt) < new Date() ? (
                        <span className="text-slate-400">Expired</span>
                      ) : (
                        <span className="font-medium text-[#16A34A]">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!s.revokedAt && (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id)}
                          className="btn-press inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs text-[#DC2626] hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        >
                          <Trash2 aria-hidden="true" className="h-3 w-3" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role-Based Access Control Table */}
      {isAdmin && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
              <h2 className="text-base font-semibold">Workspace User Roles &amp; Credentials</h2>
            </div>
          </div>

          {issuedResetInfo && (
            <div className="border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-5 py-3 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                One-time password reset code for <strong>{issuedResetInfo.email}</strong>:{' '}
                <code className="font-mono-tabular font-bold select-all px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900">
                  {issuedResetInfo.token}
                </code>
              </div>
              <button
                type="button"
                onClick={() => setIssuedResetInfo(null)}
                className="underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Assigned Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Managed Department</th>
                  <th className="px-4 py-3 text-right">Reset Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-medium">{u.displayName}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Assigned role for ${u.displayName}`}
                        value={u.role}
                        onChange={(e) =>
                          handleRoleUpdate(
                            u.id,
                            e.target.value as UserRole,
                            e.target.value === 'MANAGER'
                              ? u.managedDepartmentId ?? departments[0]?.id ?? null
                              : null,
                            u.status
                          )
                        }
                        className="min-h-[36px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium"
                      >
                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="EMPLOYEE">EMPLOYEE</option>
                        <option value="STUDENT">STUDENT</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Account status for ${u.displayName}`}
                        value={u.status || 'active'}
                        onChange={(e) =>
                          handleRoleUpdate(
                            u.id,
                            u.role,
                            u.managedDepartmentId,
                            e.target.value as 'active' | 'suspended'
                          )
                        }
                        className="min-h-[36px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === 'MANAGER' ? (
                        <select
                          aria-label={`Managed department for ${u.displayName}`}
                          value={u.managedDepartmentId ?? ''}
                          onChange={(e) =>
                            handleRoleUpdate(
                              u.id,
                              'MANAGER',
                              e.target.value ? Number(e.target.value) : null,
                              u.status
                            )
                          }
                          className="min-h-[36px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs"
                        >
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleIssueResetCode(u)}
                        className="btn-press rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                      >
                        Issue Reset Code
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit Logs (Admin only) */}
      {isAdmin && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <Activity aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-base font-semibold">Security &amp; Attendance Audit Trail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {auditLogs.slice(0, 20).map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 font-mono-tabular text-xs text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{log.actorEmail || '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-medium">{log.actorRole}</td>
                    <td className="px-4 py-2.5 font-mono-tabular text-xs text-[#2563EB]">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 font-mono-tabular text-xs text-slate-500">
                      {log.resourceType}
                      {log.resourceId ? ` #${log.resourceId}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
