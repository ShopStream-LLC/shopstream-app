import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Clips() {
  return (
    <s-page heading="Clips">
      <s-section heading="Stream clips">
        <s-paragraph>
          No clips yet. Clips will appear here after your streams. Each product
          featured during a stream will generate an auto-clip using Mux.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
