import { and, eq, gt, isNull } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { db } from '../db/index.ts';
import { userSessions, users } from '../db/schema.ts';
import { ensureSeedData } from '../db/seed.ts';
import { getOrCreateUser } from '../db/users.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifyAccessToken } from '../lib/jwt.ts';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'STUDENT';

export interface AuthenticatedDbUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  managedDepartmentId: number | null;
  employeeId: number | null;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: AuthenticatedDbUser;
  sessionJti?: string;
}

export function isAdminRole(role?: string): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function isStaffSelfRole(role?: string): boolean {
  return role === 'EMPLOYEE' || role === 'STUDENT';
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty authentication token' });
  }

  try {
    await ensureSeedData();

    // 1. Try JWT session verification first (HS256 signed by our server)
    try {
      const jwtPayload = verifyAccessToken(token);
      const now = new Date();
      const sessionRows = await db
        .select()
        .from(userSessions)
        .where(
          and(
            eq(userSessions.jti, jwtPayload.jti),
            eq(userSessions.userId, jwtPayload.sub),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, now)
          )
        )
        .limit(1);

      if (sessionRows.length === 0) {
        return res.status(401).json({ error: 'Session expired or revoked. Please sign in again.' });
      }

      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, jwtPayload.sub))
        .limit(1);

      if (userRows.length === 0 || userRows[0].status !== 'active') {
        return res.status(403).json({ error: 'Account is inactive or suspended.' });
      }

      const u = userRows[0];
      req.dbUser = {
        id: u.id,
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        managedDepartmentId: u.managedDepartmentId,
        employeeId: u.employeeId,
      };
      req.sessionJti = jwtPayload.jti;
      return next();
    } catch {
      // Not a valid local HS256 JWT — fall through to Firebase ID Token verification
    }

    // 2. Fallback: Firebase ID Token verification (Google Workspace Sign-In)
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;

    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@attendancepro.local`,
      typeof decodedToken.name === 'string' ? decodedToken.name : ''
    );
    if (dbUser.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive or suspended.' });
    }
    req.dbUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      displayName: dbUser.displayName,
      role: dbUser.role,
      status: dbUser.status,
      managedDepartmentId: dbUser.managedDepartmentId,
      employeeId: dbUser.employeeId,
    };
    return next();
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.dbUser?.role as UserRole | undefined;
    if (!role) {
      return res.status(403).json({ error: 'Forbidden: Missing user role.' });
    }
    const effectiveAllowed = new Set<UserRole>(allowedRoles);
    if (effectiveAllowed.has('ADMIN')) {
      effectiveAllowed.add('SUPER_ADMIN');
    }
    if (!effectiveAllowed.has(role)) {
      return res.status(403).json({
        error: 'Forbidden: Your current role does not have permission for this action',
      });
    }
    next();
  };
};
