/**
 * Canonical homepage hero mark: logo, PICKUP wordmark, tagline.
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
  logoAlt = "CT Pickup",
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

      <TitleTag className="mt-4 text-2xl font-bold tracking-[0.32em] text-white sm:mt-6 sm:text-3xl sm:tracking-[0.48em] md:text-4xl md:tracking-[0.55em]">
        PICKUP
      </TitleTag>

      <p className="mt-3 max-w-[20rem] text-[11px] uppercase leading-relaxed tracking-[0.2em] text-white/75 sm:mt-5 sm:max-w-none sm:text-xs sm:tracking-[0.24em] md:text-sm md:tracking-[0.28em]">
        Community. Culture. Competition.
      </p>
    </>
  );

  if (!stackClassName) return stack;

  return (
    <div className={`flex flex-col items-center ${stackClassName}`}>{stack}</div>
  );
}
