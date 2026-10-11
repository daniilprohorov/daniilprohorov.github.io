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

  // Декоративный счётчик посетителей: +1 за каждый час с 22.08.2025 (≈10 000 в октябре 2026), считается один раз при загрузке.
  function counter(el) {
    const hours = Math.floor((Date.now() - Date.UTC(2025, 7, 22)) / 3600000);
    el.textContent = String(hours).padStart(7, "0");
  }

  function init() {
    document.querySelectorAll("[data-clock]").forEach(clock);
    document.querySelectorAll("[data-calendar]").forEach(calendar);
    document.querySelectorAll("[data-counter]").forEach(counter);
    const ws = document.querySelectorAll("[data-weather]");
    const load = () => ws.forEach(weather);
    if (ws.length) { load(); setInterval(load, 30 * 60 * 1000); }
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
