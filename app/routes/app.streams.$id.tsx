import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigate, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import { Page, Layout, Card, Text, Button, TextField, RadioButton, Banner } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const streamId = params.id;

  if (!streamId) {
    throw new Response("Stream not found", { status: 404 });
  }

  const stream = await db.stream.findFirst({
    where: {
      id: streamId,
      shop,
    },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  return { stream };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { shop } = await requireShopSession(request);
    const streamId = params.id;

    if (!streamId) {
      throw new Response("Stream not found", { status: 404 });
    }

    // Validate stream belongs to this shop
    const existingStream = await db.stream.findFirst({
      where: {
        id: streamId,
        shop,
      },
    });

    if (!existingStream) {
      throw new Response("Stream not found", { status: 404 });
    }

    // Parse form data
    const formData = await request.formData();
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const startOption = formData.get("startOption") as string;
    const scheduledDate = formData.get("scheduledDate") as string | null;
    const scheduledTime = formData.get("scheduledTime") as string | null;

    // Validate title
    if (!title || title.trim() === "") {
      return {
        error: "Title is required",
      };
    }

    // Determine scheduledAt and status
    let scheduledAt: Date | null = null;
    let status: "DRAFT" | "SCHEDULED" = "DRAFT";

    if (startOption === "schedule" && scheduledDate && scheduledTime) {
      // Combine date and time into a single DateTime
      const dateTimeString = `${scheduledDate}T${scheduledTime}`;
      scheduledAt = new Date(dateTimeString);
      
      // Validate the date is in the future
      if (scheduledAt <= new Date()) {
        return {
          error: "Scheduled time must be in the future",
        };
      }
      
      status = "SCHEDULED";
    }

    // Update stream
    await db.stream.update({
      where: { id: streamId },
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        scheduledAt,
        status,
      },
    });

    // Redirect back to the same page
    return redirect(`/app/streams/${streamId}`);
  } catch (error) {
    console.error("Error updating stream:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to update stream. Please check server logs.",
    };
  }
};

function getStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "LIVE":
      return "Live";
    case "ENDED":
      return "Ended";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return status;
  }
}

export default function StreamDashboard() {
  const { stream } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [title, setTitle] = useState(stream.title);
  const [description, setDescription] = useState(stream.description || "");
  const [startOption, setStartOption] = useState<"immediate" | "schedule">(
    stream.scheduledAt ? "schedule" : "immediate"
  );
  
  // Format scheduledAt for date/time inputs
  const scheduledDate = stream.scheduledAt
    ? new Date(stream.scheduledAt).toISOString().split("T")[0]
    : "";
  const scheduledTime = stream.scheduledAt
    ? new Date(stream.scheduledAt).toTimeString().slice(0, 5)
    : "";
  
  const [dateValue, setDateValue] = useState(scheduledDate);
  const [timeValue, setTimeValue] = useState(scheduledTime);

  return (
    <Page
      title={stream.title}
      backAction={{
        content: "Streams",
        onAction: () => navigate("/app/streams"),
      }}
    >
      <Layout>
        <Layout.Section>
          {actionData?.error && (
            <Banner tone="critical" onDismiss={() => {}}>
              <Text as="p">{actionData.error}</Text>
            </Banner>
          )}
          <Card>
            <Form method="post">
              <Text as="h2" variant="headingMd">
                Stream details
              </Text>
              
              <div style={{ marginTop: "16px" }}>
                <TextField
                  label="Title"
                  name="title"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  requiredIndicator
                />
              </div>

              <div style={{ marginTop: "16px" }}>
                <TextField
                  label="Description"
                  name="description"
                  value={description}
                  onChange={setDescription}
                  multiline={4}
                  autoComplete="off"
                />
              </div>

              <div style={{ marginTop: "24px" }}>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Start time
                </Text>
                <div style={{ marginTop: "12px" }}>
                  <RadioButton
                    label="Start immediately"
                    checked={startOption === "immediate"}
                    id="immediate"
                    name="startOption"
                    value="immediate"
                    onChange={() => setStartOption("immediate")}
                  />
                </div>
                <div style={{ marginTop: "12px" }}>
                  <RadioButton
                    label="Schedule for later"
                    checked={startOption === "schedule"}
                    id="schedule"
                    name="startOption"
                    value="schedule"
                    onChange={() => setStartOption("schedule")}
                  />
                </div>
              </div>

              {startOption === "schedule" && (
                <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Date"
                      type="date"
                      name="scheduledDate"
                      value={dateValue}
                      onChange={setDateValue}
                      requiredIndicator
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Time"
                      type="time"
                      name="scheduledTime"
                      value={timeValue}
                      onChange={setTimeValue}
                      requiredIndicator
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
                <Button submit variant="primary" loading={isSubmitting}>
                  Save
                </Button>
                <Button onClick={() => navigate("/app/streams")}>
                  Back to streams
                </Button>
              </div>
            </Form>
          </Card>
          
          <Card>
            <Text as="h2" variant="headingMd">
              Stream info
            </Text>
            <Text as="p" variant="bodyMd" style={{ marginTop: "8px" }}>
              <strong>Status:</strong> {getStatusLabel(stream.status)}
            </Text>
            <Text as="p" variant="bodyMd" style={{ marginTop: "8px" }}>
              <strong>Created:</strong>{" "}
              {new Date(stream.createdAt).toLocaleString()}
            </Text>
            {stream.scheduledAt && (
              <Text as="p" variant="bodyMd" style={{ marginTop: "8px" }}>
                <strong>Scheduled:</strong>{" "}
                {new Date(stream.scheduledAt).toLocaleString()}
              </Text>
            )}
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream preview
            </Text>
            <Text as="p" variant="bodyMd">
              Stream preview will appear here. This will show the live Mux video feed
              with controls for pause/resume.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Product queue
            </Text>
            <Text as="p" variant="bodyMd">
              Product control section will appear here. Merchants can feature products,
              reorder the lineup, and see upcoming products.
            </Text>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <Text as="h2" variant="headingMd">
              Live chat
            </Text>
            <Text as="p" variant="bodyMd">
              Live chat will appear here. This will show viewer messages, system
              notifications, and purchase events.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream stats
            </Text>
            <Text as="p" variant="bodyMd">
              Real-time stats will appear here. This will show viewer count, revenue,
              orders, and average viewer value.
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
