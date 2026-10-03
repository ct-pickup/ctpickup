import { PRODUCT_NAME } from "@/lib/brand";

type WordmarkProps = {
  className?: string;
  as?: "span" | "div" | "h1";
};

/** "Competitive Together" in Archivo 700. Size and colour come from className. */
export function Wordmark({ className = "", as: Tag = "span" }: WordmarkProps) {
  return <Tag className={`font-brand ${className}`}>{PRODUCT_NAME}</Tag>;
}
