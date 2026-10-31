import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ModelSelectorProps = {
  disabled?: boolean;
  models: string[];
  onValueChange: (value: string) => void;
  value: string | null;
};

export function ModelSelector({
  disabled = false,
  models,
  onValueChange,
  value,
}: ModelSelectorProps) {
  function handleValueChange(nextValue: string | null): void {
    if (nextValue !== null) {
      onValueChange(nextValue);
    }
  }

  return (
    <Select disabled={disabled} onValueChange={handleValueChange} value={value}>
      <SelectTrigger
        aria-label="モデル"
        className="max-w-56 border-transparent bg-transparent hover:bg-muted dark:bg-transparent"
        size="sm"
      >
        <SelectValue placeholder="モデルを選択" />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
