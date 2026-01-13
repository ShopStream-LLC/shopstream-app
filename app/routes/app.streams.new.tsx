import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useNavigate } from "react-router";
import { Page, Layout, Card, Text, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Auto-generate title with date
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const title = `New stream – ${dateStr}`;

  // Create draft stream
  const stream = await db.stream.create({
    data: {
      shop,
      title,
      status: "DRAFT",
    },
  });

  // Redirect to stream dashboard
  return redirect(`/app/streams/${stream.id}`);
};

export default function CreateStream() {
  const navigate = useNavigate();

  return (
    <Page
      title="Create stream"
      backAction={{
        content: "Streams",
        onAction: () => navigate("/app/streams"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p" variant="bodyMd">
              Click the button below to create a new draft stream. You can add
              products and configure details later.
            </Text>
            <Form method="post">
              <Button submit variant="primary">
                Create draft stream
              </Button>
            </Form>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream setup
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Step 1:</strong> Select products (coming soon)
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Step 2:</strong> Stream details (coming soon)
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Step 3:</strong> Go live (coming soon)
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
