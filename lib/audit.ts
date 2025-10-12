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
    // Guard: AuditLog.entityId has an FK to ClientService.id in schema.prisma
    // Only write if the provided entityId is a valid ClientService ID
    const exists = await prisma.clientService.count({ where: { id: entityId } })
    if (!exists) {
      console.warn('[audit] Skipping audit write: entityId does not reference ClientService', {
        action,
        entityType,
        entityId,
      })
      return
    }

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
