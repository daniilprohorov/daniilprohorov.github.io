"""Собирает посты публичного Telegram-канала из веб-превью t.me/s/<channel> в blog/posts.json.

Без ключей и аккаунта. Посты накапливаются: новые дописываются к уже сохранённым.
Если blog/posts.json ещё нет — выкачивается вся доступная история (?before=<id>).
Фото скачиваются в blog/img/, чтобы сайт не зависел от CDN Telegram.
"""
import html
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

CHANNEL = "daniilprohorov1"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "blog" / "posts.json"
IMG = ROOT / "blog" / "img"

# Разрешённая разметка текста поста; остальные теги отбрасываются, текст внутри остаётся.
ALLOWED = {"b", "strong", "i", "em", "u", "s", "del", "code", "pre", "blockquote", "a", "br"}
VOID = {"br", "img", "hr", "input", "meta", "link", "source", "wbr"}
BG_URL = re.compile(r"background-image:url\('([^']+)'\)")


class ChannelPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.posts = []
        self.post = None
        self.text_depth = 0  # >0 — внутри текста поста
        self.in_date = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if self.text_depth:
            if tag not in VOID:
                self.text_depth += 1
            if tag in ALLOWED:
                if tag == "a" and (a.get("href") or "").startswith(("http://", "https://")):
                    self.post["html"] += f'<a href="{html.escape(a["href"])}" target="_blank" rel="noopener">'
                elif tag != "a":
                    self.post["html"] += f"<{tag}>"
            return
        if tag == "div" and "tgme_widget_message" in cls and a.get("data-post"):
            self.post = {"id": a["data-post"], "date": "", "html": "", "photos": []}
            self.posts.append(self.post)
        elif not self.post:
            return
        elif tag == "div" and "js-message_text" in cls and not self.post["html"]:
            self.text_depth = 1
        elif tag == "a" and "tgme_widget_message_date" in cls:
            self.in_date = True
        elif tag == "time" and self.in_date and not self.post["date"]:
            self.post["date"] = a.get("datetime", "")
        elif tag == "a" and "tgme_widget_message_photo_wrap" in cls:
            m = BG_URL.search(a.get("style") or "")
            if m:
                self.post["photos"].append(m.group(1))

    def handle_startendtag(self, tag, attrs):
        if self.text_depth and tag == "br":
            self.post["html"] += "<br>"
        elif not self.text_depth:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "a":
            self.in_date = False
        if not self.text_depth or tag in VOID:
            return
        self.text_depth -= 1
        if self.text_depth and tag in ALLOWED:
            # Закрываем только то, что открыли: <a> без http-ссылки не выводился.
            if tag != "a" or self.post["html"].count("<a ") > self.post["html"].count("</a>"):
                self.post["html"] += f"</{tag}>"

    def handle_data(self, data):
        if self.text_depth:
            self.post["html"] += html.escape(data)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def page(before=None):
    url = f"https://t.me/s/{CHANNEL}" + (f"?before={before}" if before else "")
    p = ChannelPage()
    p.feed(fetch(url).decode("utf-8"))
    return [x for x in p.posts if x["html"] or x["photos"]]


def num(post):
    return int(post["id"].rsplit("/", 1)[1])


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else []
    fresh = page()
    if not old:  # первый запуск — вся история
        before = min(map(num, fresh), default=None)
        while before:
            older = page(before)
            if not older or min(map(num, older)) >= before:
                break
            fresh += older
            before = min(map(num, older))

    posts = {p["id"]: p for p in old}
    IMG.mkdir(parents=True, exist_ok=True)
    added = 0
    for p in fresh:
        if p["id"] in posts:  # уже есть — обновляем текст (пост могли отредактировать)
            posts[p["id"]]["html"] = p["html"]
            continue
        local = []
        for i, url in enumerate(p["photos"]):
            name = f"{num(p)}-{i}.jpg"
            (IMG / name).write_bytes(fetch(url))
            local.append(f"blog/img/{name}")
        p["photos"] = local
        posts[p["id"]] = p
        added += 1

    posts = sorted(posts.values(), key=num, reverse=True)
    OUT.write_text(json.dumps(posts, ensure_ascii=False, indent=1) + "\n")
    print(f"{added} new, {len(posts)} total", file=sys.stderr)


if __name__ == "__main__":
    main()
