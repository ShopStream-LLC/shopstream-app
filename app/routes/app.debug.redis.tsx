import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, Text } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import { redis } from "../lib/redis.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }
  
  const { shop } = await requireShopSession(request);

  // Get all streams for this shop
  const streams = await db.stream.findMany({
    where: { shop },
    select: { id: true, title: true, muxStreamId: true, status: true },
  });

  // Check Redis state for each stream
  const streamStates = await Promise.all(
    streams.map(async (stream) => {
      const state = await redis.get(`stream:${stream.id}:state`);
      return {
        id: stream.id,
        title: stream.title,
        muxStreamId: stream.muxStreamId,
        dbStatus: stream.status,
        redisState: state || "not set",
      };
    })
  );

  // Get all Redis keys matching stream pattern
  const allKeys = await redis.keys("stream:*");

  // Get values for all keys
  const keyValues = await Promise.all(
    allKeys.map(async (key) => {
      const value = await redis.get(key);
      return { key, value };
    })
  );

  return { streamStates, keyValues };
};

export default function DebugRedis() {
  const { streamStates, keyValues } = useLoaderData<typeof loader>();

  return (
    <Page title="Redis Debug" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream States
            </Text>
            <div style={{ marginTop: "16px" }}>
              {streamStates.length === 0 ? (
                <Text as="p" tone="subdued">
                  No streams found
                </Text>
              ) : (
                <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                  {streamStates.map((stream) => (
                    <li key={stream.id} style={{ marginBottom: "8px" }}>
                      <Text as="p" variant="bodyMd">
                        <strong>{stream.title}</strong> (ID: {stream.id})
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Mux ID: {stream.muxStreamId || "not prepared"}
                      </Text>
                      <Text as="p" variant="bodySm">
                        DB Status: <strong>{stream.dbStatus}</strong>
                      </Text>
                      <Text as="p" variant="bodySm">
                        Redis State: <strong>{stream.redisState}</strong>
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              All Redis Keys & Values (stream:*)
            </Text>
            <div style={{ marginTop: "16px" }}>
              {keyValues.length === 0 ? (
                <Text as="p" tone="subdued">
                  No keys found in Redis
                </Text>
              ) : (
                <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                  {keyValues.map(({ key, value }) => (
                    <li key={key} style={{ marginBottom: "8px" }}>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {key}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Value: {value || "(empty)"}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
