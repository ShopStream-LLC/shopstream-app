import type { Stream, StreamClip } from "@prisma/client";

/**
 * Gets the playback URL for a stream, prioritizing Shopify over Mux
 * 
 * Priority:
 * 1. Shopify CDN URL (if migrated)
 * 2. Mux Asset Playback ID (recorded video)
 * 3. Mux Live Stream Playback ID (live stream)
 * 
 * @param stream - Stream object from database
 * @returns HLS playback URL or null if not available
 */
export function getVideoPlaybackUrl(stream: Stream): string | null {
  // Priority 1: Shopify CDN URL (after migration)
  if (stream.shopifyVideoUrl) {
    return stream.shopifyVideoUrl;
  }

  // Priority 2: Mux Asset Playback ID (recorded video after stream ends)
  if (stream.muxAssetPlaybackId) {
    return `https://stream.mux.com/${stream.muxAssetPlaybackId}.m3u8`;
  }

  // Priority 3: Mux Live Stream Playback ID (live stream)
  if (stream.muxPlaybackId) {
    return `https://stream.mux.com/${stream.muxPlaybackId}.m3u8`;
  }

  return null;
}

/**
 * Gets the playback URL for a clip, prioritizing Shopify over Mux
 * 
 * Priority:
 * 1. Shopify CDN URL (if migrated)
 * 2. Mux Clip Playback ID
 * 
 * @param clip - StreamClip object from database
 * @returns HLS playback URL or null if not available
 */
export function getClipPlaybackUrl(clip: StreamClip): string | null {
  // Priority 1: Shopify CDN URL (after migration)
  if (clip.shopifyVideoUrl) {
    return clip.shopifyVideoUrl;
  }

  // Priority 2: Mux Clip Playback ID
  if (clip.muxClipPlaybackId) {
    return `https://stream.mux.com/${clip.muxClipPlaybackId}.m3u8`;
  }

  return null;
}

/**
 * Checks if a stream has migrated to Shopify storage
 */
export function isStreamMigrated(stream: Stream): boolean {
  return !!stream.shopifyVideoId && !!stream.shopifyVideoUrl;
}

/**
 * Checks if a clip has migrated to Shopify storage
 */
export function isClipMigrated(clip: StreamClip): boolean {
  return !!clip.shopifyVideoId && !!clip.shopifyVideoUrl;
}
