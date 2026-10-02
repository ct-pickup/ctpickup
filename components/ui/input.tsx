import { forwardRef, type ComponentProps } from "react";

/**
 * Shared dark-theme field styles: caret, border, focus ring, 56px height, no harsh outlines.
 * Use for `<Input />` or `className={inputFieldClassName}` on native inputs.
 */
export const inputFieldClassName =
  "ct-input-field box-border h-14 w-full min-h-[56px] rounded-card border border-line bg-card px-4 py-4 text-body font-medium leading-6 text-ink caret-ink ring-0 transition-[caret-color,color,background-color,border-color,box-shadow] duration-200 ease-out outline-none placeholder:text-muted focus:border-line focus:bg-overlay focus:caret-ink focus:ring-2 focus:ring-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Native `<select>` — same shell as inputs; keeps dropdown affordance. */
export const selectFieldClassName = `${inputFieldClassName} cursor-pointer`;

export type InputProps = ComponentProps<"input">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={[inputFieldClassName, className].filter(Boolean).join("  ")}
      {...props}
    />
  );
});
