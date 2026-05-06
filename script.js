/* ============================================================
   IoT Terminal — Naila Winanda Nurpratama
   MQTT Dashboard Script — Revisi: Grafik Realtime, Dark/Light Mode
   ============================================================ */

/* ── KONFIGURASI MQTT ── */
const BROKER    = 'b338e112c7b54236bc6ebddb85504b3b.s1.eu.hivemq.cloud';
const PORT      = 8884;
const USERNAME  = 'nailawinanda';
const PASSWORD  = 'Naila_ukk1';
const TOPIC_SUB = 'smk/iot/sensor';
const TOPIC_CMD = 'smk/iot/relay/cmd';
const TBL_INT   = 2000;
const MAX_ROWS  = 50;
const MAX_CHART_POINTS = 30;

/* ── STATE ── */
let cl          = null;
let conn        = false;
let lastStatus  = '';
let manualDisc  = false;
let st          = null;
let uptimer     = null;
let history     = [];
let lastData    = null;
let lastTblTime = 0;
let lastTemp    = null;
let lastHum     = null;

let relayState  = [false, false, false, false];
let currentMode = '';

/* ── CHART DATA ── */
const chartLabels   = [];
const chartTempData = [];
const chartHumData  = [];
let chartTemp       = null;
let chartHum        = null;

/* ── HELPER ── */
const g = id => document.getElementById(id);

/* ── HELPER: Dapatkan label status suhu ──
 *  Sinkron dengan logika Arduino (mode AUTO):
 *    < 20°C          → Dingin  (tidak ada LED menyala)
 *    20 – 25°C       → Normal  (LED 1 Hijau)
 *    > 25 – 30°C     → Hangat  (LED 2 Kuning)
 *    > 30°C          → Panas   (LED 3 Merah)
 */
function getTempStatus(suhu) {
  if (suhu < 20)                return { label: 'Dingin 🔵',  key: 'DINGIN' };
  if (suhu >= 20 && suhu <= 25) return { label: 'Normal 🟢',  key: 'NORMAL' };
  if (suhu >  25 && suhu <= 30) return { label: 'Hangat 🟡',  key: 'HANGAT' };
  return                        { label: 'Panas 🔴',    key: 'PANAS'  };
}

/* ============================================================
   DARK / LIGHT THEME
   ============================================================ */
function toggleTheme() {
  const html = document.documentElement;
  const cur  = html.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('iot_theme', next);
  updateThemeIcons(next);
  updateChartTheme();
}

function updateThemeIcons(theme) {
  const icon = theme === 'dark' ? '☀️' : '🌙';
  const i1 = g('theme-icon');
  const i2 = g('theme-icon-dash');
  if (i1) i1.textContent = icon;
  if (i2) i2.textContent = icon;
}

function loadTheme() {
  const saved = localStorage.getItem('iot_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcons(saved);
}

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ============================================================
   CHART — dua grafik terpisah
   ============================================================ */
function makeChartOptions(color, unit, isDark) {
  const grid   = isDark ? 'rgba(120,140,200,0.08)' : 'rgba(80,100,160,0.08)';
  const border = isDark ? 'rgba(120,140,200,0.15)'  : 'rgba(80,100,160,0.15)';
  const tick   = isDark ? '#6577a0' : '#475569';
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? 'rgba(22,28,38,0.95)' : 'rgba(255,255,255,0.97)',
        titleColor: isDark ? '#e2e8f0' : '#0f172a',
        bodyColor:  isDark ? '#94a3b8' : '#475569',
        borderColor: isDark ? 'rgba(120,140,200,0.25)' : 'rgba(80,100,160,0.18)',
        borderWidth: 1, padding: 10, cornerRadius: 10,
        callbacks: { label: ctx => ` ${ctx.parsed.y} ${unit}` }
      }
    },
    scales: {
      x: {
        grid: { color: grid },
        ticks: { color: tick, font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0, maxTicksLimit: 7 },
        border: { color: border }
      },
      y: {
        grid: { color: grid },
        ticks: { color, font: { family: 'JetBrains Mono', size: 10 }, callback: v => v + unit },
        border: { color: border }
      }
    }
  };
}

