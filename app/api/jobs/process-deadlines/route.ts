import { NextRequest, NextResponse } from 'next/server'
import { runProcessDeadlines } from './processor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const result = await runProcessDeadlines()
    
    return NextResponse.json({
      success: true,
      processed: result.processed,
      sentOptions: result.sentOptions,
      noAvailability: result.noAvailability,
      singleTosBroadcast: result.singleTosBroadcast,
      errors: result.errors,
    })
  } catch (error) {
    console.error('Deadline processing failed:', error)
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
