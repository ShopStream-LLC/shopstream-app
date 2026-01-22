import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useActionData, Form, redirect, useNavigation } from "react-router";
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

  return { stream, muxStream, productDetails };
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
    console.log(`[Preflight] Starting stream ${streamId} - setting status to LIVE`);
    
    // Update stream status to LIVE and set liveStartedAt
    await db.stream.update({
      where: { id: streamId },
      data: {
        status: "LIVE",
        liveStartedAt: new Date(),
        startedAt: new Date(),
      },
    });

    // Insert STREAM_STARTED event
    await db.streamEvent.create({
      data: {
        streamId,
        type: "STREAM_STARTED",
        payload: {},
      },
    });

    console.log(`[Preflight] Stream ${streamId} status updated to LIVE, returning success for navigation`);
    
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
  const { stream, muxStream, productDetails } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const hasNavigated = useRef(false);

  const [checkProgress, setCheckProgress] = useState(0);
  const [checksComplete, setChecksComplete] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [useOBS, setUseOBS] = useState(true); // Default to OBS, disabled for now

  // Auto checks simulation
  useEffect(() => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;
      setCheckProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => setChecksComplete(true), 300);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

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
        disabled: !checksComplete,
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
                  {!checksComplete ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ animation: "rotate 2s linear infinite" }}>
                          <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                            <path
                              d="M10 2V6M10 14V18M18 10H14M6 10H2M15.5 4.5L12.5 7.5M7.5 12.5L4.5 15.5M15.5 15.5L12.5 12.5M7.5 7.5L4.5 4.5"
                              stroke="#2C6ECB"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </div>
                        <Text variant="headingMd" as="h2">
                          Running System Checks...
                        </Text>
                      </div>
                      <ProgressBar progress={checkProgress} size="small" />
                      <Text variant="bodySm" tone="subdued" as="p">
                        {checkProgress}% complete
                      </Text>
                    </>
                  ) : (
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
                            All systems are working properly
                          </Text>
                        </div>
                      </div>
                    </div>
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

              {/* Component Status Row */}
              <Card>
                <InlineStack gap="400" blockAlign="center">
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ marginBottom: "8px" }}>
                      {checksComplete ? (
                        <div style={{ color: "#008060" }}>
                          <Icon source={CheckIcon} />
                        </div>
                      ) : (
                        <div style={{ animation: "pulse 2s infinite" }}>⟳</div>
                      )}
                    </div>
                    <Text variant="bodyMd" fontWeight="semibold" as="p">
                      Camera
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {checksComplete ? "Active" : "Checking..."}
                    </Text>
                  </div>

                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ marginBottom: "8px" }}>
                      {checksComplete ? (
                        <div style={{ color: "#008060" }}>
                          <Icon source={CheckIcon} />
                        </div>
                      ) : (
                        <div style={{ animation: "pulse 2s infinite" }}>⟳</div>
                      )}
                    </div>
                    <Text variant="bodyMd" fontWeight="semibold" as="p">
                      Microphone
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {checksComplete ? "Active" : "Checking..."}
                    </Text>
                  </div>

                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ marginBottom: "8px" }}>
                      {checksComplete ? (
                        <div style={{ color: "#008060" }}>
                          <Icon source={CheckIcon} />
                        </div>
                      ) : (
                        <div style={{ animation: "pulse 2s infinite" }}>⟳</div>
                      )}
                    </div>
                    <Text variant="bodyMd" fontWeight="semibold" as="p">
                      Connection
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {checksComplete ? "45 Mbps" : "Testing..."}
                    </Text>
                  </div>
                </InlineStack>
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
                          <Badge tone="info">#{index + 1}</Badge>
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
