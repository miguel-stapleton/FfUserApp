import { prisma } from './prisma'

export interface AuditLogData {
  userId?: string
  action: string
  entityType: string
  entityId: string
  details?: Record<string, any>
}

export async function logAudit({
  userId,
  action,
  entityType,
  entityId,
  details,
}: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: userId || null,
        action,
        entityType,
        entityId,
        payload: details || {},
      },
    })
  } catch (error) {
    console.error('Failed to log audit event:', error)
    // Don't throw error to avoid breaking the main flow
  }
}
