ALTER TABLE "BookChapter"
  ADD COLUMN "creationKey" VARCHAR(128),
  ADD COLUMN "creationHash" VARCHAR(64);

CREATE UNIQUE INDEX "BookChapter_bookId_creationKey_key"
  ON "BookChapter"("bookId", "creationKey");
