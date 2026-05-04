/*
  Warnings:

  - You are about to drop the column `forumId` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `guildId` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `partnerUserId` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `partnerUsername` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `sourceChannelId` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `sourceUrl` on the `Escalation` table. All the data in the column will be lost.
  - You are about to drop the column `threadId` on the `Escalation` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[triageThreadId]` on the table `Escalation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[escalationThreadId]` on the table `Escalation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sourceMessageUrl` to the `Escalation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `triageChannelId` to the `Escalation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `triageGuildId` to the `Escalation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `triageThreadId` to the `Escalation` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Escalation_threadId_key";

-- AlterTable
ALTER TABLE "Escalation" DROP COLUMN "forumId",
DROP COLUMN "guildId",
DROP COLUMN "partnerUserId",
DROP COLUMN "partnerUsername",
DROP COLUMN "sourceChannelId",
DROP COLUMN "sourceUrl",
DROP COLUMN "threadId",
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedBy" TEXT,
ADD COLUMN     "escalationForumId" TEXT,
ADD COLUMN     "escalationGuildId" TEXT,
ADD COLUMN     "escalationThreadId" TEXT,
ADD COLUMN     "sourceAuthorId" TEXT,
ADD COLUMN     "sourceAuthorName" TEXT,
ADD COLUMN     "sourceMessageUrl" TEXT NOT NULL,
ADD COLUMN     "triageChannelId" TEXT NOT NULL,
ADD COLUMN     "triageGuildId" TEXT NOT NULL,
ADD COLUMN     "triageThreadId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'triage';

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_triageThreadId_key" ON "Escalation"("triageThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_escalationThreadId_key" ON "Escalation"("escalationThreadId");
