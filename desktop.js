"use strict";

// App ID -> route. The only navigation targets the guest can request.
const APP_ROUTES = Object.freeze({
    "bike-geometry": "/bikeGeometry/",
});

const OPEN_LINE = /^OPEN:(.+)$/;
const MAX_LINE_LENGTH = 256;

window.emulator = new V86({
    wasm_path: "/v86/v86.wasm",
    bios: { url: "/v86/seabios.bin" },
    vga_bios: { url: "/v86/vgabios.bin" },
    bzimage: { url: "/images/vmlinuz" },
    initrd: { url: "/images/desktop.gz" },
    // xvesa=: Tiny Core boot option, substituted into ~/.xsession.
    cmdline: "console=ttyS0 console=tty0 loglevel=3 base norestore noswap xvesa=800x600x16",
    memory_size: 256 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: document.getElementById("screen_container"),
    autostart: true,
});

// Without pointer lock the host cursor and the guest cursor drift apart: the
// guest only gets relative deltas. Clicking the screen captures the mouse
// (Esc releases it).
document.getElementById("screen_container").addEventListener("click", () => {
    if (document.pointerLockElement === null) window.emulator.lock_mouse();
});

function handleSerialLine(line) {
    const match = OPEN_LINE.exec(line);
    if (!match || !Object.hasOwn(APP_ROUTES, match[1])) return;
    window.location.assign(APP_ROUTES[match[1]]);
}

let serialLine = "";
let serialLineOverflow = false;

window.emulator.add_listener("serial0-output-byte", (byte) => {
    if (byte === 0x0a) {
        if (!serialLineOverflow) handleSerialLine(serialLine);
        serialLine = "";
        serialLineOverflow = false;
    } else if (byte === 0x0d || serialLineOverflow) {
        // CR is stripped; bytes of an overlong line are dropped until LF.
    } else if (serialLine.length >= MAX_LINE_LENGTH) {
        serialLine = "";
        serialLineOverflow = true;
    } else {
        serialLine += String.fromCharCode(byte);
    }
});
