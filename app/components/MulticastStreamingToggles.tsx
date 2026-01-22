import { Text } from "@shopify/polaris";

// Custom Toggle component styled as a switch
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: "44px",
        height: "24px",
        borderRadius: "12px",
        border: "none",
        backgroundColor: checked ? "#008060" : "#8C9196",
        cursor: "pointer",
        transition: "background-color 0.2s ease",
        padding: "2px",
        outline: "none",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          backgroundColor: "#FFFFFF",
          transition: "transform 0.2s ease",
          transform: checked ? "translateX(20px)" : "translateX(0)",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
        }}
      />
    </button>
  );
}

type MulticastStreamingTogglesProps = {
  facebook: boolean;
  instagram: boolean;
  tiktok: boolean;
  onChange: (platform: "facebook" | "instagram" | "tiktok", enabled: boolean) => void;
};

type PlatformToggleProps = {
  icon: "facebook" | "instagram" | "tiktok";
  name: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
};

function PlatformToggle({ icon, name, description, enabled, onToggle }: PlatformToggleProps) {
  const getIcon = () => {
    switch (icon) {
      case "facebook":
        return (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 13.9932 4.92527 17.3027 8.75 17.9028V12.3125H6.71875V10H8.75V8.23125C8.75 6.23578 9.94438 5.125 11.7717 5.125C12.6467 5.125 13.5625 5.28125 13.5625 5.28125V7.25H12.5538C11.56 7.25 11.25 7.86672 11.25 8.5V10H13.4688L13.1141 12.3125H11.25V17.9028C15.0747 17.3027 18 13.9932 18 10Z"
              fill="#1877F2"
            />
          </svg>
        );
      case "instagram":
        return (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M10 6.5C8.067 6.5 6.5 8.067 6.5 10C6.5 11.933 8.067 13.5 10 13.5C11.933 13.5 13.5 11.933 13.5 10C13.5 8.067 11.933 6.5 10 6.5Z"
              fill="url(#instagram-gradient)"
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M3 10C3 7.23858 3 5.85786 3.87868 4.97918C4.75736 4.1005 6.13808 4.1005 8.9 4.1005H11.1C13.8619 4.1005 15.2426 4.1005 16.1213 4.97918C17 5.85786 17 7.23858 17 10C17 12.7614 17 14.1421 16.1213 15.0208C15.2426 15.8995 13.8619 15.8995 11.1 15.8995H8.9C6.13808 15.8995 4.75736 15.8995 3.87868 15.0208C3 14.1421 3 12.7614 3 10ZM10 5C7.23858 5 5 7.23858 5 10C5 12.7614 7.23858 15 10 15C12.7614 15 15 12.7614 15 10C15 7.23858 12.7614 5 10 5ZM14.5 5.5C14.5 5.77614 14.7239 6 15 6C15.2761 6 15.5 5.77614 15.5 5.5C15.5 5.22386 15.2761 5 15 5C14.7239 5 14.5 5.22386 14.5 5.5Z"
              fill="url(#instagram-gradient)"
            />
            <defs>
              <linearGradient
                id="instagram-gradient"
                x1="3"
                y1="17"
                x2="17"
                y2="3"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#FD5" />
                <stop offset="0.5" stopColor="#FF543E" />
                <stop offset="1" stopColor="#C837AB" />
              </linearGradient>
            </defs>
          </svg>
        );
      case "tiktok":
        return (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M15.5 5.5C14.7 5.5 13.9 5.2 13.3 4.6C12.7 4 12.4 3.2 12.4 2.4H10V13C10 13.8 9.4 14.4 8.6 14.4C7.8 14.4 7.2 13.8 7.2 13V13C7.2 12.2 7.8 11.6 8.6 11.6C8.8 11.6 9 11.7 9.2 11.8V9.4C9 9.4 8.8 9.4 8.6 9.4C6.6 9.4 5 11 5 13C5 15 6.6 16.6 8.6 16.6C10.6 16.6 12.2 15 12.2 13V7.8C13.1 8.4 14.3 8.8 15.5 8.8V6.4C15.5 6.4 15.5 5.9 15.5 5.5Z"
              fill="#010101"
            />
          </svg>
        );
    }
  };

  return (
    <div
      style={{
        padding: "12px",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div style={{ flexShrink: 0 }}>{getIcon()}</div>
      <div style={{ flex: 1 }}>
        <Text variant="bodyMd" fontWeight="semibold" as="p">
          {name}
        </Text>
        <Text variant="bodySm" tone="subdued" as="p">
          {description}
        </Text>
      </div>
      <div style={{ flexShrink: 0 }}>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
    </div>
  );
}

export function MulticastStreamingToggles({
  facebook,
  instagram,
  tiktok,
  onChange,
}: MulticastStreamingTogglesProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <PlatformToggle
        icon="facebook"
        name="Facebook Live"
        description="Stream to your Facebook page"
        enabled={facebook}
        onToggle={(enabled) => onChange("facebook", enabled)}
      />
      <PlatformToggle
        icon="instagram"
        name="Instagram Live"
        description="Go live on Instagram"
        enabled={instagram}
        onToggle={(enabled) => onChange("instagram", enabled)}
      />
      <PlatformToggle
        icon="tiktok"
        name="TikTok Live"
        description="Stream to TikTok audience"
        enabled={tiktok}
        onToggle={(enabled) => onChange("tiktok", enabled)}
      />
    </div>
  );
}
