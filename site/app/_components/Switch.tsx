"use client";

interface SwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function Switch({ checked, label, disabled = false, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors disabled:opacity-50 ${
        checked ? "border-accent/60 bg-accent/20" : "border-line-strong bg-raised"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute size-3 transition-transform ${
          checked ? "translate-x-[19px] bg-accent" : "translate-x-[3px] bg-faint"
        }`}
      />
    </button>
  );
}
