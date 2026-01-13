import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useNavigate, useActionData, useNavigation } from "react-router";
import { Page, Layout, Card, Text, Button, Banner } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop } = await requireShopSession(request);

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
  } catch (error) {
    console.error("Error creating stream:", error);
    // Return error instead of throwing to prevent 503
    return {
      error: error instanceof Error ? error.message : "Failed to create stream. Please check server logs.",
    };
  }
};

export default function CreateStream() {
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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
          {actionData?.error && (
            <Banner tone="critical" onDismiss={() => {}}>
              <Text as="p">{actionData.error}</Text>
            </Banner>
          )}
          <Card>
            <Text as="p" variant="bodyMd">
              Click the button below to create a new draft stream. You can add
              products and configure details later.
            </Text>
            <Form method="post">
              <Button submit variant="primary" loading={isSubmitting}>
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
