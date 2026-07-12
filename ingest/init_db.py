"""Apply db/schema.sql to the DATABASE_URL Postgres. Run once (safe to re-run)."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    sql = Path("db/schema.sql").read_text(encoding="utf-8")
    body = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    statements = [s.strip() for s in body.split(";") if s.strip()]
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        for stmt in statements:
            conn.execute(stmt)
            print("ok:", stmt.splitlines()[0][:64])
    print(f"schema applied ({len(statements)} statements).")


if __name__ == "__main__":
    main()
