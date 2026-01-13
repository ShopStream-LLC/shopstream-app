import { Page, Layout, Card, Text } from "@shopify/polaris";

export default function Settings() {
  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              Streaming
            </Text>
            <Text as="p" variant="bodyMd">
              Streaming configuration settings will appear here.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Notifications
            </Text>
            <Text as="p" variant="bodyMd">
              Notification preferences will appear here.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Integrations
            </Text>
            <Text as="p" variant="bodyMd">
              Integration settings will appear here.
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
