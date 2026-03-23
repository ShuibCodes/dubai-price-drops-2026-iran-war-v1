import Image from "next/image";
import Link from "next/link";

/** Brand logotype from `public/dashboard/logos/Logotype.svg` (keep in sync with `src/components/dashboard/logos/Logotype.svg`). */
export default function DashboardLogo({ className = "" }) {
  return (
    <Link
      href="/"
      className={`inline-flex shrink-0 items-center rounded-md bg-white/95 px-2 py-1 shadow-sm ring-1 ring-white/15 transition hover:bg-white ${className}`}
      aria-label="Home"
    >
      <Image
        src="/dashboard/logos/Logotype.svg"
        alt=""
        width={109}
        height={50}
        className="h-8 w-auto sm:h-9"
        priority
      />
    </Link>
  );
}
