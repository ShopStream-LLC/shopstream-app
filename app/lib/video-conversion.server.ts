import { mux } from "./mux.server";

/**
 * Converts a Mux asset to MP4 format by downloading from Mux
 * 
 * Mux provides direct download URLs for assets, which are typically MP4.
 * This function retrieves the download URL and downloads the video.
 * 
 * @param muxAssetId - The Mux Asset ID to download
 * @returns Buffer containing the MP4 video data
 */
export async function convertHlsToMp4(muxAssetId: string): Promise<Buffer> {
  try {
    console.log(`[Video Conversion] Fetching asset ${muxAssetId} from Mux...`);

    // Retrieve asset from Mux to get download URL
    const asset = await mux.video.assets.retrieve(muxAssetId);

    // Mux assets have a master download URL (typically MP4)
    const downloadUrl = (asset as any).master?.url;

    if (!downloadUrl) {
      throw new Error(`No download URL available for asset ${muxAssetId}`);
    }

    console.log(`[Video Conversion] Downloading video from: ${downloadUrl}`);

    // Download the video file
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    // Convert response to Buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Video Conversion] Downloaded ${buffer.length} bytes from Mux`);

    return buffer;
  } catch (error) {
    console.error(`[Video Conversion] Error converting asset ${muxAssetId}:`, error);
    throw error;
  }
}

/**
 * Downloads a Mux clip asset as MP4
 * 
 * @param muxClipId - The Mux Asset ID of the clip
 * @returns Buffer containing the MP4 video data
 */
export async function downloadClipAsMp4(muxClipId: string): Promise<Buffer> {
  // Clips are also assets in Mux, so we can use the same function
  return convertHlsToMp4(muxClipId);
}
