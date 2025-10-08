import { NextRequest, NextResponse } from 'next/server'
import { requireBackoffice } from '@/lib/auth'
import { getBackofficeProposals } from '@/lib/services/proposals'

export async function GET(request: NextRequest) {
  try {
    // Require backoffice authentication
    const user = await requireBackoffice(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch proposals with live Monday.com data
    const proposals = await getBackofficeProposals()

    return NextResponse.json({ proposals })
  } catch (error) {
    console.error('Error fetching backoffice proposals:', error)
    return NextResponse.json(
      { error: 'Failed to fetch proposals' },
      { status: 500 }
    )
  }
}
