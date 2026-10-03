import { Wordmark } from "@/components/brand/Wordmark";
import { PRODUCT_NAME } from "@/lib/brand";
/**
 * Canonical homepage hero mark: logo, wordmark, tagline.
 * Reused by the homepage, session intro, and route transition overlay — keep in sync.
 */
type HomeHeroBrandProps = {
  logoAlt?: string;
  /** Use "div" when inside overlays to avoid duplicate h1 landmarks. */
  titleAs?: "h1" | "div";
  /** Optional root stack for motion scoping (e.g. route overlay). Homepage omits — same layout as fragment. */
  stackClassName?: string;
};

export function HomeHeroBrand({
  logoAlt = PRODUCT_NAME,
  titleAs = "h1",
  stackClassName,
}: HomeHeroBrandProps) {
  const TitleTag = titleAs === "h1" ? "h1" : "div";

  const stack = (
    <>
      <img
        src="/ct-logo.png"
        alt={logoAlt}
        className="h-auto w-[min(100%,220px)] max-w-[260px] object-contain sm:w-[260px] sm:max-w-none md:w-[340px]"
        draggable={false}
      />

      <TitleTag className="mt-4 text-center text-h3 text-ink sm:mt-6 sm:text-h1 md:text-display">
        <Wordmark />
      </TitleTag>

      <p className="mt-3 max-w-[20rem] text-caption leading-relaxed text-muted sm:mt-5 sm:max-w-none sm:text-caption md:text-small">
        Community. Culture. Competition.
      </p>
    </>
  );

  if (!stackClassName) return stack;

  return (
    <div className={`flex flex-col items-center ${stackClassName}`}>{stack}</div>
  );
}
