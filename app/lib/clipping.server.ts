import db from "../db.server";
import { mux } from "./mux.server";

/**
 * Creates automatic clips for featured products in a stream
 * 
 * When a product is featured during a stream, we create a clip that includes:
 * - 30 seconds before the product was featured
 * - 2 minutes after the product was featured
 * 
 * @param streamId - The stream ID to create clips for
 */
export async function createAutoClipsForFeaturedProducts(streamId: string): Promise<void> {
  try {
    // Fetch stream with products and asset info
    const stream = await db.stream.findFirst({
      where: { id: streamId },
      include: {
        products: {
          where: {
            featuredAt: {
              not: null,
            },
          },
          orderBy: {
            featuredAt: "asc",
          },
        },
      },
    });

    if (!stream) {
      console.error(`[Auto-Clip] Stream ${streamId} not found`);
      return;
    }

    if (!stream.muxAssetId) {
      console.log(`[Auto-Clip] Stream ${streamId} has no asset ID yet, skipping auto-clip creation`);
      return;
    }

    if (!stream.startedAt) {
      console.log(`[Auto-Clip] Stream ${streamId} has no startedAt timestamp, skipping auto-clip creation`);
      return;
    }

    if (stream.products.length === 0) {
      console.log(`[Auto-Clip] Stream ${streamId} has no featured products, skipping auto-clip creation`);
      return;
    }

    console.log(`[Auto-Clip] Creating clips for ${stream.products.length} featured products in stream ${streamId}`);

    // Process each featured product
    for (const streamProduct of stream.products) {
      if (!streamProduct.featuredAt) {
        continue;
      }

      try {
        // Calculate clip timing relative to stream start
        const streamStartTime = stream.startedAt.getTime();
        const featuredTime = streamProduct.featuredAt.getTime();
        const timeSinceStart = Math.floor((featuredTime - streamStartTime) / 1000); // seconds

        // Clip: 30 seconds before to 2 minutes after
        const startTimeSeconds = Math.max(0, timeSinceStart - 30);
        const endTimeSeconds = timeSinceStart + 120; // 2 minutes = 120 seconds

        // Check if clip already exists for this product
        const existingClip = await db.streamClip.findFirst({
          where: {
            streamId,
            productId: streamProduct.productId,
          },
        });

        if (existingClip) {
          console.log(`[Auto-Clip] Clip already exists for product ${streamProduct.productId} in stream ${streamId}`);
          continue;
        }

        // Create clip via Mux API
        // Mux creates clips by creating a new asset from an existing asset with trim settings
        const clipAsset = await mux.video.assets.create({
          inputs: [
            {
              url: `mux://assets/${stream.muxAssetId}`,
              start_time: startTimeSeconds,
              end_time: endTimeSeconds,
            },
          ],
          playback_policy: ["public"],
        } as any); // Type assertion needed due to Mux SDK type definitions

        const clipPlaybackId = clipAsset.playback_ids?.[0]?.id || null;

        // Store clip in database
        await db.streamClip.create({
          data: {
            streamId,
            productId: streamProduct.productId,
            muxClipId: clipAsset.id,
            muxClipPlaybackId: clipPlaybackId,
            startTime: startTimeSeconds,
            endTime: endTimeSeconds,
            title: `Auto-clip: Product featured at ${new Date(streamProduct.featuredAt).toLocaleTimeString()}`,
            description: `Automatically created clip when product was featured during the stream`,
          },
        });

        console.log(
          `[Auto-Clip] Created clip for product ${streamProduct.productId} in stream ${streamId} - ` +
          `Clip ID: ${clipAsset.id}, Playback ID: ${clipPlaybackId || 'none'}`
        );
      } catch (error) {
        console.error(
          `[Auto-Clip] Error creating clip for product ${streamProduct.productId} in stream ${streamId}:`,
          error
        );
        // Continue with next product even if one fails
      }
    }

    console.log(`[Auto-Clip] Finished creating clips for stream ${streamId}`);
  } catch (error) {
    console.error(`[Auto-Clip] Error in createAutoClipsForFeaturedProducts for stream ${streamId}:`, error);
    throw error;
  }
}
