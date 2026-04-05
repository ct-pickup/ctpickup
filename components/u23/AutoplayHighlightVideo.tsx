"use client";

import { useEffect, useRef } from "react";

/**
 * Muted loop for reliable in-browser autoplay (policy + iOS playsInline).
 */
export function AutoplayHighlightVideo({
  src,
  label,
}: {
  src: string;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    const p = el.play();
    if (p !== undefined) p.catch(() => {});
  }, [src]);

  return (
    <video
      ref={ref}
      className="w-full rounded-lg border border-white/10 bg-black"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-label={label}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
