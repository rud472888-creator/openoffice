#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
for editor in ipad-web ipad-sheets ipad-slides; do
  (
    cd "apps/$editor"
    npm run typecheck
    npm test
    npm run build
  )
done

node apps/ipad/scripts/notices.mjs
