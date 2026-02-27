import { useState } from "react";

interface MerchantLogoProps {
  website: string | null;
  name: string;
  size?: number;
}

export default function MerchantLogo({ website, name, size = 20 }: MerchantLogoProps) {
  const [error, setError] = useState(false);
  const token = import.meta.env.VITE_LOGODEV_TOKEN;

  const initial = (name || "?").charAt(0).toUpperCase();
  const fallback = (
    <span
      className="inline-flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-xs font-medium shrink-0"
      style={{ width: size, height: size }}
    >
      {initial}
    </span>
  );

  if (!token || !website || error) {
    return fallback;
  }

  return (
    <img
      src={`https://img.logo.dev/${website}?token=${token}&size=${size * 2}&format=png`}
      alt={name}
      width={size}
      height={size}
      className="rounded shrink-0"
      onError={() => setError(true)}
    />
  );
}
