# Custom Hybrid Graph RAG Architecture vs. Standard Copilot

This document summarizes the discussion comparing standard AI assistants (like Microsoft Copilot) with a custom-built Hybrid Graph RAG system using Voyage AI embeddings, vector libraries, and knowledge graphs.

---

## 1. How Standard Copilot Handles Documents

### Single Document (RAG Basics)
- **Ingestion & Indexing:** Document text is split into chunks and converted into vector embeddings representing meaning and context.
- **Secure Storage:** The original file stays within your tenant (SharePoint, Dataverse, OneDrive), with existing access permissions preserved.
- **Query Flow:** Copilot optimizes your prompt into search terms → runs semantic search against the index → retrieves the most relevant snippets → injects them into the LLM prompt (grounding) → generates the answer.

### A Folder of 100 Documents (Filter & Rank Funnel)

```
[ Your Query ]
      │
      ▼
1. KEYWORD & METADATA FILTERING   → Narrows 100 docs to the most relevant files
      │
      ▼
2. SEMANTIC VECTOR SEARCH         → Finds matching paragraphs across those files
      │
      ▼
3. RERANKING & TOP SNIPPETS       → Selects the best chunks (top 10–20)
      │
      ▼
4. LLM GROUNDING & GENERATION     → Synthesizes snippets into the final answer
```

**Strengths & Pitfalls:**
- **Needle in a haystack:** Hyper-specific lookups ("which file mentions Project Alpha?") work extremely well.
- **Aggregation barrier:** Broad questions ("summarize themes across all 100 docs") produce incomplete answers — the LLM's context window can't hold all documents, so only the top-ranked chunks are used.

---

## 2. Limitations of Standard Enterprise Copilots

- **Arbitrary chunking:** Fixed-size splits (e.g., every ~500 words) fracture tables, legal clauses, and multi-step logic.
- **No multi-hop reasoning:** Flat vector search can't reliably connect entities scattered across many documents or join relational databases.
- **Black-box behavior:** Little visibility into *why* certain chunks were retrieved; tuning is limited to prompt engineering.
- **Ecosystem lock-in:** Fixed models, fixed per-user pricing, data stays in Microsoft's cloud.

---

## 3. Advantages of a Custom System (That Copilot Can't Easily Replicate)

1. **Advanced graph & relational querying** — Graph RAG or hybrid SQL-vector databases can execute precise structural joins ("all clients who bought Product X, their total spend, and their account manager's notes") and blend them with unstructured text.
2. **Tailored ingestion & custom chunking** — Layout-aware parsers keep tables intact, convert charts to markdown, and chunk legal docs by clause rather than word count.
3. **Complete model & cost control** — Choose any LLM (including local open-source models like Llama 3 or Mistral via Ollama); pay per usage rather than flat licensing; keep sensitive data fully private or air-gapped.
4. **Custom fine-tuning & domain vocabulary** — Fine-tune embeddings or the LLM on proprietary jargon, SKUs, and acronyms to reduce hallucinations.
5. **Deterministic evaluation** — Own the pipeline; use frameworks like Ragas or TruLens to measure retrieval accuracy and systematically optimize.

**Comparison summary:**

| Feature | Microsoft Copilot | Custom Build / Own DB |
|---|---|---|
| Setup time | Minutes (out of the box) | Weeks to months |
| Data types | Best for standard text files | Text, complex tables, SQL databases |
| Logic control | Limited to prompt engineering | Complete algorithmic control |
| Data privacy | Locked to Microsoft Cloud | Fully private, air-gapped if needed |

---

## 4. Improving Embeddings: Voyage AI & Spotify's Voyager

### Voyage AI (embedding & reranking models)
- **Contextualized chunk embeddings** (`voyage-context-3`): embeds chunks with awareness of surrounding text, so vectors retain broader document meaning.
- **Multi-stage reranking:** vector search pulls ~100 raw fragments; the reranker scores and surfaces the top ~5 best answers before they reach the LLM.
- **Domain specialization:** models tuned for code, legal, and financial data — better handling of industry nomenclature and alphanumeric codes.
- **Large context windows (32K):** ingest big blocks of text at once, reducing loss during chunking.

### Spotify's Voyager (vector search library)
- Open-source, in-memory approximate nearest-neighbor (ANN) engine based on the HNSW algorithm.
- Extreme speed at scale with high recall and low latency.
- Native Python and Java bindings — easy to run directly alongside SQL queries.
- Enables **blended queries:** run a SQL query to find client IDs, then pass those IDs into a Voyager index to fetch their unstructured notes — something Copilot's closed system can't stitch together on the fly.

