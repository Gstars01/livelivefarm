// ===== 아두이노 연결 =====
// 아두이노가 보내는 한 줄 형식:  [PERIODIC] Soli : 45,Light : 300,Gas : 120
// (soil=52,gas=640 이나 JSON 한 줄 {"soil":52,...} 도 받을 수 있음. 일부 값만 보내도 됨)
//
// 1) 블루투스(BLE)  : HM-10, AT-09, BT05 같은 BLE 모듈 / ESP32 (Nordic UART)
//                     → Web Bluetooth로 바로 연결
// 2) 시리얼 포트    : HC-05, HC-06 (Windows 블루투스 설정에서 먼저 페어링 → COM 포트가 생김)
//                     또는 USB 케이블 → Web Serial로 연결
// 두 방식 모두 Chrome / Edge 에서만 동작함

const BLE_UART = [
  { service: 0xffe0, rx: 0xffe1 },                                  // HM-10 계열
  { service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",                // Nordic UART (ESP32 등)
    rx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e" }
];
const BAUD_RATE = 9600;

let lineBuf = "";
let disconnectFn = null;

// 조각조각 들어오는 글자를 줄 단위로 모아서 해석
function feed(text) {
  lineBuf += text;
  const lines = lineBuf.split("\n");
  lineBuf = lines.pop();
  if (lineBuf.length > 500) lineBuf = "";
  lines.forEach(parseLine);
}

// 아두이노가 쓰는 이름 → 사이트의 센서 이름
// 예) [PERIODIC] Soli : 45,Light : 300,Gas : 120
const KEY_ALIAS = {
  soil: "soil", soli: "soil", moisture: "soil", humidity: "soil",
  light: "sun", sun: "sun", lux: "sun",
  gas: "gas", co2: "gas",
  pest: "pest", bug: "pest"
};

function parseLine(raw) {
  // 앞쪽의 [PERIODIC] 같은 꼬리표는 떼어냄
  const line = raw.trim().replace(/^\[[^\]]*\]\s*/, "");
  if (!line) return;
  store.lastLine = raw.trim();

  let obj = {};
  if (line.startsWith("{")) {
    try { obj = JSON.parse(line); } catch { updateConnUI(); return; }
  } else {
    for (const pair of line.split(/[,;]/)) {
      const [k, v] = pair.split(/[=:]/);
      if (k && v !== undefined) obj[k.trim().toLowerCase()] = v.trim();
    }
  }

  const values = {};
  for (const [name, v] of Object.entries(obj)) {
    const key = KEY_ALIAS[name.toLowerCase()];
    const n = parseFloat(v);
    if (key && Number.isFinite(n)) values[key] = n;
  }
  if (Object.keys(values).length) recordReading(values);
  else updateConnUI();
}

function setLive(live, source = "") {
  const wasLive = store.live;
  store.live = live;
  store.source = source;
  if (live) {
    dropDemo();
    store.liveSince = new Date();
    showToast(`🔗 아두이노와 연결됐어요 (${source})`, "live");
  } else if (wasLive) {
    showToast("⚠️ 아두이노 연결이 끊겼어요", "off");
  }
  if (!live) { disconnectFn = null; lineBuf = ""; }
  onData(true);
}

function showError(err) {
  if (err && err.name === "NotFoundError") return;   // 사용자가 선택 창을 닫은 경우
  const box = document.getElementById("panel-error");
  box.textContent = "연결하지 못했어요: " + (err && err.message ? err.message : err);
  box.hidden = false;
}

// --- 블루투스(BLE) ---
async function connectBLE() {
  if (!navigator.bluetooth) throw new Error("이 브라우저는 블루투스를 지원하지 않아요. Chrome이나 Edge로 열어 주세요.");
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_UART.map(u => u.service)
  });
  const server = await device.gatt.connect();

  let ch = null;
  for (const u of BLE_UART) {
    try {
      const svc = await server.getPrimaryService(u.service);
      ch = await svc.getCharacteristic(u.rx);
      break;
    } catch { /* 다음 방식 시도 */ }
  }
  if (!ch) {
    device.gatt.disconnect();
    throw new Error("이 기기에서 데이터 통로(UART 서비스)를 찾지 못했어요. HM-10 같은 BLE 모듈인지 확인해 주세요.");
  }

  const decoder = new TextDecoder();
  ch.addEventListener("characteristicvaluechanged", e => feed(decoder.decode(e.target.value, { stream: true })));
  await ch.startNotifications();
  device.addEventListener("gattserverdisconnected", () => setLive(false));
  disconnectFn = async () => device.gatt.disconnect();
  setLive(true, `블루투스 · ${device.name || "BLE 기기"}`);
}

// --- 시리얼 포트 (HC-05/HC-06, USB) ---
async function connectSerial(port) {
  if (!("serial" in navigator)) throw new Error("이 브라우저는 시리얼 포트를 지원하지 않아요. Chrome이나 Edge로 열어 주세요.");
  port = port || await navigator.serial.requestPort();
  await port.open({ baudRate: BAUD_RATE });

  const decoder = new TextDecoderStream();
  const piping = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  disconnectFn = async () => {
    await reader.cancel().catch(() => {});
    await piping;
    await port.close().catch(() => {});
  };
  setLive(true, "시리얼 포트");

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      feed(value);
    }
  } catch { /* 케이블이 빠지거나 블루투스가 끊김 */ }
  finally {
    reader.releaseLock();
    setLive(false);
  }
}

// --- 연결 창 ---
function initConnect() {
  const panel = document.getElementById("panel");
  const errorBox = document.getElementById("panel-error");
  const run = fn => async () => {
    errorBox.hidden = true;
    try { await fn(); } catch (err) { showError(err); }
  };

  const openPanel = () => {
    errorBox.hidden = true;
    updateConnUI();
    panel.showModal();
  };
  document.getElementById("conn-open").addEventListener("click", openPanel);
  document.getElementById("linkbar-action").addEventListener("click", openPanel);
  document.getElementById("btn-ble").addEventListener("click", run(connectBLE));
  document.getElementById("btn-serial").addEventListener("click", run(() => connectSerial()));
  document.getElementById("btn-disconnect").addEventListener("click", run(async () => {
    if (disconnectFn) await disconnectFn();
    setLive(false);
  }));
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (confirm("지금까지 받은 기록을 모두 지울까요?")) clearHistory();
  });

  // 전에 허락한 시리얼 포트가 있으면 새로고침해도 자동으로 다시 연결
  if ("serial" in navigator) {
    navigator.serial.getPorts().then(ports => {
      if (ports.length === 1 && !store.live) connectSerial(ports[0]).catch(() => {});
    });
  }
}
