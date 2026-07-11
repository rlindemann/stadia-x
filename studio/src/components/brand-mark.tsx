export function BrandMark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path d="M22 5 C33.5 5 41 10.6 41 16.2 C41 20.4 37.4 23.3 32 25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M22 39 C10.5 39 3 33.4 3 27.8 C3 23.6 6.6 20.7 12 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="22" cy="22" rx="11" ry="7.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M22 14.8 V29.2" stroke="var(--accent)" strokeWidth="1.8" />
    </svg>
  );
}
