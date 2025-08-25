/*
  Warnings:

  - You are about to drop the column `backImage` on the `Book` table. All the data in the column will be lost.
  - You are about to drop the column `coverImage` on the `Book` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Book` DROP COLUMN `backImage`,
    DROP COLUMN `coverImage`,
    ADD COLUMN `backImageId` INTEGER NULL,
    ADD COLUMN `coverImageId` INTEGER NULL;

-- CreateTable
CREATE TABLE `Asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(191) NOT NULL DEFAULT 's3',
    `bucket` VARCHAR(191) NOT NULL,
    `region` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `cdnDomain` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `etag` VARCHAR(191) NULL,
    `visibility` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `originalName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Asset_key_key`(`key`),
    INDEX `Asset_bucket_key_idx`(`bucket`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Book` ADD CONSTRAINT `Book_coverImageId_fkey` FOREIGN KEY (`coverImageId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Book` ADD CONSTRAINT `Book_backImageId_fkey` FOREIGN KEY (`backImageId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
