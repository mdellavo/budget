import { useState, useRef } from "react";

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  displayValue?: (s: string) => string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function ComboBox({
  value,
  onChange,
  suggestions,
  displayValue,
  placeholder,
  disabled,
  className,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setOpen(true);
  }

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && open && suggestions.length > 0) {
      onChange(suggestions[0]);
      setOpen(false);
      e.preventDefault();
    }
  }

  function handleSelect(suggestion: string) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(suggestion);
    setOpen(false);
  }

  const showDropdown = open && suggestions.length > 0;

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      {showDropdown && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto text-sm">
          {suggestions.map((s) => (
            <li
              key={s}
              onMouseDown={() => handleSelect(s)}
              className="px-3 py-2 cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 text-gray-800"
            >
              {displayValue ? displayValue(s) : s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
