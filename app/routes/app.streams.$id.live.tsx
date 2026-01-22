import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, Form, useRevalidator } from "react-router";
import { useState, useEffect, useRef } from "react";
import {
  Card,
  Text,
  Button,
  Badge,
  BlockStack,
  InlineStack,
  Divider,
  TextField,
  Modal,
} from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import Hls from "hls.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const streamId = params.id!;

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
    include: {
      products: {
        orderBy: { position: "asc" },
      },
    },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  console.log(`[Live Page Loader] Stream ${streamId} - Status: ${stream.status}, PlaybackId: ${stream.muxPlaybackId || 'none'}`);

  // Verify stream is LIVE (status must be LIVE to access this page)
  // Note: status = LIVE means the "Start Streaming" button was clicked
  // It does NOT mean OBS has started streaming yet
  if (stream.status !== "LIVE") {
    console.log(`[Live Page Loader] Access denied - status is ${stream.status}, not LIVE`);
    throw new Response(`Stream is not ready for live control. Current status: ${stream.status}. Please start the stream from the stream settings page.`, { status: 400 });
  }

  // Check Redis for real-time stream state (tells us if OBS is actually streaming)
  let isStreamLive = false;
  try {
    const { redis } = await import("../lib/redis.server");
    const redisState = await redis.get(`stream:${streamId}:state`);
    isStreamLive = redisState === "live";
    console.log(`[Live Page Loader] Redis state: ${redisState}, isStreamLive: ${isStreamLive}`);
  } catch (error) {
    console.error("[Live Page Loader] Error fetching Redis state:", error);
    // Fallback to database status
    isStreamLive = stream.status === "LIVE";
  }

  return { stream, isStreamLive };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const streamId = params.id!;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
  });

  if (!stream) {
    return { error: "Stream not found" };
  }

  if (actionType === "endStream") {
    await db.stream.update({
      where: { id: streamId },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    await db.streamEvent.create({
      data: {
        streamId,
        type: "STREAM_ENDED",
        payload: {},
      },
    });

    return { success: true, redirect: "/app/streams" };
  }

  return { error: "Invalid action type" };
};

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function LiveStreamingControl() {
  const { stream, isStreamLive } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [chatMessage, setChatMessage] = useState("");
  const [slowMode, setSlowMode] = useState(false);
  const [announcementMode, setAnnouncementMode] = useState(false);
  const [currentLatency, setCurrentLatency] = useState<number | null>(null);
  const [showEndStreamModal, setShowEndStreamModal] = useState(false);

  // Mock data
  const [viewerCount, setViewerCount] = useState(1073);
  const mockOrders = [
    { product: "Featured Product", customer: "Casey L", amount: "$220.00", time: "12:35 AM" },
    { product: "Featured Product", customer: "Jordan P", amount: "$53.00", time: "12:35 AM" },
    { product: "Wireless Headphones", customer: "Mike Chen", amount: "$199.99", time: "12:29 AM" },
    { product: "Smart Watch", customer: "Sarah Martinez", amount: "$279.99", time: "12:29 AM" },
    { product: "Wireless Headphones", customer: "Ava Johnson", amount: "$199.99", time: "12:31 AM" },
  ];

  const mockChatMessages = [
    { user: "Sarah M", message: "Love these headphones! Do they come in other colors?", time: "12:22 AM" },
    { user: "Mike Chen", message: "Just purchased this item!", time: "12:23 AM", highlight: true },
    { user: "Emma K", message: "What's the battery life on these?", time: "12:24 AM" },
    { user: "Morgan S", message: "How does delivery take?", time: "12:35 AM" },
    { user: "Casey L", message: "I just purchased this item!", time: "12:35 AM", highlight: true },
  ];

  // Auto-poll to detect when stream becomes active (every 5 seconds)
  useEffect(() => {
    if (!stream.muxPlaybackId) {
      // If no playback ID yet, poll more frequently to detect it
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 5000);
      return () => clearInterval(interval);
    }

    if (!isStreamLive) {
      // If stream is LIVE but not yet broadcasting, poll to detect when it starts
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 5000);
      return () => clearInterval(interval);
    }

    // If stream is live and broadcasting, no need to poll frequently
    return undefined;
  }, [stream.muxPlaybackId, isStreamLive, revalidator]);

  // Timer
  useEffect(() => {
    if (!stream.liveStartedAt) return;

    const startTime = new Date(stream.liveStartedAt).getTime();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [stream.liveStartedAt]);

  // Enhanced HLS.js setup with LL-HLS for low latency
  useEffect(() => {
    if (!isStreamLive || !stream.muxPlaybackId || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    const hlsUrl = `https://stream.mux.com/${stream.muxPlaybackId}.m3u8`;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        // Core LL-HLS settings
        enableWorker: true,
        lowLatencyMode: true,
        
        // Buffer management - keep minimal for low latency
        maxBufferLength: 10,          // Target 10 seconds max buffer
        maxMaxBufferLength: 20,        // Hard limit 20 seconds
        backBufferLength: 0,           // No back buffer for live
        maxBufferSize: 60 * 1000 * 1000, // 60MB
        maxBufferHole: 0.5,            // Tolerate 0.5s gaps
        
        // Fragment loading - faster timeouts
        fragLoadingTimeOut: 2000,      // 2 seconds
        manifestLoadingTimeOut: 2000,  // 2 seconds
        levelLoadingTimeOut: 2000,     // 2 seconds
        
        // Live sync - aggressive edge tracking
        liveSyncDurationCount: 2,      // Stay 2 segments from live edge
        liveMaxLatencyDurationCount: 4, // Max 4 segments behind
        liveDurationInfinity: false,
        liveBackBufferLength: 0,
        
        // LL-HLS specific
        highBufferWatchdogPeriod: 1,   // Check buffer every 1s
        nudgeOffset: 0.1,              // Small offset for corrections
        nudgeMaxRetry: 5,
        
        // Network optimization
        startLevel: -1,                // Auto quality
        testBandwidth: true,
        progressive: true,
      });
      
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // For LL-HLS, seek closer to live edge
        if (video.duration !== Infinity && !isNaN(video.duration)) {
          // Start 0.5s behind live edge for buffer safety
          video.currentTime = video.duration - 0.5;
        }
        
        video.play().catch((error) => {
          console.error("[LL-HLS] Error playing video:", error);
        });
      });
      
      // Monitor and maintain live edge position
      hls.on(Hls.Events.LEVEL_UPDATED, () => {
        if (!video.paused && video.duration !== Infinity && !isNaN(video.duration)) {
          const liveEdge = video.duration;
          const currentTime = video.currentTime;
          const latency = liveEdge - currentTime;
          
          // If we're falling behind (> 6 seconds), jump to live edge
          if (latency > 6) {
            console.log(`[LL-HLS] Jumping to live edge. Latency was: ${latency.toFixed(2)}s`);
            video.currentTime = liveEdge - 0.5; // Slightly behind edge for safety
          }
        }
      });
      
      // Log actual latency for monitoring and update UI
      hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        // Check if we're playing a live stream
        if (video.duration !== Infinity && !isNaN(video.duration)) {
          const latency = video.duration - video.currentTime;
          if (latency >= 0) {
            setCurrentLatency(latency);
          }
        }
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Fatal network error, trying to recover...");
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Fatal media error, trying to recover...");
              hls?.recoverMediaError();
              break;
            default:
              console.log("Fatal error, cannot recover");
              hls?.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari)
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        // Seek to live edge
        if (video.duration !== Infinity && !isNaN(video.duration)) {
          video.currentTime = video.duration;
        }
      });
      video.play().catch((error) => console.error("Error playing video:", error));
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [isStreamLive, stream.muxPlaybackId]);

  const handleEndStream = () => {
    const formData = new FormData();
    formData.append("actionType", "endStream");
    fetch(`/app/streams/${stream.id}/live`, {
      method: "POST",
      body: formData,
    }).then(() => {
      navigate("/app/streams");
    });
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f6f6f7" }}>
      {/* Custom Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          backgroundColor: "#fff",
          borderBottom: "1px solid #e1e3e5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "red",
                animation: "pulse 2s infinite",
              }}
            />
            <Badge tone="critical">LIVE</Badge>
          </div>
          <Text variant="headingLg" as="h1">
            {stream.title}
          </Text>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Text variant="bodyMd" as="span">
            {formatDuration(elapsedTime)}
          </Text>
          <Button tone="critical" onClick={() => setShowEndStreamModal(true)}>
            End Stream
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", gap: "16px", padding: "16px" }}>
        {/* Left Column - Stream Preview & Chat */}
        <div style={{ flex: "0 0 35%", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Stream Preview Card */}
          <Card>
            <BlockStack gap="300">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text variant="headingMd" as="h2">
                  Stream Preview
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "8px", fontSize: "12px", color: "#6d7175" }}>
                    {!stream.muxPlaybackId && (
                      <span>⏳ Waiting for playback...</span>
                    )}
                    {stream.muxPlaybackId && !isStreamLive && (
                      <span>🔴 Waiting for stream...</span>
                    )}
                    {isStreamLive && currentLatency !== null && (
                      <>
                        <span>✓ Broadcasting</span>
                        <span>•</span>
                        <span>Latency: {currentLatency.toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M14 17V15C14 13.9391 13.5786 12.9217 12.8284 12.1716C12.0783 11.4214 11.0609 11 10 11H4C2.93913 11 1.92172 11.4214 1.17157 12.1716C0.421427 12.9217 0 13.9391 0 15V17"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <Text variant="bodySm" as="span">
                      {viewerCount.toLocaleString()}
                    </Text>
                  </div>
                </div>
              </div>

              {isStreamLive && stream.muxPlaybackId ? (
                <div style={{ position: "relative", backgroundColor: "#000", borderRadius: "8px" }}>
                  <video
                    ref={videoRef}
                    controls
                    muted
                    autoPlay
                    playsInline
                    style={{
                      width: "100%",
                      height: "auto",
                      borderRadius: "8px",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "16px",
                      left: "16px",
                      backgroundColor: "rgba(0,0,0,0.7)",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      color: "#fff",
                    }}
                  >
                    <Badge tone="success">Excellent</Badge>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: "#000",
                    borderRadius: "8px",
                    aspectRatio: "16/9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                  }}
                >
                  <BlockStack gap="200" inlineAlign="center">
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 20 20"
                      fill="none"
                      style={{ opacity: 0.5 }}
                    >
                      <path
                        d="M2.5 5.83333C2.5 4.91286 3.24619 4.16667 4.16667 4.16667H5.63011C6.0567 4.16667 6.46124 3.97436 6.72636 3.64375L7.60697 2.52292C7.87209 2.19231 8.27663 2 8.70322 2H11.2968C11.7234 2 12.1279 2.19231 12.393 2.52292L13.2736 3.64375C13.5388 3.97436 13.9433 4.16667 14.3699 4.16667H15.8333C16.7538 4.16667 17.5 4.91286 17.5 15V5.83333Z"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M10 13.3333C11.3807 13.3333 12.5 12.214 12.5 10.8333C12.5 9.45262 11.3807 8.33333 10 8.33333C8.61929 8.33333 7.5 9.45262 7.5 10.8333C7.5 12.214 8.61929 13.3333 10 13.3333Z"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <Text variant="bodyMd" as="p">
                      {!stream.muxPlaybackId
                        ? "Initializing stream... Start streaming from OBS to begin."
                        : "Waiting for video feed from OBS..."}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      {!stream.muxPlaybackId
                        ? "Playback ID will be created within 10-15 seconds"
                        : "Auto-detecting when you start streaming..."}
                    </Text>
                  </BlockStack>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Text variant="bodySm" as="span">
                  Audio Level:
                </Text>
                <div style={{ flex: 1, display: "flex", gap: "2px", alignItems: "center" }}>
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: "20px",
                        height: "8px",
                        backgroundColor: "#008060",
                        borderRadius: "2px",
                      }}
                    />
                  ))}
                  {[5].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: "20px",
                        height: "8px",
                        backgroundColor: "#e1e3e5",
                        borderRadius: "2px",
                      }}
                    />
                  ))}
                </div>
              </div>

              <InlineStack gap="200">
                <Button disabled>Pause</Button>
                <Button disabled>Switch Camera</Button>
                <Button disabled>
                  Boost Viewers
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Live Chat Card */}
          <Card>
            <BlockStack gap="300">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text variant="headingMd" as="h2">
                    Live Chat
                  </Text>
                  <Badge>5</Badge>
                </div>
                <Button size="slim" onClick={() => setSlowMode(!slowMode)}>
                  Slow Mode
                </Button>
              </div>

              <div
                style={{
                  height: "200px",
                  overflowY: "auto",
                  padding: "8px",
                  backgroundColor: "#f6f6f7",
                  borderRadius: "8px",
                }}
              >
                <BlockStack gap="200">
                  {mockChatMessages.map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px",
                        backgroundColor: msg.highlight ? "#D4F5E9" : "#fff",
                        borderRadius: "4px",
                      }}
                    >
                      <Text variant="bodySm" fontWeight="semibold" as="p">
                        {msg.user}
                      </Text>
                      <Text variant="bodySm" as="p">
                        {msg.message}
                      </Text>
                      {msg.highlight && (
                        <Badge tone="success">
                          🛒 Mike Chen Just purchased!
                        </Badge>
                      )}
                      <Text variant="bodySm" tone="subdued" as="p">
                        {msg.time}
                      </Text>
                    </div>
                  ))}
                </BlockStack>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <TextField
                  label=""
                  labelHidden
                  value={chatMessage}
                  onChange={setChatMessage}
                  placeholder="Send a message to your viewers..."
                  autoComplete="off"
                />
                <Button>Send</Button>
              </div>

              <Button onClick={() => setAnnouncementMode(!announcementMode)}>
                Announcement Mode
              </Button>
            </BlockStack>
          </Card>
        </div>

        {/* Center Column - Product Control */}
        <div style={{ flex: "0 0 40%" }}>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Product Control
              </Text>

              {/* Currently Featured Product */}
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#FFF9C2",
                  border: "2px solid #FFD700",
                  borderRadius: "8px",
                }}
              >
                <BlockStack gap="300">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Badge tone="warning">Featured</Badge>
                    <Text variant="bodySm" tone="subdued" as="span">
                      Time Featured: 0:30
                    </Text>
                  </div>

                  <div style={{ display: "flex", gap: "16px" }}>
                    <div
                      style={{
                        width: "120px",
                        height: "120px",
                        backgroundColor: "#FFD700",
                        borderRadius: "8px",
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <Text variant="headingMd" as="h3">
                        Wireless Bluetooth Headphones
                      </Text>
                      <Text variant="headingLg" as="p">
                        $79.99
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        25 remaining
                      </Text>
                      <Badge tone="success">🛒 4 sold during feature</Badge>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <Badge>Electronics</Badge>
                    <Badge>Featured</Badge>
                  </div>
                </BlockStack>
              </div>

              <InlineStack gap="200">
                <Button variant="primary">⏭ Next Product</Button>
                <Button>➕ Add Product</Button>
                <Button>📷 Scan</Button>
              </InlineStack>

              <Divider />

              {/* Coming Up */}
              <div>
                <Text variant="headingMd" as="h3">
                  Coming up (3)
                </Text>
                <BlockStack gap="200">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "12px",
                        padding: "12px",
                        backgroundColor: "#f6f6f7",
                        borderRadius: "8px",
                      }}
                    >
                      <Badge>{`#${i + 1}`}</Badge>
                      <div style={{ flex: 1 }}>
                        <Text variant="bodySm" fontWeight="semibold" as="p">
                          Premium Coffee Mug Set
                        </Text>
                        <Text variant="bodySm" as="p">
                          $34.99
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">
                          12 left
                        </Text>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </div>

              <Divider />

              {/* Previously Featured */}
              <details>
                <summary style={{ cursor: "pointer" }}>
                  <Text variant="headingMd" as="h3">
                    Previously Featured
                  </Text>
                </summary>
                <BlockStack gap="200">
                  <div style={{ padding: "12px", backgroundColor: "#f6f6f7", borderRadius: "8px" }}>
                    <Text variant="bodySm" as="p">
                      Wireless Bluetooth Headphones
                    </Text>
                    <Text variant="bodySm" as="p">
                      $79.99 each
                    </Text>
                    <Badge tone="success">8 sold - $639.92</Badge>
                  </div>
                </BlockStack>
              </details>
            </BlockStack>
          </Card>
        </div>

        {/* Right Column - Performance & Orders */}
        <div style={{ flex: "0 0 25%", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Performance Card */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Performance
              </Text>

              <div>
                <Text variant="bodySm" tone="subdued" as="p">
                  Current Viewers
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text variant="heading2xl" as="p">
                    1,073
                  </Text>
                  <Badge tone="success">↗ +12%</Badge>
                </div>
              </div>

              <div>
                <Text variant="bodySm" tone="subdued" as="p">
                  Gross Profit
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text variant="heading2xl" as="p">
                    $7740.18
                  </Text>
                  <Badge tone="success">↗ $</Badge>
                </div>
              </div>

              <div>
                <Text variant="bodySm" tone="subdued" as="p">
                  Units Sold
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text variant="heading2xl" as="p">
                    251
                  </Text>
                  <Badge tone="success">↗ 🛒</Badge>
                </div>
              </div>

              <div>
                <Text variant="bodySm" tone="subdued" as="p">
                  Avg Viewer Value
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text variant="heading2xl" as="p">
                    $11.10
                  </Text>
                  <Badge tone="warning">↗ %</Badge>
                </div>
              </div>

              {/* Live Deal */}
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#FFE5E5",
                  border: "2px solid #FF4040",
                  borderRadius: "8px",
                }}
              >
                <BlockStack gap="200">
                  <Badge tone="critical">🔥 LIVE DEAL</Badge>
                  <Text variant="heading2xl" as="p" alignment="center">
                    LIVE90
                  </Text>
                  <Text variant="headingLg" as="p" alignment="center">
                    20% OFF
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p" alignment="center">
                    ⏱ Expires in 0:10
                  </Text>
                  <InlineStack gap="200">
                    <Button size="slim">Copy Code</Button>
                    <Button size="slim">⚡ Change Deal</Button>
                    <Button size="slim" tone="critical">
                      End Deal
                    </Button>
                  </InlineStack>
                </BlockStack>
              </div>
            </BlockStack>
          </Card>

          {/* Recent Orders Card */}
          <Card>
            <BlockStack gap="300">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text variant="headingMd" as="h2">
                  Recent Orders
                </Text>
                <Badge>5</Badge>
              </div>

              <BlockStack gap="200">
                {mockOrders.map((order, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "12px",
                      backgroundColor: "#f6f6f7",
                      borderRadius: "8px",
                    }}
                  >
                    <Text variant="bodySm" fontWeight="semibold" as="p">
                      {order.product}
                    </Text>
                    <Text variant="bodySm" as="p">
                      {order.customer} • {order.time}
                    </Text>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                      <Text variant="bodySm" fontWeight="semibold" as="span">
                        {order.amount}
                      </Text>
                      <Button size="slim" tone="critical">
                        Refund
                      </Button>
                    </div>
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </div>
      </div>

      {/* End Stream Modal */}
      <Modal
        open={showEndStreamModal}
        onClose={() => setShowEndStreamModal(false)}
        title="End Live Stream?"
        primaryAction={{
          content: "End Stream",
          onAction: handleEndStream,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowEndStreamModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text variant="bodyMd" as="p">
            Are you sure you want to end your live stream? This action cannot be undone and all viewers will be disconnected.
          </Text>
        </Modal.Section>
      </Modal>
    </div>
  );
}
