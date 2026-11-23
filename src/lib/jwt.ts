import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

declare global {
  var _attendanceProJwtSecret: string | undefined;
}

function getJwtSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  if (!global._attendanceProJwtSecret) {
    global._attendanceProJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return global._attendanceProJwtSecret;
}

export interface AccessTokenPayload {
  sub: number;
  uid: string;
  email: string;
  role: string;
  jti: string;
}

export function generateJti(): string {
  return crypto.randomUUID();
}

export function signAccessToken(payload: AccessTokenPayload, expiresInSeconds = 86400): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });
  if (typeof decoded === 'string' || !decoded || typeof decoded.sub !== 'number') {
    throw new Error('Invalid token payload');
  }
  return decoded as unknown as AccessTokenPayload;
}

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
