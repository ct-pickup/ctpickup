import { forwardRef, type ComponentProps } from "react";

/**
 * Shared dark-theme field styles: caret, border, focus ring, 56px height, no harsh outlines.
 * Use for `<Input />` or `className={inputFieldClassName}` on native inputs.
 */
export const inputFieldClassName =
  "ct-input-field box-border h-14 w-full min-h-[56px] rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-base font-medium leading-6 text-white caret-white/70 shadow-none ring-0 transition-[caret-color,color,background-color,border-color,box-shadow] duration-200 ease-out outline-none placeholder:text-white/35 focus:border-white/20 focus:bg-white/[0.06] focus:caret-white focus:ring-2 focus:ring-inset focus:ring-white/5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

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
      className={[inputFieldClassName, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});
