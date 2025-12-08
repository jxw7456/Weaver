-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isAI" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "aiResponded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "escalatedAt" TIMESTAMP(3);
