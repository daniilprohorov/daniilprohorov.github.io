"use strict";

window.emulator = new V86({
    wasm_path: "/v86/v86.wasm",
    bios: { url: "/v86/seabios.bin" },
    vga_bios: { url: "/v86/vgabios.bin" },
    bzimage: { url: "/images/vmlinuz" },
    initrd: { url: "/images/core.gz" },
    cmdline: "console=ttyS0 console=tty0 loglevel=3 base norestore noswap",
    memory_size: 128 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: document.getElementById("screen_container"),
    autostart: true,
});
