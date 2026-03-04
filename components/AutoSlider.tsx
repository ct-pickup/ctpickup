"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type AutoSliderProps = {
  images: { src: string; alt?: string }[];
  intervalMs?: number;
  className?: string;
};

export default function AutoSlider({
  images,
  intervalMs = 5000,
  className = "",
}: AutoSliderProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!images || images.length <= 1) return;

    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, intervalMs);

    return () => clearInterval(id);
  }, [images, intervalMs]);

  const current = images[index];

  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className}`}>
      <div className="relative w-full aspect-[16/9]">
        <Image
          key={current.src}
          src={current.src}
          alt={current.alt ?? ""}
          fill
          className="object-cover"
          priority
        />
      </div>
    </div>
  );
}
