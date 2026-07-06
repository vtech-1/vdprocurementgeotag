// ============================================================
// ATTENDANCE.JS — Two-session IN/OUT punch flow.
//   Session 1 (morning): 1st IN → 1st OUT
//   Session 2 (evening): 2nd IN → 2nd OUT
//   Punch button appears only after a photo is captured.
//   Late: 1st IN after 7:30 AM, 2nd IN after 5:00 PM.
// ============================================================

const ATT_LS_KEY = 'vd_attendance';

// ── Persistence (per device, ISO date key) ────────────────────

function _attKey() {
    return `${STATE.currentUser?.id}_${formatDateISO(new Date())}`;
}

function loadAttendanceToday() {
    try {
        const all = JSON.parse(localStorage.getItem(ATT_LS_KEY) || '{}');
        STATE.attendanceToday = all[_attKey()] || {
            in1: null, out1: null, in2: null, out2: null
        };
    } catch (e) {
        STATE.attendanceToday = { in1: null, out1: null, in2: null, out2: null };
    }
}

function saveAttendanceToday() {
    try {
        const all = JSON.parse(localStorage.getItem(ATT_LS_KEY) || '{}');
        all[_attKey()] = STATE.attendanceToday;
        localStorage.setItem(ATT_LS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('Attendance save error', e); }
}

// Evening session begins at this hour (matches CONFIG.EVENING_START).
const EVENING_START_HOUR = 16; // 4 PM

// ── Which punches are available right now? ────────────────────
// Returns an array of { type, label }. Usually one item, but if a
// supervisor forgot to punch OUT and it's now evening, we offer BOTH
// "Punch Out — Session 1" and "Start Session 2" so the day is never
// blocked by a forgotten punch-out.

function getAvailablePunches() {
    const a = STATE.attendanceToday || {};
    const isEvening = _istParts(new Date()).hour >= EVENING_START_HOUR;

    // Session 1 not started
    if (!a.in1) return [{ type: '1st_in', label: '🟢 Punch In — Session 1' }];

    // Session 1 in progress (IN but no OUT)
    if (!a.out1) {
        const opts = [{ type: '1st_out', label: '🔴 Punch Out — Session 1' }];
        // Forgot morning punch-out and it's evening → let them start session 2
        if (isEvening && !a.in2) {
            opts.push({ type: '2nd_in', label: '🟢 Start Session 2 (skip missing 1st OUT)' });
        }
        return opts;
    }

    // Session 1 done → Session 2
    if (!a.in2)  return [{ type: '2nd_in',  label: '🟢 Punch In — Session 2'  }];
    if (!a.out2) return [{ type: '2nd_out', label: '🔴 Punch Out — Session 2' }];

    return []; // all done
}

// Backwards-compatible single "next" (first available action).
function getNextPunch() {
    const opts = getAvailablePunches();
    return opts.length ? opts[0] : null;
}

// ── Main punch handler (called with an explicit punch type) ───

async function handlePunch(punchType) {
    loadAttendanceToday();

    if (!STATE.currentPosition) {
        showMessage('📍 GPS not ready. Wait for location, then punch.', 'error');
        return;
    }

    const now  = new Date();
    const time = formatTime(now); // HH:MM:SS AM/PM

    const punchData = {
        punchType,
        supervisorId:   STATE.currentUser?.id   || 'unknown',
        supervisorName: STATE.currentUser?.name || 'unknown',
        time,
        lat: STATE.currentPosition.latitude,
        lon: STATE.currentPosition.longitude,
        village: STATE.currentLocationName || 'Unknown',
        date: formatDateISO(now),
    };

    // Save locally (mirror) — store key by session slot
    const sessionKey = { '1st_in': 'in1', '1st_out': 'out1', '2nd_in': 'in2', '2nd_out': 'out2' }[punchType];
    STATE.attendanceToday[sessionKey] = { time, lat: punchData.lat, lon: punchData.lon };
    saveAttendanceToday();

    // Local late label for immediate feedback (IST)
    let statusLabel = '';
    const mins = nowMinutes();
    if (punchType === '1st_in') statusLabel = mins > (7 * 60 + 30) ? ' (Late)' : ' (On-Time)';
    if (punchType === '2nd_in') statusLabel = mins > (17 * 60)     ? ' (Late)' : ' (On-Time)';

    // Sync to Google Sheets
    const res = await apiPost('punch', punchData);
    if (res.ok && res.data?.success) {
        showMessage(`✅ Punch recorded at ${time}${statusLabel}`, 'success');
    } else {
        const err = res.data?.error || 'offline — saved locally';
        showMessage(`⚠️ Punch at ${time}${statusLabel} — ${err}`, 'success');
    }

    updatePunchButton();
}

// ── Punch button UI (shown after photo capture) ───────────────

function showPunchButton() {
    loadAttendanceToday();
    const wrap = document.getElementById('punchActionWrap');
    if (wrap) wrap.style.display = 'block';
    updatePunchButton();
}

function updatePunchButton() {
    const holder = document.getElementById('punchBtnHolder');
    const status = document.getElementById('punchStatus');
    if (!holder) return;

    const opts = getAvailablePunches();

    if (opts.length === 0) {
        holder.innerHTML = '<button class="btn btn-block" disabled style="width:100%;background:#9e9e9e;color:white;border:none;padding:14px;opacity:0.7;">✅ All punches done today</button>';
    } else {
        holder.innerHTML = opts.map(o => {
            const isIn = o.type.endsWith('_in');
            const color = isIn ? '#4caf50' : '#f44336';
            return `<button class="btn btn-block punch-opt" data-punch="${o.type}"
                        style="width:100%;background:${color};color:white;border:none;padding:14px;font-weight:bold;margin-bottom:8px;">
                        ${o.label}</button>`;
        }).join('');
        // Wire each button to handlePunch with its explicit type
        holder.querySelectorAll('.punch-opt').forEach(b => {
            b.addEventListener('click', () => handlePunch(b.dataset.punch));
        });
    }

    if (status) {
        const a = STATE.attendanceToday || {};
        const parts = [];
        if (a.in1)  parts.push(`1st IN ${a.in1.time}`);
        parts.push(a.in1 && !a.out1 && (a.in2 || a.out2) ? '1st OUT ⚠️ Missing' : (a.out1 ? `1st OUT ${a.out1.time}` : ''));
        if (a.in2)  parts.push(`2nd IN ${a.in2.time}`);
        if (a.out2) parts.push(`2nd OUT ${a.out2.time}`);
        status.textContent = parts.filter(Boolean).join('  •  ');
    }
}

// Called when arriving at supervisor page — hide punch until a photo exists
function updateAttendanceUI() {
    loadAttendanceToday();
    const wrap = document.getElementById('punchActionWrap');
    if (wrap && !STATE.capturedPhoto) wrap.style.display = 'none';
}
