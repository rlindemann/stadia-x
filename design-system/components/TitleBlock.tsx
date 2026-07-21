"use client";

import {
    buildTitleBlockSegments,
    type TitleBlockInput,
} from "./titleBlock";

/**
 * The title block: a 28px bar pinned to the bottom edge of a document.
 * Mono, tabular, never scrolls. See DESIGN.md § Signature elements.
 *
 * Renders nothing when there is nothing truthful to say.
 */
export function TitleBlock(props: TitleBlockInput) {
    const segments = buildTitleBlockSegments(props);
    if (segments.length === 0) return null;

    return (
        <div
            className="font-ident bg-titleblock text-titleblock-foreground flex h-7 shrink-0 items-center overflow-x-auto px-3.5 text-[10px] tracking-tight"
            role="status"
            aria-label="Document status"
        >
            {segments.map((seg, i) => (
                <span
                    key={seg.text}
                    className={`whitespace-nowrap ${
                        i < segments.length - 1
                            ? "border-titleblock-rule mr-3.5 border-r pr-3.5"
                            : ""
                    } ${seg.tone === "alarm" ? "text-titleblock-alarm" : ""}`}
                >
                    {seg.text}
                </span>
            ))}
        </div>
    );
}
