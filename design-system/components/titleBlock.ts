/**
 * Title block — the persistent status bar pinned to the bottom of a document.
 *
 * Answers a bid manager's four most-asked questions without a click:
 * which document, how long, what is outstanding, is it safe to send.
 * See DESIGN.md § Signature elements.
 *
 * Two rules drive everything here:
 *
 * 1. Never fabricate. A value that is not known is omitted entirely rather
 *    than shown as zero or "—". The whole point of this bar is that it can be
 *    trusted at a glance; a confident-looking zero is worse than a gap.
 * 2. Alarm tone means compliance failure only. Open redlines are proposals,
 *    not failures, so they never take the alarm tone no matter how many there
 *    are. A word-count breach and outstanding compliance flags do.
 */

export type TitleBlockTone = "normal" | "alarm";

export interface TitleBlockSegment {
    text: string;
    tone: TitleBlockTone;
}

export interface TitleBlockInput {
    /** Document reference, e.g. "DAS-04". Falls back to the filename. */
    reference?: string | null;
    /** Version number; rendered as "REV C" (1 -> A, 2 -> B, ...). */
    revision?: number | null;
    wordCount?: number | null;
    /** Tender word limit, when the document has one. */
    wordLimit?: number | null;
    openRedlines?: number | null;
    complianceFlags?: number | null;
    syncedAt?: Date | null;
}

/** 1 -> A, 2 -> B ... 27 -> AA. Falls back to the number past the alphabet. */
export function revisionLabel(revision: number): string {
    if (!Number.isFinite(revision) || revision < 1) return String(revision);
    let n = Math.floor(revision);
    let out = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

function formatTime(d: Date): string {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function buildTitleBlockSegments(
    input: TitleBlockInput,
): TitleBlockSegment[] {
    const segments: TitleBlockSegment[] = [];
    const push = (text: string, tone: TitleBlockTone = "normal") =>
        segments.push({ text, tone });

    if (input.reference) push(input.reference.toUpperCase());

    if (typeof input.revision === "number" && input.revision > 0) {
        push(`REV ${revisionLabel(input.revision)}`);
    }

    if (typeof input.wordCount === "number") {
        const count = input.wordCount.toLocaleString("en-GB");
        if (typeof input.wordLimit === "number" && input.wordLimit > 0) {
            const limit = input.wordLimit.toLocaleString("en-GB");
            // Over the tender limit is a compliance failure, not a warning.
            const breached = input.wordCount > input.wordLimit;
            push(`${count} / ${limit} WORDS`, breached ? "alarm" : "normal");
        } else {
            push(`${count} WORDS`);
        }
    }

    // Redlines are proposals. Never alarm, however many are open.
    if (typeof input.openRedlines === "number") {
        push(
            input.openRedlines === 1
                ? "1 OPEN REDLINE"
                : `${input.openRedlines} OPEN REDLINES`,
        );
    }

    if (typeof input.complianceFlags === "number") {
        if (input.complianceFlags === 0) {
            push("NO COMPLIANCE FLAGS");
        } else {
            push(
                input.complianceFlags === 1
                    ? "1 COMPLIANCE FLAG"
                    : `${input.complianceFlags} COMPLIANCE FLAGS`,
                "alarm",
            );
        }
    }

    if (input.syncedAt) push(`SYNCED ${formatTime(input.syncedAt)}`);

    return segments;
}
