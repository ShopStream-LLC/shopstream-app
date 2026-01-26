-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "muxAssetId" TEXT,
ADD COLUMN     "muxAssetPlaybackId" TEXT,
ADD COLUMN     "muxAssetCreatedAt" TIMESTAMP(3),
ADD COLUMN     "shopifyVideoId" TEXT,
ADD COLUMN     "shopifyVideoUrl" TEXT,
ADD COLUMN     "migratedToShopifyAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StreamClip" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "productId" TEXT,
    "muxClipId" TEXT,
    "muxClipPlaybackId" TEXT,
    "startTime" INTEGER NOT NULL,
    "endTime" INTEGER NOT NULL,
    "shopifyVideoId" TEXT,
    "shopifyVideoUrl" TEXT,
    "migratedToShopifyAt" TIMESTAMP(3),
    "title" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamClip_streamId_idx" ON "StreamClip"("streamId");

-- CreateIndex
CREATE INDEX "StreamClip_productId_idx" ON "StreamClip"("productId");

-- AddForeignKey
ALTER TABLE "StreamClip" ADD CONSTRAINT "StreamClip_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
