import { CalendarCheck2, Clock, FileSpreadsheet, KeyRound, Moon, ShieldCheck, Sun } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiPublicFetch } from '../lib/api.ts';

interface SignInScreenProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

type AuthMode = 'login' | 'register' | 'reset';

const CAPABILITIES = [
  {
    icon: Clock,
    title: 'Automated time & shift math',
    detail: 'Tracks check-ins, breaks, overtime, late arrivals, early departures, and half-days against shift rules.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-based access control',
    detail: 'Separate workspace permissions for Administrators, Department Managers, and Employees or Students.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Audit-ready exports & leave sync',
    detail: 'Generate PDF and Excel workforce reports alongside leave balance tracking and anomaly alerts.',
  },
];

export function SignInScreen({ darkMode, onToggleDarkMode }: SignInScreenProps) {
  const { signInWithGoogle, loginWithPassword, registerWithPassword, authError } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  // Login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register form
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<'EMPLOYEE' | 'STUDENT'>('EMPLOYEE');
  const [regCode, setRegCode] = useState('');

  // Reset form
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      await loginWithPassword(email, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      await registerWithPassword({
        name: regName,
        email: regEmail,
        password: regPassword,
        role: regRole,
        memberCode: regCode.trim() || undefined,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to register.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      const res = await apiPublicFetch<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      setInfoMessage(res.message);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Reset request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteReset = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      const res = await apiPublicFetch<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      setInfoMessage(res.message);
      setResetToken('');
      setNewPassword('');
      setMode('login');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayedError = localError || authError;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120] text-[#111827] dark:text-slate-100">
      <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#111827] dark:bg-[#2563EB] text-white">
              <CalendarCheck2 aria-hidden="true" className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight">Attendance Pro</span>
          </div>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {darkMode ? (
              <>
                <Sun aria-hidden="true" className="h-4 w-4" />
                <span>Light mode</span>
              </>
            ) : (
              <>
                <Moon aria-hidden="true" className="h-4 w-4" />
                <span>Dark mode</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7 space-y-6">
            <h1
              className="text-3xl font-bold tracking-tight text-[#111827] dark:text-white sm:text-4xl"
              style={{ textWrap: 'balance' }}
            >
              Enterprise attendance, shift policies, and leave governance in one workspace.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
              Built for multi-department teams, universities, and research labs. Sign in with your workspace credentials or Google account to access real-time attendance logs, QR and geolocation check-ins, and executive analytics backed by PostgreSQL.
            </p>

            <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
              {CAPABILITIES.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div
                    key={cap.title}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4"
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 text-[#2563EB] dark:text-blue-400" />
                    <h2 className="mt-3 text-sm font-semibold text-[#111827] dark:text-white">
                      {cap.title}
                    </h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {cap.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-7">
              <h2 className="text-xl font-semibold tracking-tight text-[#111827] dark:text-white">
                Sign in to Attendance Pro
              </h2>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                Use Admin, Employee, or Student credentials, or continue with Google Workspace.
              </p>

              {/* Auth Mode Tabs */}
              <div className="mt-4 grid grid-cols-3 gap-1 rounded-md bg-slate-100 dark:bg-slate-800/80 p-1">
                {(
                  [
                    { key: 'login', label: 'Sign In' },
                    { key: 'register', label: 'Register' },
                    { key: 'reset', label: 'Reset' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setMode(tab.key);
                      setLocalError('');
                      setInfoMessage('');
                    }}
                      className={`btn-press rounded py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        mode === tab.key
                          ? 'bg-white dark:bg-[#111827] text-[#111827] dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-[#111827] dark:hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>

              {displayedError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-300"
                >
                  {displayedError}
                </div>
              )}

              {infoMessage && (
                <div
                  role="status"
                  className="mt-4 rounded-md border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300"
                >
                  {infoMessage}
                </div>
              )}

              {mode === 'login' && (
                <form onSubmit={handlePasswordLogin} className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium mb-1">
                      Work or Campus Email
                    </label>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@organization.com"
                      className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium mb-1">
                      Password
                    </label>
                    <input
                      id="login-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-press w-full inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md bg-[#111827] dark:bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    <KeyRound aria-hidden="true" className="h-4 w-4" />
                    <span>{submitting ? 'Signing in…' : 'Sign In with Password'}</span>
                  </button>
                </form>
              )}

              {mode === 'register' && (
                <form onSubmit={handleRegister} className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="reg-name" className="block text-xs font-medium mb-1">
                      Full Name
                    </label>
                    <input
                      id="reg-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-email" className="block text-xs font-medium mb-1">
                      Email
                    </label>
                    <input
                      id="reg-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="alex@organization.com"
                      className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="reg-role" className="block text-xs font-medium mb-1">
                        Account Type
                      </label>
                      <select
                        id="reg-role"
                        name="role"
                        value={regRole}
                        onChange={(e) => setRegRole(e.target.value as 'EMPLOYEE' | 'STUDENT')}
                        className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm"
                      >
                        <option value="EMPLOYEE">Employee</option>
                        <option value="STUDENT">Student</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="reg-code" className="block text-xs font-medium mb-1">
                        ID Code (Optional)
                      </label>
                      <input
                        id="reg-code"
                        name="memberCode"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.toUpperCase())}
                        placeholder="EMP-2050"
                        className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-mono-tabular"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="reg-password" className="block text-xs font-medium mb-1">
                      Password (min 8 chars, upper, lower &amp; digit)
                    </label>
                    <input
                      id="reg-password"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Create a strong password"
                      className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-press w-full inline-flex min-h-[42px] items-center justify-center rounded-md bg-[#111827] dark:bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? 'Creating Account…' : 'Create Account'}
                  </button>
                </form>
              )}

              {mode === 'reset' && (
                <div className="mt-4 space-y-4">
                  <form onSubmit={handleRequestReset} className="space-y-2.5">
                    <label htmlFor="reset-request-email" className="block text-xs font-medium">
                      Request Password Reset
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="reset-request-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        spellCheck={false}
                        required
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="flex-1 min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={submitting}
                        className="btn-press min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                      >
                        Request
                      </button>
                    </div>
                  </form>

                  <form
                    onSubmit={handleCompleteReset}
                    className="space-y-2.5 border-t border-slate-200 dark:border-slate-800 pt-3"
                  >
                    <label htmlFor="reset-token" className="block text-xs font-medium">
                      Complete Reset with Code
                    </label>
                    <input
                      id="reset-token"
                      name="token"
                      type="text"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste one-time reset code"
                      className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-mono-tabular"
                    />
                    <label htmlFor="reset-new-password" className="sr-only">
                      New password
                    </label>
                    <input
                      id="reset-new-password"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      className="w-full min-h-[38px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-press w-full min-h-[40px] rounded-md bg-[#111827] dark:bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 cursor-pointer"
                    >
                      Set New Password
                    </button>
                  </form>
                </div>
              )}

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase">
                  <span className="bg-white dark:bg-[#111827] px-2 text-slate-400">Or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={signInWithGoogle}
                className="btn-press w-full inline-flex min-h-[42px] items-center justify-center gap-3 rounded-md bg-[#2563EB] px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Sessions are verified server-side with signed JWT sessions or Firebase Admin tokens and scoped by role.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
