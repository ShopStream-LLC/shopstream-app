import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useState } from "react";
import { Page, Layout, Card, Text, EmptyState, Button, Badge, Tabs } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);

  // Get upcoming streams (DRAFT, SCHEDULED, LIVE)
  const upcomingStreams = await db.stream.findMany({
    where: { 
      shop,
      status: { in: ["DRAFT", "SCHEDULED", "LIVE"] }
    },
    orderBy: { createdAt: "desc" },
    include: {
      products: true,
    },
  });

  // Get past streams (ENDED)
  const pastStreams = await db.stream.findMany({
    where: { 
      shop,
      status: "ENDED"
    },
    orderBy: { endedAt: "desc" },
    include: {
      products: true,
    },
  });

  return { upcomingStreams, pastStreams };
};

function formatDate(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dateObj);
}

function getStatusBadge(status: string) {
  switch (status) {
    case "LIVE":
      return <Badge tone="success">Live</Badge>;
    case "SCHEDULED":
      return <Badge tone="info">Scheduled</Badge>;
    case "ENDED":
      return <Badge>Ended</Badge>;
    case "DRAFT":
      return <Badge>Draft</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

// Icons for stats display
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z"
        stroke="#8C9196"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 6V10L13 12"
        stroke="#8C9196"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 2V18M13 5H8.5C7.57174 5 6.6815 5.36875 6.02513 6.02513C5.36875 6.6815 5 7.57174 5 8.5C5 9.42826 5.36875 10.3185 6.02513 10.9749C6.6815 11.6313 7.57174 12 8.5 12H11.5C12.4283 12 13.3185 12.3687 13.9749 13.0251C14.6313 13.6815 15 14.5717 15 15.5C15 16.4283 14.6313 17.3185 13.9749 17.9749C13.3185 18.6313 12.4283 19 11.5 19H6"
        stroke="#8C9196"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14 17V15C14 13.9391 13.5786 12.9217 12.8284 12.1716C12.0783 11.4214 11.0609 11 10 11H4C2.93913 11 1.92172 11.4214 1.17157 12.1716C0.421427 12.9217 0 13.9391 0 15V17M20 17V15C19.9993 14.1137 19.7044 13.2528 19.1614 12.5523C18.6184 11.8519 17.8581 11.3516 17 11.13M14 1.13C14.8604 1.3503 15.623 1.8507 16.1676 2.55231C16.7122 3.25392 17.0078 4.11683 17.0078 5.005C17.0078 5.89317 16.7122 6.75608 16.1676 7.45769C15.623 8.1593 14.8604 8.6597 14 8.88M10 7C11.6569 7 13 5.65685 13 4C13 2.34315 11.6569 1 10 1C8.34315 1 7 2.34315 7 4C7 5.65685 8.34315 7 10 7Z"
        stroke="#8C9196"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Stream card for upcoming streams (DRAFT, SCHEDULED, LIVE)
function UpcomingStreamCard({ stream, navigate }: { stream: any; navigate: any }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        {/* Thumbnail or placeholder */}
        <div
          style={{
            width: "120px",
            height: "68px",
            flexShrink: 0,
            backgroundColor: "#f6f6f7",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {stream.thumbnailUrl ? (
            <img
              src={stream.thumbnailUrl}
              alt={stream.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <svg
              width="40"
              height="40"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.5 5.83333C2.5 4.91286 3.24619 4.16667 4.16667 4.16667H5.63011C6.0567 4.16667 6.46124 3.97436 6.72636 3.64375L7.60697 2.52292C7.87209 2.19231 8.27663 2 8.70322 2H11.2968C11.7234 2 12.1279 2.19231 12.393 2.52292L13.2736 3.64375C13.5388 3.97436 13.9433 4.16667 14.3699 4.16667H15.8333C16.7538 4.16667 17.5 4.91286 17.5 5.83333V15C17.5 15.9205 16.7538 16.6667 15.8333 16.6667H4.16667C3.24619 16.6667 2.5 15.9205 2.5 15V5.83333Z"
                stroke="#8C9196"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 13.3333C11.3807 13.3333 12.5 12.214 12.5 10.8333C12.5 9.45262 11.3807 8.33333 10 8.33333C8.61929 8.33333 7.5 9.45262 7.5 10.8333C7.5 12.214 8.61929 13.3333 10 13.3333Z"
                stroke="#8C9196"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="h3" variant="headingMd" fontWeight="semibold">
            {stream.title}
          </Text>
          {stream.description && (
            <div style={{ marginTop: "4px" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                {stream.description}
              </Text>
            </div>
          )}
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            {stream.scheduledAt && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z"
                    stroke="#8C9196"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 6V10L13 12"
                    stroke="#8C9196"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <Text as="span" variant="bodySm" tone="subdued">
                  {formatDate(stream.scheduledAt)}
                </Text>
              </div>
            )}
            {stream.products.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2 6L10 2L18 6M2 6V14L10 18M2 6L10 10M18 6V14L10 18M18 6L10 10M10 10V18"
                    stroke="#8C9196"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <Text as="span" variant="bodySm" tone="subdued">
                  {stream.products.length} product{stream.products.length !== 1 ? "s" : ""}
                </Text>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <div>{getStatusBadge(stream.status)}</div>
          <Button
            onClick={() => navigate(`/app/streams/${stream.id}`)}
          >
            Edit
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate(`/app/streams/${stream.id}`)}
          >
            Go Live
          </Button>
        </div>
      </div>
    </Card>
  );
}

// Stream card for past streams (ENDED)
function PastStreamCard({ stream }: { stream: any }) {
  // Generate mock statistics (consistent per stream using stream.id)
  const mockDuration = Math.floor((parseInt(stream.id.slice(0, 8), 36) % 50) + 10); // 10-60 minutes
  const mockSales = Math.floor((parseInt(stream.id.slice(8, 16), 36) % 5000) + 500); // $500-$5500
  const mockPeakViewers = Math.floor((parseInt(stream.id.slice(16, 24), 36) % 500) + 50); // 50-550 viewers

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        {/* Thumbnail or placeholder */}
        <div
          style={{
            width: "120px",
            height: "68px",
            flexShrink: 0,
            backgroundColor: "#f6f6f7",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {stream.thumbnailUrl ? (
            <img
              src={stream.thumbnailUrl}
              alt={stream.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <svg
              width="40"
              height="40"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.5 5.83333C2.5 4.91286 3.24619 4.16667 4.16667 4.16667H5.63011C6.0567 4.16667 6.46124 3.97436 6.72636 3.64375L7.60697 2.52292C7.87209 2.19231 8.27663 2 8.70322 2H11.2968C11.7234 2 12.1279 2.19231 12.393 2.52292L13.2736 3.64375C13.5388 3.97436 13.9433 4.16667 14.3699 4.16667H15.8333C16.7538 4.16667 17.5 4.91286 17.5 5.83333V15C17.5 15.9205 16.7538 16.6667 15.8333 16.6667H4.16667C3.24619 16.6667 2.5 15.9205 2.5 15V5.83333Z"
                stroke="#8C9196"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 13.3333C11.3807 13.3333 12.5 12.214 12.5 10.8333C12.5 9.45262 11.3807 8.33333 10 8.33333C8.61929 8.33333 7.5 9.45262 7.5 10.8333C7.5 12.214 8.61929 13.3333 10 13.3333Z"
                stroke="#8C9196"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="h3" variant="headingMd" fontWeight="semibold">
            {stream.title}
          </Text>
          {stream.description && (
            <div style={{ marginTop: "4px" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                {stream.description}
              </Text>
            </div>
          )}

          {/* Scheduled time (when stream started) */}
          {stream.scheduledAt && (
            <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z"
                  stroke="#8C9196"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 6V10L13 12"
                  stroke="#8C9196"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <Text as="span" variant="bodySm" tone="subdued">
                {formatDate(stream.scheduledAt)}
              </Text>
            </div>
          )}

          {/* Stats row */}
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <ClockIcon />
              <Text as="span" variant="bodySm" tone="subdued">
                {mockDuration}min
              </Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <DollarIcon />
              <Text as="span" variant="bodySm" tone="subdued">
                ${mockSales.toLocaleString()}
              </Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <UsersIcon />
              <Text as="span" variant="bodySm" tone="subdued">
                {mockPeakViewers} peak viewers
              </Text>
            </div>
          </div>
        </div>

        {/* Actions - No status badge for past streams */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <Button onClick={() => {}}>
            See Stats
          </Button>
          <Button onClick={() => {}}>
            Share
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Streams() {
  const { upcomingStreams, pastStreams } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    {
      id: "upcoming",
      content: `Upcoming Streams (${upcomingStreams.length})`,
      panelID: "upcoming-streams-panel",
    },
    {
      id: "past",
      content: `Past Streams (${pastStreams.length})`,
      panelID: "past-streams-panel",
    },
  ];

  return (
    <Page
      title="Streams"
      primaryAction={{
        content: "Create stream",
        onAction: () => navigate("/app/streams/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            {selectedTab === 0 && (
              <>
                {upcomingStreams.length === 0 ? (
                  <Card>
                    <EmptyState
                      heading="No upcoming streams"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <Text as="p">
                        Create your first live stream to start selling to your
                        audience in real-time.
                      </Text>
                    </EmptyState>
                  </Card>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {upcomingStreams.map((stream) => (
                      <UpcomingStreamCard key={stream.id} stream={stream} navigate={navigate} />
                    ))}
                  </div>
                )}
              </>
            )}

            {selectedTab === 1 && (
              <>
                {pastStreams.length === 0 ? (
                  <Card>
                    <EmptyState
                      heading="No past streams"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <Text as="p">
                        Past streams will appear here after they end.
                      </Text>
                    </EmptyState>
                  </Card>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {pastStreams.map((stream) => (
                      <PastStreamCard key={stream.id} stream={stream} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Tabs>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
