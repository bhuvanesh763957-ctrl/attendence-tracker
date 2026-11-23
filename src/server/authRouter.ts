import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  attendancePolicies,
  departments,
  employees,
  passwordResetTokens,
  shifts,
  userSessions,
  users,
} from '../db/schema.ts';
import { ensureSeedData } from '../db/seed.ts';
import { isOwnerEmail, sanitizeDbUser } from '../db/users.ts';
import { logAuditEvent } from '../lib/audit.ts';
import { generateJti, hashOpaqueToken, signAccessToken } from '../lib/jwt.ts';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '../lib/validation.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';

export const authRouter = express.Router();

async function createSessionAndToken(
  user: typeof users.$inferSelect,
  req: express.Request
): Promise<string> {
  const jti = generateJti();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(userSessions).values({
    userId: user.id,
    jti,
    userAgent: (req.headers['user-agent'] || '').slice(0, 240),
    ipAddress: req.ip || '',
    expiresAt,
  });

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return signAccessToken(
    {
      sub: user.id,
      uid: user.uid,
      email: user.email,
      role: user.role,
      jti,
    },
    86400
  );
}

// Public: Register a new Employee or Student account (or first-run admin bootstrap if no users/passwords exist)
authRouter.post('/register', async (req, res) => {
  try {
    await ensureSeedData();
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
    }

    const { name, email, password, role, memberCode, phone } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingUsers.length > 0) {
      return res.status(409).json({
        error: 'An account with this email already exists. Sign in or reset your password.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Link existing employee by email or code, or create a new directory profile
    let linkedEmp = (
      await db.select().from(employees).where(eq(employees.email, normalizedEmail)).limit(1)
    )[0];

    if (!linkedEmp) {
      const firstDept = (await db.select().from(departments).limit(1))[0];
      const firstShift = (await db.select().from(shifts).limit(1))[0];
      if (firstDept && firstShift) {
        const prefix = role === 'STUDENT' ? 'STU' : 'EMP';
        const generatedCode =
          memberCode?.toUpperCase() || `${prefix}-${Math.floor(2000 + Math.random() * 7900)}`;
        const createdEmp = await db
          .insert(employees)
          .values({
            code: generatedCode,
            fullName: name,
            email: normalizedEmail,
            phone: phone || '',
            departmentId: firstDept.id,
            shiftId: firstShift.id,
            designation: role === 'STUDENT' ? 'Student Member' : 'Team Member',
            memberType: role === 'STUDENT' ? 'student' : 'employee',
            joiningDate: new Date().toISOString().slice(0, 10),
            status: 'active',
          })
          .returning();
        linkedEmp = createdEmp[0];
      }
    }

    // Check if any admin exists yet; if owner email or zero admins, grant ADMIN
    const adminCountRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'ADMIN'));
    const hasAdmin = (adminCountRes[0]?.count ?? 0) > 0;

    const assignedRole =
      isOwnerEmail(normalizedEmail) || !hasAdmin
        ? 'ADMIN'
        : role === 'STUDENT'
          ? 'STUDENT'
          : 'EMPLOYEE';

    const uid = `local_${crypto.randomUUID()}`;
    const createdUsers = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName: name,
        passwordHash,
        role: assignedRole,
        status: 'active',
        employeeId: linkedEmp?.id ?? null,
      })
      .returning();

    const user = createdUsers[0];
    const token = await createSessionAndToken(user, req);
    const policy = (await db.select().from(attendancePolicies).limit(1))[0] ?? null;

    await logAuditEvent({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_REGISTER',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.status(201).json({
      token,
      user: sanitizeDbUser(user),
      employee: linkedEmp ?? null,
      policy,
      canSwitchTestRole: isOwnerEmail(user.email),
    });
  } catch (error) {
    const pgCode = (error as { code?: string; cause?: { code?: string } })?.code ||
      (error as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === '23505') {
      return res.status(409).json({
        error: 'An employee or student with that ID code or email already exists.',
      });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Unable to complete registration.' });
  }
});

