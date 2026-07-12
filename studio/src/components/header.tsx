"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Search" },
  { href: "/standards", label: "Standards" },
  { href: "/terms", label: "Defined terms" },
  { href: "/review", label: "Review" },
  { href: "/saved", label: "Saved" },
];

export function Header() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="header">
      <div className="head-in">
        <Link href="/" className="brand" aria-label="STADIA-X home">
          <BrandMark />
          <span className="wordmark">
            Stadia<b>-X</b>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(item.href) ? "on" : undefined}>
              {item.label}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
