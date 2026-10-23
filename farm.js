// ===== 센서 정의 =====
// read()는 아두이노가 연결된 적 없을 때 보여줄 예시 값
const rand = (min, max) => Math.round(min + Math.random() * (max - min));

const sensors = {
  soil: {
    title: "물+토양",
    label: "토양 수분", unit: "%", axis: "수분(%)",
    range: [40, 70], scale: [0, 100],
    read: () => rand(30, 75),
    judge: v => v < 40 ? ["bad", "물이 부족해요"] : v > 70 ? ["warn", "조금 축축해요"] : ["", "촉촉해요"],
    about: "흙 속 수분과 온도를 재서 작물이 목마르지 않은지 확인해요.",
    tips: ["적정 토양 수분: 40~70%", "토양 온도와 pH도 함께 확인하세요", "수분이 부족하면 자동 급수를 켜세요"]
  },
  gas: {
    title: "가스",
    label: "CO₂", unit: " ppm", axis: "CO₂(ppm)",
    range: [400, 1000], scale: [0, 1600],
    read: () => rand(350, 1300),
    judge: v => v > 1100 ? ["bad", "환기가 필요해요"] : v < 400 ? ["warn", "CO₂가 낮아요"] : ["", "공기가 좋아요"],
    about: "온실 안 이산화탄소와 유해가스 농도를 살펴 공기를 맑게 지켜요.",
    tips: ["적정 CO₂: 400~1000 ppm", "농도가 높으면 창문·환풍기를 열어주세요", "암모니아 등 유해가스도 모니터링해요"]
  },
  sun: {
    title: "햇빛",
    label: "조도", unit: " lux", axis: "조도(lux)",
    range: [10000, 50000], scale: [0, 60000],
    read: () => rand(5000, 60000),
    judge: v => v < 10000 ? ["warn", "빛이 부족해요"] : v > 50000 ? ["warn", "햇빛이 강해요"] : ["", "광합성 중"],
    about: "작물이 받는 빛의 양을 재서 광합성이 잘 되는지 확인해요.",
    tips: ["적정 조도: 10,000~50,000 lux", "흐린 날엔 보광등을 켜세요", "한낮엔 차광막으로 잎이 타는 걸 막아요"]
  },
  pest: {
    title: "해충",
    label: "오늘 감지", unit: "마리", axis: "해충(마리)",
    range: [0, 3], scale: [0, 16],
    read: () => rand(0, 12),
    judge: v => v > 8 ? ["bad", "방제가 필요해요"] : v > 3 ? ["warn", "주의해서 지켜봐요"] : ["", "깨끗해요"],
    about: "트랩 센서로 해충을 세어 피해가 커지기 전에 알려줘요.",
    tips: ["끈끈이 트랩·적외선 센서로 감지해요", "진딧물·응애·온실가루이를 주로 확인해요", "천적 곤충 방제도 고려해 보세요"]
  }
};

const fmt = v => v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const pad = n => String(n).padStart(2, "0");
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourKey = d => `${dayKey(d)}T${pad(d.getHours())}`;
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// ===== 데이터 저장소 =====
// 아두이노에서 받은 값은 시간별 평균으로 브라우저(localStorage)에 쌓아 두고 그래프에 씀
const HIST_KEY = "saengsaeng-history";
const LATEST_KEY = "saengsaeng-latest";

const store = {
  latest: {},        // 센서별 가장 최근 값
  lastTime: null,    // 마지막으로 실제 값을 받은 시각
  live: false,       // 지금 아두이노와 연결돼 있는지
  liveSince: 0,      // 연결된 시각
  source: "",        // 연결 방식 이름
  lastLine: ""       // 마지막으로 받은 원본 한 줄 (확인용)
};

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경이면 무시 */ }
}

let history = readJSON(HIST_KEY) || {};
const saved = readJSON(LATEST_KEY);
if (saved) { store.latest = saved.values || {}; store.lastTime = new Date(saved.time); }

const isDemo = () => !store.live && Object.keys(history).length === 0;

// 예시 값이 화면에 남아 있으면 지움 (실제 값과 섞이지 않도록)
function dropDemo() {
  if (!store.demoFilled) return;
  store.latest = {};
  store.demoFilled = false;
}

