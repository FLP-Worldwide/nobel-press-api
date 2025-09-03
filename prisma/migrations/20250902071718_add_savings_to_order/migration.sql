/*
  Warnings:

  - You are about to drop the column `discount` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingPrice` on the `Order` table. All the data in the column will be lost.
  - Added the required column `customerEmail` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerName` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerPhone` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Order` DROP COLUMN `discount`,
    DROP COLUMN `shippingPrice`,
    ADD COLUMN `customerEmail` VARCHAR(191) NOT NULL,
    ADD COLUMN `customerName` VARCHAR(191) NOT NULL,
    ADD COLUMN `customerPhone` VARCHAR(191) NOT NULL,
    ADD COLUMN `savings` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `storePickup` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    MODIFY `paymentMethod` ENUM('COD', 'CARD', 'UPI', 'PAYPAL') NOT NULL;

-- AlterTable
ALTER TABLE `Payment` MODIFY `method` ENUM('COD', 'CARD', 'UPI', 'PAYPAL') NOT NULL;
