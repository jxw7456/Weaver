-- CreateTable
CREATE TABLE "Escalation" (
    "id" SERIAL NOT NULL,
    "threadId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceContent" TEXT NOT NULL,
    "partnerUserId" TEXT,
    "partnerUsername" TEXT,
    "partnerCompany" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_threadId_key" ON "Escalation"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_sourceMessageId_key" ON "Escalation"("sourceMessageId");

-- CreateIndex
CREATE INDEX "Escalation_status_createdAt_idx" ON "Escalation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Escalation_partnerCompany_idx" ON "Escalation"("partnerCompany");
