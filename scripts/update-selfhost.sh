#!/bin/sh
set -eu

deployment_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deployment_dir"
mkdir -p .cache
# Serialize scheduled builds, without ever touching the data volume.
exec 9>.cache/selfhost-update.lock
flock -n 9 || exit 0
git diff --quiet --ignore-submodules=all HEAD -- || { echo 'Local changes found; update stopped.' >&2; exit 1; }
git submodule foreach --recursive 'git diff --quiet HEAD -- || exit 1'
git pull --ff-only
current_commit=$(git rev-parse HEAD)
deployed_commit=$(cat .cache/selfhost-deployed 2>/dev/null || true)
if [ "$deployed_commit" = "$current_commit" ]; then
    exit 0
fi
git submodule update --init --recursive
if [ -f .env.selfhost ]; then
    docker compose --env-file .env.selfhost --profile https up -d --build --wait --wait-timeout 120
else
    docker compose up -d --build --wait --wait-timeout 120
fi
printf '%s\n' "$current_commit" > .cache/selfhost-deployed.tmp
mv .cache/selfhost-deployed.tmp .cache/selfhost-deployed
echo "Updated deployment to $current_commit"
