import { prisma } from '@/lib/prisma'

export interface AuditLogEntry {
  action: string
  entityType: string
  entityId: string
  payload?: Record<string, any>
  actorUserId?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Log an audit event with structured data
 */
export async function log({
  action,
  entityType,
  entityId,
  payload,
  actorUserId,
  ipAddress,
  userAgent,
}: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actorUserId || 'system',
        action: `${entityType.toUpperCase()}_${action.toUpperCase()}`,
        details: payload ? JSON.stringify({
          entityType,
          entityId,
          ...payload,
        }) : JSON.stringify({
          entityType,
          entityId,
        }),
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    console.error('Failed to log audit event:', error)
    // Don't throw error to avoid breaking the main flow
  }
}

/**
 * Convenience functions for common audit actions
 */

export async function logUserAction(
  action: string,
  userId: string,
  payload?: Record<string, any>,
  actorUserId?: string
) {
  await log({
    action,
    entityType: 'USER',
    entityId: userId,
    payload,
    actorUserId,
  })
}

export async function logProposalAction(
  action: string,
  proposalId: string,
  payload?: Record<string, any>,
  actorUserId?: string
) {
  await log({
    action,
    entityType: 'PROPOSAL',
    entityId: proposalId,
    payload,
    actorUserId,
  })
}

export async function logBatchAction(
  action: string,
  batchId: string,
  payload?: Record<string, any>,
  actorUserId?: string
) {
  await log({
    action,
    entityType: 'BATCH',
    entityId: batchId,
    payload,
    actorUserId,
  })
}

export async function logClientAction(
  action: string,
  clientId: string,
  payload?: Record<string, any>,
  actorUserId?: string
) {
  await log({
    action,
    entityType: 'CLIENT',
    entityId: clientId,
    payload,
    actorUserId,
  })
}

export async function logArtistAction(
  action: string,
  artistId: string,
  payload?: Record<string, any>,
  actorUserId?: string
) {
  await log({
    action,
    entityType: 'ARTIST',
    entityId: artistId,
    payload,
    actorUserId,
  })
}

/**
 * Get audit logs for a specific entity
 */
export async function getEntityAuditLogs(
  entityType: string,
  entityId: string,
  limit: number = 50
) {
  return await prisma.auditLog.findMany({
    where: {
      details: {
        contains: `"entityId":"${entityId}"`,
      },
      action: {
        startsWith: entityType.toUpperCase(),
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  })
}

/**
 * Get recent audit logs for dashboard
 */
export async function getRecentAuditLogs(limit: number = 20) {
  return await prisma.auditLog.findMany({
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  })
}
