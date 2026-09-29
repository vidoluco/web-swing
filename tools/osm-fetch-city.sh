#!/bin/bash
# Fetches Bucharest in an 8x8 grid of small Overpass requests, with retries. Idempotent: cached tiles are skipped.
cd "$(dirname "$0")/.."
S0=44.33; W0=25.96; DLAT=0.02625; DLON=0.03375
for i in $(seq 0 7); do for j in $(seq 0 7); do
  name="t8_${i}_${j}"
  [ -f "data/raw/$name.json" ] && continue
  S=$(python3 -c "print(round($S0+$i*$DLAT,5))"); N=$(python3 -c "print(round($S0+($i+1)*$DLAT,5))")
  W=$(python3 -c "print(round($W0+$j*$DLON,5))"); E=$(python3 -c "print(round($W0+($j+1)*$DLON,5))")
  for attempt in 1 2 3 4; do
    if node tools/osm-fetch.mjs "$name" "$S" "$W" "$N" "$E" 2>&1 | grep -q "elements"; then echo "ok $name"; break; fi
    echo "retry $name ($attempt)"; sleep $((attempt * 20))
  done
  sleep 3
done; done
echo DONE
