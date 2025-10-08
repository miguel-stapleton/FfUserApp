// Prisma enum types
export type UserRole = 'ARTIST' | 'BACKOFFICE'
export type ArtistType = 'MUA' | 'HS'
export type Tier = 'FOUNDER' | 'RESIDENT' | 'FRESH'
export type ServiceType = 'WEDDING' | 'ENGAGEMENT' | 'BRIDAL_PARTY' | 'OTHER'
export type ProposalResponse = 'YES' | 'NO'
export type ProposalBatchMode = 'SINGLE' | 'BROADCAST'
export type ProposalBatchState = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
export type BatchStartReason = 'MANUAL' | 'SCHEDULED' | 'AUTO_RETRY'

// Base Prisma model types
export interface User {
  id: string
  email: string
  username: string
  passwordHash: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

export interface Artist {
  id: string
  userId: string
  email: string
  type: ArtistType
  tier: Tier
  mondayItemId: string
  active: boolean
  createdAt: Date
  updatedAt: Date
  user?: User
}

export interface ClientService {
  id: string
  mondayClientItemId: string
  serviceType: ServiceType
  clientName: string
  clientEmail: string
  clientPhone?: string
  eventDate: Date
  eventLocation?: string
  budget?: number
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface ProposalBatch {
  id: string
  clientServiceId: string
  mode: ProposalBatchMode
  state: ProposalBatchState
  startReason: BatchStartReason
  targetCount?: number
  actualCount: number
  scheduledAt?: Date
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
  clientService?: ClientService
  proposals?: Proposal[]
}

export interface Proposal {
  id: string
  batchId: string
  artistId: string
  response?: ProposalResponse
  respondedAt?: Date
  createdAt: Date
  updatedAt: Date
  batch?: ProposalBatch
  artist?: Artist
}

export interface AuditLog {
  id: string
  userId: string
  action: string
  details?: string
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  user?: User
}

export interface PushSubscription {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: Date
  updatedAt: Date
  user?: User
}

// Frontend response types
export interface ArtistProposalCard {
  id: string
  batchId: string
  clientName: string
  serviceType: ServiceType
  eventDate: Date
  eventLocation?: string
  beautyVenue?: string
  budget?: number
  notes?: string
  observations?: string
  response?: ProposalResponse
  respondedAt?: Date
  createdAt: Date
  isExpired: boolean
  timeRemaining?: string
}

export interface BackofficeRow {
  mondayClientItemId: string
  clientName: string
  eventDate: string
  beautyVenue?: string
  mStatus?: string
  status: string
  muaArtists: Array<{
    email: string
    tier: string
    response: string | null
    respondedAt: Date | null
  }>
  hsArtists: Array<{
    email: string
    tier: string
    response: string | null
    respondedAt: Date | null
  }>
}

export interface BackofficeInfo {
  totalClients: number
  activeBatches: number
  pendingProposals: number
  completedToday: number
  averageResponseTime: number
  topArtists: Array<{
    artistId: string
    artistEmail: string
    artistType: ArtistType
    tier: Tier
    responseRate: number
    totalProposals: number
  }>
  recentActivity: Array<{
    id: string
    action: string
    entityType: string
    entityId: string
    actorEmail: string
    createdAt: Date
  }>
}

export interface BackofficeClientInfo {
  mondayClientItemId: string
  clientName: string
  eventDate: string
  beautyVenue?: string
  observations?: string
  mStatus?: string
  hStatus?: string
  availableArtists: {
    mua: Array<{ email: string; tier: string }>
    hs: Array<{ email: string; tier: string }>
  }
  unavailableArtists: {
    mua: Array<{ email: string; tier: string }>
    hs: Array<{ email: string; tier: string }>
  }
  timeline: Array<{
    timestamp: string
    event: string
    icon: string
  }>
}

// API request types
export interface CreateBatchRequest {
  clientServiceId: string
  mode: ProposalBatchMode
  reason: BatchStartReason
  targetCount?: number
  scheduledAt?: Date
}

export interface RespondToProposalRequest {
  proposalId: string
  response: ProposalResponse
  actorUserId: string
}

export interface UpsertClientServiceRequest {
  mondayClientItemId: string
  serviceType: ServiceType
  clientName: string
  clientEmail: string
  clientPhone?: string
  eventDate: Date
  eventLocation?: string
  budget?: number
  notes?: string
}

// Monday.com integration types
export interface MondayArtist {
  itemId: string
  email: string
  board: string
  tier: Tier
  active: boolean
}

export interface MondayClient {
  itemId: string
  name: string
  email: string
  phone?: string
  eventDate: Date
  location?: string
  budget?: number
  serviceType: ServiceType
  notes?: string
}

// Utility types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
