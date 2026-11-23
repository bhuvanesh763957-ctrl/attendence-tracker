import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

export interface AuditInput {
  actorUserId?: number | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string | number;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail || 'system',
      actorRole: input.actorRole || 'SYSTEM',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId !== undefined ? String(input.resourceId) : '',
      ipAddress: input.ipAddress || '',
      metadata: JSON.stringify(input.metadata ?? {}),
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}
