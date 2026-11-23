import {
  Bell,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileBarChart2,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plane,
  Settings,
  Shield,
  Sun,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UserRole } from '../types/attendance.ts';

export type NavKey =
  | 'dashboard'
  | 'attendance'
  | 'directory'
  | 'leaves'
  | 'reports'
  | 'holidays'
  | 'notifications'
  | 'settings';

interface AppShellProps {
  activeNav: NavKey;
  onNavigate: (key: NavKey) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  unreadCount: number;
  onOpenMyProfile: () => void;
  children: ReactNode;
}

export const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'directory', label: 'Employees & Students', icon: Users },
  { key: 'leaves', label: 'Leave Management', icon: Plane },
  { key: 'reports', label: 'Reports & Analytics', icon: FileBarChart2 },
  { key: 'holidays', label: 'Holidays & Shifts', icon: CalendarDays },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  activeNav,
  onNavigate,
  darkMode,
  onToggleDarkMode,
  unreadCount,
  onOpenMyProfile,
  children,
}: AppShellProps) {
  const { dbUser, policy, canSwitchTestRole, switchTestRole, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const profileContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        profileContainerRef.current &&
        !profileContainerRef.current.contains(e.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen]);

  const handleRoleChange = async (role: UserRole) => {
    if (!dbUser || role === dbUser.role) return;
    setSwitchingRole(true);
    try {
      await switchTestRole(role);
    } finally {
      setSwitchingRole(false);
      setProfileMenuOpen(false);
    }
  };

  const formattedDate = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const initials = (dbUser?.displayName || 'AP')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleNavClick = (key: NavKey) => {
    onNavigate(key);
    setMobileMenuOpen(false);
  };

  const activeNavLabel = NAV_ITEMS.find((item) => item.key === activeNav)?.label || 'Dashboard';

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#0B1120] text-[#111827] dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-[#2563EB] focus:px-3.5 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 dark:border-slate-800 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#111827] dark:bg-[#2563EB] text-white shrink-0">
            <CalendarCheck2 aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-[#111827] dark:text-white">
              {policy?.organizationName || 'Attendance Pro'}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Workforce &amp; Campus Suite
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => handleNavClick(item.key)}
                className={`btn-press w-full flex items-center justify-between gap-3 rounded-md px-3 py-2.5 min-h-[40px] text-sm font-medium cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-100 dark:bg-slate-800 text-[#2563EB] dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-[#111827] dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.key === 'notifications' && unreadCount > 0 && (
                  <span className="font-mono-tabular text-xs font-semibold text-[#2563EB] dark:text-blue-400">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Access Level</span>
            <span className="font-semibold text-[#111827] dark:text-slate-200">
              {dbUser?.role}
            </span>
          </div>
          {dbUser?.employeeId && (
            <button
              type="button"
              onClick={onOpenMyProfile}
              className="btn-press w-full flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <UserCircle2 aria-hidden="true" className="h-4 w-4 text-[#2563EB] shrink-0" />
              <span>My Attendance Profile</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden bg-slate-950/60 backdrop-enter"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <div className="w-72 max-w-[85vw] bg-white dark:bg-[#111827] h-full flex flex-col border-r border-slate-200 dark:border-slate-800 drawer-enter">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#111827] dark:bg-[#2563EB] text-white shrink-0">
                  <CalendarCheck2 aria-hidden="true" className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold truncate">Attendance Pro</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="btn-press inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3 overflow-y-auto" aria-label="Mobile navigation">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => handleNavClick(item.key)}
                    className={`btn-press w-full flex items-center justify-between rounded-md px-3 py-2.5 min-h-[44px] text-sm font-medium cursor-pointer ${
                      active
                        ? 'bg-slate-100 dark:bg-slate-800 text-[#2563EB] dark:text-blue-400'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.key === 'notifications' && unreadCount > 0 && (
                      <span className="font-mono-tabular text-xs font-semibold text-[#2563EB] dark:text-blue-400">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#111827]/95 backdrop-blur px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="btn-press lg:hidden inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="hidden md:inline text-slate-400 dark:text-slate-500 whitespace-nowrap">
                Attendance Pro
              </span>
              <ChevronRight aria-hidden="true" className="hidden md:inline h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-semibold text-[#111827] dark:text-slate-100 truncate">
                {activeNavLabel}
              </span>
            </nav>

            <span className="hidden xl:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
              |
            </span>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <span>{formattedDate}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular font-medium text-[#111827] dark:text-slate-200">
                {formattedTime}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleNavClick('notifications')}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
              className="btn-press relative inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Bell aria-hidden="true" className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] font-semibold text-white font-mono-tabular">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="btn-press inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              {darkMode ? (
                <Sun aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Moon aria-hidden="true" className="h-4 w-4" />
              )}
            </button>

            <div className="relative" ref={profileContainerRef}>
              <button
                type="button"
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                onClick={() => setProfileMenuOpen((o) => !o)}
                className="btn-press inline-flex min-h-[40px] items-center gap-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded bg-[#111827] dark:bg-[#2563EB] text-xs font-semibold text-white shrink-0">
                  {initials}
                </span>
                <span className="hidden md:block leading-tight">
                  <span className="block text-xs font-semibold text-[#111827] dark:text-white max-w-[130px] truncate">
                    {dbUser?.displayName}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {dbUser?.role}
                  </span>
                </span>
              </button>

              {profileMenuOpen && (
                <div
                  role="menu"
                  className="popover-enter absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-lg p-3 z-50 space-y-3"
                >
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-2.5">
                    <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                      {dbUser?.displayName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dbUser?.email}
                    </p>
                  </div>

                  {dbUser?.employeeId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onOpenMyProfile();
                      }}
                      className="btn-press w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <UserCircle2 aria-hidden="true" className="h-4 w-4 text-[#2563EB]" />
                      <span>View My Profile</span>
                    </button>
                  )}

                  {canSwitchTestRole && (
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <Shield aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>Preview Role Access</span>
                      </p>
                      <div className="grid grid-cols-3 gap-1">
                        {(['ADMIN', 'MANAGER', 'EMPLOYEE'] as UserRole[]).map((role) => (
                          <button
                            key={role}
                            type="button"
                            disabled={switchingRole}
                            onClick={() => handleRoleChange(role)}
                            className={`btn-press rounded px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${
                              dbUser?.role === role || (role === 'ADMIN' && dbUser?.role === 'SUPER_ADMIN')
                                ? 'bg-[#2563EB] text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {role === 'EMPLOYEE' ? 'STAFF' : role}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={logout}
                      className="btn-press w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-[#DC2626] dark:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
