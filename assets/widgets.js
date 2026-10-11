// Общие виджеты для всех вариантов: часы МСК, календарь МСК, погода СПб (Open-Meteo).
(() => {
  const TZ = "Europe/Moscow";
  const SPB = { lat: 59.94, lon: 30.31 };

  function mskParts(d = new Date()) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ, year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
      }).formatToParts(d).map(x => [x.type, +x.value])
    );
    return p; // year, month, day, hour, minute, second
  }

  function clock(el) {
    const ns = "http://www.w3.org/2000/svg";
    let ticks = "";
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0;
      ticks += `<line x1="50" y1="${big ? 8 : 10}" x2="50" y2="14" stroke-width="${big ? 2.5 : 1}" transform="rotate(${i * 6} 50 50)"/>`;
    }
    let nums = "";
    for (let h = 1; h <= 12; h++) {
      const a = (h * 30 - 90) * Math.PI / 180;
      nums += `<text x="${50 + 29 * Math.cos(a)}" y="${50 + 29 * Math.sin(a) + 3.5}">${h}</text>`;
    }
    el.innerHTML = `<svg xmlns="${ns}" viewBox="0 0 100 100" class="clock-svg">
      <circle cx="50" cy="50" r="47" class="clock-face"/>
      <g class="clock-ticks">${ticks}</g>
      <g class="clock-nums" text-anchor="middle" font-size="10">${nums}</g>
      <line class="clock-h" x1="50" y1="50" x2="50" y2="28" stroke-width="4" stroke-linecap="round"/>
      <line class="clock-m" x1="50" y1="50" x2="50" y2="18" stroke-width="2.5" stroke-linecap="round"/>
      <line class="clock-s" x1="50" y1="56" x2="50" y2="14" stroke-width="1"/>
      <circle cx="50" cy="50" r="2.5" class="clock-pin"/>
    </svg><div class="clock-label">МСК</div>`;
    const [h, m, s] = ["h", "m", "s"].map(k => el.querySelector(".clock-" + k));
    const tick = () => {
      const t = mskParts();
      s.setAttribute("transform", `rotate(${t.second * 6} 50 50)`);
      m.setAttribute("transform", `rotate(${t.minute * 6 + t.second / 10} 50 50)`);
      h.setAttribute("transform", `rotate(${(t.hour % 12) * 30 + t.minute / 2} 50 50)`);
      el.querySelector(".clock-label").textContent =
        `МСК ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

  function calendar(el) {
    const t = mskParts();
    const first = (new Date(Date.UTC(t.year, t.month - 1, 1)).getUTCDay() + 6) % 7; // пн = 0
    const days = new Date(Date.UTC(t.year, t.month, 0)).getUTCDate();
    let html = `<table class="cal"><caption>${MONTHS[t.month - 1]} ${t.year}</caption><tr>`;
    html += ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d, i) => `<th${i > 4 ? ' class="we"' : ""}>${d}</th>`).join("") + "</tr><tr>";
    for (let i = 0; i < first; i++) html += "<td></td>";
    for (let d = 1; d <= days; d++) {
      const col = (first + d - 1) % 7;
      const cls = [d === t.day ? "today" : "", col > 4 ? "we" : ""].filter(Boolean).join(" ");
      html += `<td${cls ? ` class="${cls}"` : ""}>${d}</td>`;
      if (col === 6 && d < days) html += "</tr><tr>";
    }
    el.innerHTML = html + "</tr></table>";
  }

  const WMO = {
    0: ["Ясно", "☀"], 1: ["Преимущественно ясно", "🌤"], 2: ["Переменная облачность", "⛅"], 3: ["Пасмурно", "☁"],
    45: ["Туман", "🌫"], 48: ["Изморозь", "🌫"], 51: ["Морось", "🌦"], 53: ["Морось", "🌦"], 55: ["Сильная морось", "🌧"],
    61: ["Небольшой дождь", "🌦"], 63: ["Дождь", "🌧"], 65: ["Ливень", "🌧"], 66: ["Ледяной дождь", "🌧"], 67: ["Ледяной дождь", "🌧"],
    71: ["Небольшой снег", "🌨"], 73: ["Снег", "🌨"], 75: ["Снегопад", "❄"], 77: ["Снежная крупа", "🌨"],
    80: ["Ливневый дождь", "🌦"], 81: ["Ливневый дождь", "🌧"], 82: ["Сильный ливень", "⛈"],
    85: ["Снежный заряд", "🌨"], 86: ["Снежный заряд", "❄"], 95: ["Гроза", "⛈"], 96: ["Гроза с градом", "⛈"], 99: ["Гроза с градом", "⛈"],
  };

  async function weather(el) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${SPB.lat}&longitude=${SPB.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&wind_speed_unit=ms&timezone=Europe%2FMoscow`;
    try {
      const c = (await (await fetch(url)).json()).current;
      const [text, icon] = WMO[c.weather_code] ?? ["—", "?"];
      const sign = v => (v > 0 ? "+" : "") + Math.round(v);
      el.innerHTML = `<div class="w-city">Санкт-Петербург</div>
        <div class="w-main"><span class="w-icon">${icon}</span> <span class="w-temp">${sign(c.temperature_2m)}°C</span></div>
        <div class="w-text">${text}</div>
        <div class="w-extra">ощущается ${sign(c.apparent_temperature)}° · ветер ${Math.round(c.wind_speed_10m)} м/с · влажн. ${c.relative_humidity_2m}%</div>`;
    } catch {
      el.innerHTML = `<div class="w-city">Санкт-Петербург</div><div class="w-text">нет данных</div>`;
    }
  }

  // Курсы ЦБ РФ к рублю (cbr-xml-daily.ru, без ключа, CORS разрешён); номинал как у ЦБ (иена — за 100).
  const RATES = [["USD", "🇺🇸", "$"], ["EUR", "🇪🇺", "€"], ["CNY", "🇨🇳", "¥ CNY"], ["JPY", "🇯🇵", "¥ JPY"]];
  async function rates(el) {
    try {
      const d = await (await fetch("https://www.cbr-xml-daily.ru/daily_json.js")).json();
      const rows = RATES.map(([code, flag, sign]) => {
        const v = d.Valute[code];
        const arrow = v.Value > v.Previous ? "▲" : v.Value < v.Previous ? "▼" : "";
        return `<tr><td>${flag}</td><td>${v.Nominal > 1 ? v.Nominal + " " : ""}${sign}</td><td class="r-val">${v.Value.toFixed(2)} ₽</td><td class="${v.Value > v.Previous ? "r-up" : "r-down"}">${arrow}</td></tr>`;
      }).join("");
      const date = new Date(d.Date).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
      el.innerHTML = `<table class="rates">${rows}</table><div class="r-date">ЦБ РФ на ${date}</div>`;
    } catch {
      el.innerHTML = `<div class="r-date">нет данных</div>`;
    }
  }

  // Декоративный счётчик посетителей: +1 за каждый час с 22.08.2025 (≈10 000 в октябре 2026), считается один раз при загрузке.
  function counter(el) {
    const hours = Math.floor((Date.now() - Date.UTC(2025, 7, 22)) / 3600000);
    el.textContent = String(hours).padStart(7, "0");
  }

  // MD5 (RFC 1321) от UTF-8 байтов строки; Web Crypto MD5 не поддерживает.
  function md5(str) {
    const bytes = new TextEncoder().encode(str);
    const n = ((bytes.length + 8) >> 6) + 1, w = new Uint32Array(n * 16);
    bytes.forEach((b, i) => { w[i >> 2] |= b << ((i % 4) * 8); });
    w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    w[n * 16 - 2] = bytes.length * 8;
    w[n * 16 - 1] = Math.floor(bytes.length / 0x20000000);
    const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let o = 0; o < w.length; o += 16) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        const r = i >> 4;
        const f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
        const g = r === 0 ? i : r === 1 ? (5 * i + 1) % 16 : r === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
        const s = S[r * 4 + (i % 4)], t = (a + f + K[i] + w[o + g]) | 0;
        a = d; d = c; c = b; b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    return [a0, b0, c0, d0].map(x => Array.from({ length: 4 }, (_, k) => ((x >>> (k * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
  }

  function md5Widget(el) {
    el.innerHTML = `<input class="md5-in" type="text" placeholder="введите строку"><div class="md5-out"></div>`;
    const input = el.querySelector(".md5-in"), out = el.querySelector(".md5-out");
    const update = () => { out.textContent = md5(input.value); };
    input.addEventListener("input", update);
    update();
  }

  // Посты блога из Telegram-канала: blog/posts.json (собирает scripts/tg_blog.py), по 5 на страницу, страница в хэше #blog/<N>.
  const BLOG_PER_PAGE = 5;
  async function blog(el) {
    let posts;
    try {
      posts = await (await fetch(el.dataset.blog)).json();
    } catch {
      el.textContent = "нет данных";
      return;
    }
    const render = () => {
      const m = location.hash.match(/^#blog(?:\/(\d+))?$/);
      if (!m) return;
      const pages = Math.max(1, Math.ceil(posts.length / BLOG_PER_PAGE));
      const cur = Math.min(Math.max(+(m[1] || 1), 1), pages);
      const items = posts.slice((cur - 1) * BLOG_PER_PAGE, cur * BLOG_PER_PAGE).map(p => {
        const date = new Date(p.date).toLocaleString("ru-RU", { timeZone: TZ, dateStyle: "long", timeStyle: "short" });
        const photos = p.photos.filter(src => !src.startsWith("http")).map(src => `<img src="./${src}" alt="" loading="lazy">`).join("");
        return `<div class="post"><div class="post-date"><a href="https://t.me/${p.id}" target="_blank" rel="noopener">${date}</a></div>${photos}<div class="post-text">${p.html}</div></div>`;
      }).join("") || "<p>Пока пусто</p>";
      const nav = pages < 2 ? "" : `<div class="pager">` +
        (cur > 1 ? `<a href="#blog/${cur - 1}">« назад</a>` : "") +
        Array.from({ length: pages }, (_, i) => i + 1 === cur ? `<b>${i + 1}</b>` : `<a href="#blog/${i + 1}">${i + 1}</a>`).join("") +
        (cur < pages ? `<a href="#blog/${cur + 1}">вперёд »</a>` : "") + `</div>`;
      el.innerHTML = items + nav;
    };
    render();
    addEventListener("hashchange", render);
  }

  function init() {
    document.querySelectorAll("[data-clock]").forEach(clock);
    document.querySelectorAll("[data-calendar]").forEach(calendar);
    document.querySelectorAll("[data-counter]").forEach(counter);
    document.querySelectorAll("[data-md5]").forEach(md5Widget);
    document.querySelectorAll("[data-blog]").forEach(blog);
    const rs = document.querySelectorAll("[data-rates]");
    if (rs.length) { const loadRates = () => rs.forEach(rates); loadRates(); setInterval(loadRates, 60 * 60 * 1000); }
    const ws = document.querySelectorAll("[data-weather]");
    const load = () => ws.forEach(weather);
    if (ws.length) { load(); setInterval(load, 30 * 60 * 1000); }
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
