import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { AppProvider as PolarisAppProvider, Frame, Page, Layout, Card, Text, TextField, Button } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <ShopifyAppProvider embedded={false}>
      <PolarisAppProvider i18n={enTranslations}>
        <Frame>
          <Page>
            <Layout>
              <Layout.Section>
                <Card>
                  <Form method="post">
                    <TextField
                      name="shop"
                      label="Shop domain"
                      helpText="example.myshopify.com"
                      value={shop}
                      onChange={setShop}
                      autoComplete="on"
                      error={errors.shop}
                    />
                    <Button submit>Log in</Button>
                  </Form>
                </Card>
              </Layout.Section>
            </Layout>
          </Page>
        </Frame>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}
