import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { employees, users } from './schema.ts';

const OWNER_ADMIN_EMAIL = 'bhuvanesh763957@gmail.com';

export async function getOrCreateUser(uid: string, email: string, displayName: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);

    if (existing.length > 0) {
      const current = existing[0];
      const updated = await db
        .update(users)
        .set({
          email: normalizedEmail,
          displayName: displayName || current.displayName || normalizedEmail.split('@')[0],
          updatedAt: new Date(),
        })
        .where(eq(users.uid, uid))
        .returning();
      return updated[0];
    }

    const adminCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'ADMIN'));
    const hasAdmin = (adminCountResult[0]?.count ?? 0) > 0;

    const matchingEmployees = await db
      .select()
      .from(employees)
      .where(eq(employees.email, normalizedEmail))
      .limit(1);

    let linkedEmployeeId: number | null = matchingEmployees[0]?.id ?? null;
    if (!linkedEmployeeId) {
      const firstActiveEmployee = await db
        .select()
        .from(employees)
        .where(eq(employees.status, 'active'))
        .limit(1);
      linkedEmployeeId = firstActiveEmployee[0]?.id ?? null;
    }

    const initialRole =
      normalizedEmail === OWNER_ADMIN_EMAIL || !hasAdmin ? 'ADMIN' : 'EMPLOYEE';

    const result = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail.split('@')[0],
        role: initialRole,
        employeeId: linkedEmployeeId,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          displayName: displayName || normalizedEmail.split('@')[0],
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export function isOwnerEmail(email: string): boolean {
  return email.trim().toLowerCase() === OWNER_ADMIN_EMAIL;
}

export function sanitizeDbUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    managedDepartmentId: u.managedDepartmentId,
    employeeId: u.employeeId,
    hasPassword: Boolean(u.passwordHash),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

