# Отчёт о выполнении: v86 retro desktop

## 01: Голый v86 загружает Tiny Core на `/`

Гость: официальный 32-битный Tiny Core `Core-17.1.iso` (MD5 `8d5efae4cbf4ba463fa012d29e58918e`); из ISO взяты только `boot/vmlinuz` и `boot/core.gz` (`tools/image/fetch-core.sh`), v86 грузит их напрямую (bzimage + initrd), без 30-секундного приглашения isolinux. Командная строка ядра: `console=ttyS0 console=tty0 loglevel=3 base norestore noswap`.

v86: релиз `latest` с GitHub (коммит `6db8b157974dbaf1b54d2c2ec12dd71ddc1891e9`, 2026-10-04), BIOS из `bios/` того же репозитория.

Файлы, загружаемые `/` (байты, без сжатия при передаче):

| Файл | Размер |
|---|---:|
| `index.html` | 865 |
| `desktop.js` | 480 |
| `v86/libv86.js` | 359 825 |
| `v86/v86.wasm` | 2 007 347 |
| `v86/seabios.bin` | 131 072 |
| `v86/vgabios.bin` | 36 352 |
| `images/vmlinuz` | 6 115 840 |
| `images/core.gz` | 14 122 569 |
| **v86 (эмулятор + BIOS)** | **2 534 596 (2.42 MiB)** |
| **Образ (ядро + initrd)** | **20 238 409 (19.30 MiB)** |
| **Итого `/`** | **22 774 350 (21.72 MiB)** |

Загрузка до приглашения `tc@box:~$` в headless Chromium (Playwright): весь набор из 3 тестов проходит за ~12 с. Все запросы `/` — к своему origin; `.tcz` не запрашиваются. Проверено вручную: `echo hi > /dev/ttyS0` из гостя приходит в событие `serial0-output-byte`.

Тесты: `npm install && npx playwright install chromium && npm test`.

## 02: Мост COM-порта и белый список

`desktop.js` подписан на `serial0-output-byte`: байты собираются в строку до `\n`, `\r` выбрасывается, строки длиннее 256 байт отбрасываются целиком (до следующего `\n`). Строка сверяется с `^OPEN:(.+)$`, ID ищется в замороженном белом списке `APP_ROUTES` (`bike-geometry → /bikeGeometry/`) через `Object.hasOwn` (поэтому `__proto__`/`toString` не срабатывают), затем `window.location.assign(route)`. Всё прочее игнорируется. Скрипт гостя `open-webapp` — задача 03.

Тесты `tests/serial.spec.js` (4 шт., ~45 с): команды печатаются в консоль гостя через `emulator.keyboard_send_text` (`echo … > /dev/ttyS0`, sudo не нужен). Позитив: `OPEN:bike-geometry` → URL `/bikeGeometry/`, `#root` не пуст. Негативы (неизвестные ID, `__proto__`, регистр; URL `https://evil.example/`, `/bikeGeometry/`, `javascript:`; префиксы/пробелы, `open:`, пустой `OPEN:`, строка, склеенная из двух `printf`, 4 КиБ `/dev/urandom`, `dmesg`, плюс вывод ядра при загрузке): после маркерной строки, пришедшей по порту, вкладка остаётся на `/`, а сам лог порта подтверждает, что строки дошли.

## 03: Образ с X11, IceWM и `open-webapp`

Сборка: `tools/image/build.sh` (заменяет `fetch-core.sh`). Берёт `vmlinuz` и `core.gz` из официального `Core-17.1.iso` (MD5), рекурсивно разрешает `.dep` для `Xvesa icewm aterm` в официальном репозитории 17.x x86 (57 расширений, каждое проверяется по `.md5.txt`) и дописывает к `core.gz` второй gzip-cpio с их содержимым и `tools/image/overlay/` → `images/desktop.gz`; ядро распаковывает оба архива подряд. Владельцы/права/setuid (Xvesa) берутся из листингов squashfs и пишутся через mtree, root не нужен. Docker-демон на машине сборки не был запущен, поэтому собрано на хосте (macOS: `brew install squashfs`, системный `bsdtar`); команда для Docker — в `tools/image/README.md` (не прогонялась).

При загрузке `overlay/opt/bootsync.sh` выполняет скрипты `tce.installed` в порядке зависимостей (как `tce-load`) и даёт `chmod 666 /dev/ttyS0`; автологин на tty1 запускает `startx` → Xvesa 1024x768x32 + стандартный IceWM из пакета TC (панель сверху, обои TC, без своих тем). Терминал — первый пункт меню IceWM `xterm` (aterm). `open-webapp <id>` = `printf 'OPEN:%s\n' "$1" > /dev/ttyS0`.

`desktop.js`: initrd `images/desktop.gz`, `memory_size` 128 → 256 МБ (при 128 МБ initramfs не помещается: `incomplete write (-28)`). VGA 8 МБ хватает.

Проверено вручную в headless Chromium (Playwright-скрипт): рабочий стол IceWM появляется через ~22–26 с после открытия `/`; Ctrl+Esc → Enter открывает aterm; `open-webapp bike-geometry` в нём выдаёт `OPEN:bike-geometry` на COM1, и мост переводит вкладку на `/bikeGeometry/`. Сеть при загрузке не используется (запросов `.tcz` нет — образ один файл).

| Файл | Размер |
|---|---:|
| `index.html` | 865 |
| `desktop.js` | 1 471 |
| `v86/` (эмулятор + BIOS) | 2 534 596 |
| `images/vmlinuz` | 6 115 840 |
| `images/desktop.gz` (`core.gz` 14 122 569 + расширения 9 870 011) | 23 992 580 |
| **Образ (ядро + initrd)** | **30 108 420 (28.71 MiB)** |
| **Итого `/`** | **32 645 352 (31.13 MiB)** |
