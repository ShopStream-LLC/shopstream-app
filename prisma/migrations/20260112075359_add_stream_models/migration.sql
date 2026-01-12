-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "StreamEventType" AS ENUM ('STREAM_STARTED', 'STREAM_ENDED', 'PRODUCT_FEATURED', 'PRODUCT_UNFEATURED', 'DEAL_CREATED', 'DEAL_ENDED');

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "StreamStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "muxStreamId" TEXT,
    "muxPlaybackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamProduct" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "position" INTEGER NOT NULL,
    "featuredAt" TIMESTAMP(3),

    CONSTRAINT "StreamProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamEvent" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "type" "StreamEventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stream_shop_idx" ON "Stream"("shop");

-- CreateIndex
CREATE INDEX "StreamProduct_streamId_idx" ON "StreamProduct"("streamId");

-- CreateIndex
CREATE INDEX "StreamEvent_streamId_idx" ON "StreamEvent"("streamId");

-- AddForeignKey
ALTER TABLE "StreamProduct" ADD CONSTRAINT "StreamProduct_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamEvent" ADD CONSTRAINT "StreamEvent_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
