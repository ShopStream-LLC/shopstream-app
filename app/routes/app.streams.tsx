import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Streams() {
  return (
    <s-page heading="Streams">
      <s-button slot="primary-action" href="/app/streams/new">
        Create stream
      </s-button>

      <s-section heading="Your streams">
        <s-paragraph>
          No streams yet. Create your first live stream to start selling to your
          audience in real-time.
        </s-paragraph>
        <s-button href="/app/streams/new">Create your first stream</s-button>
      </s-section>

      {/* Placeholder for future table/list */}
      {/* 
      <s-section heading="Streams">
        <s-card>
          <s-table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Scheduled time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Stream data will appear here</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tbody>
          </s-table>
        </s-card>
      </s-section>
      */}
    </s-page>
  );
}
