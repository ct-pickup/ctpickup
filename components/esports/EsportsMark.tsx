/**
 * Esports mark: game controller silhouette — dual grips, center bridge, D-pad, face cluster, emerald shoulder line.
 */
export function EsportsMark({
  className = "",
  "aria-hidden": ariaHidden = true,
}: {
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
    >
      <defs>
        <linearGradient
          id="esports-ctrl-beam"
          x1="22"
          y1="30"
          x2="74"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--brand, #22c55e)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--brand, #22c55e)" stopOpacity="0.12" />
        </linearGradient>
        <filter
          id="esports-ctrl-glow"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M28 31h40"
        stroke="url(#esports-ctrl-beam)"
        strokeWidth="2"
        strokeLinecap="round"
        filter="url(#esports-ctrl-glow)"
      />

      {/* Grips + center — reads clearly as a pad, not a handset */}
      <ellipse
        cx="28"
        cy="51"
        rx="12.5"
        ry="14.5"
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="1.35"
        className="text-white"
      />
      <ellipse
        cx="68"
        cy="51"
        rx="12.5"
        ry="14.5"
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="1.35"
        className="text-white"
      />
      <rect
        x="33"
        y="35"
        width="30"
        height="22"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.25"
        className="text-white"
      />
      <rect
        x="35.5"
        y="37.5"
        width="25"
        height="17"
        rx="4"
        stroke="currentColor"
        strokeOpacity="0.09"
        strokeWidth="0.65"
        className="text-white"
      />

      {/* D-pad */}
      <path
        d="M27 49.5v8M23 53.5h8"
        stroke="currentColor"
        strokeOpacity="0.48"
        strokeWidth="1.45"
        strokeLinecap="round"
        className="text-white"
      />
      <rect
        x="20"
        y="46.5"
        width="11"
        height="11"
        rx="2.2"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="0.85"
        className="text-white"
      />

      {/* Face buttons */}
      <circle cx="63.5" cy="48.5" r="2.2" fill="currentColor" className="text-white/32" />
      <circle cx="68.5" cy="53.5" r="2.2" fill="currentColor" className="text-white/32" />
      <circle
        cx="63.5"
        cy="58.5"
        r="2.2"
        fill="var(--brand, #22c55e)"
        fillOpacity="0.92"
      />
      <circle
        cx="63.5"
        cy="58.5"
        r="2.2"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="0.35"
        className="text-white"
      />
      <circle cx="58.5" cy="53.5" r="2.2" fill="currentColor" className="text-white/32" />

      <path
        d="M48 39v14"
        stroke="currentColor"
        strokeOpacity="0.1"
        strokeWidth="0.8"
        strokeLinecap="round"
        className="text-white"
      />
      <circle cx="48" cy="46" r="1.1" fill="currentColor" className="text-white/22" />
    </svg>
  );
}
