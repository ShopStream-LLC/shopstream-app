import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigate, useFetcher, Form } from "react-router";
import { useState, useEffect } from "react";
import { Page, Layout, Card, Text, Button, TextField, Banner, BlockStack, InlineStack } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { getClipPlaybackUrl } from "../lib/video-playback.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const streamId = params.id;

  if (!streamId) {
    throw new Response("Stream not found", { status: 404 });
  }

  const stream = await db.stream.findFirst({
    where: {
      id: streamId,
      shop,
    },
    include: {
      clips: {
        orderBy: { createdAt: "desc" },
      },
      products: {
        orderBy: { position: "asc" },
      },
    },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  // Only allow analytics for ended streams
  if (stream.status !== "ENDED") {
    throw new Response("Analytics only available for ended streams", { status: 400 });
  }

  // Calculate stream duration
  const duration = stream.startedAt && stream.endedAt
    ? Math.floor((stream.endedAt.getTime() - stream.startedAt.getTime()) / 1000)
    : 0;

  return {
    stream,
    duration,
  };
};

export default function StreamAnalytics() {
  const { stream, duration } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isCreatingClip, setIsCreatingClip] = useState(false);

  const clips = stream.clips || [];
  const durationMinutes = Math.floor(duration / 60);
  const durationSeconds = duration % 60;

  // Format time input helpers
  const formatTimeForInput = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const parseTimeInput = (timeStr: string): number => {
    const [mins, secs] = timeStr.split(":").map(Number);
    return (mins || 0) * 60 + (secs || 0);
  };

  const handleCreateClip = async () => {
    const startSeconds = parseTimeInput(startTime);
    const endSeconds = parseTimeInput(endTime);

    if (!startTime || !endTime) {
      return;
    }

    if (startSeconds < 0 || endSeconds <= startSeconds || endSeconds > duration) {
      return;
    }

    setIsCreatingClip(true);

    const formData = new FormData();
    formData.append("streamId", stream.id);
    formData.append("startTime", startSeconds.toString());
    formData.append("endTime", endSeconds.toString());
    if (title) formData.append("title", title);
    if (description) formData.append("description", description);

    fetcher.submit(formData, {
      method: "post",
      action: "/api/clips/create",
    });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data as any;
      if (data.success) {
        setIsCreatingClip(false);
        setStartTime("");
        setEndTime("");
        setTitle("");
        setDescription("");
        // Reload page to show new clip
        window.location.reload();
      } else if (data.error) {
        setIsCreatingClip(false);
      }
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Page
      title={`Analytics: ${stream.title}`}
      backAction={{
        content: "Back to Stream",
        onAction: () => navigate(`/app/streams/${stream.id}`),
      }}
    >
      <Layout>
        <Layout.Section>
          {actionData?.error && (
            <Banner tone="critical" onDismiss={() => {}}>
              <Text as="p">{actionData.error}</Text>
            </Banner>
          )}

          {fetcher.data && !(fetcher.data as any).success && (fetcher.data as any).error && (
            <Banner tone="critical" onDismiss={() => {}}>
              <Text as="p">{(fetcher.data as any).error}</Text>
            </Banner>
          )}

          {/* Analytics Section */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Stream Analytics
              </Text>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                <div>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Stream Duration
                  </Text>
                  <Text variant="headingLg" as="p">
                    {durationMinutes}m {durationSeconds}s
                  </Text>
                </div>

                <div>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Started At
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stream.startedAt ? new Date(stream.startedAt).toLocaleString() : "N/A"}
                  </Text>
                </div>

                <div>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Ended At
                  </Text>
                  <Text variant="headingLg" as="p">
                    {stream.endedAt ? new Date(stream.endedAt).toLocaleString() : "N/A"}
                  </Text>
                </div>

                <div>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Total Clips
                  </Text>
                  <Text variant="headingLg" as="p">
                    {clips.length}
                  </Text>
                </div>
              </div>

              {/* Placeholder for future analytics */}
              <div style={{ marginTop: "24px", padding: "24px", backgroundColor: "#f6f6f7", borderRadius: "8px" }}>
                <Text variant="bodySm" tone="subdued" as="p">
                  Additional analytics (viewer count, revenue, orders) will be available here in a future update.
                </Text>
              </div>
            </BlockStack>
          </Card>

          {/* Manual Clip Creation Section */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Create Manual Clip
              </Text>

              <Text variant="bodySm" tone="subdued" as="p">
                Create a custom clip from your stream. Enter the start and end times in minutes:seconds format (e.g., 5:30 for 5 minutes 30 seconds).
              </Text>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <TextField
                  label="Start Time (M:SS)"
                  value={startTime}
                  onChange={setStartTime}
                  placeholder="0:00"
                  helpText={`Stream duration: ${durationMinutes}m ${durationSeconds}s`}
                />
                <TextField
                  label="End Time (M:SS)"
                  value={endTime}
                  onChange={setEndTime}
                  placeholder="1:00"
                  helpText="Must be after start time"
                />
              </div>

              <TextField
                label="Title (optional)"
                value={title}
                onChange={setTitle}
                placeholder="My custom clip"
              />

              <TextField
                label="Description (optional)"
                value={description}
                onChange={setDescription}
                multiline={3}
                placeholder="Description of this clip"
              />

              <Button
                variant="primary"
                onClick={handleCreateClip}
                loading={isCreatingClip}
                disabled={!startTime || !endTime || isCreatingClip}
              >
                Create Clip
              </Button>
            </BlockStack>
          </Card>

          {/* Existing Clips Section */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Clips ({clips.length})
              </Text>

              {clips.length === 0 ? (
                <Text variant="bodyMd" tone="subdued" as="p">
                  No clips created yet. Use the form above to create your first clip.
                </Text>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {clips.map((clip) => {
                    const playbackUrl = getClipPlaybackUrl(clip);
                    const clipDuration = clip.endTime - clip.startTime;
                    const clipMinutes = Math.floor(clipDuration / 60);
                    const clipSeconds = clipDuration % 60;

                    return (
                      <div
                        key={clip.id}
                        style={{
                          padding: "16px",
                          border: "1px solid #e1e3e5",
                          borderRadius: "8px",
                        }}
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <div>
                              <Text variant="bodyMd" fontWeight="semibold" as="p">
                                {clip.title || `Clip: ${formatTimeForInput(clip.startTime)} - ${formatTimeForInput(clip.endTime)}`}
                              </Text>
                              {clip.description && (
                                <Text variant="bodySm" tone="subdued" as="p" style={{ marginTop: "4px" }}>
                                  {clip.description}
                                </Text>
                              )}
                            </div>
                          </InlineStack>

                          <div>
                            <Text variant="bodySm" tone="subdued" as="p">
                              Duration: {clipMinutes}m {clipSeconds}s • 
                              Time: {formatTimeForInput(clip.startTime)} - {formatTimeForInput(clip.endTime)} • 
                              Created: {new Date(clip.createdAt).toLocaleDateString()}
                              {clip.productId && " • Auto-clip (product featured)"}
                            </Text>
                          </div>

                          {playbackUrl ? (
                            <div style={{ marginTop: "12px" }}>
                              <video
                                controls
                                style={{
                                  width: "100%",
                                  maxWidth: "800px",
                                  borderRadius: "4px",
                                }}
                                src={playbackUrl}
                              />
                            </div>
                          ) : (
                            <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "#f6f6f7", borderRadius: "4px" }}>
                              <Text variant="bodySm" tone="subdued" as="p">
                                Clip is being processed. Playback will be available soon.
                              </Text>
                            </div>
                          )}
                        </BlockStack>
                      </div>
                    );
                  })}
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
