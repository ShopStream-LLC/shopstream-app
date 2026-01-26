import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { requireShopSession } from "../auth.server";
import { mux } from "../lib/mux.server";

/**
 * API endpoint for creating manual clips from stream assets
 * 
 * POST /api/clips/create
 * Body: { streamId, startTime, endTime, title?, description? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { shop } = await requireShopSession(request);
    const formData = await request.formData();

    const streamId = formData.get("streamId") as string;
    const startTimeStr = formData.get("startTime") as string;
    const endTimeStr = formData.get("endTime") as string;
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;

    // Validation
    if (!streamId || !startTimeStr || !endTimeStr) {
      return Response.json(
        { error: "Missing required fields: streamId, startTime, endTime" },
        { status: 400 }
      );
    }

    const startTime = parseInt(startTimeStr, 10);
    const endTime = parseInt(endTimeStr, 10);

    if (isNaN(startTime) || isNaN(endTime) || startTime < 0 || endTime <= startTime) {
      return Response.json(
        { error: "Invalid timing: startTime must be >= 0 and endTime must be > startTime" },
        { status: 400 }
      );
    }

    // Fetch stream with asset info
    const stream = await db.stream.findFirst({
      where: {
        id: streamId,
        shop, // Ensure stream belongs to this shop
      },
    });

    if (!stream) {
      return Response.json(
        { error: "Stream not found" },
        { status: 404 }
      );
    }

    // Type assertion for Prisma fields that need regeneration
    const streamWithAsset = stream as typeof stream & { muxAssetId: string | null };
    
    if (!streamWithAsset.muxAssetId) {
      return Response.json(
        { error: "Stream asset not available yet. Please wait for the stream to end and asset to be processed." },
        { status: 400 }
      );
    }

    if (!stream.startedAt) {
      return Response.json(
        { error: "Stream has no start time, cannot create clip" },
        { status: 400 }
      );
    }

    // Validate timing is within stream duration
    // Note: We don't have exact stream duration, but we can check if endTime is reasonable
    // For now, we'll allow any positive endTime > startTime

    // Create clip via Mux API
    let clipAsset;
    try {
      clipAsset = await mux.video.assets.create({
        inputs: [
          {
            url: `mux://assets/${streamWithAsset.muxAssetId}`,
            start_time: startTime,
            end_time: endTime,
          },
        ],
        playback_policy: ["public"],
      } as any); // Type assertion needed due to Mux SDK type definitions
    } catch (error) {
      console.error(`[Manual Clip] Error creating clip via Mux API:`, error);
      return Response.json(
        { error: `Failed to create clip: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      );
    }

    const clipPlaybackId = clipAsset.playback_ids?.[0]?.id || null;

    // Store clip in database (no productId - this is a manual clip)
    // @ts-expect-error - Prisma client types may need TypeScript server restart after schema update
    const clip = await db.streamClip.create({
      data: {
        streamId,
        productId: null, // Manual clips are not linked to products
        muxClipId: clipAsset.id,
        muxClipPlaybackId: clipPlaybackId,
        startTime,
        endTime,
        title: title || `Clip: ${startTime}s - ${endTime}s`,
        description: description || null,
      },
    });

    console.log(
      `[Manual Clip] Created clip ${clip.id} for stream ${streamId} - ` +
      `Clip ID: ${clipAsset.id}, Playback ID: ${clipPlaybackId || 'none'}`
    );

    return Response.json({
      success: true,
      clip: {
        id: clip.id,
        muxClipId: clip.muxClipId,
        muxClipPlaybackId: clip.muxClipPlaybackId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        title: clip.title,
        description: clip.description,
      },
    });
  } catch (error) {
    console.error("[Manual Clip] Error in clip creation:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};
