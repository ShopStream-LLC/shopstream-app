-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveStartedAt" TIMESTAMP(3),
ADD COLUMN     "multicastFacebook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "multicastInstagram" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "multicastTiktok" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringFrequency" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "useOBS" BOOLEAN NOT NULL DEFAULT true;