function initChart() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const ctxT = g('chartTemp');
  const ctxH = g('chartHum');
  if (!ctxT || !ctxH) return;

  chartTemp = new Chart(ctxT, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Suhu',
        data: chartTempData,
        borderColor: '#2dd4bf',
        backgroundColor: 'rgba(45,212,191,0.10)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: '#2dd4bf',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        tension: 0.45,
        fill: true,
      }]
    },
    options: makeChartOptions('#2dd4bf', '°C', isDark)
  });

  chartHum = new Chart(ctxH, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Kelembapan',
        data: chartHumData,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.10)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: '#38bdf8',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        tension: 0.45,
        fill: true,
      }]
    },
    options: makeChartOptions('#38bdf8', '%', isDark)
  });
}

function updateChartTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (chartTemp) {
    const opt = makeChartOptions('#2dd4bf', '°C', isDark);
    chartTemp.options = opt;
    chartTemp.update('none');
  }
  if (chartHum) {
    const opt = makeChartOptions('#38bdf8', '%', isDark);
    chartHum.options = opt;
    chartHum.update('none');
  }
}

function addChartPoint(timeStr, suhu, hum) {
  if (suhu == null || hum == null) return;

  chartLabels.push(timeStr);
  chartTempData.push(parseFloat(suhu.toFixed(1)));
  chartHumData.push(parseFloat(hum.toFixed(1)));

  if (chartLabels.length > MAX_CHART_POINTS) {
    chartLabels.shift();
    chartTempData.shift();
    chartHumData.shift();
  }

  if (chartTemp) chartTemp.update();
  if (chartHum)  chartHum.update();
}

/* ============================================================
   NAVIGASI
   ============================================================ */
function goToDashboard() {
  const login = g('view-login');
  const dash  = g('view-dashboard');
  login.classList.add('fade-out');
  setTimeout(() => {
    login.classList.add('hidden');
    login.classList.remove('fade-out');
    dash.classList.remove('hidden');
    dash.classList.add('fade-in');
    window.scrollTo(0, 0);
    if (!chartTemp) initChart();
  }, 320);
}

function goToLogin() {
  const login = g('view-login');
  const dash  = g('view-dashboard');
  dash.classList.add('hidden');
  dash.classList.remove('fade-in');
  login.classList.remove('hidden');
  window.scrollTo(0, 0);
}

/* ============================================================
   LOCAL STORAGE
   ============================================================ */
function saveHistory() {
  try {
    localStorage.setItem('iot_hist', JSON.stringify({ rows: history }));
  } catch(e) {}
}

function loadHistory() {
  loadTheme();
  try {
    const raw = localStorage.getItem('iot_hist');
    if (!raw) return;
    const obj = JSON.parse(raw);
    history = obj.rows || [];
    rebuildTable();
    const lu = localStorage.getItem('last_update');
    if (lu) g('lu').textContent = lu;
    updateSelInfo();
    const last = localStorage.getItem('last_sensor');
    if (last) {
      const d = JSON.parse(last);
      if (d.suhu != null)   updSensor(d.suhu, d.hum);
      if (d.cahaya) updLDR(d.cahaya);
    }
  } catch(e) {}
}

/* ============================================================
   TABEL RIWAYAT
   ============================================================ */
function rebuildTable() {
  const tb = g('tbl-body');
  tb.innerHTML = history.length
    ? ''
    : '<tr><td colspan="7" class="no-data">Belum ada data diterima.</td></tr>';
  [...history].reverse().forEach((r, i) => tb.appendChild(makeRow(r, i + 1)));
  g('chk-all').checked = false;
  g('del-btn').disabled = true;
}

