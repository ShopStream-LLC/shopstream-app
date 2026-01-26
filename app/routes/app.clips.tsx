import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Page, Layout, Card, Text, EmptyState, BlockStack, InlineStack, Badge } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { getClipPlaybackUrl } from "../lib/video-playback";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);

  // Fetch all clips for this shop, ordered by creation date
  const clips = await db.streamClip.findMany({
    where: {
      stream: {
        shop,
      },
    },
    include: {
      stream: {
        select: {
          id: true,
          title: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return { clips };
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function Clips() {
  const { clips } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (clips.length === 0) {
    return (
      <Page title="Clips">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No clips yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p">
                  Clips will appear here after your streams. Each product
                  featured during a stream will generate an auto-clip using Mux.
                  You can also create manual clips from the stream analytics page.
                </Text>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Clips">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                All Clips ({clips.length})
              </Text>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {clips.map((clip) => {
                  const playbackUrl = getClipPlaybackUrl(clip);
                  const duration = clip.endTime - clip.startTime;
                  const durationMinutes = Math.floor(duration / 60);
                  const durationSeconds = duration % 60;

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
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" fontWeight="semibold" as="p">
                              {clip.title || `Clip: ${formatTime(clip.startTime)} - ${formatTime(clip.endTime)}`}
                            </Text>
                            {clip.description && (
                              <Text variant="bodySm" tone="subdued" as="p" style={{ marginTop: "4px" }}>
                                {clip.description}
                              </Text>
                            )}
                          </div>
                          <div>
                            <Button
                              size="micro"
                              onClick={() => navigate(`/app/streams/${clip.streamId}`)}
                            >
                              View Stream
                            </Button>
                          </div>
                        </InlineStack>

                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="bodySm" tone="subdued" as="p">
                            From: {clip.stream.title}
                          </Text>
                          {clip.productId && (
                            <Badge tone="info">Auto-clip</Badge>
                          )}
                          {!clip.productId && (
                            <Badge>Manual</Badge>
                          )}
                        </InlineStack>

                        <div>
                          <Text variant="bodySm" tone="subdued" as="p">
                            Duration: {durationMinutes}m {durationSeconds}s • 
                            Time: {formatTime(clip.startTime)} - {formatTime(clip.endTime)} • 
                            Created: {new Date(clip.createdAt).toLocaleDateString()}
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
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
