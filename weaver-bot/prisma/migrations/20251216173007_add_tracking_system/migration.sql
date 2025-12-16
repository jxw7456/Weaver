-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "notionPageId" TEXT,
ADD COLUMN     "tracked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackedAt" TIMESTAMP(3),
ADD COLUMN     "trackedBy" TEXT,
ADD COLUMN     "trackingNotes" TEXT;

-- CreateTable
CREATE TABLE "TrackedTicket" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "trackedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "exportedAt" TIMESTAMP(3),
    "notionPageId" TEXT,

    CONSTRAINT "TrackedTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedTicket_ticketId_key" ON "TrackedTicket"("ticketId");
