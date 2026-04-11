import {
  SUPPORT_EMAIL_ADDRESS,
  SUPPORT_EMAIL_MAILTO,
} from "@/lib/supportEmail";

type Props = {
  className?: string;
};

const defaultClass =
  "font-medium text-[var(--brand)] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm";

/**
 * Accessible mailto link; visible text is the address so screen readers get a clear label.
 */
export function SupportEmailLink({ className }: Props) {
  return (
    <a href={SUPPORT_EMAIL_MAILTO} className={className ?? defaultClass}>
      {SUPPORT_EMAIL_ADDRESS}
    </a>
  );
}
