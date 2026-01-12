import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { streamId: params.id };
};

export default function StreamDashboard() {
  const { streamId } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Live Stream Dashboard">
      <s-button slot="secondary-action" href="/app/streams">
        Back to Streams
      </s-button>

      <s-section heading="Stream preview">
        <s-paragraph>
          Stream preview will appear here. This will show the live Mux video feed
          with controls for pause/resume.
        </s-paragraph>
      </s-section>

      <s-section heading="Product queue">
        <s-paragraph>
          Product control section will appear here. Merchants can feature products,
          reorder the lineup, and see upcoming products.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Live chat">
        <s-paragraph>
          Live chat will appear here. This will show viewer messages, system
          notifications, and purchase events.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Stream stats">
        <s-paragraph>
          Real-time stats will appear here. This will show viewer count, revenue,
          orders, and average viewer value.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