function recordReading(values) {
  dropDemo();
  const now = new Date();
  const bucket = history[hourKey(now)] ||= {};
  for (const [k, v] of Object.entries(values)) {
    const cell = bucket[k] ||= [0, 0];   // [합계, 개수]
    cell[0] += v;
    cell[1] += 1;
  }
  // 40일 지난 기록은 정리
  const cutoff = dayKey(new Date(now - 40 * 864e5));
  for (const k of Object.keys(history)) if (k.slice(0, 10) < cutoff) delete history[k];
  writeJSON(HIST_KEY, history);

  Object.assign(store.latest, values);
  store.lastTime = now;
  writeJSON(LATEST_KEY, { values: store.latest, time: now.getTime() });
  onData();
}

function clearHistory() {
  history = {};
  store.latest = {};
  store.lastTime = null;
  try { localStorage.removeItem(HIST_KEY); localStorage.removeItem(LATEST_KEY); } catch {}
  for (const k of Object.keys(seriesCache)) delete seriesCache[k];
  onData(true);
}

// 아두이노와 연결된 적이 없을 때만 예시 값을 흘려보냄
function demoTick() {
  if (!isDemo()) return;
  for (const [k, s] of Object.entries(sensors)) store.latest[k] = s.read();
  store.demoFilled = true;
  onData();
}

// ===== 화면 갱신 =====
let currentDetail = null;
let currentMode = "day";
let lastChartDraw = 0;
let lastWasDemo = isDemo();

function setStatus(badge, key, v) {
  if (v === undefined) {
    badge.className = "status";
    badge.textContent = "대기 중";
    return;
  }
  const [cls, text] = sensors[key].judge(v);
  badge.className = "status " + cls;
  badge.textContent = text;
}

function onData(forceChart = false) {
  refreshBlobs();
  updateConnUI();
  if (!currentDetail) return;
  updateDetailValue();
  const demoNow = isDemo();
  // 예시→실제로 바뀌었거나, 실제 값이 들어오는 중이면 30초마다 그래프 다시 그림
  if (forceChart || demoNow !== lastWasDemo || (!demoNow && Date.now() - lastChartDraw > 30000)) {
    drawHandChart(currentDetail, currentMode, false);
  }
  lastWasDemo = demoNow;
}

// 첫 화면: 각 섬의 값과 상태
function refreshBlobs() {
  for (const key of Object.keys(sensors)) {
    const valueEl = document.querySelector(`[data-v="${key}"]`);
    if (!valueEl) continue;
    const v = store.latest[key];
    valueEl.textContent = v === undefined ? "--" : fmt(v);
    setStatus(document.querySelector(`[data-s="${key}"]`), key, v);
  }
}

// 연결 상태 판단
// live: 연결됨 + 최근 10초 안에 데이터 받음 / wait: 연결은 됐는데 데이터가 안 옴
// off: 연결이 끊김 / demo: 한 번도 연결한 적 없음
const STALE_SEC = 10;

function connState() {
  if (store.live) {
    const gotData = store.lastTime && store.lastTime >= store.liveSince;
    const since = (Date.now() - (gotData ? store.lastTime : store.liveSince)) / 1000;
    if (gotData && since < STALE_SEC) {
      return { cls: "live", short: "실시간 연결됨",
               text: `아두이노와 연결됐어요 · ${Math.max(0, Math.round(since))}초 전에 받음`, action: "" };
    }
    return { cls: "wait", short: "데이터 기다리는 중",
             text: gotData
               ? `연결은 돼 있지만 ${Math.round(since)}초째 데이터가 안 와요 · 아두이노 전원과 배선을 확인해 주세요`
               : since < STALE_SEC ? "연결됐어요 · 첫 데이터를 기다리는 중…"
               : `연결은 됐지만 ${Math.round(since)}초째 데이터가 없어요 · 통신 속도(9600)와 배선을 확인해 주세요`,
             action: "" };
  }
  if (isDemo()) {
    return { cls: "demo", short: "예시 데이터",
             text: "아두이노가 연결되지 않아 예시 데이터를 보여주고 있어요", action: "연결하기" };
  }
  return { cls: "off", short: "연결 끊김",
           text: `아두이노 연결이 끊겼어요${store.lastTime ? ` · 마지막으로 받은 시각 ${clock(store.lastTime)}` : ""}`,
           action: "다시 연결" };
}

