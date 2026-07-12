#!/bin/bash
set -e

FUSEKI_HOME=/fuseki
SEED_DIR=/data/seed
TDB_DIR=/data/tdb2
ENDPOINT="http://localhost:3030/stadia"

if [ -z "${FUSEKI_PASSWORD:-}" ]; then
  echo "ERROR: FUSEKI_PASSWORD env var is not set. Refusing to start."
  exit 1
fi

mkdir -p "$TDB_DIR"
rm -f "$TDB_DIR/tdb.lock" 2>/dev/null || true

# Inject the real password into shiro.ini
sed "s/FUSEKI_PASSWORD_PLACEHOLDER/${FUSEKI_PASSWORD}/" \
  "$FUSEKI_HOME/shiro.ini.template" > "$FUSEKI_HOME/shiro.ini"

echo "Starting Fuseki (TDB2 at $TDB_DIR)..."
FUSEKI_BASE="$FUSEKI_HOME" java -jar "$FUSEKI_HOME/fuseki-server.jar" \
  --conf="$FUSEKI_HOME/config/stadia.ttl" --port=3030 &
PID=$!

for i in $(seq 1 30); do
  if curl -sf -u "fuseki:${FUSEKI_PASSWORD}" "http://localhost:3030/\$/ping" >/dev/null 2>&1; then
    echo "Fuseki ready."; break
  fi
  sleep 1
done

AUTH="-u fuseki:${FUSEKI_PASSWORD}"

# Seed only when the store is empty (survives container restarts with a data volume).
N=$(curl -sf $AUTH "$ENDPOINT/sparql" \
  --data-urlencode 'query=SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' \
  -H "Accept: application/sparql-results+json" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['results']['bindings'][0]['n']['value'])" 2>/dev/null || echo 0)

if [ "$N" = "0" ]; then
  echo "Store empty — loading seed data..."
  for f in "$SEED_DIR"/*.ttl; do
    [ -f "$f" ] || continue
    echo "  Loading $f"
    curl -sf $AUTH -X POST "$ENDPOINT/data" \
      -H "Content-Type: text/turtle" --data-binary "@$f" >/dev/null \
      && echo "  OK" || echo "  FAILED: $f"
  done
else
  echo "Store has $N triples — skipping seed."
fi

echo "Fuseki running on :3030 (read: /stadia/sparql, write: auth required)."
wait $PID
