import { Page, Layout, Card, Text, EmptyState } from "@shopify/polaris";

export default function Clips() {
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
              </Text>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
