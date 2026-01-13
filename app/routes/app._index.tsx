import type { LoaderFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { Page, Layout, Card, Text, Button } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // No shop needed, parent route already authenticates
  return null;
};

export default function AppIndex() {
  const navigate = useNavigate();

  return (
    <Page title="Welcome to StreamCart Live">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p" variant="bodyMd">
              Welcome to StreamCart Live! Start by creating your first live stream.
            </Text>
            <Button onClick={() => navigate("/app/streams")}>
              Go to Streams
            </Button>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