function makeRow(r, num) {
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  tr.innerHTML = `
    <td><input type="checkbox" class="row-cb" data-id="${r.id}" onchange="onRowCheck()"></td>
    <td>${num != null ? num : r.num}</td>
    <td>${r.ts}</td>
    <td class="suhu-cell">${r.suhu}</td>
    <td class="hum-cell">${r.hum}</td>
    <td>${r.cahaya === 'TERANG'
      ? '<span class="bt">☀️ TERANG</span>'
      : '<span class="bg">🌙 GELAP</span>'}</td>
    <td>${r.led}</td>`;
  tr.onclick = e => {
    if (e.target.type === 'checkbox') return;
    const cb = tr.querySelector('.row-cb');
    cb.checked = !cb.checked;
    onRowCheck();
  };
  return tr;
}

function addTableRow(now, suhu, hum, cahaya, activeRelays) {
  const names = ['LED1','LED2','LED3','LED4'];
  let aktif = [];
  if (Array.isArray(activeRelays)) {
    activeRelays.forEach(n => { if (n >= 1 && n <= 4) aktif.push(names[n - 1]); });
  } else if (typeof activeRelays === 'string' && /^[01]{4}$/.test(activeRelays)) {
    activeRelays.split('').forEach((v, i) => { if (v === '1') aktif.push(names[i]); });
  }

  const row = {
    id:     now.getTime(),
    ts:     now.toLocaleTimeString('id-ID', { hour12: false }),
    suhu:   suhu != null ? suhu.toFixed(1) : '-',
    hum:    hum  != null ? hum.toFixed(1)  : '-',
    cahaya,
    led:    aktif.length ? aktif.join(', ') : '-'
  };

  history.push(row);
  if (history.length > MAX_ROWS) history.shift();

  const tb    = g('tbl-body');
  const noRow = tb.querySelector('.no-data');
  if (noRow) noRow.parentElement.remove();

  tb.insertBefore(makeRow(row, 1), tb.firstChild);

  [...tb.querySelectorAll('tr[data-id]')].forEach((tr, i) => {
    const numCell = tr.querySelector('td:nth-child(2)');
    if (numCell) numCell.textContent = i + 1;
  });

  while (tb.children.length > MAX_ROWS) tb.removeChild(tb.lastChild);

  updateSelInfo();
  saveHistory();
}

function onRowCheck() {
  const cbs     = [...document.querySelectorAll('.row-cb')];
  const checked = cbs.filter(c => c.checked);
  g('chk-all').checked  = checked.length === cbs.length && cbs.length > 0;
  g('del-btn').disabled = checked.length === 0;
  document.querySelectorAll('#tbl-body tr[data-id]').forEach(tr =>
    tr.classList.toggle('selected', !!tr.querySelector('.row-cb')?.checked)
  );
  updateSelInfo();
}

function toggleAll(master) {
  document.querySelectorAll('.row-cb').forEach(cb => cb.checked = master.checked);
  onRowCheck();
}

function updateSelInfo() {
  const n = [...document.querySelectorAll('.row-cb:checked')].length;
  g('sel-info').textContent = history.length
    ? (n ? `${n} baris dipilih` : `${history.length} baris`)
    : '';
}

function deleteSelected() {
  const ids = new Set([...document.querySelectorAll('.row-cb:checked')].map(c => +c.dataset.id));
  if (!ids.size) return;
  history = history.filter(r => !ids.has(r.id));
  saveHistory();
  rebuildTable();
  updateSelInfo();
  g('chk-all').checked  = false;
  g('del-btn').disabled = true;
}

function clearAll() {
  if (!history.length || !confirm('Hapus semua riwayat data?')) return;
  history = [];
  saveHistory();
  rebuildTable();
  updateSelInfo();
}

