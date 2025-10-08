import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProposalResponseSchema } from '@/lib/types'
import { pushService } from '@/lib/push'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request)
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Only artists can respond to proposals
    if (user.role !== 'ARTIST') {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }
    
    const body = await request.json()
    const validatedData = ProposalResponseSchema.parse(body)
    
    // Find the proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id: params.id },
    })
    
    if (!proposal) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      )
    }
    
    // Check if user owns the proposal
    if (proposal.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }
    
    // Check if proposal is still pending
    if (proposal.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: 'Proposal has already been responded to' },
        { status: 400 }
      )
    }
    
    // Update proposal status
    const newStatus = validatedData.action === 'accept' ? 'ACCEPTED' : 'REJECTED'
    
    const updatedProposal = await prisma.proposal.update({
      where: { id: params.id },
      data: { status: newStatus },
      select: {
        id: true,
        title: true,
        status: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    })
    
    // Send push notification to backoffice users
    try {
      const backofficeUsers = await prisma.user.findMany({
        where: { role: 'BACKOFFICE' },
        select: { id: true },
      })
      
      for (const backofficeUser of backofficeUsers) {
        await pushService.sendToUser(backofficeUser.id, {
          title: 'Proposal Response',
          body: `${updatedProposal.user.name || updatedProposal.user.email} ${newStatus.toLowerCase()} proposal: ${updatedProposal.title}`,
          data: {
            proposalId: updatedProposal.id,
            action: newStatus,
          },
        })
      }
    } catch (pushError) {
      console.error('Failed to send push notification:', pushError)
      // Don't fail the request if push notification fails
    }
    
    return NextResponse.json({
      success: true,
      data: { proposal: updatedProposal },
      message: `Proposal ${newStatus.toLowerCase()} successfully`,
    })
  } catch (error) {
    console.error('Proposal response error:', error)
    
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { success: false, error: 'Invalid input data' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
