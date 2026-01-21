import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Page, Layout, Card, Text, EmptyState, Button, Badge } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);

  const streams = await db.stream.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: {
      products: true,
    },
  });

  return { streams };
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

export default function Streams() {
  const { streams } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

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
          {streams.length === 0 ? (
            <Card>
              <EmptyState
                heading="No streams yet"
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
              {streams.map((stream) => (
                <Card key={stream.id}>
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
              ))}
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
