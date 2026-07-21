// Minimal types the reference components need. In the source app these live
// in a larger shared types file; only the shape ProvenanceMargin/Marker read
// is reproduced here so the folder ports without dragging the whole app.

export interface DaveEditAnnotation {
    edit_id: string;
    deleted_text: string;
    inserted_text: string;
    reason?: string;
    /** What the model CLAIMED the source was. */
    source_kind?: "document" | "regulation" | "boilerplate" | "model";
    source_doc_id?: string | null;
    source_page?: number | null;
    source_quote?: string | null;
    source_ref?: string | null;
    /**
     * What the backend CONFIRMED. Render off THIS, never off source_kind alone
     * — an unverified claim must look exactly like unsourced text.
     * See DESIGN.md § Color hard rules.
     */
    source_verified?: boolean;
}
