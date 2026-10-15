-- Add the explicit publishing lifecycle and immutable review records.
ALTER TABLE `Book`
  MODIFY `status` ENUM(
    'DRAFT',
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'PAYMENT_PENDING',
    'PUBLISHED',
    'REJECTED',
    'INACTIVE'
  ) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `authorBiography` TEXT NULL,
  ADD COLUMN `categories` JSON NULL,
  ADD COLUMN `keywords` JSON NULL,
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `retailPrice` DECIMAL(12, 2) NULL,
  ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
  ADD COLUMN `submittedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `publishedAt` DATETIME(3) NULL;

-- A chapter is intentionally able to hold a realistically sized manuscript section.
ALTER TABLE `BookChapter`
  MODIFY `content` LONGTEXT NOT NULL,
  ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

ALTER TABLE `Order`
  ADD COLUMN `kind` ENUM('RETAIL', 'AUTHOR_COPY') NOT NULL DEFAULT 'RETAIL',
  ADD COLUMN `shippingCharge` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

CREATE TABLE `BookRevision` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookId` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `snapshot` JSON NOT NULL,
  `contentHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `BookRevision_bookId_version_key`(`bookId`, `version`),
  INDEX `BookRevision_bookId_idx`(`bookId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BookReview` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookId` INTEGER NOT NULL,
  `revisionId` INTEGER NOT NULL,
  `status` ENUM('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
  `authorMessage` TEXT NULL,
  `reviewerNotes` TEXT NULL,
  `submittedById` INTEGER NOT NULL,
  `reviewedById` INTEGER NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,

  UNIQUE INDEX `BookReview_revisionId_key`(`revisionId`),
  INDEX `BookReview_bookId_submittedAt_idx`(`bookId`, `submittedAt`),
  INDEX `BookReview_status_submittedAt_idx`(`status`, `submittedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PublishingPayment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookId` INTEGER NOT NULL,
  `revisionId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
  `status` ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
  `provider` VARCHAR(191) NULL,
  `providerOrderId` VARCHAR(191) NULL,
  `providerRef` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `paidAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PublishingPayment_providerOrderId_key`(`providerOrderId`),
  UNIQUE INDEX `PublishingPayment_providerRef_key`(`providerRef`),
  INDEX `PublishingPayment_bookId_status_idx`(`bookId`, `status`),
  INDEX `PublishingPayment_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BookStatusEvent` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookId` INTEGER NOT NULL,
  `actorId` INTEGER NOT NULL,
  `previousStatus` ENUM(
    'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED',
    'PAYMENT_PENDING', 'PUBLISHED', 'REJECTED', 'INACTIVE'
  ) NOT NULL,
  `newStatus` ENUM(
    'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED',
    'PAYMENT_PENDING', 'PUBLISHED', 'REJECTED', 'INACTIVE'
  ) NOT NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `BookStatusEvent_bookId_createdAt_idx`(`bookId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BookRevision`
  ADD CONSTRAINT `BookRevision_bookId_fkey`
  FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BookReview`
  ADD CONSTRAINT `BookReview_bookId_fkey`
  FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `BookReview_revisionId_fkey`
  FOREIGN KEY (`revisionId`) REFERENCES `BookRevision`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `BookReview_submittedById_fkey`
  FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `BookReview_reviewedById_fkey`
  FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PublishingPayment`
  ADD CONSTRAINT `PublishingPayment_bookId_fkey`
  FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PublishingPayment_revisionId_fkey`
  FOREIGN KEY (`revisionId`) REFERENCES `BookRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PublishingPayment_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BookStatusEvent`
  ADD CONSTRAINT `BookStatusEvent_bookId_fkey`
  FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `BookStatusEvent_actorId_fkey`
  FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
