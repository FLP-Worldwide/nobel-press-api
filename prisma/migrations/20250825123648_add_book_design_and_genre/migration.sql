/*
  Warnings:

  - You are about to drop the column `backImageId` on the `Book` table. All the data in the column will be lost.
  - You are about to drop the column `coverImageId` on the `Book` table. All the data in the column will be lost.
  - You are about to drop the `Asset` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Book` DROP FOREIGN KEY `Book_backImageId_fkey`;

-- DropForeignKey
ALTER TABLE `Book` DROP FOREIGN KEY `Book_coverImageId_fkey`;

-- DropIndex
DROP INDEX `Book_backImageId_fkey` ON `Book`;

-- DropIndex
DROP INDEX `Book_coverImageId_fkey` ON `Book`;

-- AlterTable
ALTER TABLE `Book` DROP COLUMN `backImageId`,
    DROP COLUMN `coverImageId`,
    ADD COLUMN `genre` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `Asset`;

-- CreateTable
CREATE TABLE `BookDesign` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookId` INTEGER NOT NULL,
    `size` ENUM('FIVE_X_EIGHT', 'FIVE_HALF_X_EIGHT_HALF', 'SIX_X_NINE', 'EIGHT_HALF_X_EIGHT_HALF', 'EIGHT_HALF_X_ELEVEN', 'CUSTOM') NOT NULL,
    `bindingType` ENUM('PAPERBACK', 'HARDCOVER') NOT NULL,
    `interior` ENUM('BLACK_WHITE', 'COLOR') NOT NULL,
    `paperType` ENUM('CREAM', 'WHITE', 'ART_MATTE') NOT NULL,
    `coverLamination` ENUM('MATTE', 'GLOSS', 'NONE') NOT NULL,
    `customWidthIn` DECIMAL(5, 2) NULL,
    `customHeightIn` DECIMAL(5, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BookDesign_bookId_key`(`bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BookDesign` ADD CONSTRAINT `BookDesign_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
