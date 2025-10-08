import { NextRequest, NextResponse } from 'next/server'
import { requireBackoffice } from '@/lib/auth'
import { getBackofficeClientInfo } from '@/lib/services/clients'

interface RouteParams {
  params: {
    mondayClientItemId: string
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Require backoffice authentication
    const user = await requireBackoffice(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { mondayClientItemId } = params

    if (!mondayClientItemId) {
      return NextResponse.json(
        { error: 'Monday client item ID is required' },
        { status: 400 }
      )
    }

    // Fetch client info with live Monday.com data
    const clientInfo = await getBackofficeClientInfo(mondayClientItemId)

    if (!clientInfo) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(clientInfo)
  } catch (error) {
    console.error('Error fetching client info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch client info' },
      { status: 500 }
    )
  }
}
