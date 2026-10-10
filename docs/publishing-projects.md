# Публикация проектов через CI

Исходники и сборка живут в репозитории проекта. Его GitHub Actions собирает статический сайт и коммитит результат в отдельный каталог ветки `main` репозитория `daniilprohorov/daniilprohorov.github.io`. Этот репозиторий хранит готовые файлы, а не собирает проекты.

Рабочий пример: `../bikeCad/.github/workflows/publish.yml`. Он публикует `dist/` в `bikeGeometry/`; адрес приложения — https://daniilprohorov.github.io/bikeGeometry/.

## 1. Подготовить сборку проекта

Сборка должна выдавать статические файлы, включая `index.html`, например в `dist/`. Серверный процесс на GitHub Pages запустить нельзя.

Для Vite в bikeCad используется относительный base:

```ts
export default defineConfig({
  base: './',
  // Остальные настройки проекта.
});
```

Так ссылки на ресурсы работают внутри каталога проекта. Альтернатива для фиксированного маршрута — `base: '/myProject/'`. Не оставляйте ссылки на ресурсы вида `/assets/...`, если файлы будут лежать в `/myProject/assets/`.

Если приложение использует клиентский роутер, учтите: GitHub Pages не перенаправляет произвольные вложенные URL на `index.html`. Используйте hash-routing либо заранее генерируйте страницы по нужным путям.

## 2. Настроить доступ из CI к репозиторию сайта

Для каждого исходного репозитория создайте отдельный SSH deploy key. Пример команды на локальной машине (выберите свободное имя файла):

```sh
ssh-keygen -t ed25519 -C 'myProject GitHub Pages deploy' -f "$HOME/.ssh/myProject-pages" -N ''
```

Получатся два файла:

| Файл | Куда добавить |
| --- | --- |
| `~/.ssh/myProject-pages.pub` — публичный ключ | В репозиторий **сайта**: Settings → Deploy keys → Add deploy key; включить **Allow write access** |
| `~/.ssh/myProject-pages` — приватный ключ | В репозиторий **проекта**: Settings → Secrets and variables → Actions → New repository secret; имя **`PAGES_DEPLOY_KEY`** |

Страницы настроек:

- Deploy keys сайта: https://github.com/daniilprohorov/daniilprohorov.github.io/settings/keys
- Secret проекта: `https://github.com/<owner>/<project>/settings/secrets/actions`

В secret вставьте приватный ключ целиком, включая строки `BEGIN` и `END`. Не коммитьте ключи. Deploy key с правом записи даёт доступ ко всему репозиторию сайта, а не только к каталогу проекта; используйте его только в доверенных workflow.

Обычный `GITHUB_TOKEN` исходного репозитория не даёт права пушить в другой репозиторий. В рабочем примере поэтому используется `deploy_key`.

## 3. Добавить workflow в репозиторий проекта

Создайте `.github/workflows/publish.yml` **в исходном репозитории**, не в репозитории сайта. Ниже схема bikeCad с заменой каталога на `myProject`:

```yaml
name: Publish to GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build

      - uses: peaceiris/actions-gh-pages@v4
        with:
          deploy_key: ${{ secrets.PAGES_DEPLOY_KEY }}
          external_repository: daniilprohorov/daniilprohorov.github.io
          publish_branch: main
          publish_dir: ./dist
          destination_dir: myProject
          keep_files: true
          commit_message: "deploy myProject ${{ github.sha }}"
```

Что адаптировать:

| Параметр | Значение |
| --- | --- |
| `on.push.branches` | Ветка исходников: в bikeCad `master`; если у проекта `main`, укажите `main` |
| `node-version` | Версия Node, поддерживаемая проектом; в bikeCad — 22 |
| Команды установки, тестов и сборки | В примере npm и закоммиченный `package-lock.json`; для другого стека замените соответствующие шаги |
| `publish_dir` | Каталог результата сборки, не исходники |
| `destination_dir` | Уникальный каталог проекта в сайте, например `myProject`; не корень сайта |
| `commit_message` | Имя проекта для идентификации деплоя |

`publish_branch: main` относится к **репозиторию сайта** и не зависит от имени ветки исходников.

`keep_files: true` повторяет рабочий пример: новые файлы копируются поверх существующих, старые сохраняются. Поэтому устаревшие хешированные assets тоже останутся. Это не точная синхронизация каталога. По документации action, при `keep_files: false` удаление ограничено `destination_dir`, если он задан; такой режим используйте только осознанно, когда весь каталог принадлежит одной сборке. Не убирайте `destination_dir`: публикация в корень может перезаписать рабочий стол и другие файлы сайта.

## 4. Проверить настройки GitHub Pages

В репозитории сайта откройте https://github.com/daniilprohorov/daniilprohorov.github.io/settings/pages.

Для этой схемы публикации выберите **Deploy from a branch**, ветку **`main`**, каталог **`/ (root)`**. Если сайт уже публикуется так, ничего менять не нужно. Файл `.nojekyll` в корне этого репозитория уже есть.

## 5. Запустить и проверить

1. Закоммитьте workflow в исходный репозиторий и сделайте push в указанную ветку. Для ручного запуска используйте Actions → Publish to GitHub Pages → Run workflow; workflow должен находиться в default branch, чтобы ручной запуск был доступен.
2. Проверьте в Actions проекта успешное выполнение установки, тестов, сборки и публикации.
3. В репозитории сайта проверьте новый коммит `deploy myProject ...` в `main` и наличие `myProject/index.html` вместе с ресурсами сборки.
4. Дождитесь успешной публикации Pages в репозитории сайта.
5. Откройте `https://daniilprohorov.github.io/myProject/`, проверьте загрузку JS/CSS и работу приложения. Для bikeCad проверочный адрес — https://daniilprohorov.github.io/bikeGeometry/.

Успешный push сборки ещё не означает, что Pages уже обновился: это отдельный этап.

## Подключение к рабочему столу

Прямая ссылка на опубликованный проект работает без изменений рабочего стола. Чтобы запускать приложение из ретро-Linux, нужна отдельная интеграция: маршрут в `APP_ROUTES` файла `desktop.js` и пункт запуска в гостевой ОС, отправляющий `OPEN:<id>`. Сборка проекта через CI сама такую интеграцию не добавляет.

## Типичные ошибки

| Симптом | Что проверить |
| --- | --- |
| `Permission denied (publickey)` | Secret содержит приватный ключ; соответствующий публичный ключ добавлен в репозиторий сайта |
| Push отклонён | У deploy key включён write access; правила ветки `main` разрешают такой push |
| Workflow не запускается | Имя ветки в `on.push.branches` совпадает с веткой исходников; Actions разрешены в настройках проекта |
| `npm ci` падает | Есть актуальный `package-lock.json`, согласованный с `package.json` |
| HTML открывается, ресурсы дают 404 | `base` и пути ресурсов учитывают `destination_dir`; файлы ресурсов попали в сборку |
| Файлы есть в `main`, сайт не обновился | Настройки Pages и результат его отдельного деплоя |
| Параллельные публикации конфликтуют при push | Проверьте лог action; после завершения конкурирующего деплоя повторите неуспешный запуск. Workflow разных исходных репозиториев не имеют общей очереди |

Документация используемого action: https://github.com/peaceiris/actions-gh-pages/tree/v4#readme.
