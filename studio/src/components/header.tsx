"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { ClauseJump } from "./clause-jump";

// Primary items stay inline; secondary tools collapse into the "More" menu.
const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/", label: "Search" },
  { href: "/standards", label: "Documents" },
  { href: "/categories", label: "Categories" },
  { href: "/terms", label: "Terms" },
];
const MORE = [
  { href: "/analyze", label: "Analyze" },
  { href: "/collections", label: "Collections" },
  { href: "/review", label: "Review" },
  { href: "/admin", label: "Admin" },
];

export function Header() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [open, setOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close both menus on navigation and the More menu on outside click.
  useEffect(() => {
    setOpen(false);
    setNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const moreActive = MORE.some((m) => isActive(m.href));

  return (
    <header className="header">
      <div className="head-in">
        <Link href="/" className="brand" aria-label="STADIA-X home">
          <BrandMark />
          <span className="wordmark">
            Stadia<b>-X</b>
          </span>
        </Link>
        <nav className={`nav${navOpen ? " nav-open" : ""}`}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(item.href) ? "on" : undefined}>
              {item.label}
            </Link>
          ))}
          <div className="nav-more" ref={moreRef}>
            <button
              type="button"
              className={`nav-more-btn${moreActive ? " on" : ""}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              More
            </button>
            {open && (
              <div className="nav-more-menu" role="menu">
                {MORE.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={isActive(item.href) ? "on" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <ClauseJump />
        </nav>
        <div className="head-right">
          <button
            type="button"
            className={`nav-toggle${navOpen ? " on" : ""}`}
            aria-label="Menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
