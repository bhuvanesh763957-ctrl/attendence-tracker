import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be configured with at least 32 characters.'
    );
  }

  return secret;
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

export function signAccessToken(
  payload: AccessTokenPayload,
  expiresInSeconds = 86400
): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });

  if (
    typeof decoded === 'string' ||
    !decoded ||
    typeof decoded.sub !== 'number'
  ) {
    throw new Error('Invalid token payload');
  }

  return decoded as unknown as AccessTokenPayload;
}

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
