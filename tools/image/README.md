# Guest image

`build.sh` builds the two files v86 boots on `/` (kernel + initrd, no isolinux prompt):

- `images/vmlinuz` — the kernel from the official 32-bit Tiny Core `Core-17.1.iso` (MD5-checked).
- `images/desktop.gz` — the ISO's `core.gz` followed by a second gzipped cpio archive with the
  extensions `Xvesa`, `icewm`, `aterm` and all their dependencies (resolved from the `.dep` files
  of the official 17.x x86 repository, each `.tcz` MD5-checked) plus `overlay/`. The kernel unpacks
  both archives, so nothing is downloaded at boot.

Boot flow in the guest: `overlay/opt/bootsync.sh` runs the extensions' `tce.installed` scripts in
dependency order (what `tce-load` would do: `Xserver`, `desktop`, IceWM menus, caches) and opens
`/dev/ttyS0` to the desktop user; then autologin on tty1 runs `startx`, which starts Xvesa
(1024x768x32) with stock IceWM. The first IceWM menu entry, `xterm`, opens aterm.

`overlay/usr/local/bin/open-webapp <id>` writes `OPEN:<id>` to `/dev/ttyS0`; the page maps the ID
to a route (see `desktop.js`).

The unpacked image needs more than half of 128 MB of RAM for the initramfs, so v86 runs with 256 MB.

## Building

Needs `sh`, `curl`, `bsdtar` (libarchive), `unsquashfs` (squashfs-tools), `gzip`, `awk`. No root:
owners, modes and setuid bits come from the squashfs listings and are written through an mtree
manifest. Every file of the appended archive gets the same mtime.

In Docker from the repo root:

```sh
docker run --rm -v "$PWD":/work -w /work alpine:3.20 \
  sh -c 'apk add --no-cache curl libarchive-tools squashfs-tools >/dev/null && sh tools/image/build.sh'
```

Or on the host, e.g. macOS: `brew install squashfs && sh tools/image/build.sh` (macOS ships
`bsdtar`).

## v86

`v86/` holds the v86 build from the GitHub `latest` release (commit
`6db8b157974dbaf1b54d2c2ec12dd71ddc1891e9`, 2026-10-04):

- `libv86.js`, `v86.wasm` — https://github.com/copy/v86/releases/tag/latest
- `seabios.bin`, `vgabios.bin` — https://github.com/copy/v86/tree/master/bios
