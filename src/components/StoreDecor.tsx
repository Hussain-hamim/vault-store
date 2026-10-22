/** Soft computer-store illustrations that fill empty side space (CSS motion, no GSAP). */
export function StoreDecor() {
  return (
    <div className="store-decor" aria-hidden="true">
      <svg
        className="store-decor-item store-decor-laptop"
        viewBox="0 0 160 110"
        fill="none"
      >
        <rect
          x="18"
          y="8"
          width="124"
          height="78"
          rx="8"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="28"
          y="18"
          width="104"
          height="52"
          rx="4"
          fill="currentColor"
          opacity="0.12"
        />
        <path
          d="M8 92h144c-6 8-20 12-72 12S14 100 8 92Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="80" cy="78" r="2.5" fill="currentColor" opacity="0.45" />
      </svg>
      <svg
        className="store-decor-item store-decor-phone"
        viewBox="0 0 70 120"
        fill="none"
      >
        <rect
          x="8"
          y="6"
          width="54"
          height="108"
          rx="10"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="16"
          y="22"
          width="38"
          height="68"
          rx="3"
          fill="currentColor"
          opacity="0.12"
        />
        <circle cx="35" cy="102" r="4" stroke="currentColor" strokeWidth="2" />
      </svg>
      <svg
        className="store-decor-item store-decor-chip"
        viewBox="0 0 100 100"
        fill="none"
      >
        <rect
          x="22"
          y="22"
          width="56"
          height="56"
          rx="8"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="34"
          y="34"
          width="32"
          height="32"
          rx="4"
          fill="currentColor"
          opacity="0.14"
        />
        {[14, 28, 42, 56, 70].map((y) => (
          <g key={y}>
            <path d={`M6 ${y}h16`} stroke="currentColor" strokeWidth="2" />
            <path d={`M78 ${y}h16`} stroke="currentColor" strokeWidth="2" />
          </g>
        ))}
        {[14, 28, 42, 56, 70].map((x) => (
          <g key={`v${x}`}>
            <path d={`M${x} 6v16`} stroke="currentColor" strokeWidth="2" />
            <path d={`M${x} 78v16`} stroke="currentColor" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <svg
        className="store-decor-item store-decor-headphones"
        viewBox="0 0 120 90"
        fill="none"
      >
        <path
          d="M20 52V40c0-22 18-36 40-36s40 14 40 36v12"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect
          x="8"
          y="48"
          width="22"
          height="32"
          rx="8"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="90"
          y="48"
          width="22"
          height="32"
          rx="8"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
      <svg
        className="store-decor-item store-decor-keyboard"
        viewBox="0 0 140 70"
        fill="none"
      >
        <rect
          x="6"
          y="10"
          width="128"
          height="50"
          rx="8"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        {[18, 36, 54, 72, 90, 108].map((x) => (
          <rect
            key={x}
            x={x}
            y="22"
            width="12"
            height="10"
            rx="2"
            fill="currentColor"
            opacity="0.2"
          />
        ))}
        <rect
          x="36"
          y="40"
          width="68"
          height="10"
          rx="2"
          fill="currentColor"
          opacity="0.18"
        />
      </svg>
      <svg
        className="store-decor-item store-decor-mouse"
        viewBox="0 0 60 90"
        fill="none"
      >
        <rect
          x="12"
          y="8"
          width="36"
          height="72"
          rx="18"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M30 8v22"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="30" cy="24" r="3" fill="currentColor" opacity="0.35" />
      </svg>
      <svg
        className="store-decor-item store-decor-tablet"
        viewBox="0 0 100 130"
        fill="none"
      >
        <rect
          x="10"
          y="6"
          width="80"
          height="118"
          rx="12"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="20"
          y="20"
          width="60"
          height="84"
          rx="4"
          fill="currentColor"
          opacity="0.12"
        />
        <circle cx="50" cy="114" r="4" stroke="currentColor" strokeWidth="2" />
      </svg>
      <div className="store-decor-orb store-decor-orb-a" />
      <div className="store-decor-orb store-decor-orb-b" />
      <div className="store-decor-orb store-decor-orb-c" />
    </div>
  );
}
