import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { redis } from "../lib/redis.server";
import { mux } from "../lib/mux.server";

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
      // Stream started - find stream by muxStreamId
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
      const updateData: any = {
        status: "LIVE",
        startedAt: new Date(),
      };
      
      if (playbackId && !stream.muxPlaybackId) {
        updateData.muxPlaybackId = playbackId;
        console.log(`Mux webhook: Captured playback ID ${playbackId} from active event`);
      }

      // Stream started
      await Promise.all([
        // Update Redis state
        redis.set(`stream:${stream.id}:state`, "live"),
        // Create StreamEvent
        db.streamEvent.create({
          data: {
            streamId: stream.id,
            type: "STREAM_STARTED",
            payload: {
              muxStreamId: liveStreamId,
              timestamp: new Date().toISOString(),
              playbackId: playbackId || null,
            },
          },
        }),
        // Update stream status (and possibly playback ID)
        db.stream.update({
          where: { id: stream.id },
          data: updateData,
        }),
      ]);

      console.log(`Mux webhook: Stream ${stream.id} went live (playbackId: ${playbackId || stream.muxPlaybackId || 'not yet available'})`);
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
      // Asset is ready for playback - get playback ID
      const assetData = eventData as any; // Mux webhook types are complex unions
      const assetId = assetData.id;
      const playbackIds = assetData.playback_ids || [];
      const playbackId = playbackIds[0]?.id;

      if (!playbackId) {
        console.warn(`Mux webhook: No playback ID for asset ${assetId}`);
        return new Response("OK", { status: 200 });
      }

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

      // Update stream with playback ID if not already set
      if (!stream.muxPlaybackId) {
        await db.stream.update({
          where: { id: stream.id },
          data: { muxPlaybackId: playbackId },
        });
        console.log(`Mux webhook: Updated stream ${stream.id} with playback ID ${playbackId}`);
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
