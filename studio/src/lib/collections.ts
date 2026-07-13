// Client-side collections: named sets of saved clauses with per-clause notes,
// persisted in localStorage. No login required (auth is deferred), so this is
// per-browser. A "collections-change" event lets components stay in sync.

export type ClauseSnapshot = {
  id: number;
  clause_path: string;
  heading_trail: string;
  standard_id: string;
  standard_title: string;
  standard_status: string | null;
  publisher: string | null;
  obligation_type: string;
  page: number;
  pdf_file_page: number;
  source_url: string | null;
  verbatim_text: string;
};

export type CollectionItem = { clause: ClauseSnapshot; note: string };
export type Collection = { id: string; name: string; created: number; items: CollectionItem[] };

const KEY = "stadia-collections-v1";
const EVENT = "collections-change";

function isBrowser() {
  return typeof window !== "undefined";
}

// Ids without Date/Math.random reliance issues in the app runtime (this is browser code).
function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function load(): Collection[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(cols: Collection[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(KEY, JSON.stringify(cols));
  window.dispatchEvent(new Event(EVENT));
}

export function subscribe(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler); // sync across tabs
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function createCollection(name: string): Collection {
  const cols = load();
  const col: Collection = { id: newId(), name: name.trim() || "Untitled", created: Date.now(), items: [] };
  persist([...cols, col]);
  return col;
}

export function renameCollection(id: string, name: string) {
  persist(load().map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)));
}

export function deleteCollection(id: string) {
  persist(load().filter((c) => c.id !== id));
}

export function addItem(collectionId: string, clause: ClauseSnapshot) {
  persist(
    load().map((c) =>
      c.id === collectionId && !c.items.some((it) => it.clause.id === clause.id)
        ? { ...c, items: [...c.items, { clause, note: "" }] }
        : c,
    ),
  );
}

export function removeItem(collectionId: string, clauseId: number) {
  persist(
    load().map((c) =>
      c.id === collectionId ? { ...c, items: c.items.filter((it) => it.clause.id !== clauseId) } : c,
    ),
  );
}

export function setNote(collectionId: string, clauseId: number, note: string) {
  persist(
    load().map((c) =>
      c.id === collectionId
        ? { ...c, items: c.items.map((it) => (it.clause.id === clauseId ? { ...it, note } : it)) }
        : c,
    ),
  );
}

// Ids of collections that already contain a given clause (for toggle state).
export function collectionsWith(clauseId: number): string[] {
  return load().filter((c) => c.items.some((it) => it.clause.id === clauseId)).map((c) => c.id);
}
