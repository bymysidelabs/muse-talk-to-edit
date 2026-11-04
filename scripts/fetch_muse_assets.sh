#!/bin/sh
# Official Muse avatar clips and icons used by the /muse demo screen, downloaded
# from muse.ai at run time. They belong to Meta and are not committed here.
set -e
cd "$(dirname "$0")/../public" && mkdir -p muse-assets && cd muse-assets
for p in videos/avatars/hatch_working.mp4 videos/avatars/hatch_connecting.mp4 images/landing/brand/muse-logo.svg images/landing/icons/icon-piggybank@2x.webp; do
  curl -sfL -A "Mozilla/5.0" -o "$(basename "$p")" "https://muse.ai/$p" && echo "muse-assets/$(basename "$p")"
done
