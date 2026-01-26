import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { redis } from "../lib/redis.server";
import { mux } from "../lib/mux.server";
import { createAutoClipsForFeaturedProducts } from "../lib/clipping.server";

/**
 * Mux webhook endpoint
 * Handles live stream lifecycle events and asset readiness
 * 
 * Events handled:
 * - video.live_stream.active: Stream is live and broadcasting
 * - video.live_stream.idle: Stream has ended
 * - video.asset.ready: Asset is ready for playback
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Get raw body and headers for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("Mux-Signature");

    if (!signature) {
      console.error("Mux webhook: Missing signature");
      return new Response("Missing signature", { status: 401 });
    }

    // Verify webhook signature using Mux SDK
    const webhookSecret = process.env.MUX_WEBHOOK_SIGNING_SECRET;
    if (!webhookSecret) {
      console.warn("Mux webhook: MUX_WEBHOOK_SIGNING_SECRET not configured. Rejecting webhook for security.");
      return new Response("Webhook secret not configured", { status: 401 });
    }

    let event;
    try {
      // Use Mux SDK's built-in signature verification
      event = mux.webhooks.unwrap(rawBody, {
        get: (name: string) => name === "mux-signature" ? signature : null
      }, webhookSecret);
    } catch (error) {
      console.error("Mux webhook: Signature verification failed", error);
      return new Response("Invalid signature", { status: 401 });
    }

    // Extract event data
    const eventType = event.type;
    const eventData = event.data;

    // Handle different event types
    if (eventType === "video.live_stream.active") {
      // OBS is streaming and Mux is processing - mark as ready (but NOT live yet)
      // Stream only goes LIVE when merchant clicks "Start Streaming" button
      const liveStreamId = eventData.id;
      const liveStreamData = eventData as any;
      const stream = await db.stream.findFirst({
        where: { muxStreamId: liveStreamId },
      });

      if (!stream) {
        console.warn(`Mux webhook: Stream not found for muxStreamId ${liveStreamId}`);
        return new Response("Stream not found", { status: 404 });
      }

      // Extract playback ID if available and not already set
      const playbackId = liveStreamData.playback_ids?.[0]?.id;
      const updateData: any = {};
      
      if (playbackId && !stream.muxPlaybackId) {
        updateData.muxPlaybackId = playbackId;
        console.log(`Mux webhook: Captured playback ID ${playbackId} from active event`);
      }

      // Mark stream as ready (OBS streaming, Mux active) but DON'T set status to LIVE
      // Status stays DRAFT/SCHEDULED until merchant clicks "Start Streaming"
      await Promise.all([
        // Update Redis state (OBS is streaming)
        redis.set(`stream:${stream.id}:state`, "live"),
        // Update playback ID if available (but NOT status)
        Object.keys(updateData).length > 0
          ? db.stream.update({
              where: { id: stream.id },
              data: updateData,
            })
          : Promise.resolve(),
      ]);

      console.log(`Mux webhook: Stream ${stream.id} is ready (OBS streaming, Mux active). Waiting for merchant to click "Start Streaming".`);
    } else if (eventType === "video.live_stream.idle") {
      // Stream ended - find stream by muxStreamId
      const liveStreamId = eventData.id;
      const stream = await db.stream.findFirst({
        where: { muxStreamId: liveStreamId },
      });

      if (!stream) {
        console.warn(`Mux webhook: Stream not found for muxStreamId ${liveStreamId}`);
        return new Response("Stream not found", { status: 404 });
      }
      await Promise.all([
        // Update Redis state
        redis.set(`stream:${stream.id}:state`, "ended"),
        // Create StreamEvent
        db.streamEvent.create({
          data: {
            streamId: stream.id,
            type: "STREAM_ENDED",
            payload: {
              muxStreamId: liveStreamId,
              timestamp: new Date().toISOString(),
            },
          },
        }),
        // Update stream status
        db.stream.update({
          where: { id: stream.id },
          data: {
            status: "ENDED",
            endedAt: new Date(),
          },
        }),
      ]);

      console.log(`Mux webhook: Stream ${stream.id} went idle`);
    } else if (eventType === "video.asset.ready") {
      // Asset is ready for playback - store asset info
      const assetData = eventData as any; // Mux webhook types are complex unions
      const assetId = assetData.id;
      const playbackIds = assetData.playback_ids || [];
      const assetPlaybackId = playbackIds[0]?.id;
      const createdAt = assetData.created_at ? new Date(assetData.created_at) : new Date();

      // Find stream by checking if this asset is linked to a live stream
      const liveStreamId = assetData.live_stream_id;
      if (!liveStreamId) {
        console.log(`Mux webhook: Asset ${assetId} ready but no live_stream_id`);
        return new Response("OK", { status: 200 });
      }

      const stream = await db.stream.findFirst({
        where: { muxStreamId: liveStreamId },
      });

      if (!stream) {
        console.warn(`Mux webhook: Stream not found for asset ${assetId}`);
        return new Response("Stream not found", { status: 404 });
      }

      // Store asset info (distinct from live stream playback ID)
      const updateData: any = {
        muxAssetId: assetId,
        muxAssetCreatedAt: createdAt,
      };

      if (assetPlaybackId) {
        updateData.muxAssetPlaybackId = assetPlaybackId;
      }

      // Only update if asset info is not already set
      if (!stream.muxAssetId) {
        await db.stream.update({
          where: { id: stream.id },
          data: updateData,
        });
        console.log(`Mux webhook: Stored asset info for stream ${stream.id} - Asset ID: ${assetId}, Playback ID: ${assetPlaybackId || 'none'}`);
        
        // Trigger auto-clip creation for featured products (async, non-blocking)
        // This runs in the background to avoid webhook timeout
        createAutoClipsForFeaturedProducts(stream.id).catch((error) => {
          console.error(`Mux webhook: Error creating auto-clips for stream ${stream.id}:`, error);
        });
      } else {
        console.log(`Mux webhook: Asset info already stored for stream ${stream.id}, skipping update`);
      }
    } else {
      console.log(`Mux webhook: Unhandled event type ${eventType}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Mux webhook error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
