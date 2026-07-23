#!/usr/bin/env bash
set -euo pipefail

npm ci
exec npm run web:dev
