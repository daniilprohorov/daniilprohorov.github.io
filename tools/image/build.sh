#!/bin/sh
# Builds the guest image for the desktop on `/`:
#   images/vmlinuz     - kernel of the official 32-bit Tiny Core Core-17.1.iso
#   images/desktop.gz  - its core.gz with X11 (Xvesa), IceWM, aterm and all their
#                        dependencies appended as a second cpio archive, so the
#                        guest boots straight into IceWM without any network.
# Needs: sh, curl, bsdtar (libarchive), unsquashfs (squashfs-tools), gzip, awk.
set -eu

VERSION=17.1
MIRROR=http://tinycorelinux.net/17.x/x86
ISO=Core-$VERSION.iso
ISO_MD5=8d5efae4cbf4ba463fa012d29e58918e
EXTENSIONS="Xvesa icewm aterm"
# Fixed mtime for everything in the appended archive (2025-07-16, the core.gz date).
EPOCH=1752624000

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OVERLAY=$ROOT/tools/image/overlay
WORK=$(mktemp -d)
trap 'chmod -R u+w "$WORK"; rm -rf "$WORK"' EXIT
STAGE=$WORK/stage
TCZ=$WORK/tcz
mkdir -p "$STAGE" "$TCZ"

md5_of() {
  if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

fetch() { # fetch <url> <file> <md5>
  curl -fsS -o "$2" "$1"
  actual=$(md5_of "$2")
  [ "$actual" = "$3" ] || { echo "MD5 mismatch for $1: $actual" >&2; exit 1; }
}

# Kernel and base initrd from the official ISO.
fetch "$MIRROR/release/$ISO" "$WORK/$ISO" "$ISO_MD5"
bsdtar -xf "$WORK/$ISO" -C "$WORK" boot/vmlinuz boot/core.gz

# Resolve extension dependencies depth-first: the order tce-load installs them in.
ORDER=
resolve() {
  case " $ORDER " in *" $1 "*) return ;; esac
  case $1 in *KERNEL*) echo "kernel-specific extension $1 is not supported" >&2; exit 1 ;; esac
  status=$(curl -sS -o "$TCZ/$1.tcz.dep" -w '%{http_code}' "$MIRROR/tcz/$1.tcz.dep")
  case $status in
    200) ;;
    404) : >"$TCZ/$1.tcz.dep" ;;
    *) echo "HTTP $status for $1.tcz.dep" >&2; exit 1 ;;
  esac
  for dep in $(tr -d '\r' <"$TCZ/$1.tcz.dep"); do resolve "${dep%.tcz}"; done
  ORDER="$ORDER $1"
}
for ext in $EXTENSIONS; do resolve "$ext"; done

# Unpack every extension into one tree. An unprivileged unpack loses owners and
# setuid bits, so the metadata is taken from the squashfs listings instead.
LISTING=$WORK/listing
: >"$LISTING"
for ext in $ORDER; do
  curl -fsS -o "$TCZ/$ext.tcz.md5.txt" "$MIRROR/tcz/$ext.tcz.md5.txt"
  fetch "$MIRROR/tcz/$ext.tcz" "$TCZ/$ext.tcz" "$(cut -d' ' -f1 "$TCZ/$ext.tcz.md5.txt")"
  unsquashfs -n -f -no-xattrs -d "$STAGE" "$TCZ/$ext.tcz" >/dev/null
  unsquashfs -lln -d '' "$TCZ/$ext.tcz" >>"$LISTING"
  # tce-load marks every installed extension in tce.installed, script or not.
  if [ ! -e "$STAGE/usr/local/tce.installed/$ext" ]; then
    mkdir -p "$STAGE/usr/local/tce.installed"
    : >"$STAGE/usr/local/tce.installed/$ext"
    echo "-rwxrwxr-x 0/50 0 - - /usr/local/tce.installed/$ext" >>"$LISTING"
  fi
done
# The boot hook runs the extensions' install scripts in this order.
mkdir -p "$STAGE/usr/local/etc"
printf '%s\n' $ORDER >"$STAGE/usr/local/etc/desktop-extensions.lst"
echo "-rw-r--r-- 0/0 0 - - /usr/local/etc/desktop-extensions.lst" >>"$LISTING"

# Our own files (open-webapp, boot hook), owned by root.
for path in $(cd "$OVERLAY" && find . -type f | sed 's|^\.||'); do
  mkdir -p "$(dirname "$STAGE$path")"
  cp "$OVERLAY$path" "$STAGE$path"
  if [ -x "$OVERLAY$path" ]; then mode=-rwxr-xr-x; else mode=-rw-r--r--; fi
  echo "$mode 0/0 0 - - $path" >>"$LISTING"
done

# Paths core.gz already has: its directories keep their owner and mode.
gzip -dc "$WORK/boot/core.gz" | bsdtar -tf - | sed 's|^\./||; s|/$||; s|^|/|' >"$WORK/core-paths"
# The listing as an mtree manifest; the last entry for a path wins.
awk -v stage="$STAGE" -v epoch="$EPOCH" '
  function octal(perm,   m, i, c) {
    m = 0
    for (i = 2; i <= 10; i++) {
      c = substr(perm, i, 1)
      if (c != "-" && c != "S" && c != "T") m += 2 ^ (10 - i)
    }
    if (substr(perm, 4, 1) ~ /[sS]/) m += 2048
    if (substr(perm, 7, 1) ~ /[sS]/) m += 1024
    if (substr(perm, 10, 1) ~ /[tT]/) m += 512
    return sprintf("%o", m)
  }
  function fail(msg) { print msg > "/dev/stderr"; failed = 1; exit 1 }
  FNR == NR { core[$0] = 1; next }
  $6 == "" { next }
  {
    path = $6
    if (path ~ /[\\#]/) fail("unsupported path " path)
    split($2, owner, "/")
    type = substr($1, 1, 1)
    attrs = "uid=" owner[1] " gid=" owner[2] " mode=" octal($1) " time=" epoch
    if (type == "d") { if (!(path in core)) entry[path] = "type=dir " attrs }
    else if (type == "-") entry[path] = "type=file " attrs " contents=" stage path
    else if (type == "l" && $7 == "->" && NF == 8) entry[path] = "type=link " attrs " link=" $8
    else fail("unsupported entry " $0)
  }
  END {
    if (failed) exit 1
    for (p in entry) {
      parent = p; sub(/\/[^\/]*$/, "", parent)
      if (parent != "" && !(parent in entry) && !(parent in core)) fail("no parent directory for " p)
      print "." p " " entry[p]
    }
  }
' "$WORK/core-paths" "$LISTING" >"$WORK/entries"
{ echo "#mtree"; LC_ALL=C sort "$WORK/entries"; } >"$WORK/overlay.mtree"

(cd "$WORK" && bsdtar -cf - --format newc @overlay.mtree) | gzip -9n >"$WORK/overlay.gz"

mkdir -p "$ROOT/images"
cp "$WORK/boot/vmlinuz" "$ROOT/images/vmlinuz"
# The kernel unpacks concatenated initramfs archives in order.
cat "$WORK/boot/core.gz" "$WORK/overlay.gz" >"$ROOT/images/desktop.gz"
chmod 644 "$ROOT/images/vmlinuz" "$ROOT/images/desktop.gz"
echo "extensions:$ORDER"
ls -l "$ROOT/images"
