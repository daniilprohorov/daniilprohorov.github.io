#!/bin/sh
# Fetches the 32-bit Tiny Core "Core" ISO, verifies its MD5 and extracts the
# kernel and initrd into images/ for v86 to boot directly (no isolinux prompt).
set -eu

VERSION=17.1
ISO=Core-$VERSION.iso
MD5=8d5efae4cbf4ba463fa012d29e58918e
URL=http://tinycorelinux.net/17.x/x86/release/$ISO

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'chmod -R u+w "$WORK"; rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/$ISO" "$URL"

if command -v md5sum >/dev/null; then
  actual=$(md5sum "$WORK/$ISO" | cut -d' ' -f1)
else
  actual=$(md5 -q "$WORK/$ISO")
fi
[ "$actual" = "$MD5" ] || { echo "MD5 mismatch: $actual" >&2; exit 1; }

bsdtar -xf "$WORK/$ISO" -C "$WORK" boot/vmlinuz boot/core.gz
mkdir -p "$ROOT/images"
cp "$WORK/boot/vmlinuz" "$ROOT/images/vmlinuz"
cp "$WORK/boot/core.gz" "$ROOT/images/core.gz"
chmod 644 "$ROOT/images/vmlinuz" "$ROOT/images/core.gz"
ls -l "$ROOT/images"
