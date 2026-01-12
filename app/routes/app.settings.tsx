import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Settings() {
  return (
    <s-page heading="Settings">
      <s-section heading="Streaming">
        <s-paragraph>
          Streaming configuration settings will appear here.
        </s-paragraph>
      </s-section>

      <s-section heading="Notifications">
        <s-paragraph>
          Notification preferences will appear here.
        </s-paragraph>
      </s-section>

      <s-section heading="Integrations">
        <s-paragraph>
          Integration settings will appear here.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