// 잠깐 떴다 사라지는 알림
function showToast(message, kind = "") {
  const box = document.getElementById("toast");
  if (!box) return;
  box.textContent = message;
  box.className = `toast show ${kind}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.className = `toast ${kind}`; }, 3500);
}

// 상단 연결 상태 표시
function updateConnUI() {
  const btn = document.getElementById("conn-open");
  const label = document.getElementById("conn-label");
  if (!btn) return;
  const st = connState();
  btn.className = `conn ${st.cls}`;
  label.textContent = st.short;

  const bar = document.getElementById("linkbar");
  if (bar) {
    bar.className = `linkbar ${st.cls}`;
    document.getElementById("linkbar-text").textContent = st.text;
    const act = document.getElementById("linkbar-action");
    act.textContent = st.action;
    act.hidden = !st.action;
  }

  const state = document.getElementById("panel-state");
  if (state) state.textContent = store.live ? `${store.source}(으)로 연결돼 있어요.` : "연결돼 있지 않아요.";
  const raw = document.getElementById("panel-raw");
  if (raw) raw.textContent = store.lastLine || "아직 받은 데이터가 없어요";
  const off = document.getElementById("btn-disconnect");
  if (off) off.disabled = !store.live;
}

// ===== 상세 화면 =====
function renderDetail(key) {
  const s = sensors[key];
  const blobClass = { soil: "b1", gas: "b2", sun: "b3", pest: "b4" }[key];
  const others = Object.entries(sensors)
    .filter(([k]) => k !== key)
    .map(([k, o]) => `<a href="#${k}">${o.title}</a>`).join("");

  currentDetail = key;
  currentMode = "day";
  document.title = `${s.title} · 생생팜`;
  document.getElementById("page").innerHTML = `
    <a class="back" href="#">← 농장으로 돌아가기</a>
    <div class="blob ${blobClass}">
      <span class="deco" style="top:16%;right:14%">🌴</span>
      <span class="deco small" style="bottom:12%;left:18%">🌱</span>
      <h2>${s.title}</h2>
      <div class="reading">${s.label} <strong id="now">--</strong>${s.unit}</div>
      <span class="status" id="status">대기 중</span>
      <span class="seen" id="seen"></span>
    </div>

    <div class="card">
      <h3>무엇을 보나요?</h3>
      <p>${s.about}</p>
    </div>

    <div class="card">
      <div class="card-head">
        <h3 id="chart-title">오늘의 변화</h3>
        <div class="toggle" role="group" aria-label="기간 선택">
          <button class="pill" data-mode="day" aria-pressed="true">🌱 하루</button>
          <button class="pill" data-mode="month" aria-pressed="false">🌸 한 달</button>
        </div>
      </div>
      <div class="chart-wrap">
        <svg viewBox="0 0 1000 700" id="chart" aria-label="${s.title} 변화 그래프"></svg>
      </div>
      <p style="font-size:16px;margin-top:6px"><span id="chart-caption"></span> 초록 띠는 적정 범위예요.</p>
    </div>

    <div class="card">
      <h3>관리 팁</h3>
      <ul>${s.tips.map(t => `<li>${t}</li>`).join("")}</ul>
    </div>

    <div class="others">${others}</div>
  `;

  // 하루 / 한 달 전환 버튼
  const pills = document.querySelectorAll(".pill");
  pills.forEach(btn => btn.addEventListener("click", () => {
    pills.forEach(b => b.setAttribute("aria-pressed", b === btn));
    currentMode = btn.dataset.mode;
    drawHandChart(key, currentMode);
  }));
  updateDetailValue();
  drawHandChart(key, "day");
}

function updateDetailValue() {
  const nowEl = document.getElementById("now");
  if (!nowEl) return;
  const v = store.latest[currentDetail];
  nowEl.textContent = v === undefined ? "--" : fmt(v);
  setStatus(document.getElementById("status"), currentDetail, v);
  document.getElementById("seen").textContent =
    isDemo() ? "예시 데이터예요"
    : store.lastTime ? `마지막 수신 ${clock(store.lastTime)}${store.live ? "" : " · 연결 끊김"}` : "";
}

// ===== 그래프 데이터 =====
// 예시 모드: 무작위 값 (버튼을 오가도 같은 값이 보이도록 저장)
// 실제 모드: 아두이노에서 받아 쌓은 시간별 평균
const seriesCache = {};

function seriesFrame(mode) {
  const now = new Date();
  if (mode === "month") {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return {
      xMin: 1, xMax: dim,
      ticks: [1, ...[5, 10, 15, 20, 25, 30].filter(d => d <= dim)].map(d => [d, `${d}일`]),
      xAxis: "날짜(일)", title: "이번 달 변화", nowWord: "오늘", unitWord: "일",
      span: `${now.getMonth() + 1}월 1일부터 오늘까지 하루 평균이에요.`
    };
  }
  return {
    xMin: 0, xMax: 24,
    ticks: [0, 6, 12, 18, 24].map(h => [h, `${h}시`]),
    xAxis: "시간(시)", title: "오늘의 변화", nowWord: "지금", unitWord: "시",
    span: "0시부터 지금까지 시간별 평균이에요."
  };
}

function demoSeries(key, mode) {
  const id = key + mode;
  if (seriesCache[id]) return seriesCache[id];
  const s = sensors[key];
  const [lo, hi] = s.scale;
  const clamp = v => Math.min(hi, Math.max(lo, v));
  const now = new Date();
  let v = (s.range[0] + s.range[1]) / 2;
  const walk = step => (v = clamp(v + (Math.random() - .5) * (hi - lo) * step), Math.round(v));

  const xs = mode === "month"
    ? Array.from({ length: now.getDate() }, (_, i) => i + 1)
    : Array.from({ length: now.getHours() + 1 }, (_, h) => h);
  const values = xs.map(x => {
    if (key !== "sun") return walk(mode === "month" ? .1 : .14);
    return mode === "month"
      ? rand(15000, 48000)
      : clamp(Math.round(Math.max(0, Math.sin((x - 6) / 12 * Math.PI)) * 52000 + (Math.random() - .5) * 6000));
  });
  return (seriesCache[id] = { xs, values });
}

function realSeries(key, mode) {
  const now = new Date();
  const xs = [], values = [];
  if (mode === "month") {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const prefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(d)}T`;
      let sum = 0, n = 0;
      for (let h = 0; h < 24; h++) {
        const cell = history[prefix + pad(h)]?.[key];
        if (cell) { sum += cell[0]; n += cell[1]; }
      }
      if (n) { xs.push(d); values.push(Math.round(sum / n * 10) / 10); }
    }
  } else {
    for (let h = 0; h < 24; h++) {
      const cell = history[`${dayKey(now)}T${pad(h)}`]?.[key];
      if (cell) { xs.push(h); values.push(Math.round(cell[0] / cell[1] * 10) / 10); }
    }
  }
  return { xs, values };
}

