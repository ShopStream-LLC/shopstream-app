import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Page, Layout, Card, Text, Button, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const streams = await db.stream.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  return { streams };
};

function getStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "LIVE":
      return "Live";
    case "ENDED":
      return "Ended";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return status;
  }
}

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
                <Button onClick={() => navigate("/app/streams/new")}>
                  Create your first stream
                </Button>
              </EmptyState>
            </Card>
          ) : (
            <Card>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                    <th style={{ textAlign: "left", padding: "12px" }}>Title</th>
                    <th style={{ textAlign: "left", padding: "12px" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "12px" }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {streams.map((stream) => (
                    <tr
                      key={stream.id}
                      style={{ borderBottom: "1px solid #e1e3e5", cursor: "pointer" }}
                      onClick={() => navigate(`/app/streams/${stream.id}`)}
                    >
                      <td style={{ padding: "12px" }}>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {stream.title}
                        </Text>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <Text as="span" variant="bodyMd">
                          {getStatusLabel(stream.status)}
                        </Text>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <Text as="span" variant="bodyMd">
                          {formatDate(stream.createdAt)}
                        </Text>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
