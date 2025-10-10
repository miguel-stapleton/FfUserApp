-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ARTIST', 'BACKOFFICE');

-- CreateEnum
CREATE TYPE "ArtistType" AS ENUM ('MUA', 'HS');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('FOUNDER', 'RESIDENT', 'FRESH');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('MUA', 'HS');

-- CreateEnum
CREATE TYPE "ProposalResponse" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "ProposalBatchMode" AS ENUM ('SINGLE', 'BROADCAST');

-- CreateEnum
CREATE TYPE "ProposalBatchState" AS ENUM ('OPEN', 'SENT_OPTIONS', 'NO_AVAILABILITY', 'EXPIRED_NO_ACTION');

-- CreateEnum
CREATE TYPE "BatchStartReason" AS ENUM ('UNDECIDED', 'CHOSEN_NO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ArtistType" NOT NULL,
    "tier" "Tier" NOT NULL,
    "email" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "profilePicture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientService" (
    "id" TEXT NOT NULL,
    "mondayClientItemId" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "bridesName" TEXT NOT NULL,
    "weddingDate" TIMESTAMP(3) NOT NULL,
    "beautyVenue" TEXT NOT NULL,
    "description" TEXT,
    "chosenArtistMondayItemId" TEXT,
    "currentStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalBatch" (
    "id" TEXT NOT NULL,
    "clientServiceId" TEXT NOT NULL,
    "mode" "ProposalBatchMode" NOT NULL,
    "startReason" "BatchStartReason" NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "state" "ProposalBatchState" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "proposalBatchId" TEXT NOT NULL,
    "clientServiceId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "response" "ProposalResponse",
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_userId_key" ON "Artist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_email_key" ON "Artist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_mondayItemId_key" ON "Artist"("mondayItemId");

-- CreateIndex
CREATE INDEX "Artist_type_active_idx" ON "Artist"("type", "active");

-- CreateIndex
CREATE INDEX "ClientService_mondayClientItemId_service_idx" ON "ClientService"("mondayClientItemId", "service");

-- CreateIndex
CREATE INDEX "ProposalBatch_clientServiceId_state_deadlineAt_idx" ON "ProposalBatch"("clientServiceId", "state", "deadlineAt");

-- CreateIndex
CREATE INDEX "Proposal_artistId_respondedAt_idx" ON "Proposal"("artistId", "respondedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_proposalBatchId_artistId_key" ON "Proposal"("proposalBatchId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalBatch" ADD CONSTRAINT "ProposalBatch_clientServiceId_fkey" FOREIGN KEY ("clientServiceId") REFERENCES "ClientService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposalBatchId_fkey" FOREIGN KEY ("proposalBatchId") REFERENCES "ProposalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clientServiceId_fkey" FOREIGN KEY ("clientServiceId") REFERENCES "ClientService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "ClientService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

