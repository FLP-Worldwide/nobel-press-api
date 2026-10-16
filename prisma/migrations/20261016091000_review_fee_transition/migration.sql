-- Existing unpaid submissions must pass through payment before joining the queue.
-- Run after the enum migration has committed. Preserve immutable revisions and notes.
INSERT INTO "BookStatusEvent" ("bookId", "actorId", "previousStatus", "newStatus", "notes", "createdAt")
SELECT b.id, b."userId", b.status, 'PAYMENT_PENDING', 'Moved to fee-before-review workflow; submitted version retained', CURRENT_TIMESTAMP
FROM "Book" b
WHERE b.status IN ('IN_REVIEW', 'APPROVED') AND b."deletedAt" IS NULL
AND NOT EXISTS (SELECT 1 FROM "PublishingPayment" p WHERE p."bookId" = b.id AND p.status = 'PAID' AND p.amount = 199 AND p.currency = 'INR');

UPDATE "Book" b SET status = 'PAYMENT_PENDING', "approvedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE b.status IN ('IN_REVIEW', 'APPROVED') AND b."deletedAt" IS NULL
AND NOT EXISTS (SELECT 1 FROM "PublishingPayment" p WHERE p."bookId" = b.id AND p.status = 'PAID' AND p.amount = 199 AND p.currency = 'INR');

UPDATE "BookReview" r SET status = 'PAYMENT_PENDING'
FROM "Book" b, "BookRevision" v
WHERE r."bookId" = b.id AND r."revisionId" = v.id AND b.status = 'PAYMENT_PENDING'
AND v.version = (SELECT MAX(latest.version) FROM "BookRevision" latest WHERE latest."bookId" = b.id)
AND NOT EXISTS (SELECT 1 FROM "PublishingPayment" p WHERE p."bookId" = b.id AND p.status = 'PAID' AND p.amount = 199 AND p.currency = 'INR');
