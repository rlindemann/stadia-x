# Per-Company Customization Guide

How to spin up a customized copy of the AEC base template (`aec-base`) for a specific company.
Each company copy is independent: its own backing services, prompts, regulations source, and
branding. Only the domain layer changes; the engine stays the same.

## What varies per company

| Area | What to change | Where |
|---|---|---|
| Backing services | Supabase project, R2 bucket, model API keys | `backend/.env`, `frontend/.env.local` |
| Database schema | Run the schema once on the new Supabase project | `backend/migrations/000_one_shot_schema.sql` |
| Drafting/review prompts | AEC system prompts for this company's style/policies | backend chat prompts (see ARCHITECTURE.md section 3) |
| Practice categories | Document types / RIBA stages this company uses | `frontend/src/app/components/workflows/practices.ts` |
| Built-in workflows | This company's reusable prompts and review grids | the two `builtinWorkflows.ts` files |
| Regulations source | This company's graph database of regulations/policies | the `query_regulations` tool (Phase 3) |
| Branding | Name, logo | `site-logo.tsx`, `package.json`, README, title prompt |

## Steps to create a new company copy

1. Copy the code
   - Copy the `aec-base` branch/repo into a new folder or repo for the company.

2. Provision that company's services
   - Create a Supabase project; run `backend/migrations/000_one_shot_schema.sql` in its SQL editor.
   - Create an S3-compatible bucket (Cloudflare R2 or similar).
   - Obtain Anthropic and/or Gemini API keys (or have users bring their own in-app).

3. Configure env (never commit these; they are gitignored)
   - `backend/.env`: PORT, FRONTEND_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, R2_* , model keys.
   - `frontend/.env.local`: NEXT_PUBLIC_SUPABASE_URL, publishable key, NEXT_PUBLIC_API_BASE_URL,
     R2_* , model keys.

4. Apply the company's domain customization
   - Prompts, practice categories, built-in workflows, generate_docx template.
   - Point the `query_regulations` tool at this company's regulations graph.
   - Branding if desired.

5. Install and run
   - `npm install --prefix backend` and `npm install --prefix frontend`
     (frontend needs `--legacy-peer-deps` due to a next / opennextjs-cloudflare peer conflict).
   - Backend: `npm run dev --prefix backend` (port 3101).
   - Frontend: `npx next dev -p 3100 --prefix frontend` (must match backend FRONTEND_URL / CORS).
   - Open http://localhost:3100.

## Keeping copies up to date

Generic improvements (engine fixes, new AEC features) are made in `aec-base` and then merged
into each company copy. Keep per-company edits confined to the domain layer above so merges stay
clean. If divergence grows, extract the domain layer (prompts, workflows, branding) into a small
config module so per-company changes live in one place.

## Local dev note (ports)

The backend CORS allows the origin in `FRONTEND_URL` (currently `http://localhost:3100`), and the
frontend calls the backend at `NEXT_PUBLIC_API_BASE_URL` (currently `http://localhost:3101`).
Keep these two consistent or auth requests will fail with CORS/"Failed to fetch".
