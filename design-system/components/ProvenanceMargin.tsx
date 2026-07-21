"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DaveEditAnnotation } from "./types";
import { ProvenanceMarker } from "./ProvenanceMarker";

/**
 * The provenance margin: source markers running down the right-hand side of the
 * document, each aligned with the edit it belongs to.
 *
 * A document pinned left with annotations down the right IS a marked-up
 * drawing. That asymmetry is the composition. See DESIGN.md § Signature
 * elements.
 *
 * Alignment works because DocxView already tags every rendered <ins>/<del>
 * with `data-w-id` (see DocxView.tsx). We measure each tagged element's
 * position within the scroll container and place its marker at the same
 * offset. Markers for edits whose element cannot be found are dropped rather
 * than stacked at the top — a marker in the wrong place is worse than none.
 */

const MIN_GAP = 26; // px between stacked markers

interface Placed {
    edit: DaveEditAnnotation;
    top: number;
}

export function ProvenanceMargin({
    edits,
    containerRef,
    rootRef,
    /** Bumped by the parent whenever the document re-renders. */
    revision,
}: {
    edits: DaveEditAnnotation[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** The positioned wrapper this margin is absolutely placed within. */
    rootRef: React.RefObject<HTMLDivElement | null>;
    revision?: unknown;
}) {
    const [placed, setPlaced] = useState<Placed[]>([]);
    const frame = useRef<number | null>(null);

    const measure = useCallback(() => {
        const container = containerRef.current;
        const root = rootRef.current;
        if (!container || !root) return;

        // Measured against the wrapper, not the viewport, so the result is
        // independent of scroll position and needs no scroll listener.
        const rootTop = root.getBoundingClientRect().top;

        const next: Placed[] = [];
        for (const edit of edits) {
            const wId = edit.ins_w_id || edit.del_w_id;
            if (!wId) continue;
            const tag = edit.ins_w_id ? "ins" : "del";
            let el = container.querySelector<HTMLElement>(
                `${tag}[data-w-id="${CSS.escape(wId)}"]`,
            );
            // The tag may not match if only the counterpart rendered.
            if (!el) {
                el = container.querySelector<HTMLElement>(
                    `[data-w-id="${CSS.escape(wId)}"]`,
                );
            }
            if (!el) continue;
            next.push({ edit, top: el.getBoundingClientRect().top - rootTop });
        }

        // Keep document order, then push apart so markers never overlap.
        next.sort((a, b) => a.top - b.top);
        let last = -Infinity;
        for (const p of next) {
            if (p.top < last + MIN_GAP) p.top = last + MIN_GAP;
            last = p.top;
        }

        setPlaced((prev) => {
            if (
                prev.length === next.length &&
                prev.every(
                    (p, i) =>
                        p.edit.edit_id === next[i].edit.edit_id &&
                        Math.abs(p.top - next[i].top) < 1,
                )
            ) {
                return prev; // no change; avoid a render loop
            }
            return next;
        });
    }, [edits, containerRef, rootRef]);

    const schedule = useCallback(() => {
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            measure();
        });
    }, [measure]);

    useEffect(() => {
        schedule();
        const container = containerRef.current;
        if (!container) return;

        // docx-preview rewrites the DOM wholesale, and fonts/images settle
        // after first paint — both move every marker.
        const mo = new MutationObserver(schedule);
        mo.observe(container, { childList: true, subtree: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(container);

        return () => {
            mo.disconnect();
            ro.disconnect();
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            frame.current = null;
        };
    }, [schedule, containerRef, revision]);

    if (placed.length === 0) return null;

    return (
        // In flow, immediately right of the document — not pinned to the far
        // edge of the viewport, or the markers detach from the text they
        // annotate on a wide screen.
        <div
            className="pointer-events-none relative w-[190px] shrink-0"
            aria-hidden="true"
        >
            {placed.map(({ edit, top }) => (
                <div
                    key={edit.edit_id}
                    className="absolute left-5"
                    style={{ top }}
                >
                    <ProvenanceMarker annotation={edit} />
                </div>
            ))}
        </div>
    );
}