**Key point:** Neither an embedding model nor a vector library solves multi-hop reasoning alone. They are specialized gears inside a larger custom pipeline (Hybrid Graph RAG).

---

## 5. What is Graph RAG / Hybrid Graph RAG?

**Graph RAG** combines vector search with a **Knowledge Graph**:
- **Nodes (entities):** people, products, companies, concepts (e.g., "Client A", "Product X").
- **Edges (relationships):** how they connect (e.g., Client A —BOUGHT→ Product X).

Instead of reading chunks in isolation, the AI follows relationship paths across documents to answer complex questions.

**Hybrid Graph RAG** merges three retrieval methods into one system:
1. **Structured data (SQL):** exact calculations and filters ("clients with total spend > £10,000").
2. **Unstructured data (vector search / Voyage AI):** fuzzy semantic matching ("notes where the client seemed frustrated").
3. **Relational links (graph DB):** connection tracing ("which account managers handle clients who bought Product X?").

```
              [ Natural Language Query ]
                        │
                        ▼
              ┌─────────────────────┐
              │ Orchestration Layer │
              │(LangChain/LlamaIndex)│
              └─────────┬───────────┘
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 1. Relational│ │ 2. Graph DB  │ │ 3. Vector    │
│  SQL Search  │ │  Traversal   │ │  Search      │
│ (exact       │ │ (entity      │ │ (semantic    │
│  filters &   │ │  connections)│ │  match via   │
│  calcs)      │ │              │ │  Voyage AI)  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       └────────────────┼────────────────┘
                        ▼
              ┌─────────────────────┐
              │ Context Synthesis & │
              │   LLM Generation    │
              └─────────────────────┘
```

---

## 6. The Hybrid Graph RAG Production Stack

### Layer 1: Core Database

**Option A — Multi-model database (easiest to manage):**
- **Neo4j:** industry-leading graph DB with built-in vector search and structured node properties.
- **PostgreSQL + `pgvector` + Apache AGE:** turns standard Postgres into a vector + graph + relational database simultaneously.

**Option B — Specialized split stack (massive scale):**
- **Relational:** PostgreSQL, MySQL, or Snowflake (ledgers, client IDs, financials).
- **Graph:** Neo4j or AWS Neptune (entity/network maps).
- **Vector:** Spotify's Voyager (fast local in-memory) or Pinecone / Qdrant (cloud-managed).

### Layer 2: Intelligence
- **Embeddings & reranking:** Voyage AI (`voyage-4`, `voyage-context-3`).
- **LLM:** OpenAI GPT-4o, Anthropic Claude, or local open-source (Llama 3, Mistral via Ollama) for data compliance.

### Layer 3: Orchestration
- **Microsoft GraphRAG framework:** open-source, automates knowledge-graph extraction from raw text.
- **LangChain / LlamaIndex:** property-graph indexing templates and hybrid SQL-graph workflows.

---

## 7. Query Execution Flow (End-to-End Example)

Query: *"Show me all clients who bought Product X, their total spend, and their account manager's notes."*

```
[ User Input Query ]
        │
        ▼
1. QUERY TRANSLATION & DECONSTRUCTION
   Orchestrator parses intent into functional sub-tasks.
        │
   ┌────┼─────────────────────────┐
   ▼    ▼                         ▼
2A. SQL LEDGER        2B. GRAPH NODES        2C. VECTOR DB
Structured query on   Traces links to find   Voyage AI scans
purchase tables;      the assigned account   unstructured logs
sums total spend.     managers.              for textual notes.
   │    │                         │
   └────┼─────────────────────────┘
        ▼
3. CONTEXT FUSION & AGGREGATION
   Numbers, relationships, and text passages combined.
        │
        ▼
4. LLM GENERATION & CITATION
   Coherent final answer with source attribution.
```

**Step-by-step:**
1. The orchestrator splits the query into three tasks.
2. The SQL engine finds client IDs who bought Product X and sums their spend.
3. The graph database traces those client IDs to their assigned account managers.
4. The vector engine semantically searches the interaction logs tied to those clients.
5. The orchestrator packages structured data + graph relationships + raw notes into one prompt.
6. The LLM outputs a comprehensive, cited answer.

---

## Next Steps (Open Questions)

- Automate graph extraction from your documents with Microsoft's open-source GraphRAG framework?
- Or start with a unified PostgreSQL (`pgvector` + Apache AGE) database and build the query layer from there?
- Decide backend language (Python / Node.js) and whether data is mostly structured tables or unstructured text.
