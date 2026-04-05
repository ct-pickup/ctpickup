"use client";

import { coachPhotoSrc } from "@/lib/trainingCoaches";

type CoachHeadshotProps = {
  slug: string;
  name: string;
  className?: string;
  /** CSS `object-position`, e.g. `50% 12%` for tighter head framing */
  imagePosition?: string;
  loading?: "eager" | "lazy";
};

export function CoachHeadshot({
  slug,
  name,
  className = "",
  imagePosition = "50% 18%",
  loading = "lazy",
}: CoachHeadshotProps) {
  return (
    <div className={`relative overflow-hidden bg-[#0a0b0c] ${className}`}>
      <img
        src={coachPhotoSrc(slug)}
        alt={name}
        loading={loading}
        className="absolute inset-0 h-full w-full object-cover [filter:saturate(0.9)_contrast(1.03)_brightness(0.96)]"
        style={{ objectPosition: imagePosition }}
        onError={(e) => {
          e.currentTarget.src = "/coaches/placeholder.svg";
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(15,15,16,0.82)_0%,rgba(15,15,16,0.28)_48%,transparent_70%)]"
        aria-hidden
      />
    </div>
  );
}
