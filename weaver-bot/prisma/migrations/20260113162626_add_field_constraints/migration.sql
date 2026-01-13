/*
  Warnings:

  - You are about to alter the column `question` on the `FAQ` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `category` on the `FAQ` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - You are about to alter the column `comment` on the `Feedback` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.
  - You are about to alter the column `subject` on the `Ticket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(200)`.
  - You are about to alter the column `category` on the `Ticket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - You are about to alter the column `status` on the `Ticket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `trackingNotes` on the `Ticket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `priority` on the `TrackedTicket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(10)`.
  - You are about to alter the column `status` on the `TrackedTicket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `notes` on the `TrackedTicket` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.

*/
-- AlterTable
ALTER TABLE "FAQ" ALTER COLUMN "question" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "category" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "Feedback" ALTER COLUMN "comment" SET DATA TYPE VARCHAR(1000);

-- AlterTable
ALTER TABLE "Ticket" ALTER COLUMN "subject" SET DATA TYPE VARCHAR(200),
ALTER COLUMN "category" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "trackingNotes" SET DATA TYPE VARCHAR(500);

-- AlterTable
ALTER TABLE "TrackedTicket" ALTER COLUMN "priority" SET DATA TYPE VARCHAR(10),
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "notes" SET DATA TYPE VARCHAR(1000);
