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
