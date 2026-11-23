import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, NavKey } from './components/AppShell.tsx';
import { AttendanceView } from './components/AttendanceView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { DirectoryView } from './components/DirectoryView.tsx';
import { HolidaysShiftsView } from './components/HolidaysShiftsView.tsx';
import { LeavesView } from './components/LeavesView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { SignInScreen } from './components/SignInScreen.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { apiFetch } from './lib/api.ts';
import { NotificationItem } from './types/attendance.ts';

const VALID_NAV_KEYS = new Set<NavKey>([
  'dashboard',
  'attendance',
  'directory',
  'leaves',
  'reports',
  'holidays',
  'notifications',
  'settings',
]);

function getInitialNav(): NavKey {
  try {
    const param = new URLSearchParams(window.location.search).get('tab') as NavKey | null;
    if (param && VALID_NAV_KEYS.has(param)) return param;
  } catch {
    // ignore URL read failures
  }
  return 'dashboard';
}

function WorkspaceApp() {
  const { dbUser, loading } = useAuth();
  const [activeNav, setActiveNavState] = useState<NavKey>(getInitialNav);
  const [unreadCount, setUnreadCount] = useState(0);
  const [profileTargetId, setProfileTargetId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; isError: boolean } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('attendance_pro_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const setActiveNav = useCallback((next: NavKey) => {
    setActiveNavState(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'dashboard') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', next);
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // ignore history errors
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveNavState(getInitialNav());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', darkMode ? '#0b1120' : '#f8fafc');
    }
    try {
      window.localStorage.setItem('attendance_pro_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage failures
    }
  }, [darkMode]);

  const scheduleToastDismiss = useCallback((toastId: number) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === toastId ? null : current));
    }, 4500);
  }, []);

  const showToast = useCallback(
    (text: string, isError = false) => {
      const id = Date.now();
      setToast({ id, text, isError });
      scheduleToastDismiss(id);
    },
    [scheduleToastDismiss]
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (!dbUser) return;
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setUnreadCount(res.notifications.filter((n) => !n.isRead).length);
    } catch {
      // silent background badge refresh
    }
  }, [dbUser]);

  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount, activeNav]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-600 dark:text-slate-300">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 mx-auto rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin" />
          <p className="text-sm font-medium">Loading Attendance Pro…</p>
        </div>
      </div>
    );
  }

  if (!dbUser) {
    return (
      <SignInScreen
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />
    );
  }

  const handleOpenMyProfile = () => {
    if (dbUser.employeeId) {
      setProfileTargetId(dbUser.employeeId);
      setActiveNav('directory');
    }
  };

  return (
    <AppShell
      activeNav={activeNav}
      onNavigate={setActiveNav}
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((d) => !d)}
      unreadCount={unreadCount}
      onOpenMyProfile={handleOpenMyProfile}
    >
      {activeNav === 'dashboard' && (
        <DashboardView onNavigate={setActiveNav} onNotify={showToast} />
      )}
      {activeNav === 'attendance' && <AttendanceView onNotify={showToast} />}
      {activeNav === 'directory' && (
        <DirectoryView
          initialProfileId={profileTargetId}
          onClearInitialProfile={() => setProfileTargetId(null)}
          onNotify={showToast}
        />
      )}
      {activeNav === 'leaves' && <LeavesView onNotify={showToast} />}
      {activeNav === 'reports' && <ReportsView />}
      {activeNav === 'holidays' && <HolidaysShiftsView onNotify={showToast} />}
      {activeNav === 'notifications' && (
        <NotificationsView
          onCountChanged={() => void refreshUnreadCount()}
          onNotify={showToast}
        />
      )}
      {activeNav === 'settings' && <SettingsView onNotify={showToast} />}

      {toast && (
        <div
          role={toast.isError ? 'alert' : 'status'}
          aria-live={toast.isError ? 'assertive' : 'polite'}
          onMouseEnter={() => {
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
          }}
          onMouseLeave={() => scheduleToastDismiss(toast.id)}
          className={`toast-enter fixed bottom-5 right-5 z-50 flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg no-print ${
            toast.isError
              ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-[#DC2626] dark:text-rose-200'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-[#111827] dark:text-white'
          }`}
        >
          {toast.isError ? (
            <XCircle aria-hidden="true" className="h-4 w-4 text-[#DC2626] shrink-0" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-[#16A34A] shrink-0" />
          )}
          <span className="min-w-0">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss message"
            className="btn-press text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceApp />
    </AuthProvider>
  );
}
