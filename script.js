/* ============================================================
   IoT Terminal — Naila Winanda Nurpratama
   MQTT Dashboard Script
   ============================================================ */

/* ── KONFIGURASI MQTT ── */
const BROKER    = 'b338e112c7b54236bc6ebddb85504b3b.s1.eu.hivemq.cloud';
const PORT      = 8884;
const USERNAME  = 'nailawinanda';
const PASSWORD  = 'Naila_ukk1';
const TOPIC_SUB = 'smk/iot/sensor';        // Subscribe — data dari ESP32
const TOPIC_CMD = 'smk/iot/relay/cmd';     // Publish  — perintah relay ke ESP32
const TBL_INT   = 2000;   // interval update tabel (ms)
const MAX_ROWS  = 50;     // baris maksimum riwayat

/*
  PIN MAP (sesuai Arduino):
  LED/Relay 1 → GPIO 4   (Hijau,  20–25°C)
  LED/Relay 2 → GPIO 18  (Kuning, 26–30°C)
  LED/Relay 3 → GPIO 19  (Merah,  ≥31°C)
  LED/Relay 4 → GPIO 21  (Hijau,  Indikator / selalu ON di auto)
*/

/* ── STATE ── */
let cl          = null;
let conn        = false;
let lastStatus  = '';
let manualDisc  = false;
let mc          = parseInt(localStorage.getItem('msg_count')) || 0;
let st          = null;
let uptimer     = null;
let history     = [];
let nextId      = 1;
let lastData    = null;
let lastTblTime = 0;

// State relay lokal (index 0–3 = relay 1–4)
let relayState  = [false, false, false, false];
let currentMode = '';  // 'auto' | 'manual' | ''

/* ── HELPER ── */
const g = id => document.getElementById(id);

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
    localStorage.setItem('iot_hist', JSON.stringify({ rows: history, nextId }));
  } catch(e) {}
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('iot_hist');
    if (!raw) return;
    const obj = JSON.parse(raw);
    history = obj.rows || [];
    nextId  = obj.nextId || history.length + 1;
    rebuildTable();
    const lu = localStorage.getItem('last_update');
    if (lu) g('lu').textContent = lu;
    updateSelInfo();
    const last = localStorage.getItem('last_sensor');
    if (last) {
      const d = JSON.parse(last);
      if (d.suhu)   updSensor(d.suhu, d.hum);
      if (d.cahaya) updLDR(d.cahaya);
    }
  } catch(e) {}
  g('mc').textContent = mc;
}

/* ============================================================
   TABEL RIWAYAT
   ============================================================ */
function rebuildTable() {
  const tb = g('tbl-body');
  tb.innerHTML = history.length
    ? ''
    : '<tr><td colspan="7" class="no-data">Belum ada data diterima.</td></tr>';
  history.forEach(r => tb.appendChild(makeRow(r)));
  g('chk-all').checked = false;
  g('del-btn').disabled = true;
}

function makeRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  tr.innerHTML = `
    <td><input type="checkbox" class="row-cb" data-id="${r.id}" onchange="onRowCheck()"></td>
    <td>${r.id}</td>
    <td>${r.ts}</td>
    <td class="suhu-cell">${r.suhu}</td>
    <td class="hum-cell">${r.hum}</td>
    <td>${r.cahaya === 'TERANG'
      ? '<span class="bt">TERANG</span>'
      : '<span class="bg">GELAP</span>'}</td>
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
  // activeRelays = array angka relay yang ON, misal [2, 4] artinya LED2 dan LED4
  const names = ['LED1','LED2','LED3','LED4'];
  let aktif = [];

  if (Array.isArray(activeRelays)) {
    // Format array index 1-based: [1, 3] → LED1, LED3
    activeRelays.forEach(n => {
      if (n >= 1 && n <= 4) aktif.push(names[n - 1]);
    });
  } else if (typeof activeRelays === 'string' && /^[01]{4}$/.test(activeRelays)) {
    // Format string biner "1010" → LED1, LED3
    activeRelays.split('').forEach((v, i) => { if (v === '1') aktif.push(names[i]); });
  }

  const row = {
    id:     nextId++,
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

  tb.appendChild(makeRow(row));

  while (tb.children.length > MAX_ROWS) tb.removeChild(tb.firstChild);

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
  mc      = Math.max(0, mc - ids.size);
  localStorage.setItem('msg_count', mc);
  g('mc').textContent = mc;
  saveHistory();
  rebuildTable();
  updateSelInfo();
  g('chk-all').checked  = false;
  g('del-btn').disabled = true;
}

function clearAll() {
  if (!history.length || !confirm('Hapus semua riwayat data?')) return;
  history = [];
  nextId  = 1;
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
   RELAY CONTROL — Publish ke ESP32 via MQTT
   Format: {"relay":1,"state":true}   (relay 1-indexed)
   ============================================================ */
function toggleRelay(relayNum) {
  if (currentMode !== 'manual') {
    showAlert('⚠ Hanya aktif di mode MANUAL', 'yellow');
    return;
  }
  if (!conn) {
    showAlert('⚠ Belum terhubung ke MQTT', 'yellow');
    return;
  }

  const idx      = relayNum - 1;
  const newState = !relayState[idx];
  const payload  = JSON.stringify({ relay: relayNum, state: newState });

  try {
    const msg = new Paho.Message(payload);
    msg.destinationName = TOPIC_CMD;
    cl.send(msg);
    addLog('CMD', `→ Relay ${relayNum} : ${newState ? 'ON' : 'OFF'}`);

    // Update state lokal langsung (feedback cepat di UI)
    relayState[idx] = newState;
    applyRelayUI(idx, newState);
  } catch(e) {
    addLog('ERR', 'Gagal kirim perintah: ' + e.message);
  }
}

/* Update satu relay di UI */
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

/* Aktifkan / nonaktifkan tombol relay sesuai mode */
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
  addLog('SYS', 'Connected: ' + BROKER);
  addLog('SYS', 'Subscribe: ' + TOPIC_SUB);
  addLog('SYS', 'Publish CMD: ' + TOPIC_CMD);
  st      = Date.now();
  uptimer = setInterval(uptime, 1000);
}

function onFail(e) {
  setBadge('error', 'GAGAL');
  addLog('SYS', 'Error: ' + e.errorMessage);
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
  mc++;
  localStorage.setItem('msg_count', mc);
  g('mc').textContent = mc;
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
    if (suhu != null && hum != null) updSensor(suhu, hum);
    if (cahaya) updLDR(cahaya);

    // Deteksi perubahan mode — enable/disable tombol relay
    if (mode !== currentMode) {
      currentMode = mode;
      setRelayButtons(mode === 'manual' && conn);
      if (mode === 'manual') {
        addLog('SYS', 'Mode MANUAL → tombol relay web aktif');
      } else {
        addLog('SYS', 'Mode AUTO → tombol relay web nonaktif');
      }
    }

    if (mode === 'manual') {
      // ── MODE MANUAL ──────────────────────────────────────────
      // Sinkronisasi state relay lokal dari data ESP32
      // (hanya update dari ESP32 jika tidak ada aksi web baru)
      const ledFromESP = parseLed(d.led);
      addLog('MODE', 'MANUAL');
      addLog('LED',  `L1:${+ledFromESP[0]} L2:${+ledFromESP[1]} L3:${+ledFromESP[2]} L4:${+ledFromESP[3]}`);
      // Sinkronisasi relayState dari ESP32 (sumber kebenaran)
      relayState = [...ledFromESP];
      updLEDs(ledFromESP, 'manual');
      setSystemState('manual');

    } else {
      // ── MODE AUTO ────────────────────────────────────────────
      if (suhu == null || hum == null) { addLog('ERR', 'Data tidak lengkap'); return; }
      addLog('SUHU', suhu.toFixed(1) + ' °C');
      addLog('HUM',  hum.toFixed(1)  + ' %');
      addLog('LDR',  cahaya || '—');
      setSystemState('auto', suhu);
      updLEDs(null, 'auto', suhu);
      // Update state relay lokal sesuai logika auto
      relayState = [
        suhu >= 20 && suhu <= 25,
        suhu >  25 && suhu <= 30,
        suhu >  30,
        true   // relay 4 selalu ON di auto
      ];
      cekAlert(suhu);
    }

    // ── Tambah ke tabel menggunakan relayState yang sudah sinkron ──
    if (Date.now() - lastTblTime >= TBL_INT) {
      lastTblTime = Date.now();
      // Konversi relayState [true,false,true,true] → [1,3,4] (1-indexed)
      const activeRelays = relayState
        .map((on, i) => on ? i + 1 : null)
        .filter(n => n !== null);
      addTableRow(now, suhu, hum, cahaya, activeRelays);
    }

  } catch(e) {
    addLog('ERR', 'JSON Error: ' + e.message);
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
  g('sv').textContent   = suhu.toFixed(1);
  g('hv').textContent   = hum.toFixed(1);
  g('sb').style.width   = Math.min(100, (suhu / 50) * 100) + '%';
  g('hb').style.width   = Math.min(100, hum) + '%';
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
    : (suhu != null ? 'LED dari suhu ' + suhu.toFixed(1) + '°C' : 'LED dari suhu sensor');
}

function setSystemState(state, suhu) {
  const sv   = g('sval');
  const ring = g('sring');
  if (state === 'auto') {
    sv.textContent      = 'AKTIF';
    sv.className        = 'on';
    ring.className      = 'status-ring on';
    const s = suhu <= 25 ? 'NORMAL' : suhu <= 30 ? 'SEDANG' : 'PANAS';
    g('snote').textContent = 'STATUS: ' + s + ' | ' + suhu.toFixed(1) + '°C';
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
    g('lb1').textContent = '20–25°C (GPIO 4)';
    g('lb2').textContent = '26–30°C (GPIO 18)';
    g('lb3').textContent = '≥31°C   (GPIO 19)';
    g('lb4').textContent = 'INDIKATOR (GPIO 21)';

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

    g('l4').className    = 'lorb green';
    g('ls4').textContent = 'Aktif';
    g('ls4').className   = 'lstate on-g';
    const rb4 = g('rb4');
    if (rb4) rb4.classList.add('is-on');
  }
}

/* ============================================================
   ALERT & LOG
   ============================================================ */
function cekAlert(suhu) {
  const s = suhu <= 25 ? 'NORMAL' : suhu <= 30 ? 'SEDANG' : 'PANAS';
  if (s !== lastStatus) {
    const map = {
      NORMAL: ['● Suhu Normal (20–25°C)', 'green'],
      SEDANG: ['● Suhu Sedang (26–30°C)', 'yellow'],
      PANAS:  ['● Suhu Panas (≥30°C)',    'red']
    };
    showAlert(...map[s]);
  }
  lastStatus = s;
}

function setBadge(cls, txt) {
  g('badge').className   = 'badge ' + cls;
  g('btext').textContent = txt;
}

function addLog(type, msg) {
  const el  = g('log');
  const t   = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const d   = document.createElement('div');
  d.className = 'le';
  const cls = type === 'CMD'
    ? 'cmd-txt'
    : (msg.includes('TERANG') || msg.includes('AKTIF'))
      ? 'on-txt'
      : (msg.includes('GELAP') || msg.includes('STANDBY'))
        ? 'muted'
        : '';
  d.innerHTML = `<span class="lt">${t}</span> <span class="lk">[${type}]</span> <span class="lm ${cls}">${msg}</span>`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 120) el.removeChild(el.firstChild);
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
  setTimeout(() => div.remove(), 3200);
}

/* ── INIT ── */
window.addEventListener('load', loadHistory);
