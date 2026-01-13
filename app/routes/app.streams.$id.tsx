import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Page, Layout, Card, Text, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const streamId = params.id;

  if (!streamId) {
    throw new Response("Stream not found", { status: 404 });
  }

  const stream = await db.stream.findFirst({
    where: {
      id: streamId,
      shop,
    },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  return { stream };
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

export default function StreamDashboard() {
  const { stream } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page
      title={stream.title}
      backAction={{
        content: "Streams",
        onAction: () => navigate("/app/streams"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream details
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Status:</strong> {getStatusLabel(stream.status)}
            </Text>
            {stream.description && (
              <Text as="p" variant="bodyMd">
                <strong>Description:</strong> {stream.description}
              </Text>
            )}
            <Text as="p" variant="bodyMd">
              <strong>Created:</strong>{" "}
              {new Date(stream.createdAt).toLocaleString()}
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream preview
            </Text>
            <Text as="p" variant="bodyMd">
              Stream preview will appear here. This will show the live Mux video feed
              with controls for pause/resume.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Product queue
            </Text>
            <Text as="p" variant="bodyMd">
              Product control section will appear here. Merchants can feature products,
              reorder the lineup, and see upcoming products.
            </Text>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <Text as="h2" variant="headingMd">
              Live chat
            </Text>
            <Text as="p" variant="bodyMd">
              Live chat will appear here. This will show viewer messages, system
              notifications, and purchase events.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream stats
            </Text>
            <Text as="p" variant="bodyMd">
              Real-time stats will appear here. This will show viewer count, revenue,
              orders, and average viewer value.
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
