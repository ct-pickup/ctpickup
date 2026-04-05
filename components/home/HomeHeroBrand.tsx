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
        className="w-[260px] md:w-[340px] h-auto object-contain"
        draggable={false}
      />

      <TitleTag className="mt-6 text-3xl font-bold tracking-[0.55em] text-white md:text-4xl">
        PICKUP
      </TitleTag>

      <p className="mt-5 text-xs uppercase tracking-[0.28em] text-white/75 md:text-sm">
        Community. Culture. Competition.
      </p>
    </>
  );

  if (!stackClassName) return stack;

  return (
    <div className={`flex flex-col items-center ${stackClassName}`}>{stack}</div>
  );
}
