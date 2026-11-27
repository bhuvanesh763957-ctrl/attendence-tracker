export const QR_TOKEN_PATTERN = /^APQR-[A-F0-9]{12}$/;

const QR_PAYLOAD_PREFIX = 'ATTENDANCE:';

/** Encodes a server-issued token into the QR payload used by the scanner. */
export function buildQrPayload(token: string): string {
  const normalized = normalizeQrToken(token);
  return normalized ? `${QR_PAYLOAD_PREFIX}${normalized}` : token.trim();
}

/**
 * Accepts both the current `ATTENDANCE:APQR-...` payload and legacy raw tokens
 * (`APQR-...`) so already-printed QR codes keep working.
 */
export function normalizeQrToken(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  const value = trimmed.toUpperCase().startsWith(QR_PAYLOAD_PREFIX)
    ? trimmed.slice(QR_PAYLOAD_PREFIX.length).trim()
    : trimmed;
  const normalized = value.toUpperCase();

  return QR_TOKEN_PATTERN.test(normalized) ? normalized : null;
}
