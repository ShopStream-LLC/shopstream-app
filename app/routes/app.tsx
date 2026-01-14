import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  // Persist `host` so App Bridge actions (like ResourcePicker) can work even when
  // the iframe URL no longer includes `?host=...` after client-side navigation.
  useEffect(() => {
    try {
      const host = new URLSearchParams(window.location.search).get("host");
      if (host) {
        window.sessionStorage.setItem("shopifyHost", host);
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <Frame>
          <ui-nav-menu>
            <a href="/app" rel="home">Home</a>
            <a href="/app/streams">Streams</a>
            <a href="/app/clips">Clips</a>
            <a href="/app/settings">Settings</a>
          </ui-nav-menu>
          <Outlet />
        </Frame>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