function exportCSV() {
  if (!history.length) { alert('Tidak ada data.'); return; }
  const rows = [
    ['#','Waktu','Suhu (°C)','Hum (%)','Cahaya','LED'],
    ...history.map(r => [r.id, r.ts, r.suhu, r.hum, r.cahaya, r.led])
  ];
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURI(rows.map(r => r.join(',')).join('\n'));
  a.download = `iot-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click();
}

/* ============================================================
   RELAY CONTROL
   ============================================================ */
function toggleRelay(relayNum) {
  if (currentMode !== 'manual') { showAlert('⚠ Hanya aktif di mode MANUAL', 'yellow'); return; }
  if (!conn) { showAlert('⚠ Belum terhubung ke MQTT', 'yellow'); return; }

  const idx      = relayNum - 1;
  const newState = !relayState[idx];
  const payload  = JSON.stringify({ relay: relayNum, state: newState });

  try {
    const msg = new Paho.Message(payload);
    msg.destinationName = TOPIC_CMD;
    cl.send(msg);
    relayState[idx] = newState;
    applyRelayUI(idx, newState);
  } catch(e) {
    showAlert('❌ Gagal kirim: ' + e.message, 'red');
  }
}

function applyRelayUI(idx, on) {
  const n = idx + 1;
  const colorClass   = ['green', 'yellow', 'red', 'green'];
  const offClass     = ['off-g', 'off-y',  'off-r', 'off-g'];
  const onStateClass = ['on-g',  'on-y',   'on-r',  'on-g'];

  const orb = g('l' + n);
  const lbl = g('ls' + n);
  const btn = g('rb' + n);

  if (on) {
    orb.className = 'lorb ' + colorClass[idx];
    lbl.textContent = 'Menyala';
    lbl.className   = 'lstate ' + onStateClass[idx];
    if (btn) btn.classList.add('is-on');
  } else {
    orb.className   = 'lorb ' + offClass[idx];
    lbl.textContent = 'Padam';
    lbl.className   = 'lstate';
    if (btn) btn.classList.remove('is-on');
  }
}

function setRelayButtons(enabled) {
  [1, 2, 3, 4].forEach(n => {
    const btn = g('rb' + n);
    if (btn) btn.disabled = !enabled;
  });
  const banner = g('manual-banner');
  if (banner) {
    if (enabled) banner.classList.remove('hidden');
    else         banner.classList.add('hidden');
  }
}

/* ============================================================
   MQTT
   ============================================================ */
function toggle() { conn ? doDisc() : doConn(); }

function doConn() {
  manualDisc = false;
  setBadge('connecting', 'CONNECTING...');
  g('btn').disabled = true;
  cl = new Paho.Client(BROKER, PORT, '/mqtt', 'Web-' + Math.floor(Math.random() * 9000 + 1000));
  cl.onConnectionLost  = onLost;
  cl.onMessageArrived  = onMsg;
  cl.connect({
    userName:  USERNAME,
    password:  PASSWORD,
    useSSL:    true,
    onSuccess: onConn,
    onFailure: onFail
  });
}

function doDisc() {
  if (!cl || !conn) return;
  manualDisc = true;
  cl.disconnect();
  g('btn-text').textContent = 'HUBUNGKAN KE MQTT';
  g('btn').classList.remove('disc');
  g('btn').disabled = false;
  setBadge('', 'DISCONNECTED');
  setRelayButtons(false);
}

function onConn() {
  conn = true;
  setBadge('connected', 'CONNECTED');
  g('btn').disabled = false;
  g('btn').classList.add('disc');
  g('btn-text').textContent = 'PUTUSKAN KONEKSI';
  cl.subscribe(TOPIC_SUB);
  st      = Date.now();
  uptimer = setInterval(uptime, 1000);
  showAlert('✅ Terhubung ke MQTT Broker', 'green');
}

function onFail(e) {
  setBadge('error', 'GAGAL');
  showAlert('❌ Gagal: ' + e.errorMessage, 'red');
  g('btn').disabled = false;
}

function onLost() {
  conn = false;
  setBadge('', 'DISCONNECTED');
  g('btn').disabled = false;
  if (uptimer) clearInterval(uptimer);
  setSystemState('off');
  setRelayButtons(false);
  g('btn-text').textContent = 'HUBUNGKAN KE MQTT';
  g('btn').classList.remove('disc');
  if (!manualDisc) setTimeout(doConn, 3000);
  manualDisc = false;
}

function onMsg(m) {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
  g('lu').textContent = timeStr;
  localStorage.setItem('last_update', timeStr);

  try {
    const d      = JSON.parse(m.payloadString.trim());
    const mode   = (d.mode || 'auto').toLowerCase();
    const suhu   = d.suhu        != null ? parseFloat(d.suhu)        : null;
    const hum    = d.kelembapan  != null ? parseFloat(d.kelembapan)  : null;
    const cahaya = (d.cahaya || '').toUpperCase();

    lastData = { suhu, hum, cahaya };
    localStorage.setItem('last_sensor', JSON.stringify(lastData));

    updModeBadge(mode, suhu);
    if (suhu != null && hum != null) {
      updSensor(suhu, hum);
      addChartPoint(timeStr, suhu, hum);
    }
    if (cahaya) updLDR(cahaya);

    if (mode !== currentMode) {
      currentMode = mode;
      setRelayButtons(mode === 'manual' && conn);
    }

    if (mode === 'manual') {
      const ledFromESP = parseLed(d.led);
      relayState = [...ledFromESP];
      updLEDs(ledFromESP, 'manual');
      setSystemState('manual');

    } else {
      if (suhu == null || hum == null) return;
      setSystemState('auto', suhu);
      updLEDs(null, 'auto', suhu);
      // Sinkron persis dengan Arduino mode AUTO
      relayState = [
        suhu >= 20 && suhu <= 25,   // LED1 Hijau  — Normal
        suhu >  25 && suhu <= 30,   // LED2 Kuning — Hangat
        suhu >  30,                 // LED3 Merah  — Panas
        true                        // LED4 selalu ON
      ];
      cekAlert(suhu);
    }

    if (Date.now() - lastTblTime >= TBL_INT) {
      lastTblTime = Date.now();
      const activeRelays = relayState
        .map((on, i) => on ? i + 1 : null)
        .filter(n => n !== null);
      addTableRow(now, suhu, hum, cahaya, activeRelays);
    }

  } catch(e) {
    showAlert('❌ JSON Error: ' + e.message, 'red');
  }
}

/* ============================================================
   PARSER & UPDATER UI
   ============================================================ */
function parseLed(led) {
  const s = [false, false, false, false];
  if (led == null) return s;
  if (Array.isArray(led))
    led.forEach(n => { if (n >= 1 && n <= 4) s[n-1] = true; });
  else if (typeof led === 'string' && /^[01]{4}$/.test(led))
    led.split('').forEach((v, i) => s[i] = v === '1');
  else if (typeof led === 'number')
    for (let i = 0; i < 4; i++) s[i] = !!(led & (1 << i));
  return s;
}

function updSensor(suhu, hum) {
  // ── Trend suhu ──
  if (lastTemp !== null) {
    const diff  = suhu - lastTemp;
    const trend = g('temp-trend');
    if (Math.abs(diff) < 0.1) {
      trend.textContent = '→ Stabil';
      trend.className   = 'sensor-trend same';
    } else if (diff > 0) {
      trend.textContent = '↑ +' + diff.toFixed(1);
      trend.className   = 'sensor-trend up';
    } else {
      trend.textContent = '↓ ' + diff.toFixed(1);
      trend.className   = 'sensor-trend down';
    }
  }

  // ── Trend kelembapan ──
  if (lastHum !== null) {
    const diff  = hum - lastHum;
    const trend = g('hum-trend');
    if (Math.abs(diff) < 0.5) {
      trend.textContent = '→ Stabil';
      trend.className   = 'sensor-trend same';
    } else if (diff > 0) {
      trend.textContent = '↑ +' + diff.toFixed(1);
      trend.className   = 'sensor-trend up';
    } else {
      trend.textContent = '↓ ' + diff.toFixed(1);
      trend.className   = 'sensor-trend down';
    }
  }

  lastTemp = suhu;
  lastHum  = hum;

  g('sv').textContent = suhu.toFixed(1);
  g('hv').textContent = hum.toFixed(1);
  g('sb').style.width = Math.min(100, (suhu / 50) * 100) + '%';
  g('hb').style.width = Math.min(100, hum) + '%';

  // ── Status suhu: sinkron dengan Arduino ──
  const { label: tempStatusLabel } = getTempStatus(suhu);
  const humStatus = hum < 30 ? 'Kering 🟡' : hum <= 70 ? 'Normal 🟢' : 'Lembap 🔵';
  g('temp-status').textContent = tempStatusLabel;
  g('hum-status').textContent  = humStatus;
}

function updLDR(v) {
  const t = v === 'TERANG';
  g('lico').textContent  = t ? '☀️' : '🌙';
  g('lbox').className    = 'ldr-box ' + (t ? 'terang' : 'gelap');
  g('lpill').className   = 'ldr-pill ' + (t ? 'terang' : 'gelap');
  g('lpill').textContent = t ? 'TERANG' : 'GELAP';
}

function updModeBadge(mode, suhu) {
  const mb = g('mode-badge');
  mb.className = mode === 'manual' ? 'manual' : 'auto';
  mb.id = 'mode-badge';
  g('mode-text').textContent = mode === 'manual' ? 'MODE: MANUAL' : 'MODE: AUTO';
  g('mode-hint').textContent = mode === 'manual'
    ? 'LED dikontrol via tombol fisik / web'
    : (suhu != null ? 'LED otomatis dari suhu ' + suhu.toFixed(1) + '°C' : 'LED dari suhu sensor');
}

function setSystemState(state, suhu) {
  const sv   = g('sval');
  const ring = g('sring');
  if (state === 'auto') {
    sv.textContent = 'AKTIF';
    sv.className   = 'on';
    ring.className = 'status-ring on';
    const { key } = getTempStatus(suhu);
    g('snote').textContent = 'STATUS: ' + key + ' | ' + suhu.toFixed(1) + '°C';
  } else if (state === 'manual') {
    sv.textContent         = 'MANUAL';
    sv.className           = 'on';
    ring.className         = 'status-ring on';
    g('snote').textContent = 'Kontrol relay via tombol fisik / web';
  } else {
    sv.textContent         = 'STANDBY';
    sv.className           = '';
    ring.className         = 'status-ring';
    g('snote').textContent = 'Menunggu data dari ESP32...';
    const mb    = g('mode-badge');
    mb.className           = '';
    mb.id                  = 'mode-badge';
    g('mode-text').textContent = 'MODE: —';
    g('mode-hint').textContent = 'Menunggu data...';
  }
}

/* ============================================================
   LED UPDATE
   ============================================================ */
function updLEDs(state, mode, suhu) {
  const offClass = ['off-g', 'off-y', 'off-r', 'off-g'];
  [1, 2, 3, 4].forEach(i => {
    g('l'  + i).className   = 'lorb ' + offClass[i - 1];
    g('ls' + i).textContent = 'Padam';
    g('ls' + i).className   = 'lstate';
    const btn = g('rb' + i);
    if (btn) btn.classList.remove('is-on');
  });

  if (mode === 'manual') {
    const colorClass   = ['green',  'yellow', 'red',  'green'];
    const onStateClass = ['on-g',   'on-y',   'on-r', 'on-g'];
    const gpioLabels   = ['GPIO 4', 'GPIO 18','GPIO 19','GPIO 21'];
    [1, 2, 3, 4].forEach((_, i) => {
      g('lb' + (i + 1)).textContent = gpioLabels[i];
      if (state[i]) {
        g('l'  + (i + 1)).className   = 'lorb ' + colorClass[i];
        g('ls' + (i + 1)).textContent  = 'Menyala';
        g('ls' + (i + 1)).className    = 'lstate ' + onStateClass[i];
        const btn = g('rb' + (i + 1));
        if (btn) btn.classList.add('is-on');
      }
    });
  } else {
    // Label badge sesuai range Arduino
    g('lb1').textContent = '20–25°C (GPIO 4)';
    g('lb2').textContent = '26–30°C (GPIO 18)';
    g('lb3').textContent = '>30°C   (GPIO 19)';
    g('lb4').textContent = 'INDIKATOR (GPIO 21)';

    // Sinkron dengan Arduino: >= 20 && <= 25 → LED1, > 25 && <= 30 → LED2, > 30 → LED3
    if (suhu >= 20 && suhu <= 25) {
      g('l1').className    = 'lorb green';
      g('ls1').textContent = 'Menyala';
      g('ls1').className   = 'lstate on-g';
    } else if (suhu > 25 && suhu <= 30) {
      g('l2').className    = 'lorb yellow';
      g('ls2').textContent = 'Menyala';
      g('ls2').className   = 'lstate on-y';
    } else if (suhu > 30) {
      g('l3').className    = 'lorb red';
      g('ls3').textContent = 'Menyala';
      g('ls3').className   = 'lstate on-r';
    }
    // Suhu < 20 → tidak ada LED 1/2/3 yang menyala (sudah di-reset di atas)

    // LED 4 selalu menyala (indikator) — sama dengan Arduino target[3] = true
    g('l4').className    = 'lorb green';
    g('ls4').textContent = 'Aktif';
    g('ls4').className   = 'lstate on-g';
    const rb4 = g('rb4');
    if (rb4) rb4.classList.add('is-on');
  }
}

/* ============================================================
   ALERT — CEK SUHU & PERINGATAN PANAS
   ============================================================ */
let hotBannerShown = false;

function showHotWarning(suhu) {
  if (!hotBannerShown) {
    hotBannerShown = true;
    const container = document.querySelector('.container');
    if (!container) return;

    const old = document.getElementById('hot-warning-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.id        = 'hot-warning-banner';
    banner.className = 'hot-warning-banner';
    banner.innerHTML = `
      <div class="hot-warning-icon">🔥</div>
      <div class="hot-warning-content">
        <div class="hot-warning-title">PERINGATAN: SUHU TERLALU PANAS!</div>
        <div class="hot-warning-sub">Suhu saat ini <strong>${suhu.toFixed(1)}°C</strong> — melebihi batas aman (>30°C). Segera ambil tindakan pendinginan!</div>
      </div>
      <button class="hot-warning-close" onclick="dismissHotWarning()">✕</button>
    `;

    container.insertBefore(banner, container.firstChild);
  } else {
    const sub = document.querySelector('#hot-warning-banner .hot-warning-sub');
    if (sub) sub.innerHTML = `Suhu saat ini <strong>${suhu.toFixed(1)}°C</strong> — melebihi batas aman (>30°C). Segera ambil tindakan pendinginan!`;
  }
}

function dismissHotWarning() {
  const banner = document.getElementById('hot-warning-banner');
  if (banner) {
    banner.style.animation = 'bannerOut .3s ease forwards';
    setTimeout(() => { banner.remove(); hotBannerShown = false; }, 300);
  }
}

function hideHotWarning() {
  const banner = document.getElementById('hot-warning-banner');
  if (banner) {
    banner.remove();
    hotBannerShown = false;
  }
}

function cekAlert(suhu) {
  const { key } = getTempStatus(suhu);

  if (key !== lastStatus) {
    // Label alert sinkron dengan range Arduino
    const map = {
      DINGIN: ['🔵 Suhu Dingin (<20°C)',          'yellow'],
      NORMAL: ['🟢 Suhu Normal (20–25°C)',         'green'],
      HANGAT: ['🟡 Suhu Hangat (26–30°C)',         'yellow'],
      PANAS:  ['🔴 Suhu Panas (>30°C) — BAHAYA!', 'red']
    };
    if (map[key]) showAlert(...map[key]);

    if (key === 'PANAS') {
      showHotWarning(suhu);
    } else {
      hideHotWarning();
    }
  } else if (key === 'PANAS') {
    showHotWarning(suhu);
  }

  lastStatus = key;
}

function setBadge(cls, txt) {
  g('badge').className   = 'badge ' + cls;
  g('btext').textContent = txt;
}

function uptime() {
  if (!st) return;
  const s = Math.floor((Date.now() - st) / 1000);
  g('up').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function showAlert(text, type) {
  const div = document.createElement('div');
  div.className  = 'alert-box alert-' + type;
  div.innerText  = text;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

/* ── INIT ── */
window.addEventListener('load', loadHistory);
