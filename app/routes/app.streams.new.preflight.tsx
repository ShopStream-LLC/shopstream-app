import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useActionData, Form, redirect, useNavigation, useRevalidator } from "react-router";
import { useState, useEffect, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Banner,
  Badge,
  BlockStack,
  InlineStack,
  Modal,
  TextField,
  Icon,
  ProgressBar,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import Mux from "@mux/mux-node";

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, admin } = await requireShopSession(request);
  const url = new URL(request.url);
  const streamId = url.searchParams.get("streamId");

  if (!streamId) {
    throw new Response("Stream ID required", { status: 400 });
  }

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
    include: { products: true },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  // Auto-create Mux stream if not exists
  if (!stream.muxStreamId) {
    try {
      const liveStream = await mux.video.liveStreams.create({
        playback_policy: ["public"],
        latency_mode: "low",
        new_asset_settings: {
          playback_policy: ["public"],
        },
      });

      const rtmpUrl = (liveStream as any).rtmp?.url || "rtmps://global-live.mux.com:443/app";
      const playbackId = liveStream.playback_ids?.[0]?.id || null;

      await db.stream.update({
        where: { id: streamId },
        data: {
          muxStreamId: liveStream.id,
          muxPlaybackId: playbackId,
          muxRtmpUrl: rtmpUrl,
          muxLatencyMode: "low",
        },
      });

      // Reload stream with updated data
      const updatedStream = await db.stream.findFirst({
        where: { id: streamId, shop },
        include: { products: true },
      });

      // Fetch product details from Shopify
      const productDetails = await Promise.all(
        updatedStream!.products.map(async (streamProduct) => {
          try {
            const id = streamProduct.productId.includes("/")
              ? streamProduct.productId.split("/").pop()
              : streamProduct.productId;

            const response = await admin.graphql(`
              query getProduct($id: ID!) {
                product(id: $id) {
                  id
                  title
                  featuredImage {
                    url
                    altText
                  }
                }
              }
            `, {
              variables: { id: `gid://shopify/Product/${id}` },
            });

            const data = await response.json();
            return {
              streamProduct,
              product: data.data?.product || null,
            };
          } catch (error) {
            console.error(`Error fetching product ${streamProduct.productId}:`, error);
            return {
              streamProduct,
              product: null,
            };
          }
        })
      );

      return { stream: updatedStream!, muxStream: liveStream, productDetails };
    } catch (error) {
      console.error("Error creating Mux stream:", error);
      throw new Response("Failed to create streaming session", { status: 500 });
    }
  }

  // Fetch Mux stream details if exists
  let muxStream = null;
  if (stream.muxStreamId) {
    try {
      muxStream = await mux.video.liveStreams.retrieve(stream.muxStreamId);
    } catch (error) {
      console.error("Error fetching Mux stream:", error);
    }
  }

  // REAL CHECKS: Verify OBS is streaming and Mux is active
  const checks = {
    obsStreaming: false,    // Is OBS actually streaming? (Redis state)
    muxActive: false,       // Has Mux webhook fired? (Mux stream status)
    playbackReady: false,   // Does playback ID exist?
  };

  // Check Redis for OBS streaming state
  try {
    const { redis } = await import("../lib/redis.server");
    const redisState = await redis.get(`stream:${streamId}:state`);
    checks.obsStreaming = redisState === "live";
  } catch (error) {
    console.error("Error checking Redis state:", error);
  }

  // Check Mux stream status
  if (stream.muxStreamId && muxStream) {
    try {
      checks.muxActive = (muxStream as any).status === "active";
      checks.playbackReady = !!stream.muxPlaybackId;
    } catch (error) {
      console.error("Error checking Mux status:", error);
    }
  }

  const allChecksPassed = checks.obsStreaming && checks.muxActive && checks.playbackReady;

  // Fetch product details from Shopify
  const productDetails = await Promise.all(
    stream.products.map(async (streamProduct) => {
      try {
        const id = streamProduct.productId.includes("/")
          ? streamProduct.productId.split("/").pop()
          : streamProduct.productId;

        const response = await admin.graphql(`
          query getProduct($id: ID!) {
            product(id: $id) {
              id
              title
              featuredImage {
                url
                altText
              }
            }
          }
        `, {
          variables: { id: `gid://shopify/Product/${id}` },
        });

        const data = await response.json();
        return {
          streamProduct,
          product: data.data?.product || null,
        };
      } catch (error) {
        console.error(`Error fetching product ${streamProduct.productId}:`, error);
        return {
          streamProduct,
          product: null,
        };
      }
    })
  );

  return { stream, muxStream, productDetails, checks, allChecksPassed };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const streamId = formData.get("streamId") as string;

  if (!streamId) {
    return { error: "Stream ID required" };
  }

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
  });

  if (!stream) {
    return { error: "Stream not found" };
  }

  if (actionType === "startStreaming") {
    // Verify stream is ready (safety check)
    if (stream.status === "LIVE") {
      return { error: "Stream is already live" };
    }

    // Check if OBS is actually streaming (verify readiness)
    let isReady = false;
    try {
      const { redis } = await import("../lib/redis.server");
      const redisState = await redis.get(`stream:${streamId}:state`);
      isReady = redisState === "live" && !!stream.muxPlaybackId;
    } catch (error) {
      console.error("Error checking stream readiness:", error);
    }

    if (!isReady) {
      return { 
        error: "Stream is not ready. Please ensure OBS is streaming and all checks pass." 
      };
    }

    console.log(`[Preflight] Going live - stream ${streamId} status set to LIVE`);
    
    // THIS is when stream actually goes live for customers
    await db.stream.update({
      where: { id: streamId },
      data: {
        status: "LIVE",
        startedAt: new Date(), // Actual "go live" moment
      },
    });

    // Insert STREAM_STARTED event (only created when merchant clicks button)
    await db.streamEvent.create({
      data: {
        streamId,
        type: "STREAM_STARTED",
        payload: {},
      },
    });

    console.log(`[Preflight] Stream ${streamId} is now LIVE, returning success for navigation`);
    
    // Return success for client-side navigation (preserves session in embedded app)
    return { success: true, streamId };
  }

  return { error: "Invalid action type" };
};

