# Guest image

`fetch-core.sh` downloads the official 32-bit Tiny Core `Core-17.1.iso`, checks its
MD5 and extracts `boot/vmlinuz` and `boot/core.gz` into `images/`. The page boots
them directly in v86 (kernel + initrd), skipping the ISO's 30-second isolinux prompt.

Reproduce in Docker from the repo root:

```sh
docker run --rm -v "$PWD":/work -w /work alpine:3.20 \
  sh -c 'apk add --no-cache curl libarchive-tools >/dev/null && sh tools/image/fetch-core.sh'
```

Or run `sh tools/image/fetch-core.sh` directly on a host with `curl` and `bsdtar`.

## v86

`v86/` holds the v86 build from the GitHub `latest` release (commit
`6db8b157974dbaf1b54d2c2ec12dd71ddc1891e9`, 2026-10-04):

- `libv86.js`, `v86.wasm` — https://github.com/copy/v86/releases/tag/latest
- `seabios.bin`, `vgabios.bin` — https://github.com/copy/v86/tree/master/bios
