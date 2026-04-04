import Image from "next/image";

type CoachHeadshotProps = {
  src: string;
  alt: string;
  /** Tailwind-friendly sizing hint for `next/image` */
  sizes: string;
  className?: string;
  /** CSS `object-position`, e.g. `50% 12%` for tighter head framing */
  imagePosition?: string;
  priority?: boolean;
};

export function CoachHeadshot({
  src,
  alt,
  sizes,
  className = "",
  imagePosition = "50% 18%",
  priority,
}: CoachHeadshotProps) {
  return (
    <div
      className={`relative overflow-hidden bg-[#0a0b0c] ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover [filter:saturate(0.9)_contrast(1.03)_brightness(0.96)]"
        style={{ objectPosition: imagePosition }}
        priority={priority}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(15,15,16,0.82)_0%,rgba(15,15,16,0.28)_48%,transparent_70%)]"
        aria-hidden
      />
    </div>
  );
}