// Public: Login with email and password (Admin, Manager, Employee, Student)
authRouter.post('/login', async (req, res) => {
  try {
    await ensureSeedData();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email and password are required.' });
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const user = userRows[0];
    if (!user || !user.passwordHash) {
      await logAuditEvent({
        actorEmail: normalizedEmail,
        actorRole: 'ANONYMOUS',
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'session',
        ipAddress: req.ip,
        metadata: { reason: 'invalid_credentials_or_sso_only' },
      });
      return res.status(401).json({
        error:
          'Invalid email or password. If your account uses Google Sign-In, sign in with Google or set a password first.',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Your account is suspended. Contact an administrator.' });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      await logAuditEvent({
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'session',
        ipAddress: req.ip,
        metadata: { reason: 'wrong_password' },
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = await createSessionAndToken(user, req);
    const linkedEmployee = user.employeeId
      ? (await db.select().from(employees).where(eq(employees.id, user.employeeId)).limit(1))[0] ??
        null
      : null;
    const policy = (await db.select().from(attendancePolicies).limit(1))[0] ?? null;

    await logAuditEvent({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_LOGIN_SUCCESS',
      resourceType: 'session',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: sanitizeDbUser(user),
      employee: linkedEmployee,
      policy,
      canSwitchTestRole: isOwnerEmail(user.email),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

// Authenticated: Logout and revoke active JWT session
authRouter.post('/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.sessionJti) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.jti, req.sessionJti));
    }

    await logAuditEvent({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      actorRole: req.dbUser!.role,
      action: 'AUTH_LOGOUT',
      resourceType: 'session',
      resourceId: req.sessionJti || 'firebase',
      ipAddress: req.ip,
    });

    res.json({ loggedOut: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});

// Public: Request password reset token (stored hashed in DB; generic response prevents email enumeration)
authRouter.post('/forgot-password', async (req, res) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (userRows.length > 0) {
      const user = userRows[0];
      const rawToken = crypto.randomBytes(24).toString('hex');
      const tokenHash = hashOpaqueToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      await logAuditEvent({
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'AUTH_PASSWORD_RESET_REQUESTED',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: req.ip,
      });
    }

    res.json({
      message:
        'If an account exists for that email, a password reset request has been logged. Contact your workspace administrator to issue a one-time reset code if SMTP is not configured.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Unable to process password reset request.' });
  }
});

// Admin / Super Admin: Issue a one-time password reset token for a specific user
authRouter.post(
  '/admin-reset-token',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const userId = Number((req.body as { userId?: number }).userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'Valid userId is required.' });
      }

      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const rawToken = crypto.randomBytes(16).toString('hex');
      const tokenHash = hashOpaqueToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await db.insert(passwordResetTokens).values({
        userId,
        tokenHash,
        expiresAt,
      });

      await logAuditEvent({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: 'ADMIN_ISSUED_PASSWORD_RESET_TOKEN',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: req.ip,
      });

      res.json({ resetToken: rawToken, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error('Admin reset token error:', error);
      res.status(500).json({ error: 'Unable to issue reset token.' });
    }
  }
);

// Public: Complete password reset using opaque token
authRouter.post('/reset-password', async (req, res) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reset data.' });
    }

    const tokenHash = hashOpaqueToken(parsed.data.token);
    const now = new Date();
    const tokenRows = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .limit(1);

    if (tokenRows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    const resetRow = tokenRows[0];
    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);

    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(users.id, resetRow.userId));

    await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, resetRow.id));

    await db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(and(eq(userSessions.userId, resetRow.userId), isNull(userSessions.revokedAt)));

    await logAuditEvent({
      actorUserId: resetRow.userId,
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      resourceType: 'user',
      resourceId: resetRow.userId,
      ipAddress: req.ip,
    });

    res.json({ message: 'Password has been reset. You can now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// Authenticated: Change password (or set password for SSO user)
authRouter.post('/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password.' });
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, req.dbUser!.id))
      .limit(1);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userRows[0];
    if (user.passwordHash) {
      const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    const now = new Date();

    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(users.id, user.id));

    if (req.sessionJti) {
      await db
        .update(userSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(userSessions.userId, user.id),
            ne(userSessions.jti, req.sessionJti),
            isNull(userSessions.revokedAt)
          )
        );
    }

    await logAuditEvent({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_PASSWORD_CHANGED',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// Authenticated: Update own profile (displayName + phone)
authRouter.patch('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile data.' });
    }

    const userId = req.dbUser!.id;
    const now = new Date();
    if (parsed.data.displayName) {
      await db
        .update(users)
        .set({ displayName: parsed.data.displayName, updatedAt: now })
        .where(eq(users.id, userId));
    }

    if (req.dbUser!.employeeId) {
      const empUpdates: Record<string, unknown> = { updatedAt: now };
      if (parsed.data.displayName) empUpdates.fullName = parsed.data.displayName;
      if (parsed.data.phone !== undefined) empUpdates.phone = parsed.data.phone;
      await db
        .update(employees)
        .set(empUpdates)
        .where(eq(employees.id, req.dbUser!.employeeId));
    }

    const updated = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    await logAuditEvent({
      actorUserId: userId,
      actorEmail: updated.email,
      actorRole: updated.role,
      action: 'PROFILE_UPDATED',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: req.ip,
    });

    res.json({ user: sanitizeDbUser(updated) });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Authenticated: List active & recent login sessions for current user
authRouter.get('/sessions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, req.dbUser!.id))
      .orderBy(desc(userSessions.createdAt))
      .limit(15);

    res.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        createdAt: s.createdAt,
        isCurrent: req.sessionJti === s.jti,
      })),
    });
  } catch (error) {
    console.error('Session list error:', error);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

// Authenticated: Revoke a specific session belonging to current user
authRouter.delete('/sessions/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }

    const updated = await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.id, id), eq(userSessions.userId, req.dbUser!.id)))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    res.json({ revoked: true, id });
  } catch (error) {
    console.error('Session revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});
