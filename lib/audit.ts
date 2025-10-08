import { prisma } from './prisma'

export interface AuditLogData {
  userId: string
  action: string
  details?: Record<string, any>
  ipAddress?: string
  userAgent?: string
}

export async function logAudit({
  userId,
  action,
  details,
  ipAddress,
  userAgent,
}: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details: details ? JSON.stringify(details) : null,
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    console.error('Failed to log audit event:', error)
    // Don't throw error to avoid breaking the main flow
  }
}
