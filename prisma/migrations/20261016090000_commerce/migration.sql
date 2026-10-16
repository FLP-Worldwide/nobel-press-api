-- AlterEnum
ALTER TYPE "public"."BookReviewStatus" ADD VALUE 'PAYMENT_PENDING';

-- AlterEnum
ALTER TYPE "public"."OrderStatus" ADD VALUE 'PRINTING';

-- AlterTable
ALTER TABLE "public"."Book" ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "printCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "public"."PublishingPayment" ADD COLUMN     "initiationStartedAt" TIMESTAMP(3),
ADD COLUMN     "redirectUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "checkoutKey" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."OrderItem" ADD COLUMN     "authorEarnings" DECIMAL(12,2),
ADD COLUMN     "cartItemId" INTEGER,
ADD COLUMN     "cartItemUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "platformCommission" DECIMAL(12,2),
ADD COLUMN     "printCost" DECIMAL(12,2),
ADD COLUMN     "revisionId" INTEGER,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "initiationStartedAt" TIMESTAMP(3),
ADD COLUMN     "redirectUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "public"."Order"("checkoutKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "public"."Payment"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "public"."Payment"("providerOrderId");

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "public"."BookRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

