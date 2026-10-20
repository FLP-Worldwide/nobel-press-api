ALTER TABLE "Book" ADD COLUMN "publicId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "Book_publicId_key" ON "Book"("publicId");
