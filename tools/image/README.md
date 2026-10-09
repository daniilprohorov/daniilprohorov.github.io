# Guest image

`build.sh` builds the two files v86 boots on `/` (kernel + initrd, no isolinux prompt):

- `images/vmlinuz` — the kernel from the official 32-bit Tiny Core `Core-17.1.iso` (MD5-checked).
- `images/desktop.gz` — the ISO's `core.gz` followed by a second gzipped cpio archive with the
  extensions `Xvesa`, `icewm`, `aterm`, `flaxpdf` (PDF viewer), `idesk` (desktop icons) and all
  their dependencies (resolved from the `.dep` files of the official 17.x x86 repository, each
  `.tcz` MD5-checked) plus `overlay/` and `assets/cv.pdf` as `/usr/local/share/cv/cv.pdf`. The
  kernel unpacks both archives, so nothing is downloaded at boot. Changing `assets/cv.pdf` needs
  a rebuild.

Boot flow in the guest: `overlay/opt/bootsync.sh` runs the extensions' `tce.installed` scripts in
dependency order (what `tce-load` would do: `Xserver`, `desktop`, IceWM menus, caches) and opens
`/dev/ttyS0` to the desktop user; then autologin on tty1 runs `startx`, which starts Xvesa
(1024x768x32) with stock IceWM. `overlay/usr/local/share/icewm/` replaces the stock example `menu`
and `toolbar` (they list programs the image lacks): both hold only `Bike Geometry`
(`open-webapp bike-geometry`) and `xterm` (aterm); `preferences` keeps the stock Tiny Core values
but puts the taskbar at the bottom and hides the built-in Settings submenu and the Help item.
At login IceWM runs `overlay/usr/local/share/icewm/startup`: it turns off X pointer acceleration
(`xset m 1 1`, so v86's relative mouse deltas map 1:1), links the CV to `~/Desktop/cv.pdf` and
starts idesk. Its icons, opened by double-click: `overlay/etc/skel/.idesktop/cv.lnk` (the CV in
FlaxPDF) and `bike-geometry.lnk` (`open-webapp bike-geometry`, icon
`overlay/usr/local/share/pixmaps/bike-geometry.png`). The page locks the pointer on click on the
screen (Esc releases it).

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
