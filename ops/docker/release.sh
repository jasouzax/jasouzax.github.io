#!/bin/sh
# Release a multi-platform image through a loopback-only staging registry, then publish verified objects to R2.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
tag=${1:-$(git rev-parse --short=12 HEAD)}
storage=${JAZU_REGISTRY_STORAGE:-$HOME/jazu-registry}
case "$tag" in *[!a-zA-Z0-9_.-]*|'') printf '%s\n' 'Invalid image tag' >&2; exit 2;; esac
mkdir -p "$storage"
if ! docker container inspect jazu-image-registry >/dev/null 2>&1; then
    docker run -d --name jazu-image-registry --restart unless-stopped -p 127.0.0.1:5000:5000 -v "$storage:/var/lib/registry" registry:3
fi
docker buildx build --platform linux/arm64,linux/amd64 --provenance=false --build-arg "JAZU_REVISION=$(git rev-parse HEAD)" --tag "localhost:5000/jazu:$tag" --push .
node --env-file=.env ops/docker/publish_registry.ts "$storage"
printf 'Published registry.jasouza.com/jazu:%s\n' "$tag"
