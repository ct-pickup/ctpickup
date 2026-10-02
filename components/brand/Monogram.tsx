import { SHORT_NAME } from "@/lib/brand";

type MonogramProps = {
  size?: number;
  /** light: pitch on chalk. dark: chalk on ink. */
  variant?: "light" | "dark";
  className?: string;
};

export function Monogram({ size = 32, variant = "light", className = "" }: MonogramProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG brand asset
    <img
      src={`/brand/ct-monogram-${variant}.svg`}
      alt={SHORT_NAME}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
