const paths = {
  link: (
    <>
      <path d="m10 13 4-4" />
      <path d="M8 16H6a4 4 0 0 1-3-7l4-4a4 4 0 0 1 6 0M16 8h2a4 4 0 0 1 3 7l-4 4a4 4 0 0 1-6 0" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  chart: <path d="M4 4v16h17M9 15v-4M14 15V7M19 15v-6" />,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7z" />,
  check: <path d="m5 12 4 4L19 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
};
export default function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.link}
    </svg>
  );
}
