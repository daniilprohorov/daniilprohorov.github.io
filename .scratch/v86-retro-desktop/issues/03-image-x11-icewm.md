# 03: Образ с X11, IceWM и `open-webapp`

**What to build:** Пересобранный образ Tiny Core грузится в v86 сразу в X11 со стандартным IceWM (меню и панель задач, без тем). Все пакеты вшиты в образ. Есть терминал и гостевой скрипт `open-webapp <id>`, который пишет `OPEN:<id>` в `/dev/ttyS0`.

**Blocked by:** 01 (параллельно с 02)

**Status:** done

- [x] `/` загружает рабочий стол IceWM с меню и панелью задач
- [x] Загрузка не требует сети
- [x] Терминал открывается из меню
- [x] `open-webapp bike-geometry` в терминале выдаёт `OPEN:bike-geometry` на COM-порт
- [x] Размер образа записан в отчёт

Готово: `tools/image/build.sh` собирает `images/vmlinuz` + `images/desktop.gz` (core.gz + Xvesa/IceWM/aterm с зависимостями), `desktop.js` грузит их с 256 МБ RAM; `open-webapp` и хук загрузки в `tools/image/overlay/`; размеры в `../report.md`.
