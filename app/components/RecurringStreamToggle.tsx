import { Text, Select } from "@shopify/polaris";

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

type RecurringStreamToggleProps = {
  isRecurring: boolean;
  frequency: string;
  onToggle: (enabled: boolean) => void;
  onFrequencyChange: (freq: string) => void;
};

export function RecurringStreamToggle({
  isRecurring,
  frequency,
  onToggle,
  onFrequencyChange,
}: RecurringStreamToggleProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ paddingTop: "2px", flexShrink: 0 }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 4V10C1 11.0609 1.42143 12.0783 2.17157 12.8284C2.92172 13.5786 3.93913 14 5 14H17M17 14L13 10M17 14L13 18"
              stroke="#202223"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div style={{ flexShrink: 0 }}>
          <Toggle checked={isRecurring} onChange={onToggle} />
        </div>
        <div style={{ flex: 1 }}>
          <Text variant="bodyMd" fontWeight="semibold" as="span">
            Recurring Stream
          </Text>
          <div style={{ marginTop: "4px" }}>
            <Text variant="bodySm" tone="subdued" as="span">
              Automatically schedule future streams
            </Text>
          </div>
        </div>
      </div>

      {isRecurring && (
        <div style={{ marginTop: "16px", marginLeft: "44px" }}>
          <Select
            label="Frequency"
            options={[
              { label: "Daily", value: "daily" },
              { label: "Weekly", value: "weekly" },
              { label: "Monthly", value: "monthly" },
            ]}
            value={frequency}
            onChange={onFrequencyChange}
          />
        </div>
      )}
    </div>
  );
}