// ===== 손그림 그래프 =====
// 잎 = y축 눈금, 꽃 = x축 눈금
const LEAF = `<path d="M-40 0 C-26 -18 2 -18 12 0 C2 16 -26 16 -40 0 Z" fill="#2fae00" stroke="#111" stroke-width="3" stroke-linejoin="round"/>
  <path d="M-30 0 C-18 -3 -4 -3 6 0" fill="none" stroke="#c9f5a8" stroke-width="3" stroke-linecap="round"/>`;
const FLOWER = [0, 72, 144, 216, 288].map(a =>
  `<ellipse cx="0" cy="-11" rx="8" ry="11" transform="rotate(${a})" fill="#ffb3c7" stroke="#111" stroke-width="2.5"/>`).join("") +
  `<circle r="7" fill="#ffd84d" stroke="#111" stroke-width="2.5"/>`;

function drawHandChart(key, mode = "day", animate = true) {
  const s = sensors[key];
  const AX = { x0: 170, x1: 900, y0: 560, y1: 110 };   // 원점, x축 끝, y축 위쪽
  const [lo, hi] = s.scale;
  const demo = isDemo();
  const fr = seriesFrame(mode);
  const { xs, values: data } = demo ? demoSeries(key, mode) : realSeries(key, mode);
  const last = data.length - 1;
  lastChartDraw = Date.now();
  document.getElementById("chart-title").textContent = fr.title;
  document.getElementById("chart-caption").textContent =
    demo ? `${fr.span} (아두이노 연결 전이라 예시 데이터예요.)` : `${fr.span} 아두이노에서 받은 실제 값이에요.`;

  const px = x => AX.x0 + ((x - fr.xMin) / (fr.xMax - fr.xMin)) * (AX.x1 - AX.x0);
  const py = val => AX.y0 - ((Math.min(hi, Math.max(lo, val)) - lo) / (hi - lo)) * (AX.y0 - AX.y1);

  const top = py(Math.min(hi, s.range[1]));
  let html = `<rect x="${AX.x0}" y="${top}" width="${AX.x1 - AX.x0}" height="${py(s.range[0]) - top}" rx="10" fill="#2fae00" opacity=".12"/>`;

  // y축 눈금: 잎
  for (let i = 0; i <= 4; i++) {
    const t = lo + (hi - lo) * i / 4;
    if (i > 0) html += `<line x1="${AX.x0}" x2="${AX.x1}" y1="${py(t)}" y2="${py(t)}" stroke="#d6d6d0" stroke-width="2" stroke-dasharray="8 10"/>`;
    html += `<g transform="translate(${AX.x0 - 8} ${py(t)})">${LEAF}</g>`;
    html += `<text x="${AX.x0 - 58}" y="${py(t) + 8}" text-anchor="end" class="tick">${fmt(t)}</text>`;
  }
  // x축 눈금: 꽃
  for (const [x, label] of fr.ticks) {
    html += `<g transform="translate(${px(x)} ${AX.y0 + 34})">${FLOWER}</g>`;
    html += `<text x="${px(x)}" y="${AX.y0 + 82}" text-anchor="middle" class="tick">${label}</text>`;
  }

  // 축과 화살표
  html += `<path d="M${AX.x0} ${AX.y0} V${AX.y1 - 50} M${AX.x0 - 12} ${AX.y1 - 34} L${AX.x0} ${AX.y1 - 54} L${AX.x0 + 12} ${AX.y1 - 34}"
            fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  html += `<path d="M${AX.x0} ${AX.y0} H${AX.x1 + 50} M${AX.x1 + 34} ${AX.y0 - 12} L${AX.x1 + 54} ${AX.y0} L${AX.x1 + 34} ${AX.y0 + 12}"
            fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  html += `<text x="${AX.x0 + 22}" y="${AX.y1 - 40}" class="axis">${s.axis}</text>`;
  html += `<text x="${AX.x1 + 54}" y="${AX.y0 - 20}" text-anchor="end" class="axis">${fr.xAxis}</text>`;

  if (data.length === 0) {
    html += `<text x="${(AX.x0 + AX.x1) / 2}" y="${(AX.y0 + AX.y1) / 2}" text-anchor="middle" class="empty">아직 받은 데이터가 없어요</text>`;
    document.getElementById("chart").innerHTML = html;
    return;
  }

  // 값 선 + 아래 면
  const pts = data.map((d, i) => `${px(xs[i])},${py(d)}`);
  html += `<polygon points="${px(xs[0])},${AX.y0} ${pts.join(" ")} ${px(xs[last])},${AX.y0}" fill="#2fae00" opacity=".12"/>`;
  html += `<polyline class="line${animate ? "" : " still"}" points="${pts.join(" ")}"/>`;
  data.forEach((d, i) => {
    const x = px(xs[i]);
    if (i % 3 === 0 || i === last)
      html += `<circle class="dot ${i === last ? "now" : ""}" cx="${x}" cy="${py(d)}" r="${i === last ? 10 : 6}"><title>${xs[i]}${fr.unitWord} ${fmt(d)}${s.unit}</title></circle>`;
    // 점마다 값 표시 (마지막 값은 아래 "지금/오늘" 라벨로 따로 보여줌)
    if (i % 3 === 0 && i !== last) {
      const vy = py(d) - 16 < AX.y1 - 10 ? py(d) + 30 : py(d) - 16;
      html += `<text x="${x}" y="${vy}" text-anchor="middle" class="dot-label">${fmt(d)}</text>`;
    }
  });
  const lx = Math.min(px(xs[last]) + 16, AX.x1 - 190);
  const ly = Math.max(py(data[last]) - 22, AX.y1 + 10);
  html += `<text x="${lx}" y="${ly}" class="now-label">${fr.nowWord} ${fmt(data[last])}${s.unit}</text>`;
  document.getElementById("chart").innerHTML = html;
}

// ===== 화면 전환 (한 페이지 안에서 #soil, #gas … 로 이동) =====
// 페이지를 새로 열면 블루투스 연결이 끊기므로 상세 화면도 같은 페이지 안에서 바꿔 끼움
function route() {
  const key = location.hash.slice(1);
  const home = document.getElementById("home");
  const page = document.getElementById("page");
  if (sensors[key]) {
    home.hidden = true;
    page.hidden = false;
    renderDetail(key);
  } else {
    currentDetail = null;
    home.hidden = false;
    page.hidden = true;
    page.innerHTML = "";
    document.title = "생생팜";
  }
  document.querySelectorAll("nav a[href^='#']").forEach(a =>
    a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + key));
  window.scrollTo(0, 0);
}

function initApp() {
  addEventListener("hashchange", route);
  route();
  demoTick();
  refreshBlobs();
  updateConnUI();
  setInterval(demoTick, 5000);
  setInterval(updateConnUI, 1000);   // "○초 전에 받음" 갱신
}
