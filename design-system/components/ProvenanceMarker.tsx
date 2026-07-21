"use client";

import type { DaveEditAnnotation } from "./types";

/**
 * Where a proposed edit came from.
 *
 * Two states only — source or no source. There is no confidence percentage,
 * because "87% confident" is a number a bid manager cannot act on and will be
 * blamed for ignoring. See DESIGN.md § Color hard rules.
 *
 * Renders off `source_verified`, never off `source_kind`. A source the backend
 * could not confirm is displayed exactly like no source at all, so an invented
 * citation can never look like a real one.
 *
 * Unsourced is marked by FORM (a dashed accent outline), not by red. Unsourced
 * is unverified, not failed — red is reserved for compliance failure.
 */
export function ProvenanceMarker({
    annotation,
}: {
    annotation: Pick<
        DaveEditAnnotation,
        "source_kind" | "source_ref" | "source_page" | "source_verified"
    >;
}) {
    const verified = annotation.source_verified === true;

    if (!verified) {
        return (
            <span className="font-ident text-brand-text border-brand inline-block border border-dashed px-1.5 py-0.5 text-[9.5px] tracking-tight">
                MODEL — UNSOURCED
            </span>
        );
    }

    const label =
        annotation.source_ref?.toUpperCase() ||
        (annotation.source_kind === "boilerplate"
            ? "PRACTICE-BOILERPLATE"
            : annotation.source_kind === "regulation"
              ? "REGULATION"
              : "SOURCE");

    return (
        <span className="font-ident text-muted-foreground inline-block text-[9.5px] tracking-tight">
            {label}
            {annotation.source_page ? ` p.${annotation.source_page}` : ""}
        </span>
    );
}
