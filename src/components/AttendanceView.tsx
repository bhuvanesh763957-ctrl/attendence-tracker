import {
  Check,
  Clock,
  Coffee,
  Edit2,
  FileEdit,
  Home,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  QrCode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import {
  AttendanceRecord,
  AttendanceStatus,
  CorrectionRequest,
  Department,
  Employee,
  QrSession,
} from '../types/attendance.ts';
import { ConfirmModal, Modal } from './Modal.tsx';
import { StatusIndicator } from './StatusBadge.tsx';

interface AttendanceViewProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'Present',
  'Late',
  'Work From Home',
  'Half Day',
  'On Leave',
  'Holiday',
  'Weekly Off',
  'Absent',
];

export function AttendanceView({ onNotify }: AttendanceViewProps) {
  const { dbUser, employee, policy } = useAuth();
  const isAdmin = dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN';
  const isManagerOrAdmin = isAdmin || dbUser?.role === 'MANAGER';
  const isSelfOnly = dbUser?.role === 'EMPLOYEE' || dbUser?.role === 'STUDENT';

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [qrSessions, setQrSessions] = useState<QrSession[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const [showAllDates, setShowAllDates] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Target member selector for check-in/out (Managers/Admins can select, Employee locked to self)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  // Modals
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [geoConsent, setGeoConsent] = useState(false);
  const [geoCoords, setGeoCoords] = useState<{ lat: string; lng: string } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrTokenInput, setQrTokenInput] = useState('');
  const [qrLabelInput, setQrLabelInput] = useState('Main Campus Gate');
  const [qrValidMins, setQrValidMins] = useState(60);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [activeQrPreview, setActiveQrPreview] = useState<QrSession | null>(null);

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'Present' as AttendanceStatus,
    checkInTimeStr: '09:00',
    checkOutTimeStr: '17:30',
    breakMinutes: 45,
    notes: '',
  });

  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    requestedStatus: 'Present',
    requestedCheckIn: '09:00',
    requestedCheckOut: '17:30',
    reason: '',
  });

  const [editModalRecord, setEditModalRecord] = useState<AttendanceRecord | null>(null);
  const [editForm, setEditForm] = useState({
    status: 'Present' as AttendanceStatus,
    checkInTimeStr: '',
    checkOutTimeStr: '',
    breakMinutes: 0,
    notes: '',
  });

  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (!showAllDates && dateFilter) params.set('date', dateFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (deptFilter !== 'ALL') params.set('departmentId', deptFilter);

      const [attRes, corrRes, deptRes, empRes, qrRes] = await Promise.all([
        apiFetch<{ records: AttendanceRecord[] }>(`/api/attendance?${params.toString()}`),
        apiFetch<{ corrections: CorrectionRequest[] }>('/api/corrections'),
        apiFetch<{ departments: Department[] }>('/api/departments'),
        apiFetch<{ employees: Employee[] }>('/api/employees'),
        apiFetch<{ sessions: QrSession[] }>('/api/qr-sessions'),
      ]);

      setRecords(attRes.records);
      setCorrections(corrRes.corrections);
      setDepartments(deptRes.departments);
      setEmployees(empRes.employees);
      setQrSessions(qrRes.sessions);

      if (!selectedMemberId && employee?.id) {
        setSelectedMemberId(String(employee.id));
      } else if (!selectedMemberId && empRes.employees[0]?.id) {
        setSelectedMemberId(String(empRes.employees[0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load attendance logs.');
    } finally {
      setLoading(false);
    }
  }, [dateFilter, showAllDates, statusFilter, deptFilter, employee?.id, selectedMemberId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeQrPreview) {
      QRCode.toDataURL(activeQrPreview.token, { width: 220, margin: 2 })
        .then(setQrImageUrl)
        .catch(() => setQrImageUrl(''));
    } else {
      setQrImageUrl('');
    }
  }, [activeQrPreview]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        (r.employeeName || '').toLowerCase().includes(q) ||
        (r.employeeCode || '').toLowerCase().includes(q) ||
        (r.departmentName || '').toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  const activeTargetId =
    isSelfOnly
      ? employee?.id
      : selectedMemberId
        ? Number(selectedMemberId)
        : employee?.id;

  const todayIso = new Date().toISOString().slice(0, 10);
  const targetTodayRecord = records.find(
    (r) => r.employeeId === activeTargetId && r.date === todayIso
  );

  const handleStandardCheckIn = async (method: 'Web' | 'WFH') => {
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ employeeId: activeTargetId, method }),
      });
      onNotify(`Checked in via ${method}.`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Check-in failed.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify({ employeeId: activeTargetId }),
      });
      onNotify('Checked out successfully. Working hours and overtime updated.');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Check-out failed.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogBreak = async (addMinutes: number) => {
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/break', {
        method: 'POST',
        body: JSON.stringify({ employeeId: activeTargetId, addMinutes }),
      });
      onNotify(`Added ${addMinutes}m break time.`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to log break.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCaptureLocation = () => {
    if (!navigator.geolocation) {
      onNotify('Geolocation is not supported by this browser.', true);
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoCoords({
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
        });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        onNotify(err.message || 'Location access denied.', true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleGeoCheckInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!geoConsent) {
      onNotify('Please provide explicit geolocation consent first.', true);
      return;
    }
    if (!geoCoords) {
      onNotify('Capture GPS coordinates before submitting.', true);
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: activeTargetId,
          method: 'Geolocation',
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          geoConsent: true,
        }),
      });
      onNotify('Geolocation check-in recorded.');
      setGeoModalOpen(false);
      setGeoConsent(false);
      setGeoCoords(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Geolocation check-in failed.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQrSession = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ session: QrSession }>('/api/qr-sessions', {
        method: 'POST',
        body: JSON.stringify({ label: qrLabelInput, validMinutes: qrValidMins }),
      });
      setActiveQrPreview(res.session);
      setQrTokenInput(res.session.token);
      onNotify('Generated time-bounded QR attendance token.');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not create QR session.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQrCheckInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!qrTokenInput.trim()) {
      onNotify('Enter an active QR session token.', true);
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: activeTargetId,
          method: 'QR',
          qrToken: qrTokenInput.trim(),
        }),
      });
      onNotify('QR attendance verified and recorded.');
      setQrModalOpen(false);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'QR verification failed.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          ...manualForm,
          employeeId: Number(manualForm.employeeId),
          breakMinutes: Number(manualForm.breakMinutes),
        }),
      });
      onNotify('Attendance entry saved.');
      setManualModalOpen(false);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save attendance entry.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCorrectionSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/corrections', {
        method: 'POST',
        body: JSON.stringify({
          ...correctionForm,
          employeeId: correctionForm.employeeId
            ? Number(correctionForm.employeeId)
            : activeTargetId,
        }),
      });
      onNotify('Attendance correction request submitted for review.');
      setCorrectionModalOpen(false);
      setCorrectionForm((prev) => ({ ...prev, reason: '' }));
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to submit correction.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewCorrection = async (id: number, decision: 'Approved' | 'Rejected') => {
    try {
      await apiFetch(`/api/corrections/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      onNotify(`Correction request ${decision.toLowerCase()}.`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Review action failed.', true);
    }
  };

  const handleOpenEditRecord = (rec: AttendanceRecord) => {
    const toHhmm = (iso: string | null) => {
      if (!iso) return '';
      return new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };
    setEditForm({
      status: rec.status,
      checkInTimeStr: toHhmm(rec.checkInTime),
      checkOutTimeStr: toHhmm(rec.checkOutTime),
      breakMinutes: rec.breakMinutes,
      notes: rec.notes || '',
    });
    setEditModalRecord(rec);
  };

  const handleSaveEditRecord = async (e: FormEvent) => {
    e.preventDefault();
    if (!editModalRecord) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/attendance/${editModalRecord.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: editForm.status,
          checkInTimeStr: editForm.checkInTimeStr || null,
          checkOutTimeStr: editForm.checkOutTimeStr || null,
          breakMinutes: Number(editForm.breakMinutes) || 0,
          notes: editForm.notes,
        }),
      });
      onNotify('Attendance record updated and recalculated.');
      setEditModalRecord(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update record.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeleteRecord = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/attendance/${deleteTarget.id}`, { method: 'DELETE' });
      onNotify(`Removed attendance entry for ${deleteTarget.employeeName || deleteTarget.date}.`);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true);
    } finally {
      setDeleting(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Smart Attendance Console
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track real-time check-ins, breaks, overtime, QR kiosks, geolocation consent, and correction requests.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setCorrectionForm((prev) => ({
                ...prev,
                employeeId: activeTargetId ? String(activeTargetId) : '',
              }));
              setCorrectionModalOpen(true);
            }}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
          >
            <FileEdit aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Request Correction</span>
          </button>

          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => {
                setManualForm((prev) => ({
                  ...prev,
                  employeeId: employees[0]?.id ? String(employees[0].id) : '',
                }));
                setManualModalOpen(true);
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap"
            >
              <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Mark Attendance</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Punch & Smart Check-In Toolbar */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#111827] dark:text-white">
              Active Check-In / Check-Out Session
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Duplicate check-ins on the same date are blocked automatically; overtime and half-day thresholds follow shift rules.
            </p>
          </div>

          {isManagerOrAdmin && employees.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="target-member"
                className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
              >
                Member:
              </label>
              <select
                id="target-member"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-[#111827] dark:text-white"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} — {e.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={submitting || Boolean(targetTodayRecord?.checkInTime)}
            onClick={() => handleStandardCheckIn('Web')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" />
            <span>Web Check-In</span>
          </button>

          {policy?.allowWfh !== false && (
            <button
              type="button"
              disabled={submitting || Boolean(targetTodayRecord?.checkInTime)}
              onClick={() => handleStandardCheckIn('WFH')}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
            >
              <Home aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
              <span>WFH Check-In</span>
            </button>
          )}

          {policy?.allowQrCheckIn !== false && (
            <button
              type="button"
              onClick={() => {
                if (!activeQrPreview && qrSessions[0]) setActiveQrPreview(qrSessions[0]);
                setQrModalOpen(true);
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
            >
              <QrCode aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
              <span>QR Attendance</span>
            </button>
          )}

          <button
            type="button"
            disabled={submitting || Boolean(targetTodayRecord?.checkInTime)}
            onClick={() => setGeoModalOpen(true)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <MapPin aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
            <span>Geolocation Check-In</span>
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block mx-1" />

          <button
            type="button"
            disabled={submitting || !targetTodayRecord?.checkInTime || Boolean(targetTodayRecord?.checkOutTime)}
            onClick={handleCheckOut}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#111827] dark:bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            <span>Check Out</span>
          </button>

          {targetTodayRecord?.checkInTime && !targetTodayRecord.checkOutTime && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 ml-1">
                <Coffee aria-hidden="true" className="h-3.5 w-3.5" />
                Break:
              </span>
              {[15, 30, 45].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  disabled={submitting}
                  onClick={() => handleLogBreak(mins)}
                  className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-mono-tabular font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  +{mins}m
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
          />
          <input
            id="attendance-search"
            aria-label="Search attendance logs"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search member name, ID, or department…"
            className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm text-[#111827] dark:text-white placeholder:text-slate-400"
          />
        </div>

        <input
          id="attendance-date-filter"
          aria-label="Filter by date"
          type="date"
          disabled={showAllDates}
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
        />

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAllDates}
            onChange={(e) => setShowAllDates(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
          />
          <span>All recent dates</span>
        </label>

        <select
          id="attendance-status-filter"
          aria-label="Filter by attendance status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="ALL">All Statuses</option>
          {ATTENDANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {isAdmin && (
          <select
            id="attendance-dept-filter"
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
        )}
      </div>

      {/* Error / Loading / Attendance Log Table */}
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
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Check In</th>
                <th className="px-4 py-3">Check Out</th>
                <th className="px-4 py-3 text-right">Break</th>
                <th className="px-4 py-3 text-right">Worked</th>
                <th className="px-4 py-3 text-right">Overtime</th>
                <th className="px-4 py-3">Method</th>
                {isManagerOrAdmin && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={isManagerOrAdmin ? 11 : 10} className="px-4 py-3.5">
                      <div className="h-5 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={isManagerOrAdmin ? 11 : 10} className="px-4 py-10 text-center text-sm text-slate-500">
                    <p>No attendance logs match the selected filters.</p>
                    {(statusFilter !== 'ALL' || deptFilter !== 'ALL' || searchQuery || !showAllDates) && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('ALL');
                          setDeptFilter('ALL');
                          setSearchQuery('');
                          setShowAllDates(true);
                        }}
                        className="btn-press mt-2.5 inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Show all recent dates
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#111827] dark:text-white">
                        {rec.employeeName}
                      </p>
                      <p className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                        {rec.employeeCode}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <p>{rec.departmentName}</p>
                      <p className="text-slate-400">{rec.shiftName}</p>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">{rec.date}</td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={rec.status} />
                      {(rec.arrivalDelayMinutes ?? 0) > 0 && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          +{rec.arrivalDelayMinutes}m late
                        </p>
                      )}
                      {rec.anomalyFlag && (
                        <p className="mt-0.5 text-[11px] text-[#D97706] dark:text-amber-400">
                          {rec.anomalyFlag}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {formatTime(rec.checkInTime)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {formatTime(rec.checkOutTime)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular text-xs text-slate-500">
                      {rec.breakMinutes}m
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-medium">
                      {(rec.workingMinutes / 60).toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular text-xs text-[#2563EB] dark:text-blue-400">
                      {rec.overtimeMinutes > 0 ? `+${(rec.overtimeMinutes / 60).toFixed(1)}h` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <p>{rec.checkInMethod}</p>
                      {rec.locationLabel && (
                        <p className="text-[11px] text-slate-400 max-w-[140px] truncate">
                          {rec.locationLabel}
                        </p>
                      )}
                    </td>
                    {isManagerOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditRecord(rec)}
                            aria-label={`Edit attendance for ${rec.employeeName}`}
                            className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Edit2 aria-hidden="true" className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(rec)}
                              aria-label={`Delete attendance for ${rec.employeeName}`}
                              className="btn-press inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-[#DC2626] hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            >
                              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correction Requests Queue */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">
              Attendance Correction Requests
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Approved corrections automatically update working minutes and clear anomaly flags
            </p>
          </div>
          <Clock aria-hidden="true" className="h-4 w-4 text-slate-400" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Requested Window</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                {isManagerOrAdmin && <th className="px-4 py-3 text-right">Review</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {corrections.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 6 : 5}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No attendance correction requests submitted.
                  </td>
                </tr>
              ) : (
                corrections.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.employeeName}</p>
                      <p className="font-mono-tabular text-xs text-slate-500">{c.employeeCode}</p>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">{c.date}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {c.requestedStatus} ({c.requestedCheckIn} – {c.requestedCheckOut})
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-xs">
                      {c.reason}
                    </td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={c.status} />
                    </td>
                    {isManagerOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        {c.status === 'Pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleReviewCorrection(c.id, 'Approved')}
                              className="inline-flex items-center gap-1 rounded bg-[#16A34A] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <Check aria-hidden="true" className="h-3.5 w-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReviewCorrection(c.id, 'Rejected')}
                              className="inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-900 px-2.5 py-1.5 text-xs font-medium text-[#DC2626] dark:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            >
                              <X aria-hidden="true" className="h-3.5 w-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Processed</span>
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

      {/* Geolocation Modal */}
      <Modal
        open={geoModalOpen}
        onClose={() => setGeoModalOpen(false)}
        title="Geolocation Check-In"
        subtitle="Explicit consent is required before recording location coordinates."
      >
        <form onSubmit={handleGeoCheckInSubmit} className="space-y-4">
          <label className="flex items-start gap-3 rounded-md border border-slate-200 dark:border-slate-700 p-3.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={geoConsent}
              onChange={(e) => setGeoConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#2563EB]"
            />
            <span className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
              I consent to capture my current GPS latitude and longitude solely to verify today&apos;s attendance check-in.
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
            <div className="text-xs">
              <p className="font-medium text-slate-700 dark:text-slate-200">Captured Coordinates</p>
              <p className="font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                {geoCoords ? `${geoCoords.lat}, ${geoCoords.lng}` : 'Not captured yet'}
              </p>
            </div>
            <button
              type="button"
              disabled={geoLoading}
              onClick={handleCaptureLocation}
              className="btn-press inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>{geoLoading ? 'Locating…' : 'Locate Me'}</span>
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setGeoModalOpen(false)}
              className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !geoConsent || !geoCoords}
              className="min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Confirm Geo Check-In
            </button>
          </div>
        </form>
      </Modal>

      {/* QR Code Attendance Modal */}
      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="QR Code Attendance"
        subtitle="Verify attendance with a time-bounded QR turnstile token."
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-6">
          {isManagerOrAdmin && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Admin / Manager QR Kiosk Generator
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  value={qrLabelInput}
                  onChange={(e) => setQrLabelInput(e.target.value)}
                  placeholder="Checkpoint label"
                  className="sm:col-span-2 min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={qrValidMins}
                  onChange={(e) => setQrValidMins(Number(e.target.value))}
                  className="min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-mono-tabular"
                  title="Validity in minutes"
                />
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCreateQrSession}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-md bg-[#111827] dark:bg-[#2563EB] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 cursor-pointer"
              >
                <QrCode aria-hidden="true" className="h-4 w-4" />
                <span>Generate New QR Session</span>
              </button>

              {activeQrPreview && qrImageUrl && (
                <div className="flex flex-col sm:flex-row items-center gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <img
                    src={qrImageUrl}
                    alt={`QR code for ${activeQrPreview.token}`}
                    className="h-36 w-36 rounded border border-slate-200 bg-white p-1"
                  />
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-[#111827] dark:text-white">
                      {activeQrPreview.label}
                    </p>
                    <p className="font-mono-tabular text-sm font-bold text-[#2563EB]">
                      {activeQrPreview.token}
                    </p>
                    <p className="text-slate-500">
                      Expires at{' '}
                      {new Date(activeQrPreview.expiresAt).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleQrCheckInSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="qr-token-input"
                className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
              >
                Enter Scanned QR Token
              </label>
              <input
                id="qr-token-input"
                type="text"
                value={qrTokenInput}
                onChange={(e) => setQrTokenInput(e.target.value)}
                placeholder="e.g. APQR-8F3A12B4C901"
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>

            {qrSessions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-500">Active sessions:</p>
                <div className="flex flex-wrap gap-1.5">
                  {qrSessions.slice(0, 4).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setQrTokenInput(s.token);
                        setActiveQrPreview(s);
                      }}
                      className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-mono-tabular hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {s.token} ({s.label})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                Verify & Check In
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Manual Mark Modal */}
      <Modal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Mark Manual Attendance"
        subtitle="Record or override daily attendance for a team member or student."
      >
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label htmlFor="manual-member" className="block text-xs font-medium mb-1">
              Member
            </label>
            <select
              id="manual-member"
              required
              value={manualForm.employeeId}
              onChange={(e) => setManualForm({ ...manualForm, employeeId: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="manual-date" className="block text-xs font-medium mb-1">
                Date
              </label>
              <input
                id="manual-date"
                type="date"
                required
                value={manualForm.date}
                onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="manual-status" className="block text-xs font-medium mb-1">
                Status
              </label>
              <select
                id="manual-status"
                value={manualForm.status}
                onChange={(e) =>
                  setManualForm({ ...manualForm, status: e.target.value as AttendanceStatus })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="manual-checkin" className="block text-xs font-medium mb-1">
                Check In
              </label>
              <input
                id="manual-checkin"
                type="time"
                value={manualForm.checkInTimeStr}
                onChange={(e) => setManualForm({ ...manualForm, checkInTimeStr: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="manual-checkout" className="block text-xs font-medium mb-1">
                Check Out
              </label>
              <input
                id="manual-checkout"
                type="time"
                value={manualForm.checkOutTimeStr}
                onChange={(e) => setManualForm({ ...manualForm, checkOutTimeStr: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="manual-break" className="block text-xs font-medium mb-1">
                Break (min)
              </label>
              <input
                id="manual-break"
                type="number"
                min={0}
                max={180}
                value={manualForm.breakMinutes}
                onChange={(e) =>
                  setManualForm({ ...manualForm, breakMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div>
            <label htmlFor="manual-notes" className="block text-xs font-medium mb-1">
              Notes
            </label>
            <input
              id="manual-notes"
              type="text"
              value={manualForm.notes}
              onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
              placeholder="Optional supervisor remark"
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setManualModalOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Save Attendance
            </button>
          </div>
        </form>
      </Modal>

      {/* Correction Request Modal */}
      <Modal
        open={correctionModalOpen}
        onClose={() => setCorrectionModalOpen(false)}
        title="Submit Attendance Correction"
        subtitle="Request a time or status adjustment for supervisor approval."
      >
        <form onSubmit={handleCorrectionSubmit} className="space-y-4">
          {isManagerOrAdmin && (
            <div>
              <label htmlFor="corr-member" className="block text-xs font-medium mb-1">
                Member
              </label>
              <select
                id="corr-member"
                value={correctionForm.employeeId}
                onChange={(e) =>
                  setCorrectionForm({ ...correctionForm, employeeId: e.target.value })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} — {e.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="corr-date" className="block text-xs font-medium mb-1">
                Date
              </label>
              <input
                id="corr-date"
                type="date"
                required
                value={correctionForm.date}
                onChange={(e) => setCorrectionForm({ ...correctionForm, date: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="corr-status" className="block text-xs font-medium mb-1">
                Requested Status
              </label>
              <select
                id="corr-status"
                value={correctionForm.requestedStatus}
                onChange={(e) =>
                  setCorrectionForm({ ...correctionForm, requestedStatus: e.target.value })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {['Present', 'Work From Home', 'Half Day', 'Late'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="corr-checkin" className="block text-xs font-medium mb-1">
                Requested Check-In
              </label>
              <input
                id="corr-checkin"
                type="time"
                required
                value={correctionForm.requestedCheckIn}
                onChange={(e) =>
                  setCorrectionForm({ ...correctionForm, requestedCheckIn: e.target.value })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="corr-checkout" className="block text-xs font-medium mb-1">
                Requested Check-Out
              </label>
              <input
                id="corr-checkout"
                type="time"
                required
                value={correctionForm.requestedCheckOut}
                onChange={(e) =>
                  setCorrectionForm({ ...correctionForm, requestedCheckOut: e.target.value })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div>
            <label htmlFor="corr-reason" className="block text-xs font-medium mb-1">
              Reason
            </label>
            <textarea
              id="corr-reason"
              required
              rows={3}
              value={correctionForm.reason}
              onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
              placeholder="Explain the badge miss or schedule adjustment…"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCorrectionModalOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Submit Request
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Attendance Record Modal */}
      <Modal
        open={Boolean(editModalRecord)}
        onClose={() => setEditModalRecord(null)}
        title={`Edit Attendance — ${editModalRecord?.employeeName || ''}`}
        subtitle={`Date: ${editModalRecord?.date || ''} · Hours & overtime recalculate automatically`}
      >
        <form onSubmit={handleSaveEditRecord} className="space-y-4">
          <div>
            <label htmlFor="edit-status" className="block text-xs font-medium mb-1">
              Status
            </label>
            <select
              id="edit-status"
              value={editForm.status}
              onChange={(e) =>
                setEditForm({ ...editForm, status: e.target.value as AttendanceStatus })
              }
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              {ATTENDANCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="edit-checkin" className="block text-xs font-medium mb-1">
                Check In
              </label>
              <input
                id="edit-checkin"
                type="time"
                value={editForm.checkInTimeStr}
                onChange={(e) => setEditForm({ ...editForm, checkInTimeStr: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="edit-checkout" className="block text-xs font-medium mb-1">
                Check Out
              </label>
              <input
                id="edit-checkout"
                type="time"
                value={editForm.checkOutTimeStr}
                onChange={(e) => setEditForm({ ...editForm, checkOutTimeStr: e.target.value })}
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="edit-break" className="block text-xs font-medium mb-1">
                Break (min)
              </label>
              <input
                id="edit-break"
                type="number"
                min={0}
                max={300}
                value={editForm.breakMinutes}
                onChange={(e) =>
                  setEditForm({ ...editForm, breakMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div>
            <label htmlFor="edit-notes" className="block text-xs font-medium mb-1">
              Notes
            </label>
            <input
              id="edit-notes"
              type="text"
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditModalRecord(null)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteRecord}
        loading={deleting}
        title="Delete Attendance Record"
        message={
          deleteTarget
            ? `Permanently remove the attendance entry for ${deleteTarget.employeeName || 'this member'} on ${deleteTarget.date}? This action is logged and cannot be undone.`
            : ''
        }
        confirmLabel="Delete Record"
      />
    </div>
  );
}