function formatDate(date: Date | string | null) {
  if (!date) return "Not scheduled";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString() + " at " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function PreFlightCheckPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { stream, muxStream, productDetails, checks = { obsStreaming: false, muxActive: false, playbackReady: false }, allChecksPassed = false } = loaderData;
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const hasNavigated = useRef(false);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Auto-poll to detect when OBS starts streaming (every 5 seconds)
  useEffect(() => {
    if (allChecksPassed) return; // Stop polling when ready
    
    const interval = setInterval(() => {
      revalidator.revalidate(); // Re-check every 5 seconds
    }, 5000);
    
    return () => clearInterval(interval);
  }, [allChecksPassed, revalidator]);

  // Handle client-side navigation after successful stream start
  useEffect(() => {
    if (
      navigation.state === "idle" &&
      actionData?.success &&
      actionData?.streamId &&
      !hasNavigated.current
    ) {
      hasNavigated.current = true;
      navigate(`/app/streams/${actionData.streamId}/live`);
    }
  }, [actionData, navigation.state, navigate]);


  const rtmpUrl = stream.muxRtmpUrl || "rtmps://global-live.mux.com:443/app";
  const streamKey = (muxStream as any)?.stream_key || "Stream key loading...";

  return (
    <Page
      title="Pre-Flight Check"
      subtitle="Final checks before going live"
      backAction={{
        content: "Back",
        onAction: () => navigate(`/app/streams/new/settings?streamId=${stream.id}`),
      }}
      secondaryActions={[
        {
          content: "Advanced Settings",
          onAction: () => setShowAdvancedSettings(true),
        },
      ]}
      primaryAction={{
        content: "Start Streaming",
        disabled: !allChecksPassed || navigation.state !== "idle",
        loading: navigation.state === "submitting",
        onAction: () => {
          const form = document.querySelector('form[method="post"]') as HTMLFormElement;
          if (form) {
            form.requestSubmit();
          }
        },
      }}
    >
      <Form method="post">
        <input type="hidden" name="actionType" value="startStreaming" />
        <input type="hidden" name="streamId" value={stream.id} />

        <Layout>
          {actionData?.error && (
            <Layout.Section>
              <Banner tone="critical" title="Error">
                {actionData.error}
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* System Status Card */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    System Checks
                  </Text>
                  
                  {/* OBS Streaming Check */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {checks.obsStreaming ? (
                      <Icon source={CheckIcon} tone="success" />
                    ) : (
                      <div style={{ animation: "pulse 2s infinite", color: "#6d7175" }}>⟳</div>
                    )}
                    <div style={{ flex: 1 }}>
                      <Text variant="bodyMd" fontWeight="semibold" as="p">
                        OBS Streaming
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {checks.obsStreaming ? "Connected and streaming" : "Waiting for OBS to start streaming..."}
                      </Text>
                    </div>
                  </div>

                  {/* Mux Active Check */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {checks.muxActive ? (
                      <Icon source={CheckIcon} tone="success" />
                    ) : (
                      <div style={{ animation: "pulse 2s infinite", color: "#6d7175" }}>⟳</div>
                    )}
                    <div style={{ flex: 1 }}>
                      <Text variant="bodyMd" fontWeight="semibold" as="p">
                        Mux Processing
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {checks.muxActive ? "Active and processing stream" : "Waiting for Mux to process..."}
                      </Text>
                    </div>
                  </div>

                  {/* Playback Ready Check */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {checks.playbackReady ? (
                      <Icon source={CheckIcon} tone="success" />
                    ) : (
                      <div style={{ animation: "pulse 2s infinite", color: "#6d7175" }}>⟳</div>
                    )}
                    <div style={{ flex: 1 }}>
                      <Text variant="bodyMd" fontWeight="semibold" as="p">
                        Playback Ready
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {checks.playbackReady ? "Stream is ready for viewers" : "Waiting for playback ID..."}
                      </Text>
                    </div>
                  </div>

                  {allChecksPassed ? (
                    <div
                      style={{
                        padding: "16px",
                        backgroundColor: "#D4F5E9",
                        borderRadius: "8px",
                        border: "1px solid #B4E5D3",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            backgroundColor: "#008060",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon source={CheckIcon} tone="base" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <Text variant="headingMd" as="h2">
                            Ready to Go Live!
                          </Text>
                          <Text variant="bodySm" as="p">
                            All systems are working properly. Click "Start Streaming" to go live.
                          </Text>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Banner tone="info">
                      <Text as="p">
                        Start streaming from OBS first. Once OBS is connected and Mux is processing,
                        the "Start Streaming" button will be enabled.
                      </Text>
                    </Banner>
                  )}

                  {/* OBS Toggle (disabled for now) */}
                  <div
                    style={{
                      padding: "12px",
                      backgroundColor: "#f6f6f7",
                      borderRadius: "8px",
                      opacity: 0.6,
                      cursor: "not-allowed",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Text variant="bodyMd" as="p">
                        Use OBS for streaming
                      </Text>
                      <Badge tone="info">Enabled</Badge>
                    </div>
                  </div>
                </BlockStack>
              </Card>


              {/* Camera Preview Card */}
              <Card>
                <BlockStack gap="200">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Text variant="headingMd" as="h2">
                      Camera Preview
                    </Text>
                    <Badge tone="success">Live</Badge>
                  </div>

                  <div
                    style={{
                      backgroundColor: "#1a1a1a",
                      borderRadius: "8px",
                      padding: "48px 24px",
                      textAlign: "center",
                      color: "#fff",
                      minHeight: "200px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "16px",
                    }}
                  >
                    <svg width="60" height="60" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M2.5 5.83333C2.5 4.91286 3.24619 4.16667 4.16667 4.16667H5.63011C6.0567 4.16667 6.46124 3.97436 6.72636 3.64375L7.60697 2.52292C7.87209 2.19231 8.27663 2 8.70322 2H11.2968C11.7234 2 12.1279 2.19231 12.393 2.52292L13.2736 3.64375C13.5388 3.97436 13.9433 4.16667 14.3699 4.16667H15.8333C16.7538 4.16667 17.5 4.91286 17.5 5.83333V15C17.5 15.9205 16.7538 16.6667 15.8333 16.6667H4.16667C3.24619 16.6667 2.5 15.9205 2.5 15V5.83333Z"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M10 13.3333C11.3807 13.3333 12.5 12.214 12.5 10.8333C12.5 9.45262 11.3807 8.33333 10 8.33333C8.61929 8.33333 7.5 9.45262 7.5 10.8333C7.5 12.214 8.61929 13.3333 10 13.3333Z"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <div>
                      <Text variant="headingMd" as="p" tone="subdued">
                        Camera Feed
                      </Text>
                      <Text variant="bodySm" as="p" tone="subdued">
                        Preview of your live stream
                      </Text>
                    </div>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Using OBS Studio for streaming. Camera preview available in OBS.
                    </Text>
                  </div>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Stream Summary Card */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Stream Summary
                  </Text>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {stream.title}
                    </Text>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                      <path d="M10 6V10L13 12" stroke="#8C9196" strokeWidth="1.5" />
                    </svg>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {stream.scheduledAt ? formatDate(stream.scheduledAt) : "Starting now"}
                    </Text>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M2 6L10 2L18 6M2 6V14L10 18M2 6L10 10M18 6V14L10 18M18 6L10 10M10 10V18"
                        stroke="#8C9196"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {stream.products.length} product{stream.products.length !== 1 ? "s" : ""} featured
                    </Text>
                  </div>
                </BlockStack>
              </Card>

              {/* Share Stream Card */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Share Stream
                  </Text>

                  <TextField
                    label="Stream Link"
                    labelHidden
                    value={`https://shopify.com/live/${stream.id.slice(0, 8)}`}
                    readOnly
                    autoComplete="off"
                    connectedRight={
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://shopify.com/live/${stream.id.slice(0, 8)}`);
                        }}
                      >
                        Copy
                      </Button>
                    }
                  />

                  <Text variant="bodySm" tone="subdued" as="p">
                    Share this link with your audience to watch the live stream
                  </Text>
                </BlockStack>
              </Card>

              {/* Product Lineup Card */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Product Lineup
                  </Text>

                  <BlockStack gap="200">
                    {productDetails
                      .sort((a, b) => a.streamProduct.position - b.streamProduct.position)
                      .slice(0, 5)
                      .map((item, index) => (
                        <div
                          key={item.streamProduct.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "8px",
                            backgroundColor: "#f6f6f7",
                            borderRadius: "8px",
                          }}
                        >
                          <Badge tone="info">{`#${index + 1}`}</Badge>
                          {item.product ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                              {item.product.featuredImage?.url && (
                                <img
                                  src={item.product.featuredImage.url}
                                  alt={item.product.featuredImage.altText || item.product.title}
                                  style={{
                                    width: "32px",
                                    height: "32px",
                                    objectFit: "cover",
                                    borderRadius: "4px",
                                  }}
                                />
                              )}
                              <Text variant="bodySm" as="p" truncate>
                                {item.product.title}
                              </Text>
                            </div>
                          ) : (
                            <Text variant="bodySm" as="p">
                              Product {item.streamProduct.productId.slice(-8)}
                            </Text>
                          )}
                        </div>
                      ))}
                  </BlockStack>
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>
        </Layout>
      </Form>

      {/* Advanced Settings Modal */}
      <Modal
        open={showAdvancedSettings}
        onClose={() => setShowAdvancedSettings(false)}
        title="Advanced Settings"
        primaryAction={{
          content: "Close",
          onAction: () => setShowAdvancedSettings(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              Configure advanced streaming options and RTMP settings
            </Text>

            <div>
              <Text variant="headingMd" as="h3">
                RTMP Settings
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                Use these credentials to stream from OBS or other broadcasting software
              </Text>
            </div>

            <TextField
              label="Server URL"
              value={rtmpUrl}
              readOnly
              autoComplete="off"
              connectedRight={
                <Button onClick={() => navigator.clipboard.writeText(rtmpUrl)}>Copy</Button>
              }
            />

            <TextField
              label="Stream Key"
              value={streamKey}
              readOnly
              autoComplete="off"
              connectedRight={
                <Button onClick={() => navigator.clipboard.writeText(streamKey)}>Copy</Button>
              }
            />

            <div style={{ padding: "12px", backgroundColor: "#f6f6f7", borderRadius: "8px" }}>
              <Text variant="bodySm" as="p">
                📝 Need help setting up OBS?{" "}
                <a href="#" style={{ color: "#2C6ECB" }}>
                  View our guide
                </a>
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
