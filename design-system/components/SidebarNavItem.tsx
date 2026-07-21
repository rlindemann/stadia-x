"use client";

import type { LucideIcon } from "lucide-react";

/**
 * One navigation entry, in either sidebar state.
 *
 * Collapsed (the rail): a 26px square with a hairline border. Active takes the
 * accent border and wash — the accent never fills. See DESIGN.md § Signature
 * elements.
 *
 * Expanded: the numbered editorial treatment, with a 1px accent rule marking
 * the active row.
 *
 * Pure presentation, no contexts, so it can be rendered in the design harness
 * at /design-check without an authenticated session.
 */
export interface SidebarNavItemProps {
    label: string;
    /** Two-digit marker shown in the expanded state, e.g. "01". */
    n: string;
    icon: LucideIcon;
    isActive: boolean;
    isOpen: boolean;
    onClick: () => void;
    animateLabel?: boolean;
}

export function SidebarNavItem({
    label,
    n,
    icon: Icon,
    isActive,
    isOpen,
    onClick,
    animateLabel,
}: SidebarNavItemProps) {
    return (
        <button
            onClick={onClick}
            title={!isOpen ? label : ""}
            aria-current={isActive ? "page" : undefined}
            className={`group relative w-full h-10 items-center gap-3 text-left transition-colors ${
                isOpen ? "border-b border-rule px-2.5" : "justify-center px-0"
            } ${
                isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
            } ${!isOpen ? "hidden md:flex" : "flex"}`}
        >
            {/* Active marker — a rule, not a filled block. Expanded only; the
                rail marks active on the item itself. */}
            <span
                className={`absolute left-0 top-0 h-full w-px bg-brand transition-opacity ${
                    isActive && isOpen ? "opacity-100" : "opacity-0"
                }`}
            />
            {isOpen ? (
                <span
                    className={`font-serif text-xs tabular-nums transition-colors ${
                        isActive
                            ? "text-brand"
                            : "text-muted-foreground/60 group-hover:text-brand"
                    }`}
                >
                    {n}
                </span>
            ) : (
                <span
                    className={`flex h-[26px] w-[26px] items-center justify-center rounded-[2px] border transition-colors ${
                        isActive
                            ? "border-brand bg-brand-muted text-brand"
                            : "border-rule-strong text-muted-foreground group-hover:border-brand group-hover:text-brand"
                    }`}
                >
                    <Icon className="h-[15px] w-[15px] flex-shrink-0" />
                </span>
            )}
            {isOpen && (
                <span
                    className={`text-[13px] uppercase tracking-[0.1em] ${
                        animateLabel ? "sidebar-fade-in-2" : ""
                    }`}
                >
                    {label}
                </span>
            )}
        </button>
    );
}
