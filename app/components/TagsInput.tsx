import { useState } from "react";
import { TextField, Button, Tag } from "@shopify/polaris";

type TagsInputProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  helpText?: string;
};

export function TagsInput({ tags, onChange, label = "Tags (Internal Only)", helpText }: TagsInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !tags.includes(trimmedValue)) {
      onChange([...tags, trimmedValue]);
      setInputValue("");
    }
  };

  const handleRemove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={label}
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleKeyPress}
            placeholder="Add a tag..."
            helpText={helpText}
            autoComplete="off"
          />
        </div>
        <Button onClick={handleAdd}>Add</Button>
      </div>

      {tags.length > 0 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {tags.map((tag) => (
            <Tag key={tag} onRemove={() => handleRemove(tag)}>
              {tag}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
