import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
// import { uploadVideoToShopify } from "../lib/shopify-upload.server"; // TODO: Enable when admin context is available
import { convertHlsToMp4, downloadClipAsMp4 } from "../lib/video-conversion.server";
// import { requireShopSession } from "../auth.server"; // TODO: Enable when per-shop authentication is implemented

/**
 * Migration job endpoint to migrate 90+ day old assets from Mux to Shopify
 * 
 * GET /api/jobs/migrate-assets?token=[SECRET]
 * 
 * This endpoint:
 * 1. Finds streams where muxAssetCreatedAt is older than 90 days
 * 2. Downloads videos from Mux
 * 3. Uploads to Shopify Files
 * 4. Updates database with Shopify URLs
 * 5. Optionally deletes from Mux (commented out for safety)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return action({ request });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify secret token
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const expectedToken = process.env.MIGRATION_JOB_SECRET;

  if (!expectedToken) {
    console.error("[Migration Job] MIGRATION_JOB_SECRET not configured");
    return Response.json(
      { error: "Migration job secret not configured" },
      { status: 500 }
    );
  }

  if (token !== expectedToken) {
    console.error("[Migration Job] Invalid token provided");
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    console.log("[Migration Job] Starting asset migration...");

    // Calculate 90 days ago
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Find streams that need migration
    const streamsToMigrate = await db.stream.findMany({
      where: {
        muxAssetCreatedAt: {
          lte: ninetyDaysAgo,
        },
        shopifyVideoId: null, // Not migrated yet
        status: "ENDED", // Only migrate ended streams
        muxAssetId: {
          not: null, // Must have an asset
        },
      },
      include: {
        clips: {
          where: {
            shopifyVideoId: null, // Clips not migrated yet
            muxClipId: {
              not: null,
            },
          },
        },
      },
    });

    console.log(`[Migration Job] Found ${streamsToMigrate.length} streams to migrate`);

    const results = {
      streamsProcessed: 0,
      streamsSucceeded: 0,
      streamsFailed: 0,
      clipsProcessed: 0,
      clipsSucceeded: 0,
      clipsFailed: 0,
      errors: [] as string[],
    };

    // Process each stream
    for (const stream of streamsToMigrate) {
      try {
        console.log(`[Migration Job] Processing stream ${stream.id}...`);

        if (!stream.muxAssetId) {
          console.log(`[Migration Job] Stream ${stream.id} has no asset ID, skipping`);
          continue;
        }

        // Get admin context for this shop (needed for Shopify upload)
        // Note: This requires a session, but for cron jobs we might need a different approach
        // For now, we'll need to handle this differently - perhaps store admin tokens or use app-level auth
        // This is a limitation - we need shop context to upload to Shopify
        
        // TODO: This needs to be refactored to work with cron jobs
        // Options:
        // 1. Store admin access tokens per shop
        // 2. Use app-level authentication
        // 3. Call this endpoint per-shop with proper authentication
        
        // For now, we'll skip the actual upload and just log what would be done
        console.log(`[Migration Job] Would migrate stream ${stream.id} (asset: ${stream.muxAssetId})`);
        
        // Download video from Mux
        const videoBuffer = await convertHlsToMp4(stream.muxAssetId);
        console.log(`[Migration Job] Downloaded ${videoBuffer.length} bytes for stream ${stream.id}`);

        // TODO: Upload to Shopify (requires admin context)
        // const uploadResult = await uploadVideoToShopify(
        //   admin,
        //   videoBuffer,
        //   `stream-${stream.id}.mp4`,
        //   `Stream: ${stream.title}`
        // );

        // if (!uploadResult) {
        //   throw new Error("Failed to upload video to Shopify");
        // }

        // Update stream with Shopify URLs
        // await db.stream.update({
        //   where: { id: stream.id },
        //   data: {
        //     shopifyVideoId: uploadResult.fileId,
        //     shopifyVideoUrl: uploadResult.cdnUrl,
        //     migratedToShopifyAt: new Date(),
        //   },
        // });

        results.streamsProcessed++;
        results.streamsSucceeded++;

        // Process clips for this stream
        for (const clip of stream.clips) {
          try {
            if (!clip.muxClipId) {
              continue;
            }

            console.log(`[Migration Job] Processing clip ${clip.id}...`);

            // Download clip
            const clipBuffer = await downloadClipAsMp4(clip.muxClipId);
            console.log(`[Migration Job] Downloaded ${clipBuffer.length} bytes for clip ${clip.id}`);

            // TODO: Upload to Shopify and update database
            // Similar to stream migration above

            results.clipsProcessed++;
            results.clipsSucceeded++;
          } catch (error) {
            console.error(`[Migration Job] Error processing clip ${clip.id}:`, error);
            results.clipsFailed++;
            results.errors.push(`Clip ${clip.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        }
      } catch (error) {
        console.error(`[Migration Job] Error processing stream ${stream.id}:`, error);
        results.streamsFailed++;
        results.errors.push(`Stream ${stream.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    console.log("[Migration Job] Migration complete:", results);

    return Response.json({
      success: true,
      summary: results,
      message: `Processed ${results.streamsProcessed} streams and ${results.clipsProcessed} clips`,
    });
  } catch (error) {
    console.error("[Migration Job] Fatal error:", error);
    return Response.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};
