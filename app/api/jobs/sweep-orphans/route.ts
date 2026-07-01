import { NextRequest, NextResponse } from 'next/server'
import { sweepOrphanedClientServices } from '@/lib/services/sweep-orphans'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Manual trigger for the orphan-ClientService sweep.
 *
 * Use this when you want to heal orphans on demand (e.g. you spot a bride
 * on Monday who isn't in any artist's FFuser inbox and want to backfill
 * her without waiting for the next webhook to arrive).
 *
 * The same sweep also runs automatically at the end of every Monday
 * webhook POST, so you rarely need to call this manually during normal
 * activity. The manual route defaults to a wider 24-hour window than the
 * 60-minute window the webhook uses, so it can catch older orphans.
 *
 * Usage:
 *   curl -X POST https://<your-domain>/api/jobs/sweep-orphans
 *   curl -X POST 'https://<your-domain>/api/jobs/sweep-orphans?windowMinutes=240'
 */

async function runSweep(request: NextRequest) {
  const url = new URL(request.url)
  const windowParam = url.searchParams.get('windowMinutes')
  const windowMinutes = windowParam ? Math.max(1, parseInt(windowParam, 10) || 0) : 24 * 60

  try {
    const result = await sweepOrphanedClientServices({ windowMinutes })
    return NextResponse.json({
      success: true,
      windowMinutes,
      ...result,
    })
  } catch (error) {
    console.error('[sweep-orphans:route] failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return runSweep(request)
}

// Allow GET so it can be hit from a browser or external scheduler easily.
export async function GET(request: NextRequest) {
  return runSweep(request)
}
