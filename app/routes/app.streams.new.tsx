import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function CreateStream() {
  return (
    <s-page heading="Create stream">
      <s-button slot="secondary-action" href="/app/streams">
        Back
      </s-button>

      <s-section heading="Stream setup">
        <s-paragraph>
          <s-text emphasis="strong">Step 1:</s-text> Select products
        </s-paragraph>
        <s-paragraph>
          <s-text emphasis="strong">Step 2:</s-text> Stream details
        </s-paragraph>
        <s-paragraph>
          <s-text emphasis="strong">Step 3:</s-text> Go live
        </s-paragraph>
      </s-section>

      <s-section heading="Stream setup coming next">
        <s-paragraph>
          The stream creation wizard will be implemented here. This will include
          product selection, stream details, scheduling, and Mux setup.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
