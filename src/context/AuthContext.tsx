import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiFetch,
  apiPublicFetch,
  getInMemoryAuthToken,
  setInMemoryAuthToken,
} from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { AttendancePolicy, DbUser, Employee, UserRole } from '../types/attendance.ts';

interface AuthSessionPayload {
  token: string;
  user: DbUser;
  employee: Employee | null;
  policy: AttendancePolicy | null;
  canSwitchTestRole: boolean;
}

interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role: 'EMPLOYEE' | 'STUDENT';
  memberCode?: string;
  phone?: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUser | null;
  employee: Employee | null;
  policy: AttendancePolicy | null;
  canSwitchTestRole: boolean;
  loading: boolean;
  authError: string;
  signInWithGoogle: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerWithPassword: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchTestRole: (role: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [canSwitchTestRole, setCanSwitchTestRole] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      const data = await apiFetch<{
        user: DbUser;
        employee: Employee | null;
        policy: AttendancePolicy | null;
        canSwitchTestRole: boolean;
      }>('/api/me');
      setDbUser(data.user);
      setEmployee(data.employee);
      setPolicy(data.policy);
      setCanSwitchTestRole(data.canSwitchTestRole);
      setAuthError('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to load workspace profile.');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        setInMemoryAuthToken(null);
        await loadProfile();
      } else if (!getInMemoryAuthToken()) {
        setDbUser(null);
        setEmployee(null);
        setPolicy(null);
        setCanSwitchTestRole(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [loadProfile]);

  const signInWithGoogle = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Sign-in was cancelled or blocked by the browser.'
      );
    }
  };

  const loginWithPassword = async (email: string, password: string) => {
    setAuthError('');
    try {
      const res = await apiPublicFetch<AuthSessionPayload>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setInMemoryAuthToken(res.token);
      setDbUser(res.user);
      setEmployee(res.employee);
      setPolicy(res.policy);
      setCanSwitchTestRole(res.canSwitchTestRole);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid email or password.';
      setAuthError(msg);
      throw err;
    }
  };

  const registerWithPassword = async (payload: RegisterPayload) => {
    setAuthError('');
    try {
      const res = await apiPublicFetch<AuthSessionPayload>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setInMemoryAuthToken(res.token);
      setDbUser(res.user);
      setEmployee(res.employee);
      setPolicy(res.policy);
      setCanSwitchTestRole(res.canSwitchTestRole);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      setAuthError(msg);
      throw err;
    }
  };

  const logout = async () => {
    try {
      if (getInMemoryAuthToken() || auth.currentUser) {
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
      }
    } finally {
      setInMemoryAuthToken(null);
      setDbUser(null);
      setEmployee(null);
      setPolicy(null);
      setCanSwitchTestRole(false);
      setAuthError('');
      if (auth.currentUser) {
        await signOut(auth);
      }
    }
  };

  const switchTestRole = async (role: UserRole) => {
    const res = await apiFetch<{ user: DbUser }>('/api/me/test-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setDbUser(res.user);
    await loadProfile();
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        employee,
        policy,
        canSwitchTestRole,
        loading,
        authError,
        signInWithGoogle,
        loginWithPassword,
        registerWithPassword,
        logout,
        refreshProfile: loadProfile,
        switchTestRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
