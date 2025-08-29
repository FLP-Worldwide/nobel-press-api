/*
  Warnings:

  - A unique constraint covering the columns `[sessionId]` on the table `Cart` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Cart` ADD COLUMN `sessionId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Cart_sessionId_key` ON `Cart`(`sessionId`);
