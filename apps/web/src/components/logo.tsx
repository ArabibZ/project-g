/* Project G brand mark — "the watcher's blip".
   A G drawn as a scanning dial; the orange dot in its opening is the
   new job the scraper just spotted. */

export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        viewBox="0 0 48 48"
        fill="none"
      >
        <path
          d="M 33.4 14.2 A 12.6 12.6 0 1 0 36.6 24 L 26.5 24"
          stroke="currentColor"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        <circle cx="35.4" cy="11.6" r="3.4" fill="#e57b28" />
      </svg>
    </span>
  );
}

export function BrandLockup({ tagline = true }: { tagline?: boolean }) {
  return (
    <>
      <LogoMark />
      <span className="brand-copy">
        <strong>
          Project G<span className="tick">.</span>
        </strong>
        {tagline ? <span>Job monitor</span> : null}
      </span>
    </>
  );
}
