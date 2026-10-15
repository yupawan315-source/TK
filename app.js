/* ============================================================
   ระบบลงเวลาปฏิบัติราชการอิเล็กทรอนิกส์ (BKM e-Time)
   app.js
   ============================================================ */

/** รุ่นของไฟล์ ใช้ตรวจว่าเบราว์เซอร์โหลดไฟล์ใหม่จริงหรือยังใช้ของเก่าในแคช */
const BUILD = '20261009c';
try { console.log('BKM e-Time build', BUILD); } catch (e) {}

/* ==========================================================
   ตั้งค่า Firebase  —  ผู้ติดตั้งต้องแก้ส่วนนี้ส่วนเดียว
   นำค่าจาก Firebase Console (Project settings > General > Your apps)
   มาใส่แทนข้อความในเครื่องหมายคำพูดทีละบรรทัด
   ห้ามลบเครื่องหมายคำพูด จุลภาค และวงเล็บปีกกา
   ========================================================== */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDiGAK-bIMVj2ereYTeQOygXHKjXzb6cfs",
  authDomain:        "yupawan-63dc6.firebaseapp.com",
  databaseURL:       "https://yupawan-63dc6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "yupawan-63dc6",
  storageBucket:     "yupawan-63dc6.firebasestorage.app",
  messagingSenderId: "976391992844",
  appId:             "1:976391992844:web:8029db11d307dd3c66a029"
};

const SDK_VER = '10.12.2';
/* ที่อยู่สำรองสำหรับโหลดไลบรารี Firebase
   gstatic ใช้รูปแบบ <ฐาน>/<รุ่น>/<ไฟล์> ส่วน jsDelivr และ unpkg ใช้ <ฐาน>@<รุ่น>/<ไฟล์> */
const CDNS = [
  { base:'https://www.gstatic.com/firebasejs', sep:'/' },
  { base:'https://cdn.jsdelivr.net/npm/firebase', sep:'@' },
  { base:'https://unpkg.com/firebase', sep:'@' }
];

/* partial:true หมายถึงเลือกครึ่งวันเช้าหรือครึ่งวันบ่ายได้ (เฉพาะการขอวันเดียว) */
const LEAVE_TYPES = [
  { id:'SICK',     name:'ลาป่วย',        quotaKey:'qSick' },
  { id:'BUSINESS', name:'ลากิจส่วนตัว',   quotaKey:'qBiz'  },
  { id:'MATERNITY',name:'ลาคลอดบุตร',    quotaKey:'qMat'  },
  { id:'ORDAIN',   name:'ลาอุปสมบท',     quotaKey:null    },
  { id:'STUDY',    name:'ลาศึกษาต่อ',     quotaKey:null    },
  { id:'DUTY',     name:'ไปราชการ',      quotaKey:null, partial:true },
  { id:'TRAINING', name:'อบรมสัมมนา',     quotaKey:null, partial:true }
];
const LEAVE_NAME = {}; LEAVE_TYPES.forEach(t => LEAVE_NAME[t.id] = t.name);
LEAVE_NAME.VACATION = 'ลาพักผ่อน';   // เลิกใช้แล้ว คงไว้เพื่อแสดงชื่อของใบลาเดิม

/* ช่วงเวลาของการลาหรือไปราชการ */
const PERIOD_NAME = { FULL:'เต็มวัน', AM:'ครึ่งวันเช้า', PM:'ครึ่งวันบ่าย' };
function isPartial(l){ return !!l && (l.period === 'AM' || l.period === 'PM'); }
function leaveName(l){
  if (!l) return '';
  return (LEAVE_NAME[l.type] || l.type) + (isPartial(l) ? ' ' + PERIOD_NAME[l.period] : '');
}
/** ใบลาที่อนุมัติแล้วของบุคคลในวันนั้น */
function approvedOn(list, uid, dateStr){
  return (list || []).find(x => x.uid === uid && x.status === 'APPROVED'
                              && x.dateFrom <= dateStr && dateStr <= x.dateTo);
}
/** สายจริงหรือไม่ ไม่นับสายเมื่อได้รับอนุมัติไปราชการช่วงเช้า */
function effLate(r, l){ return !!(r && r.checkIn && r.checkIn.late) && !(isPartial(l) && l.period === 'AM'); }
/** ขาดการลงเวลาออกหรือไม่ ไม่นับเมื่อได้รับอนุมัติไปราชการช่วงบ่าย */
function missingOut(r, l){ return !!(r && r.checkIn && !r.checkOut) && !(isPartial(l) && l.period === 'PM'); }

/** ประเภทบุคลากร ใช้สรุปจำนวนท้ายรายงานการลงเวลาประจำวัน */
const STAFF_TYPES = ['ผู้บริหาร','ข้าราชการครู','พนักงานราชการ','ครูอัตราจ้าง',
                     'เจ้าหน้าที่ธุรการ','นักการภารโรง','อื่น ๆ'];

/** เดาประเภทจากชื่อตำแหน่ง ใช้กับข้อมูลเดิมที่ยังไม่ได้ระบุประเภท */
function inferStaffType(position){
  const p = String(position || '');
  if (/ผู้อำนวยการ|รองผู้อำนวยการ|ผู้บริหาร/.test(p)) return 'ผู้บริหาร';
  if (/ภารโรง/.test(p))        return 'นักการภารโรง';
  if (/ธุรการ/.test(p))        return 'เจ้าหน้าที่ธุรการ';
  if (/พนักงานราชการ/.test(p)) return 'พนักงานราชการ';
  if (/อัตราจ้าง|จ้างสอน/.test(p)) return 'ครูอัตราจ้าง';
  if (/ครู/.test(p))           return 'ข้าราชการครู';
  return 'อื่น ๆ';
}
function staffTypeOf(u){
  return (u && u.staffType && STAFF_TYPES.indexOf(u.staffType) >= 0)
    ? u.staffType : inferStaffType(u && u.position);
}

const WEAK_PINS = ['0000','1111','2222','3333','4444','5555','6666','7777',
                   '8888','9999','1234','4321','1212','2580','0123','9876'];

const DEFAULT_CONFIG = {
  schoolName:'',
  areaOffice:'',
  lat:17.080757, lng:102.422768, radius:200,
  timeOpen:'06:00', timeStart:'08:00', timeLate:'09:00', timeEnd:'15:30',
  remindIn:'07:30', remindOut:'15:20',
  qSick:60, qBiz:45, qMat:90,
  larkWebhook:''
};

/* ---------- สถานะร่วม ---------- */
let db = null;
let CFG = Object.assign({}, DEFAULT_CONFIG);
let USERS = {};            // uid -> user
let ME = null;             // ผู้ใช้ที่เข้าระบบ
let HOLIDAYS = {};         // 'YYYY-MM-DD' -> {name}
let todayRec = null;       // บันทึกลงเวลาของวันนี้
let geo = { ok:false, lat:null, lng:null, dist:null, acc:null };
let camStream = null, snapData = null, camMode = null;
let todayPart = null;      // ใบลาครึ่งวันที่อนุมัติแล้วของวันนี้ (ถ้ามี)
let clockTimer = null, page = 'home', editUid = null, ufAdmin = false;
let leaveType = null, myLeaves = [], allLeaves = [];

/* ============================================================
   ส่วนที่ 1 : เครื่องมือพื้นฐาน
   ============================================================ */
const $  = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function show(view){
  ['vBoot','vSetup','vLogin','vPin','vApp'].forEach(v =>
    $(v).classList.toggle('hide', v !== view));
}
function alertBox(id, text, kind){
  const b = $(id); if (!b) return;
  b.textContent = text || '';
  b.className = 'alert a-' + (kind || 'err') + (text ? ' show' : '');
}
function toast(text){
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function openM(id){ $(id).classList.add('on'); }
function closeM(id){ $(id).classList.remove('on'); }

const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};

/* ---------- วันที่และเวลา ---------- */
const TH_MONTH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MON_ABBR = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                     'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DAY = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

function pad(n){ return (n < 10 ? '0' : '') + n; }
function dateKey(d){ d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function monthKey(d){ d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth()+1); }
function timeNow(d){ d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function thaiDate(key){
  const [y,m,dd] = key.split('-').map(Number);
  const d = new Date(y, m-1, dd);
  return 'วัน' + TH_DAY[d.getDay()] + 'ที่ ' + dd + ' ' + TH_MONTH[m-1] + ' ' + (y+543);
}
function thaiDateShort(key){
  const [y,m,dd] = key.split('-').map(Number);
  return dd + ' ' + TH_MON_ABBR[m-1] + ' ' + (y+543);
}
function toMin(hhmm){ const [h,m] = String(hhmm||'0:0').split(':').map(Number); return h*60+m; }
function isWeekend(key){ const [y,m,d] = key.split('-').map(Number);
  const w = new Date(y,m-1,d).getDay(); return w === 0 || w === 6; }
function isWorkday(key){ return !isWeekend(key) && !HOLIDAYS[key]; }
function eachDate(from, to){
  const out = []; const [y1,m1,d1] = from.split('-').map(Number);
  const cur = new Date(y1, m1-1, d1); const end = new Date(to.split('-')[0],
    Number(to.split('-')[1])-1, Number(to.split('-')[2]));
  let guard = 0;
  while (cur <= end && guard++ < 400){ out.push(dateKey(cur)); cur.setDate(cur.getDate()+1); }
  return out;
}
/* ปีงบประมาณ : 1 ต.ค. ถึง 30 ก.ย. — ใช้กับสิทธิ์การลา */
function fiscalYear(key){
  const [y,m] = key.split('-').map(Number);
  return m >= 10 ? y + 1 : y;
}
function fiscalRange(fy){ return { from:(fy-1)+'-10-01', to:fy+'-09-30' }; }

/* ---------- ระยะทาง ---------- */
function haversine(la1, lo1, la2, lo2){
  const R = 6371000, rad = Math.PI/180;
  const dLa = (la2-la1)*rad, dLo = (lo2-lo1)*rad;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*rad)*Math.cos(la2*rad)*Math.sin(dLo/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

/* ---------- เข้ารหัส PIN ---------- */
async function hashPin(pin, salt){
  const data = new TextEncoder().encode(salt + '::' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function newSalt(){
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('');
}
function randomPin(){
  let p; const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); p = String(1000 + (a[0] % 9000)); }
  while (WEAK_PINS.includes(p));
  return p;
}
function initials(u){
  const n = (u.firstName || '').trim();
  return n ? n.charAt(0) : '?';
}
function fullName(u){
  if (!u) return '';
  return (u.prefix || '') + (u.firstName || '') + ' ' + (u.lastName || '');
}

/* ============================================================
   ส่วนที่ 2 : เปิดระบบ
   ============================================================ */
function loadScript(src){
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => no(new Error(src));
    document.head.appendChild(s);
  });
}
async function loadFirebase(){
  const files = ['firebase-app-compat.js','firebase-database-compat.js','firebase-auth-compat.js'];
  let lastErr = null;
  for (const c of CDNS){
    try {
      for (const f of files) await loadScript(c.base + c.sep + SDK_VER + '/' + f);
      return true;
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('โหลดไลบรารีไม่สำเร็จ');
}

async function boot(){
  try {
    if (!window.crypto || !crypto.subtle){
      throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัส กรุณาเปิดผ่าน https');
    }
    $('bootMsg').textContent = 'กำลังโหลดไลบรารี…';
    await loadFirebase();

    $('bootMsg').textContent = 'กำลังเชื่อมต่อฐานข้อมูล…';
    const bad = Object.keys(FIREBASE_CONFIG).filter(k =>
      !FIREBASE_CONFIG[k] || String(FIREBASE_CONFIG[k]).indexOf('ใส่ค่า') === 0);
    if (bad.length) throw new Error(
      'ยังไม่ได้ใส่ค่า Firebase ในไฟล์ app.js — ขาด ' + bad.join(', '));
    firebase.initializeApp(FIREBASE_CONFIG);
    try { console.log('Firebase SDK', firebase.SDK_VERSION,
      '| databaseURL', FIREBASE_CONFIG.databaseURL); } catch (e) {}
    db = firebase.database();
    await firebase.auth().signInAnonymously();

    $('bootMsg').textContent = 'กำลังอ่านข้อมูลระบบ…';
    const [cfgSnap, userSnap, holSnap] = await Promise.all([
      db.ref('config').get(), db.ref('users').get(), db.ref('holidays').get()
    ]);
    if (cfgSnap.exists()) CFG = Object.assign({}, DEFAULT_CONFIG, cfgSnap.val());
    USERS = userSnap.exists() ? userSnap.val() : {};
    HOLIDAYS = holSnap.exists() ? holSnap.val() : {};

    if (!Object.keys(USERS).length){ show('vSetup'); return; }

    const uid = store.get('etime_uid');
    if (uid && USERS[uid] && USERS[uid].status === 'ACTIVE'){
      ME = Object.assign({ uid }, USERS[uid]);
      if (ME.mustChangePin) { show('vPin'); return; }
      enterApp();
    } else {
      store.del('etime_uid');
      showLogin();
    }
  } catch(err){
    $('bootMsg').textContent = 'เชื่อมต่อไม่สำเร็จ';
    alertBox('bootErr', 'สาเหตุ: ' + (err && err.message ? err.message : err), 'err');
    $('bootRetry').classList.remove('hide');
  }
}

/* ============================================================
   ส่วนที่ 3 : ติดตั้งครั้งแรก
   ============================================================ */
async function doSetup(){
  alertBox('suMsg','');
  const first = $('suFirst').value.trim(), last = $('suLast').value.trim();
  const pos = $('suPos').value.trim(), school = $('suSchool').value.trim();
  const pin = $('suPin').value.trim();
  if (!first || !last) return alertBox('suMsg','กรุณากรอกชื่อและนามสกุล');
  if (!pos) return alertBox('suMsg','กรุณากรอกตำแหน่ง');
  if (!/^\d{4}$/.test(pin)) return alertBox('suMsg','รหัส PIN ต้องเป็นตัวเลข 4 หลัก');
  if (WEAK_PINS.includes(pin)) return alertBox('suMsg','รหัส PIN นี้คาดเดาง่ายเกินไป');

  const btn = $('suBtn'); btn.disabled = true; btn.textContent = 'กำลังสร้าง…';
  try {
    const salt = newSalt();
    const uid = 'U001';
    const user = {
      uid, prefix:$('suPrefix').value.trim(), firstName:first, lastName:last,
      position:pos, role:'DIRECTOR', isAdmin:true, larkUserId:'',
      staffType:'ผู้บริหาร',
      salt, pinHash:await hashPin(pin, salt), mustChangePin:false,
      status:'ACTIVE', createdAt:Date.now()
    };
    CFG = Object.assign({}, DEFAULT_CONFIG, { schoolName:school });
    await db.ref('config').set(CFG);
    await db.ref('users/' + uid).set(user);
    USERS[uid] = user;
    ME = Object.assign({ uid }, user);
    store.set('etime_uid', uid);
    enterApp();
    toast('ติดตั้งระบบเรียบร้อย');
  } catch(e){
    alertBox('suMsg','บันทึกไม่สำเร็จ: ' + e.message);
    btn.disabled = false; btn.textContent = 'สร้างบัญชีและเริ่มใช้งาน';
  }
}

/* ============================================================
   ส่วนที่ 4 : เข้าสู่ระบบ
   ============================================================ */
function showLogin(){
  $('lgSchool').textContent = CFG.schoolName || '';
  $('lgArea').textContent = CFG.areaOffice || '';
  const sel = $('lgUser');
  sel.innerHTML = '<option value="">— เลือกชื่อของท่าน —</option>';
  Object.keys(USERS)
    .filter(u => USERS[u].status === 'ACTIVE')
    .sort((a,b) => a.localeCompare(b))
    .forEach(u => {
      const o = document.createElement('option');
      o.value = u;
      o.textContent = fullName(USERS[u]) + (USERS[u].position ? ' (' + USERS[u].position + ')' : '');
      sel.appendChild(o);
    });
  show('vLogin');
}

async function doLogin(){
  alertBox('lgMsg','');
  const uid = $('lgUser').value, pin = $('lgPin').value.trim();
  if (!uid) return alertBox('lgMsg','กรุณาเลือกชื่อผู้ใช้');
  if (!/^\d{4}$/.test(pin)) return alertBox('lgMsg','กรุณากรอกรหัส PIN 4 หลัก');

  const failKey = 'etime_fail_' + uid;
  const lockKey = 'etime_lock_' + uid;
  const lockUntil = Number(store.get(lockKey) || 0);
  if (lockUntil > Date.now()){
    const min = Math.ceil((lockUntil - Date.now())/60000);
    return alertBox('lgMsg','กรอกรหัสผิดเกินกำหนด กรุณารออีก ' + min + ' นาที');
  }

  const btn = $('lgBtn'); btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
  try {
    const u = USERS[uid];
    const ok = u && u.salt && (await hashPin(pin, u.salt)) === u.pinHash;
    if (!ok){
      const n = Number(store.get(failKey) || 0) + 1;
      store.set(failKey, String(n));
      if (n >= 5){ store.set(lockKey, String(Date.now() + 15*60000)); store.del(failKey);
        alertBox('lgMsg','กรอกรหัสผิดครบ 5 ครั้ง ระงับการเข้าใช้ 15 นาที'); }
      else alertBox('lgMsg','รหัส PIN ไม่ถูกต้อง (เหลืออีก ' + (5-n) + ' ครั้ง)');
      $('lgPin').value = '';
      return;
    }
    store.del(failKey); store.del(lockKey);
    ME = Object.assign({ uid }, u);
    store.set('etime_uid', uid);
    db.ref('users/' + uid + '/lastLogin').set(Date.now()).catch(()=>{});
    if (ME.mustChangePin) show('vPin'); else enterApp();
  } finally {
    btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
  }
}

function goChangePin(){ $('cpOld').value = $('cpNew').value = $('cpNew2').value = '';
  alertBox('cpMsg',''); show('vPin'); }

async function doChangePin(){
  alertBox('cpMsg','');
  const oldP = $('cpOld').value.trim(), a = $('cpNew').value.trim(), b = $('cpNew2').value.trim();
  if (!/^\d{4}$/.test(a)) return alertBox('cpMsg','รหัส PIN ต้องเป็นตัวเลข 4 หลัก');
  if (a !== b) return alertBox('cpMsg','รหัส PIN ใหม่ทั้งสองช่องไม่ตรงกัน');
  if (WEAK_PINS.includes(a)) return alertBox('cpMsg','รหัส PIN นี้คาดเดาง่ายเกินไป');
  if ((await hashPin(oldP, ME.salt)) !== ME.pinHash)
    return alertBox('cpMsg','รหัส PIN เดิมไม่ถูกต้อง');

  const btn = $('cpBtn'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    const salt = newSalt(), hash = await hashPin(a, salt);
    await db.ref('users/' + ME.uid).update({ salt, pinHash:hash, mustChangePin:false });
    ME.salt = salt; ME.pinHash = hash; ME.mustChangePin = false;
    USERS[ME.uid] = Object.assign({}, USERS[ME.uid], { salt, pinHash:hash, mustChangePin:false });
    toast('เปลี่ยนรหัส PIN แล้ว');
    enterApp();
  } catch(e){
    alertBox('cpMsg','บันทึกไม่สำเร็จ: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึกรหัสใหม่';
  }
}

function doLogout(){
  store.del('etime_uid'); ME = null; stopCamera();
  clearInterval(clockTimer);
  ['mMe','mLeave','mUser','mDetail','mReason','mLeaveView'].forEach(closeM);
  $('lgPin').value = '';
  showLogin();
}

/* ============================================================
   ส่วนที่ 5 : โครงเมนู
   ============================================================ */
function menuItems(){
  const m = [
    { k:'home',    icon:'i-in',    label:'ลงเวลา' },
    { k:'leave',   icon:'i-cal',   label:'การลา' },
    { k:'history', icon:'i-list',  label:'ประวัติ' }
  ];
  if (ME.role === 'DIRECTOR' || ME.isAdmin){
    m.push({ k:'dash',   icon:'i-chart', label:'แดชบอร์ด' });
    m.push({ k:'report', icon:'i-list',  label:'รายงาน' });
  }
  if (ME.isAdmin) m.push({ k:'admin', icon:'i-gear', label:'ตั้งค่า' });
  return m;
}

function enterApp(){
  $('tbSchool').textContent = CFG.schoolName || '';
  $('sdSchool').textContent = CFG.schoolName || '';
  $('tbAv').textContent = initials(ME);

  const items = menuItems();
  $('bnav').innerHTML = items.map(i =>
    '<button class="bn-i" data-k="' + i.k + '" onclick="nav(\'' + i.k + '\')">' +
    '<svg class="ic"><use href="#' + i.icon + '"/></svg><span>' + i.label + '</span></button>').join('');
  $('sdNav').innerHTML = items.map(i =>
    '<button class="sn-i" data-k="' + i.k + '" onclick="nav(\'' + i.k + '\')">' +
    '<svg class="ic"><use href="#' + i.icon + '"/></svg><span>' + i.label + '</span></button>').join('');

  show('vApp');
  nav('home');
  startClock();
}

function nav(k){
  page = k;
  stopCamera();
  ['pgHome','pgLeave','pgHistory','pgDash','pgReport','pgAdmin']
    .forEach(p => $(p).classList.add('hide'));
  const map = { home:'pgHome', leave:'pgLeave', history:'pgHistory',
                dash:'pgDash', report:'pgReport', admin:'pgAdmin' };
  $(map[k]).classList.remove('hide');
  document.querySelectorAll('.bn-i,.sn-i').forEach(n =>
    n.classList.toggle('on', n.getAttribute('data-k') === k));
  const titles = { home:'ลงเวลาปฏิบัติราชการ', leave:'การลา', history:'ประวัติการลงเวลา',
                   dash:'แดชบอร์ด', report:'รายงาน', admin:'ตั้งค่าระบบ' };
  $('tbTitle').textContent = titles[k];
  window.scrollTo(0,0);

  if (k === 'home')    loadHome();
  if (k === 'leave')   loadLeavePage();
  if (k === 'history') initHistory();
  if (k === 'dash')    initDash();
  if (k === 'report')  initReport();
  if (k === 'admin')   initAdmin();
}

function startClock(){
  clearInterval(clockTimer);
  const tick = () => {
    const d = new Date();
    $('hoClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('hoDate').textContent = thaiDate(dateKey(d));
  };
  tick(); clockTimer = setInterval(tick, 20000);
}

function openMe(){
  $('meName').textContent = fullName(ME);
  $('meRole').textContent = ME.position + (ME.isAdmin ? ' · ผู้ดูแลระบบ' : '');
  $('meBody').innerHTML =
    '<div class="kv"><span class="k">รหัสผู้ใช้</span><span class="v">' + esc(ME.uid) + '</span></div>' +
    '<div class="kv"><span class="k">สถานะในระบบ</span><span class="v">' +
      (ME.role === 'DIRECTOR' ? 'ผู้อำนวยการ' : 'ผู้ปฏิบัติงาน') + '</span></div>' +
    '<div class="kv"><span class="k">หน่วยงาน</span><span class="v">' + esc(CFG.schoolName) + '</span></div>';
  openM('mMe');
}

/* ============================================================
   ส่วนที่ 6 : หน้าลงเวลา
   ============================================================ */
async function loadHome(){
  $('hoWho').textContent = fullName(ME) + ' · ' + ME.position;
  const today = dateKey();
  snapData = null; camMode = null;

  const [recSnap, lvSnap] = await Promise.all([
    db.ref('attendance/' + monthKey() + '/' + ME.uid + '/' + today).get(),
    db.ref('leaves').orderByChild('uid').equalTo(ME.uid).get()
  ]);
  todayRec = recSnap.exists() ? recSnap.val() : null;
  myLeaves = lvSnap.exists()
    ? Object.keys(lvSnap.val()).map(id => Object.assign({ id }, lvSnap.val()[id])) : [];

  renderHomeStamps();
  renderHomeState(today);
}

function leaveOn(dateStr, list){
  return (list || myLeaves).find(l =>
    l.status !== 'REJECTED' && l.dateFrom <= dateStr && dateStr <= l.dateTo);
}

function renderHomeStamps(){
  const ci = todayRec && todayRec.checkIn, co = todayRec && todayRec.checkOut;
  $('hoIn').textContent  = ci ? ci.time : '—';
  $('hoOut').textContent = co ? co.time : '—';
  $('hoInNote').textContent  = ci ? (ci.late ? 'ลงเวลาสาย' : 'ตรงเวลา') : '';
  $('hoOutNote').textContent = co ? (co.early ? 'ออกก่อนเวลา' : 'ครบเวลา') : '';
}

function setHeroState(icon, text){
  $('hoState').innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg><span>' + text + '</span>';
}

function renderHomeState(today){
  const box = $('hoAction'), btns = $('hoBtns');
  const lv = leaveOn(today);
  const ap = approvedOn(myLeaves, ME.uid, today);
  todayPart = isPartial(ap) ? ap : null;

  if (!isWorkday(today)){
    const why = HOLIDAYS[today] ? HOLIDAYS[today].name : 'วันหยุดประจำสัปดาห์';
    setHeroState('i-info', 'วันนี้ไม่ใช่วันทำการ — ' + esc(why));
    box.classList.add('hide'); return;
  }
  if (ap && !todayPart){
    setHeroState('i-check', 'วันนี้ท่าน' + leaveName(ap) + ' (อนุมัติแล้ว)');
    box.classList.add('hide'); return;
  }
  if (!ap && lv && lv.status === 'PENDING'){
    setHeroState('i-info', 'ใบ' + leaveName(lv) + 'ของท่านรออนุมัติ ยังลงเวลาได้ตามปกติ');
  }

  box.classList.remove('hide');
  const ci = todayRec && todayRec.checkIn, co = todayRec && todayRec.checkOut;

  if (!ci){
    if (todayPart && todayPart.period === 'AM')
      setHeroState('i-info', 'ได้รับอนุมัติ' + leaveName(todayPart) +
        ' ลงเวลาเข้าเมื่อกลับถึงโรงเรียน ระบบไม่นับว่ามาสาย');
    else if (todayPart)
      setHeroState('i-info', 'ได้รับอนุมัติ' + leaveName(todayPart) +
        ' กรุณาลงเวลาเข้าตามปกติ ช่วงบ่ายไม่ต้องกลับมาลงเวลาออก');
    else if (!lv || lv.status !== 'PENDING')
      setHeroState('i-warn', 'ท่านยังไม่ได้ลงเวลาเข้าปฏิบัติราชการ');
    btns.innerHTML = '<button class="b-pri b-big b-full" id="btnAct" onclick="startStamp(\'in\')">' +
      '<svg class="ic"><use href="#i-cam"/></svg>เปิดกล้องเพื่อลงเวลาเข้า</button>';
    requestGeo();
  } else if (!co && todayPart && todayPart.period === 'PM'){
    setHeroState('i-check', 'ลงเวลาเข้าแล้วเมื่อ ' + ci.time + ' น. ได้รับอนุมัติ' +
      leaveName(todayPart) + ' จึงไม่ต้องลงเวลาออก');
    btns.innerHTML = '<button class="b-out b-full" id="btnAct" onclick="startStamp(\'out\')">' +
      '<svg class="ic"><use href="#i-cam"/></svg>ลงเวลาออกเมื่อเสร็จภารกิจ (ไม่บังคับ)</button>' +
      '<div class="help" style="text-align:center;margin-top:8px">ลงเวลาออกนอกพื้นที่สถานศึกษาได้ ' +
      'ระบบบันทึกระยะห่างไว้เป็นหลักฐาน</div>';
    requestGeo();
  } else if (!co){
    setHeroState('i-check', 'ลงเวลาเข้าแล้วเมื่อ ' + ci.time + ' น. อย่าลืมลงเวลาออก');
    btns.innerHTML = '<button class="b-pri b-big b-full" id="btnAct" onclick="startStamp(\'out\')">' +
      '<svg class="ic"><use href="#i-cam"/></svg>เปิดกล้องเพื่อลงเวลาออก</button>';
    requestGeo();
  } else {
    setHeroState('i-check', 'ลงเวลาครบแล้วสำหรับวันนี้ ขอบคุณครับ');
    box.classList.add('hide');
  }
}

/* ---------- พิกัด ---------- */
function requestGeo(){
  const box = $('geoBox'), txt = $('geoText');
  box.className = 'geo geo-wait';
  txt.textContent = 'กำลังอ่านตำแหน่ง…';
  if (!navigator.geolocation){
    box.className = 'geo geo-out'; txt.textContent = 'อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => {
      const d = haversine(p.coords.latitude, p.coords.longitude, Number(CFG.lat), Number(CFG.lng));
      geo = { ok:d <= Number(CFG.radius), lat:p.coords.latitude, lng:p.coords.longitude,
              dist:d, acc:Math.round(p.coords.accuracy) };
      if (geo.ok){
        box.className = 'geo geo-in';
        txt.textContent = 'อยู่ในพื้นที่สถานศึกษา ห่างจากจุดอ้างอิง ' + d + ' เมตร';
      } else {
        box.className = 'geo geo-out';
        txt.textContent = 'อยู่นอกพื้นที่ ห่างจากสถานศึกษา ' + d +
          ' เมตร (อนุญาตไม่เกิน ' + CFG.radius + ' เมตร)';
        if (todayPart && todayPart.period === 'PM' && todayRec && todayRec.checkIn){
          box.className = 'geo geo-wait';
          txt.textContent += ' — ลงเวลาออกนอกพื้นที่ได้ เนื่องจากได้รับอนุมัติ' + leaveName(todayPart);
        }
      }
    },
    err => {
      geo.ok = false;
      box.className = 'geo geo-out';
      txt.textContent = err.code === 1
        ? 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'
        : 'อ่านตำแหน่งไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่';
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
  );
}

/* ---------- กล้อง ---------- */
async function startStamp(mode){
  camMode = mode; snapData = null;
  $('camPh').classList.add('hide');
  $('camImg').classList.add('hide');
  const vid = $('camVid'); vid.classList.remove('hide');
  $('hoBtns').innerHTML = '<button class="b-out b-full" disabled>กำลังเปิดกล้อง…</button>';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:'user', width:{ ideal:640 } }, audio:false });
    vid.srcObject = camStream;
    await vid.play();
    $('hoBtns').innerHTML =
      '<button class="b-pri b-big b-full" onclick="takeSnap()" style="margin-bottom:10px">' +
      '<svg class="ic"><use href="#i-cam"/></svg>ถ่ายภาพ</button>' +
      '<button class="b-out b-full" onclick="cancelStamp()">ยกเลิก</button>';
  } catch(e){
    stopCamera();
    $('camPh').classList.remove('hide');
    $('camPh').textContent = 'เปิดกล้องไม่สำเร็จ ' +
      (e.name === 'NotAllowedError' ? 'กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์' : e.message);
    $('hoBtns').innerHTML = '<button class="b-out b-full" onclick="renderHomeState(dateKey())">ลองใหม่</button>';
  }
}
function stopCamera(){
  if (camStream){ camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  const v = $('camVid'); if (v){ v.srcObject = null; v.classList.add('hide'); }
}
function cancelStamp(){ stopCamera(); snapData = null;
  $('camImg').classList.add('hide'); $('camPh').classList.remove('hide');
  $('camPh').textContent = 'กดปุ่มด้านล่างเพื่อเปิดกล้องและบันทึกเวลา';
  renderHomeState(dateKey()); }

function takeSnap(){
  const vid = $('camVid'), cv = $('snapCanvas');
  const W = 420, H = Math.round(W * (vid.videoHeight / vid.videoWidth || 4/3));
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(vid, 0, 0, W, H);   // บันทึกภาพจริงโดยไม่กลับด้าน
  snapData = cv.toDataURL('image/jpeg', 0.55);
  stopCamera();
  const img = $('camImg'); img.src = snapData; img.classList.remove('hide');
  $('hoBtns').innerHTML =
    '<button class="b-pri b-big b-full" id="btnSave" onclick="submitStamp()" style="margin-bottom:10px">' +
    '<svg class="ic"><use href="#i-check"/></svg>' +
    (camMode === 'in' ? 'บันทึกเวลาเข้า' : 'บันทึกเวลาออก') + '</button>' +
    '<button class="b-out b-full" onclick="startStamp(camMode)">ถ่ายใหม่</button>';
}

/* ---------- บันทึกเวลา ---------- */
function saveBtn(state){
  const b = $('btnSave'); if (!b) return;
  if (state === 'busy'){ b.disabled = true; b.textContent = 'กำลังดำเนินการ…'; }
  else { b.disabled = false; b.textContent = camMode === 'in' ? 'บันทึกเวลาเข้า' : 'บันทึกเวลาออก'; }
}

function submitStamp(){
  if (!snapData) return toast('กรุณาถ่ายภาพก่อนบันทึก');
  // ตรวจพิกัดซ้ำ ณ ขณะกดปุ่ม
  saveBtn('busy');
  if (!navigator.geolocation) return finishStamp(null);
  navigator.geolocation.getCurrentPosition(
    p => {
      const d = haversine(p.coords.latitude, p.coords.longitude, Number(CFG.lat), Number(CFG.lng));
      geo = { ok:d <= Number(CFG.radius), lat:p.coords.latitude, lng:p.coords.longitude,
              dist:d, acc:Math.round(p.coords.accuracy) };
      const offsiteOk = camMode === 'out' && todayPart && todayPart.period === 'PM';
      if (!geo.ok && !offsiteOk){
        saveBtn('idle');
        requestGeo();
        return toast('อยู่นอกพื้นที่สถานศึกษา ' + d + ' เมตร จึงบันทึกเวลาไม่ได้');
      }
      finishStamp(geo);
    },
    () => {
      saveBtn('idle');
      toast('อ่านตำแหน่งไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่');
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
  );
}

function finishStamp(g){
  const now = new Date(), t = timeNow(now), mins = toMin(t);
  if (camMode === 'in' && todayPart && todayPart.period === 'AM'){
    if (mins < toMin(CFG.timeOpen)){
      saveBtn('idle');
      return toast('ยังไม่ถึงเวลาเปิดให้ลงเวลา (' + CFG.timeOpen + ' น.)');
    }
    return saveStamp(g, t, { late:false, duty:'AM', reason:leaveName(todayPart) });
  }
  if (camMode === 'out' && todayPart && todayPart.period === 'PM'){
    return saveStamp(g, t, { early:false, duty:'PM', offsite: !(g && g.ok),
                             reason:leaveName(todayPart) + (todayPart.reason ? ' · ' + todayPart.reason : '') });
  }
  if (camMode === 'in'){
    const late = mins > toMin(CFG.timeStart);
    if (mins < toMin(CFG.timeOpen)){
      saveBtn('idle');
      return toast('ยังไม่ถึงเวลาเปิดให้ลงเวลา (' + CFG.timeOpen + ' น.)');
    }
    if (mins > toMin(CFG.timeLate)){
      askReason('ลงเวลาเข้าหลัง ' + CFG.timeLate + ' น.',
        'เกินเวลาผ่อนผัน จึงต้องระบุเหตุผลประกอบการลงเวลา',
        reason => saveStamp(g, t, { late:true, reason }));
      return;
    }
    saveStamp(g, t, { late });
  } else {
    const early = mins < toMin(CFG.timeEnd);
    if (early){
      askReason('ลงเวลาออกก่อน ' + CFG.timeEnd + ' น.',
        'ออกก่อนเวลาเลิกปฏิบัติราชการ จึงต้องระบุเหตุผล',
        reason => saveStamp(g, t, { early:true, reason }));
      return;
    }
    saveStamp(g, t, { early });
  }
}

function askReason(title, desc, cb){
  $('rsTitle').textContent = title; $('rsDesc').textContent = desc;
  $('rsText').value = '';
  $('rsOk').onclick = () => {
    const v = $('rsText').value.trim();
    if (v.length < 3) return toast('กรุณาระบุเหตุผล');
    closeM('mReason'); cb(v);
  };
  openM('mReason');
  saveBtn('idle');
}

async function saveStamp(g, t, extra){
  saveBtn('busy');
  const today = dateKey(), mk = monthKey();
  const entry = Object.assign({
    time:t, ts:Date.now(), offsite:false,
    lat:g ? Number(g.lat.toFixed(6)) : null,
    lng:g ? Number(g.lng.toFixed(6)) : null,
    distance:g ? g.dist : null,
    accuracy:g ? g.acc : null
  }, extra);
  const field = camMode === 'in' ? 'checkIn' : 'checkOut';
  try {
    const base = 'attendance/' + mk + '/' + ME.uid + '/' + today;
    await db.ref(base).update({ date:today, uid:ME.uid, [field]:entry });
    // เก็บภาพแยกโหนด เพื่อไม่ให้รายงานต้องดึงภาพมาด้วย
    await db.ref('photos/' + mk + '/' + ME.uid + '/' + today + '/' + field).set(snapData);
    todayRec = Object.assign({}, todayRec || {}, { date:today, uid:ME.uid, [field]:entry });
    snapData = null;
    $('camImg').classList.add('hide'); $('camPh').classList.remove('hide');
    $('camPh').textContent = 'กดปุ่มด้านล่างเพื่อเปิดกล้องและบันทึกเวลา';
    renderHomeStamps(); renderHomeState(today);
    toast(camMode === 'in' ? 'บันทึกเวลาเข้า ' + t + ' น. แล้ว' : 'บันทึกเวลาออก ' + t + ' น. แล้ว');
  } catch(e){
    toast('บันทึกไม่สำเร็จ: ' + e.message);
    saveBtn('idle');
  }
}

/* ============================================================
   ส่วนที่ 7 : การลา
   ============================================================ */
async function loadLeavePage(){
  const fy = fiscalYear(dateKey());
  $('lvYear').textContent = 'ปีงบประมาณ ' + (fy + 543);
  const snap = await db.ref('leaves').orderByChild('uid').equalTo(ME.uid).get();
  myLeaves = snap.exists()
    ? Object.keys(snap.val()).map(id => Object.assign({ id }, snap.val()[id])) : [];
  myLeaves.sort((a,b) => b.createdAt - a.createdAt);
  renderQuota(fy);
  renderMyLeaves();
}

function usedDays(uid, typeId, fy){
  const r = fiscalRange(fy);
  return (uid === ME.uid ? myLeaves : allLeaves)
    .filter(l => l.uid === uid && l.type === typeId && l.status === 'APPROVED'
                 && l.dateFrom >= r.from && l.dateFrom <= r.to)
    .reduce((s,l) => s + (l.days || 0), 0);
}

function renderQuota(fy){
  $('lvQuota').innerHTML = LEAVE_TYPES.map(t => {
    const used = usedDays(ME.uid, t.id, fy);
    if (!t.quotaKey){
      return '<div class="row"><div class="row-m"><div class="row-n">' + t.name + '</div>' +
        '<div class="row-d">ใช้ไป ' + used + ' วัน · ไม่จำกัดสิทธิ์</div></div></div>';
    }
    const q = Number(CFG[t.quotaKey] || 0), left = q - used;
    const pct = q ? Math.min(100, Math.round(used/q*100)) : 0;
    const warn = q && used >= q ? '<span class="chip c-no">เกินสิทธิ์</span>'
               : (q && used >= q*0.8 ? '<span class="chip c-late">ใกล้เต็มสิทธิ์</span>' : '');
    return '<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px">' +
      '<div class="row-n">' + t.name + ' ' + warn + '</div>' +
      '<div class="row-time">' + (left < 0 ? 0 : left) + ' / ' + q + '</div></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:' +
        (used >= q ? 'var(--red)' : used >= q*0.8 ? 'var(--amber)' : 'var(--navy)') + '"></i></div>' +
      '<div class="row-d">ใช้ไปแล้ว ' + used + ' วัน</div></div>';
  }).join('');
}

function leaveChip(st){
  if (st === 'APPROVED') return '<span class="chip c-ok">อนุมัติแล้ว</span>';
  if (st === 'REJECTED') return '<span class="chip c-no">ไม่อนุมัติ</span>';
  return '<span class="chip c-late">รออนุมัติ</span>';
}

function renderMyLeaves(){
  if (!myLeaves.length){
    $('lvList').innerHTML = '<div class="empty">ยังไม่มีใบลา<br>กดปุ่มด้านบนเพื่อยื่นใบลา</div>';
    return;
  }
  $('lvList').innerHTML = myLeaves.map(l =>
    '<div class="row tap" onclick="viewLeave(\'' + l.id + '\',false)">' +
    '<div class="row-m"><div class="row-n">' + leaveName(l) + ' ' + leaveChip(l.status) + '</div>' +
    '<div class="row-d">' + thaiDateShort(l.dateFrom) +
      (l.dateFrom !== l.dateTo ? ' – ' + thaiDateShort(l.dateTo) : '') +
      ' · ' + l.days + ' วันทำการ</div></div>' +
    '<div class="row-r"><svg class="ic ic-s" style="color:var(--dim)"><use href="#i-list"/></svg></div></div>').join('');
}

function openLeaveForm(){
  alertBox('lfMsg',''); leaveType = null;
  $('lfPeriod').value = 'FULL';
  $('lfTypes').innerHTML = LEAVE_TYPES.map(t =>
    '<button type="button" class="opt" data-t="' + t.id + '" onclick="pickLeaveType(\'' + t.id + '\')">' +
    '<span class="dot"></span><span>' + t.name + '</span></button>').join('');
  const today = dateKey();
  $('lfFrom').value = today; $('lfTo').value = today;
  $('lfReason').value = '';
  calcLeaveDays();
  openM('mLeave');
}
function pickLeaveType(id){
  leaveType = id;
  document.querySelectorAll('#lfTypes .opt').forEach(b =>
    b.classList.toggle('on', b.getAttribute('data-t') === id));
  calcLeaveDays();
}
/** แสดงช่องช่วงเวลาทันทีที่เลือกไปราชการหรืออบรมสัมมนา
 *  ครึ่งวันเลือกได้เฉพาะเมื่อขอวันเดียว */
function syncPeriod(){
  const t = LEAVE_TYPES.find(x => x.id === leaveType);
  const show = !!(t && t.partial);
  const oneDay = $('lfFrom').value && $('lfFrom').value === $('lfTo').value;
  $('lfPeriodWrap').classList.toggle('hide', !show);
  ['AM','PM'].forEach(v => {
    const o = $('lfPeriod').querySelector('option[value="' + v + '"]');
    if (o) o.disabled = !oneDay;
  });
  if (!show || !oneDay) $('lfPeriod').value = 'FULL';
  $('lfPeriodHelp').textContent = !oneDay
    ? 'ขอหลายวันได้เฉพาะเต็มวัน หากต้องการครึ่งวัน ให้เลือกวันที่เริ่มและวันที่สิ้นสุดเป็นวันเดียวกัน'
    : 'ครึ่งวันบ่าย ไม่ต้องกลับมาลงเวลาออกที่โรงเรียน · ครึ่งวันเช้า ลงเวลาเข้าเมื่อกลับถึงโรงเรียนโดยไม่นับว่ามาสาย';
}
function calcLeaveDays(){
  const f = $('lfFrom').value, t = $('lfTo').value;
  if (!f || !t) return;
  if (t < f){ $('lfTo').value = f; }
  syncPeriod();
  let days = eachDate($('lfFrom').value, $('lfTo').value).filter(isWorkday).length;
  if (days && $('lfPeriod').value !== 'FULL') days = 0.5;
  const box = $('lfDays');
  box.textContent = 'รวม ' + days + ' วันทำการ (ไม่นับเสาร์อาทิตย์และวันหยุดที่บันทึกไว้)';
  box.className = 'alert a-info show';
  box._days = days;
}

async function submitLeave(){
  alertBox('lfMsg','');
  if (!leaveType) return alertBox('lfMsg','กรุณาเลือกประเภทการลา');
  const from = $('lfFrom').value, to = $('lfTo').value;
  const reason = $('lfReason').value.trim();
  if (!from || !to) return alertBox('lfMsg','กรุณาเลือกวันที่');
  if (reason.length < 3) return alertBox('lfMsg','กรุณาระบุเหตุผลการลา');
  const days = $('lfDays')._days || 0;
  if (!days) return alertBox('lfMsg','ช่วงวันที่เลือกไม่มีวันทำการ');

  const t = LEAVE_TYPES.find(x => x.id === leaveType);
  if (t.quotaKey){
    const q = Number(CFG[t.quotaKey] || 0);
    const used = usedDays(ME.uid, t.id, fiscalYear(from));
    if (used + days > q){
      const ok = confirm('การลาครั้งนี้จะทำให้ใช้สิทธิ์ ' + t.name + ' รวม ' +
        (used + days) + ' วัน ซึ่งเกินสิทธิ์ ' + q + ' วัน\n\nต้องการยื่นใบลาต่อไปหรือไม่');
      if (!ok) return;
    }
  }

  const btn = $('lfBtn'); btn.disabled = true; btn.textContent = 'กำลังส่ง…';
  try {
    const ref = db.ref('leaves').push();
    await ref.set({
      uid:ME.uid, name:fullName(ME), type:leaveType, dateFrom:from, dateTo:to,
      period:$('lfPeriod').value || 'FULL',
      days, reason, status:'PENDING', createdAt:Date.now(),
      decidedBy:null, decidedAt:null, comment:null
    });
    closeM('mLeave');
    toast('ส่งใบลาแล้ว รอผู้อำนวยการพิจารณา');
    loadLeavePage();
  } catch(e){
    alertBox('lfMsg','ส่งไม่สำเร็จ: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'ส่งใบลา';
  }
}

function viewLeave(id, canDecide){
  const list = canDecide ? allLeaves : myLeaves;
  const l = list.find(x => x.id === id); if (!l) return;
  $('lvvTitle').textContent = leaveName(l);
  $('lvvSub').textContent = l.name || fullName(USERS[l.uid]);
  $('lvvBody').innerHTML =
    '<div class="kv"><span class="k">สถานะ</span><span class="v">' + leaveChip(l.status) + '</span></div>' +
    '<div class="kv"><span class="k">ช่วงวันที่</span><span class="v">' + thaiDate(l.dateFrom) +
      (l.dateFrom !== l.dateTo ? '<br>ถึง ' + thaiDate(l.dateTo) : '') + '</span></div>' +
    '<div class="kv"><span class="k">จำนวน</span><span class="v">' + l.days + ' วันทำการ' +
      (isPartial(l) ? ' (' + PERIOD_NAME[l.period] + ')' : '') + '</span></div>' +
    '<div class="kv"><span class="k">เหตุผล</span><span class="v">' + esc(l.reason) + '</span></div>' +
    (l.comment ? '<div class="kv"><span class="k">ความเห็น</span><span class="v">' + esc(l.comment) + '</span></div>' : '') +
    (l.decidedBy ? '<div class="kv"><span class="k">ผู้พิจารณา</span><span class="v">' +
      esc(fullName(USERS[l.decidedBy])) + '</span></div>' : '');

  const canAct = canDecide && l.status === 'PENDING';
  $('lvvCmtWrap').classList.toggle('hide', !canAct);
  $('lvvCmt').value = '';
  $('lvvFoot').innerHTML = canAct
    ? '<button class="b-out" onclick="closeM(\'mLeaveView\')">ปิด</button>' +
      '<button class="b-del" onclick="decideLeave(\'' + l.id + '\',false)">ไม่อนุมัติ</button>' +
      '<button class="b-ok" onclick="decideLeave(\'' + l.id + '\',true)">อนุมัติ</button>'
    : '<button class="b-out" onclick="closeM(\'mLeaveView\')">ปิด</button>';
  openM('mLeaveView');
}

async function decideLeave(id, approve){
  const cmt = $('lvvCmt').value.trim();
  if (!approve && cmt.length < 3) return toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  try {
    await db.ref('leaves/' + id).update({
      status: approve ? 'APPROVED' : 'REJECTED',
      decidedBy:ME.uid, decidedAt:Date.now(), comment:cmt || null
    });
    closeM('mLeaveView');
    toast(approve ? 'อนุมัติใบลาแล้ว' : 'บันทึกการไม่อนุมัติแล้ว');
    loadPendingLeaves();
  } catch(e){ toast('บันทึกไม่สำเร็จ: ' + e.message); }
}

/* ============================================================
   ส่วนที่ 8 : ประวัติของฉัน
   ============================================================ */
function initHistory(){
  $('hsSub').textContent = fullName(ME) + ' · ' + ME.position;
  if (!$('hsMonth').value) $('hsMonth').value = monthKey();
  loadHistory();
}

async function loadHistory(){
  const mk = $('hsMonth').value || monthKey();
  $('hsList').innerHTML = '<div class="empty">กำลังโหลด…</div>';
  const [attSnap, lvSnap] = await Promise.all([
    db.ref('attendance/' + mk + '/' + ME.uid).get(),
    db.ref('leaves').orderByChild('uid').equalTo(ME.uid).get()
  ]);
  const att = attSnap.exists() ? attSnap.val() : {};
  myLeaves = lvSnap.exists()
    ? Object.keys(lvSnap.val()).map(id => Object.assign({ id }, lvSnap.val()[id])) : [];

  const [y,m] = mk.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const today = dateKey();
  let work = 0, onTime = 0, late = 0, leaveD = 0, absent = 0, noOut = 0;
  const rows = [];

  for (let d = 1; d <= last; d++){
    const key = mk + '-' + pad(d);
    if (key > today) break;
    if (!isWorkday(key)) continue;
    work++;
    const r = att[key], lv = leaveOn(key), ap = approvedOn(myLeaves, ME.uid, key);
    if (r && r.checkIn){
      if (effLate(r, ap)) late++; else onTime++;
      if (missingOut(r, ap)) noOut++;
      rows.push({ key, kind:'att', r, ap });
    } else if (ap && isPartial(ap)){
      absent++; rows.push({ key, kind:'absent', ap });
    } else if (lv && lv.status === 'APPROVED'){
      leaveD++; rows.push({ key, kind:'leave', lv });
    } else if (lv && lv.status === 'PENDING'){
      rows.push({ key, kind:'pending', lv });
    } else {
      absent++; rows.push({ key, kind:'absent' });
    }
  }

  $('hsTiles').innerHTML =
    tile('วันทำการ', work, 'วัน') + tile('ตรงเวลา', onTime, 'วัน') +
    tile('มาสาย', late, 'วัน') + tile('ลา', leaveD, 'วัน') +
    tile('ไม่ได้ลงเวลา', absent, 'วัน') + tile('ไม่ได้ลงเวลาออก', noOut, 'วัน');

  $('hsList').innerHTML = rows.length
    ? rows.reverse().map(x => historyRow(x)).join('')
    : '<div class="empty">ยังไม่มีข้อมูลในเดือนนี้</div>';
}

function tile(label, val, unit){
  return '<div class="tile"><div class="l">' + label + '</div>' +
    '<div class="v">' + val + '</div><div class="s">' + unit + '</div></div>';
}

function historyRow(x){
  const d = thaiDateShort(x.key);
  if (x.kind === 'att'){
    const ci = x.r.checkIn, co = x.r.checkOut;
    return '<div class="row tap" onclick="viewStamp(\'' + x.key + '\',\'' + ME.uid + '\')">' +
      '<div class="row-m"><div class="row-n">' + d + ' ' +
        (effLate(x.r, x.ap) ? '<span class="chip c-late">สาย</span>' : '<span class="chip c-ok">ตรงเวลา</span>') +
        (missingOut(x.r, x.ap) ? ' <span class="chip c-no">ไม่ได้ลงเวลาออก</span>' : '') +
        (isPartial(x.ap) ? ' <span class="chip c-info">' + leaveName(x.ap) + '</span>' : '') + '</div>' +
      '<div class="row-d">เข้า ' + ci.time + (co ? ' · ออก ' + co.time : '') + '</div></div></div>';
  }
  if (x.kind === 'leave')
    return '<div class="row"><div class="row-m"><div class="row-n">' + d +
      ' <span class="chip c-info">' + leaveName(x.lv) + '</span></div>' +
      '<div class="row-d">อนุมัติแล้ว</div></div></div>';
  if (x.kind === 'pending')
    return '<div class="row"><div class="row-m"><div class="row-n">' + d +
      ' <span class="chip c-late">รออนุมัติการลา</span></div>' +
      '<div class="row-d">' + leaveName(x.lv) + '</div></div></div>';
  return '<div class="row"><div class="row-m"><div class="row-n">' + d +
    ' <span class="chip c-no">ไม่ได้ลงเวลา</span></div>' +
    (x.ap ? '<div class="row-d">' + leaveName(x.ap) + ' (อนุมัติแล้ว)</div>' : '') + '</div></div>';
}

async function viewStamp(key, uid){
  const mk = key.slice(0,7);
  $('dtTitle').textContent = thaiDate(key);
  $('dtSub').textContent = fullName(USERS[uid]);
  $('dtBody').innerHTML = '<div class="empty">กำลังโหลด…</div>';
  openM('mDetail');
  const [rSnap, pSnap] = await Promise.all([
    db.ref('attendance/' + mk + '/' + uid + '/' + key).get(),
    db.ref('photos/' + mk + '/' + uid + '/' + key).get()
  ]);
  if (!rSnap.exists()){ $('dtBody').innerHTML = '<div class="empty">ไม่พบข้อมูล</div>'; return; }
  const r = rSnap.val(), ph = pSnap.exists() ? pSnap.val() : {};
  const part = (label, e, img) => {
    if (!e) return '<div class="sec-t">' + label + '</div><div class="empty">ไม่มีข้อมูล</div>';
    return '<div class="sec-t">' + label + '</div>' +
      (img ? '<img src="' + img + '" alt="" style="width:100%;max-width:240px;border-radius:8px;margin-bottom:10px">' : '') +
      '<div class="kv"><span class="k">เวลา</span><span class="v">' + e.time + ' น. ' +
        (e.late ? '<span class="chip c-late">สาย</span>' : '') +
        (e.early ? '<span class="chip c-late">ออกก่อนเวลา</span>' : '') +
        (e.offsite ? '<span class="chip c-info">นอกพื้นที่</span>' : '') + '</span></div>' +
      '<div class="kv"><span class="k">ระยะจากโรงเรียน</span><span class="v">' +
        (e.distance != null ? e.distance + ' เมตร' : '—') + '</span></div>' +
      (e.reason ? '<div class="kv"><span class="k">เหตุผล</span><span class="v">' + esc(e.reason) + '</span></div>' : '');
  };
  $('dtBody').innerHTML = part('การลงเวลาเข้า', r.checkIn, ph.checkIn) +
                          part('การลงเวลาออก', r.checkOut, ph.checkOut);
}

/* ============================================================
   ส่วนที่ 9 : แดชบอร์ด
   ============================================================ */
function initDash(){
  $('dbSub').textContent = CFG.schoolName + ' · ' + thaiDate(dateKey());
  if (!$('dbMonthPick').value) $('dbMonthPick').value = monthKey();
  if (!$('dbDay').value) $('dbDay').value = dateKey();
  $('dbDay').max = dateKey();            // เลือกวันในอนาคตไม่ได้
  dashTab('today');
}
function dashTab(t){
  ['dbToday','dbMonth','dbLeave'].forEach((p,i) => {
    $(p).classList.toggle('hide', ['today','month','leave'][i] !== t);
    $('dbT' + (i+1)).classList.toggle('on', ['today','month','leave'][i] === t);
  });
  if (t === 'today') loadDashToday();
  if (t === 'month') loadDashMonth();
  if (t === 'leave') loadPendingLeaves();
}

function activeUsers(){
  return Object.keys(USERS).filter(u => USERS[u].status === 'ACTIVE').sort();
}

async function loadDashToday(){
  const today = $('dbDay').value || dateKey();
  const mk = today.slice(0, 7);
  const isToday = today === dateKey();
  $('dbDayLabel').textContent = isToday
    ? 'สถานะรายบุคคลวันนี้' : 'สถานะรายบุคคล ' + thaiDateShort(today);
  $('dbRows').innerHTML = '<div class="empty">กำลังโหลด…</div>';
  const [attSnap, lvSnap] = await Promise.all([
    db.ref('attendance/' + mk).get(), db.ref('leaves').get()
  ]);
  const att = attSnap.exists() ? attSnap.val() : {};
  allLeaves = lvSnap.exists()
    ? Object.keys(lvSnap.val()).map(id => Object.assign({ id }, lvSnap.val()[id])) : [];

  if (!isWorkday(today)){
    const why = HOLIDAYS[today] ? HOLIDAYS[today].name : 'วันหยุดประจำสัปดาห์';
    $('dbTiles').innerHTML = '';
    $('dbRows').innerHTML = '<div class="empty">' +
      (isToday ? 'วันนี้' : thaiDateShort(today)) + 'ไม่ใช่วันทำการ<br>' + esc(why) + '</div>';
    return;
  }

  let onTime = 0, late = 0, lv = 0, none = 0, noOut = 0;
  const rows = activeUsers().map(uid => {
    const u = USERS[uid];
    const r = (att[uid] || {})[today];
    const l = allLeaves.find(x => x.uid === uid && x.status !== 'REJECTED'
                                  && x.dateFrom <= today && today <= x.dateTo);
    const ap = approvedOn(allLeaves, uid, today);
    let chip, note;
    if (r && r.checkIn){
      if (effLate(r, ap)){ late++; chip = '<span class="chip c-late">มาสาย</span>'; }
      else { onTime++; chip = '<span class="chip c-ok">ตรงเวลา</span>'; }
      if (missingOut(r, ap)){ noOut++; chip += ' <span class="chip c-no">ยังไม่ลงเวลาออก</span>'; }
      if (isPartial(ap)) chip += ' <span class="chip c-info">' + leaveName(ap) + '</span>';
      note = 'เข้า ' + r.checkIn.time + (r.checkOut ? ' · ออก ' + r.checkOut.time +
        (r.checkOut.offsite ? ' (นอกพื้นที่)' : '') : '');
    } else if (ap && isPartial(ap)){
      none++; chip = '<span class="chip c-no">ยังไม่ลงเวลา</span>'; note = leaveName(ap) + ' (อนุมัติแล้ว)';
    } else if (ap){
      lv++; chip = '<span class="chip c-info">' + leaveName(ap) + '</span>'; note = 'อนุมัติแล้ว';
    } else if (l && l.status === 'PENDING'){
      chip = '<span class="chip c-late">รออนุมัติการลา</span>'; note = leaveName(l);
    } else {
      none++; chip = '<span class="chip c-no">ยังไม่ลงเวลา</span>'; note = '—';
    }
    return '<div class="row' + (r && r.checkIn ? ' tap' : '') + '"' +
      (r && r.checkIn ? ' onclick="viewStamp(\'' + today + '\',\'' + uid + '\')"' : '') + '>' +
      '<div class="row-av">' + esc(initials(u)) + '</div>' +
      '<div class="row-m"><div class="row-n">' + esc(fullName(u)) + '</div>' +
      '<div class="row-d">' + note + '</div></div>' +
      '<div class="row-r">' + chip + '</div></div>';
  });

  $('dbTiles').innerHTML = tile('ตรงเวลา', onTime, 'คน') + tile('มาสาย', late, 'คน') +
    tile('ลา', lv, 'คน') + tile('ยังไม่ลงเวลา', none, 'คน');
  $('dbRows').innerHTML = rows.join('') || '<div class="empty">ยังไม่มีบุคลากรในระบบ</div>';
}

async function loadDashMonth(){
  const mk = $('dbMonthPick').value || monthKey();
  $('dbMonthList').innerHTML = '<div class="empty">กำลังโหลด…</div>';
  const [attSnap, lvSnap] = await Promise.all([
    db.ref('attendance/' + mk).get(), db.ref('leaves').get()
  ]);
  const att = attSnap.exists() ? attSnap.val() : {};
  allLeaves = lvSnap.exists()
    ? Object.keys(lvSnap.val()).map(id => Object.assign({ id }, lvSnap.val()[id])) : [];

  const [y,m] = mk.split('-').map(Number);
  const last = new Date(y, m, 0).getDate(), today = dateKey();
  const days = [];
  for (let d = 1; d <= last; d++){
    const key = mk + '-' + pad(d);
    if (key > today) break;
    if (isWorkday(key)) days.push(key);
  }

  $('dbMonthList').innerHTML = activeUsers().map(uid => {
    const u = USERS[uid], mine = att[uid] || {};
    let onTime = 0, late = 0, lv = 0, absent = 0;
    days.forEach(key => {
      const r = mine[key];
      const l = approvedOn(allLeaves, uid, key);
      if (r && r.checkIn){ effLate(r, l) ? late++ : onTime++; }
      else if (l && !isPartial(l)) lv++; else absent++;
    });
    const pct = days.length ? Math.round((onTime + late) / days.length * 100) : 0;
    return '<div class="row" style="display:block">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">' +
      '<div class="row-n">' + esc(fullName(u)) + '</div>' +
      '<div class="row-time">' + pct + '%</div></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="row-d">ตรงเวลา ' + onTime + ' · สาย ' + late + ' · ลา ' + lv +
        ' · ไม่ได้ลงเวลา ' + absent + ' จาก ' + days.length + ' วันทำการ</div></div>';
  }).join('') || '<div class="empty">ยังไม่มีข้อมูล</div>';
}

async function loadPendingLeaves(){
  $('dbLeaveList').innerHTML = '<div class="empty">กำลังโหลด…</div>';
  const snap = await db.ref('leaves').get();
  allLeaves = snap.exists()
    ? Object.keys(snap.val()).map(id => Object.assign({ id }, snap.val()[id])) : [];
  allLeaves.sort((a,b) => b.createdAt - a.createdAt);
  const pend = allLeaves.filter(l => l.status === 'PENDING');
  const done = allLeaves.filter(l => l.status !== 'PENDING').slice(0, 20);

  const render = l =>
    '<div class="row tap" onclick="viewLeave(\'' + l.id + '\',true)">' +
    '<div class="row-av">' + esc(initials(USERS[l.uid] || {})) + '</div>' +
    '<div class="row-m"><div class="row-n">' + esc(l.name || fullName(USERS[l.uid])) + '</div>' +
    '<div class="row-d">' + leaveName(l) + ' · ' + thaiDateShort(l.dateFrom) +
      (l.dateFrom !== l.dateTo ? ' – ' + thaiDateShort(l.dateTo) : '') +
      ' · ' + l.days + ' วัน</div></div>' +
    '<div class="row-r">' + leaveChip(l.status) + '</div></div>';

  $('dbLeaveList').innerHTML =
    '<div class="card-t" style="margin-bottom:8px">รอพิจารณา ' + pend.length + ' รายการ</div>' +
    (pend.length ? pend.map(render).join('') : '<div class="empty">ไม่มีใบลารอพิจารณา</div>') +
    '<div class="sec-t">พิจารณาแล้ว</div>' +
    (done.length ? done.map(render).join('') : '<div class="empty">ยังไม่มีรายการ</div>');
}

/* ============================================================
   ส่วนที่ 9.1 : รายงานการลงเวลาปฏิบัติราชการ
   จัดทำเป็นรายวัน หนึ่งวันต่อหนึ่งแผ่น พร้อมช่องรับรอง
   ============================================================ */
let rpMode = 'day';

function initReport(){
  if (!$('rpDay').value) $('rpDay').value = dateKey();
  if (!$('rpMonth').value) $('rpMonth').value = monthKey();
  $('rpDay').max = dateKey();
  reportMode('day');
}

function reportMode(m){
  rpMode = m;
  $('rpT1').classList.toggle('on', m === 'day');
  $('rpT2').classList.toggle('on', m === 'month');
  $('rpDayWrap').classList.toggle('hide', m !== 'day');
  $('rpMonthWrap').classList.toggle('hide', m !== 'month');
  buildReport();
}

/** รวบรวมข้อมูลของวันเดียว คืน null เมื่อไม่ใช่วันทำการ */
function dayData(dateStr, att, leaves){
  if (!isWorkday(dateStr)) return null;
  return activeUsers().map(uid => {
    const u = USERS[uid];
    const r = (att[uid] || {})[dateStr];
    const l = leaves.find(x => x.uid === uid && x.status === 'APPROVED'
                               && x.dateFrom <= dateStr && dateStr <= x.dateTo);
    const p = leaves.find(x => x.uid === uid && x.status === 'PENDING'
                               && x.dateFrom <= dateStr && dateStr <= x.dateTo);
    let inT = '—', outT = '—', st = '', note = '';
    if (r && r.checkIn){
      inT  = r.checkIn.time;
      outT = r.checkOut ? r.checkOut.time : '—';
      st   = effLate(r, l) ? 'มาสาย' : 'ปกติ';
      const n = [];
      if (isPartial(l) && !r.checkIn.duty && !(r.checkOut && r.checkOut.duty))
        n.push(leaveName(l) + (l.reason ? ' · ' + l.reason : ''));
      if (r.checkIn.reason)  n.push(r.checkIn.reason);
      if (r.checkOut && r.checkOut.reason) n.push(r.checkOut.reason);
      if (r.checkOut && r.checkOut.offsite) n.push('ลงเวลากลับนอกพื้นที่');
      if (missingOut(r, l)) n.push('ไม่ได้ลงเวลากลับ');
      note = n.join(' · ');
    } else if (l && isPartial(l)){
      st = 'ไม่ได้ลงเวลา';
      note = leaveName(l) + ' (อนุมัติแล้ว)';
    } else if (l){
      st = leaveName(l);
      note = l.reason || '';
    } else if (p){
      st = 'รออนุมัติการลา';
      note = leaveName(p) + (p.reason ? ' · ' + p.reason : '');
    } else {
      st = 'ไม่ได้ลงเวลา';
    }
    return { uid, u, inT, outT, st, note,
             present: !!(r && r.checkIn), leave: !!l && !isPartial(l), type: staffTypeOf(u) };
  });
}

/** ตารางสรุปท้ายแผ่น แยกตามประเภทบุคลากร */
function summaryRows(rows){
  const used = STAFF_TYPES.filter(t => rows.some(r => r.type === t));
  const cells = used.map(t => {
    const g = rows.filter(r => r.type === t);
    const pre = g.filter(r => r.present).length;
    const lv  = g.filter(r => !r.present && r.leave).length;
    const ab  = g.length - pre - lv;
    return '<tr><td class="l">' + esc(t) + '</td>' +
      '<td class="c">' + g.length + '</td><td class="c">' + pre + '</td>' +
      '<td class="c">' + lv + '</td><td class="c">' + ab + '</td></tr>';
  }).join('');
  const pre = rows.filter(r => r.present).length;
  const lv  = rows.filter(r => !r.present && r.leave).length;
  return '<table class="rp-sum"><thead><tr>' +
    '<th class="l">ประเภทบุคลากร</th><th>ทั้งหมด</th><th>มาปฏิบัติราชการ</th>' +
    '<th>ลา</th><th>ไม่ได้ลงเวลา</th></tr></thead><tbody>' + cells +
    '<tr class="tot"><td class="l">รวมทั้งสิ้น</td><td class="c">' + rows.length +
    '</td><td class="c">' + pre + '</td><td class="c">' + lv +
    '</td><td class="c">' + (rows.length - pre - lv) + '</td></tr>' +
    '</tbody></table>';
}

function dayPage(dateStr, rows){
  const body = rows.map((r, i) =>
    '<tr><td class="c">' + (i+1) + '</td>' +
    '<td class="l">' + esc(fullName(r.u)) + '</td>' +
    '<td class="l">' + esc(r.u.position || '') + '</td>' +
    '<td class="c">' + esc(r.inT) + '</td>' +
    '<td class="c">' + esc(r.outT) + '</td>' +
    '<td class="c">' + esc(r.st) + '</td>' +
    '<td class="l small">' + esc(r.note) + '</td></tr>').join('');

  return '<section class="rp-page">' +
    '<div class="rp-hd">' +
      '<div class="t1">บันทึกการลงเวลาปฏิบัติราชการ</div>' +
      '<div class="t2">' + esc(CFG.schoolName || '') + '</div>' +
      '<div class="t3">' + esc(CFG.areaOffice || '') + '</div>' +
      '<div class="t3 bold">' + thaiDate(dateStr) + '</div>' +
    '</div>' +
    '<table class="rp-main"><thead><tr>' +
      '<th style="width:9mm">ที่</th><th style="width:52mm">ชื่อ-สกุล</th>' +
      '<th style="width:34mm">ตำแหน่ง</th><th style="width:19mm">เวลามา</th>' +
      '<th style="width:19mm">เวลากลับ</th><th style="width:26mm">สถานะ</th>' +
      '<th>หมายเหตุ</th></tr></thead><tbody>' + body + '</tbody></table>' +
    summaryRows(rows) +
    '<div class="rp-note">ข้อมูลเวลาบันทึกโดยระบบลงเวลาปฏิบัติราชการอิเล็กทรอนิกส์ ' +
      'ซึ่งตรวจสอบพิกัดภายในบริเวณสถานศึกษาและบันทึกภาพยืนยันทุกครั้ง</div>' +
    '<div class="rp-sign"><div class="box">' +
      '<div>ขอรับรองว่าข้อมูลข้างต้นถูกต้องตรงตามความเป็นจริง</div>' +
      '<div class="ln"></div>' +
      '<div>( ' + esc(directorName()) + ' )</div>' +
      '<div>ผู้อำนวยการ' + esc(CFG.schoolName || '') + '</div>' +
      '<div class="small">วันที่ ........ เดือน .................... พ.ศ. ..........</div>' +
    '</div></div>' +
  '</section>';
}

function directorName(){
  const d = Object.keys(USERS).find(u =>
    USERS[u].role === 'DIRECTOR' && USERS[u].status === 'ACTIVE');
  return d ? fullName(USERS[d]) : '.......................................';
}

async function buildReport(){
  const out = $('rpOut');
  out.innerHTML = '<div class="empty">กำลังจัดทำรายงาน…</div>';
  alertBox('rpMsg', '', 'info');

  let days = [];
  if (rpMode === 'day'){
    days = [$('rpDay').value || dateKey()];
  } else {
    const mk = $('rpMonth').value || monthKey();
    const [y, m] = mk.split('-').map(Number);
    const last = new Date(y, m, 0).getDate(), today = dateKey();
    for (let d = 1; d <= last; d++){
      const key = mk + '-' + pad(d);
      if (key > today) break;
      days.push(key);
    }
  }

  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  const [attList, lvSnap] = await Promise.all([
    Promise.all(months.map(m => db.ref('attendance/' + m).get())),
    db.ref('leaves').get()
  ]);
  const attByMonth = {};
  months.forEach((m, i) => { attByMonth[m] = attList[i].exists() ? attList[i].val() : {}; });
  const leaves = lvSnap.exists()
    ? Object.keys(lvSnap.val()).map(id => Object.assign({ id }, lvSnap.val()[id])) : [];

  const pages = [], skipped = [];
  days.forEach(d => {
    const rows = dayData(d, attByMonth[d.slice(0, 7)], leaves);
    if (!rows) { skipped.push(d); return; }
    pages.push(dayPage(d, rows));
  });

  if (!pages.length){
    out.innerHTML = '';
    alertBox('rpMsg', rpMode === 'day'
      ? thaiDateShort(days[0]) + ' ไม่ใช่วันทำการ จึงไม่มีรายงาน'
      : 'เดือนที่เลือกยังไม่มีวันทำการ', 'warn');
    return;
  }

  out.innerHTML = pages.join('');
  alertBox('rpMsg', 'จัดทำแล้ว ' + pages.length + ' แผ่น' +
    (skipped.length ? ' (ข้ามวันหยุด ' + skipped.length + ' วัน)' : ''), 'info');
}

/* ============================================================
   ส่วนที่ 10 : ตั้งค่าระบบ
   ============================================================ */
function initAdmin(){ adminTab('users'); }
function adminTab(t){
  ['adUsers','adConfig','adHoliday'].forEach((p,i) => {
    $(p).classList.toggle('hide', ['users','config','holiday'][i] !== t);
    $('adT' + (i+1)).classList.toggle('on', ['users','config','holiday'][i] === t);
  });
  if (t === 'users') loadUserList();
  if (t === 'config') fillConfig();
  if (t === 'holiday') loadHolidayList();
}

/* ---------- ทะเบียนบุคลากร ---------- */
async function loadUserList(){
  const snap = await db.ref('users').get();
  USERS = snap.exists() ? snap.val() : {};
  $('adUserList').innerHTML = Object.keys(USERS).sort().map(uid => {
    const u = USERS[uid];
    const chips = '<span class="chip ' + (u.role === 'DIRECTOR' ? 'c-late' : 'c-info') + '">' +
        (u.role === 'DIRECTOR' ? 'ผู้อำนวยการ' : 'ผู้ปฏิบัติงาน') + '</span>' +
      (u.isAdmin ? ' <span class="chip c-ok">ผู้ดูแล</span>' : '') +
      (u.status !== 'ACTIVE' ? ' <span class="chip c-off">พ้นหน้าที่</span>' : '') +
      (u.mustChangePin ? ' <span class="chip c-late">รอเปลี่ยนรหัส</span>' : '');
    return '<div class="row"><div class="row-av">' + esc(initials(u)) + '</div>' +
      '<div class="row-m"><div class="row-n">' + esc(fullName(u)) + '</div>' +
      '<div class="row-d">' + esc(u.position || '') +
        ' · ' + esc(staffTypeOf(u)) + '</div>' +
      '<div class="chips" style="margin-top:4px">' + chips + '</div></div>' +
      '<div class="row-r" style="display:flex;flex-direction:column;gap:6px">' +
      '<button class="b-out b-sm" onclick="openUserForm(\'' + uid + '\')">แก้ไข</button>' +
      '<button class="b-sec b-sm" onclick="resetPin(\'' + uid + '\')">รหัสใหม่</button>' +
      '</div></div>';
  }).join('') || '<div class="empty">ยังไม่มีบุคลากร</div>';
}

function toggleAdmin(){
  ufAdmin = !ufAdmin;
  $('ufAdminRow').classList.toggle('on', ufAdmin);
}

function openUserForm(uid){
  alertBox('ufMsg',''); editUid = uid || null;
  const u = uid ? USERS[uid] : null;
  $('ufTitle').textContent = uid ? 'แก้ไขข้อมูลบุคลากร' : 'เพิ่มบุคลากร';
  $('ufDesc').textContent = uid ? uid + ' · ' + fullName(u)
    : 'ระบบจะสร้างรหัส PIN ให้อัตโนมัติหลังบันทึก';
  $('ufPrefix').value = u ? (u.prefix || '') : '';
  $('ufFirst').value  = u ? (u.firstName || '') : '';
  $('ufLast').value   = u ? (u.lastName || '') : '';
  $('ufPos').value    = u ? (u.position || '') : '';
  $('ufType').innerHTML = STAFF_TYPES.map(t =>
    '<option value="' + t + '">' + t + '</option>').join('');
  $('ufType').value   = u ? staffTypeOf(u) : 'ข้าราชการครู';
  $('ufRole').value   = u ? (u.role || 'TEACHER') : 'TEACHER';
  $('ufStatus').value = u ? (u.status || 'ACTIVE') : 'ACTIVE';
  $('ufLark').value   = u ? (u.larkUserId || '') : '';
  $('ufStWrap').style.display = uid ? 'block' : 'none';
  ufAdmin = u ? !!u.isAdmin : false;
  $('ufAdminRow').classList.toggle('on', ufAdmin);
  openM('mUser');
}

function nextUid(){
  let max = 0;
  Object.keys(USERS).forEach(u => {
    const m = /^U(\d+)$/.exec(u); if (m) max = Math.max(max, Number(m[1]));
  });
  return 'U' + String(max + 1).padStart(3, '0');
}

async function saveUser(){
  alertBox('ufMsg','');
  const first = $('ufFirst').value.trim(), last = $('ufLast').value.trim();
  const pos = $('ufPos').value.trim(), role = $('ufRole').value;
  const status = editUid ? $('ufStatus').value : 'ACTIVE';
  if (!first || !last) return alertBox('ufMsg','กรุณากรอกชื่อและนามสกุล');
  if (!pos) return alertBox('ufMsg','กรุณากรอกตำแหน่ง');

  const dup = Object.keys(USERS).find(u => u !== editUid &&
    USERS[u].firstName === first && USERS[u].lastName === last);
  if (dup) return alertBox('ufMsg','มีชื่อ-สกุลนี้ในทะเบียนแล้ว (' + dup + ')');

  if (editUid){
    const willAdmin = ufAdmin, willActive = status === 'ACTIVE';
    if (USERS[editUid].isAdmin && (!willAdmin || !willActive)){
      const others = Object.keys(USERS).filter(u => u !== editUid &&
        USERS[u].isAdmin && USERS[u].status === 'ACTIVE');
      if (!others.length)
        return alertBox('ufMsg','ดำเนินการไม่ได้ เพราะจะไม่เหลือผู้ดูแลระบบที่ปฏิบัติงานอยู่');
    }
  }

  const btn = $('ufBtn'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    const base = {
      prefix:$('ufPrefix').value.trim(), firstName:first, lastName:last,
      position:pos, role, isAdmin:ufAdmin, status,
      staffType:$('ufType').value,
      larkUserId:$('ufLark').value.trim()
    };
    if (editUid){
      await db.ref('users/' + editUid).update(base);
      USERS[editUid] = Object.assign({}, USERS[editUid], base);
      if (editUid === ME.uid) ME = Object.assign(ME, base);
      closeM('mUser'); toast('บันทึกการแก้ไขแล้ว'); loadUserList();
    } else {
      const uid = nextUid(), pin = randomPin(), salt = newSalt();
      const user = Object.assign({ uid, salt, pinHash:await hashPin(pin, salt),
        mustChangePin:true, createdAt:Date.now() }, base);
      await db.ref('users/' + uid).set(user);
      USERS[uid] = user;
      closeM('mUser');
      $('psFor').textContent = fullName(user) + ' · รหัส ' + uid;
      $('psNum').textContent = pin;
      openM('mPinShow');
    }
  } catch(e){
    alertBox('ufMsg','บันทึกไม่สำเร็จ: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึก';
  }
}

async function resetPin(uid){
  const u = USERS[uid];
  if (!confirm('ตั้งรหัส PIN ใหม่ให้ ' + fullName(u) + ' ใช่หรือไม่\n\nรหัสเดิมจะใช้งานไม่ได้ทันที')) return;
  try {
    const pin = randomPin(), salt = newSalt();
    await db.ref('users/' + uid).update({ salt, pinHash:await hashPin(pin, salt), mustChangePin:true });
    USERS[uid] = Object.assign({}, u, { salt, mustChangePin:true });
    $('psFor').textContent = fullName(u) + ' · รหัส ' + uid;
    $('psNum').textContent = pin;
    openM('mPinShow');
  } catch(e){ toast('ตั้งรหัสใหม่ไม่สำเร็จ: ' + e.message); }
}

/* ---------- เกณฑ์และพิกัด ---------- */
function fillConfig(){
  $('cfSchool').value = CFG.schoolName || '';
  $('cfArea').value   = CFG.areaOffice || '';
  $('cfOpen').value   = CFG.timeOpen;  $('cfStart').value = CFG.timeStart;
  $('cfLate').value   = CFG.timeLate;  $('cfEnd').value   = CFG.timeEnd;
  $('cfRemIn').value  = CFG.remindIn;  $('cfRemOut').value = CFG.remindOut;
  $('cfLat').value    = CFG.lat;  $('cfLng').value = CFG.lng;  $('cfRadius').value = CFG.radius;
  $('cfQSick').value  = CFG.qSick; $('cfQBiz').value = CFG.qBiz;
  $('cfQMat').value  = CFG.qMat;
  $('cfLark').value   = CFG.larkWebhook || '';
}
function useMyLocation(){
  if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง');
  toast('กำลังอ่านตำแหน่ง…');
  navigator.geolocation.getCurrentPosition(p => {
    $('cfLat').value = p.coords.latitude.toFixed(6);
    $('cfLng').value = p.coords.longitude.toFixed(6);
    toast('ใส่พิกัดปัจจุบันแล้ว อย่าลืมกดบันทึก');
  }, () => toast('อ่านตำแหน่งไม่สำเร็จ'), { enableHighAccuracy:true, timeout:15000 });
}
async function saveConfig(){
  const next = {
    schoolName:$('cfSchool').value.trim(), areaOffice:$('cfArea').value.trim(),
    timeOpen:$('cfOpen').value, timeStart:$('cfStart').value,
    timeLate:$('cfLate').value, timeEnd:$('cfEnd').value,
    remindIn:$('cfRemIn').value, remindOut:$('cfRemOut').value,
    lat:Number($('cfLat').value), lng:Number($('cfLng').value),
    radius:Number($('cfRadius').value),
    qSick:Number($('cfQSick').value), qBiz:Number($('cfQBiz').value),
    qMat:Number($('cfQMat').value),
    larkWebhook:$('cfLark').value.trim()
  };
  if (!next.schoolName) return toast('กรุณากรอกชื่อโรงเรียน');
  if (!isFinite(next.lat) || !isFinite(next.lng)) return toast('พิกัดไม่ถูกต้อง');
  if (!(next.radius >= 30)) return toast('รัศมีต้องไม่น้อยกว่า 30 เมตร');
  if (toMin(next.timeLate) < toMin(next.timeStart)) return toast('เวลาผ่อนผันต้องอยู่หลังเวลาปฏิบัติราชการ');

  const btn = $('cfBtn'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    await db.ref('config').update(next);
    CFG = Object.assign(CFG, next);
    $('tbSchool').textContent = CFG.schoolName;
    $('sdSchool').textContent = CFG.schoolName;
    toast('บันทึกการตั้งค่าแล้ว');
  } catch(e){ toast('บันทึกไม่สำเร็จ: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'บันทึกการตั้งค่า'; }
}

/* ---------- วันหยุด ---------- */
async function loadHolidayList(){
  const snap = await db.ref('holidays').get();
  HOLIDAYS = snap.exists() ? snap.val() : {};
  const keys = Object.keys(HOLIDAYS).sort().reverse().slice(0, 60);
  $('hdList').innerHTML = keys.map(k =>
    '<div class="row"><div class="row-m"><div class="row-n">' + thaiDate(k) + '</div>' +
    '<div class="row-d">' + esc(HOLIDAYS[k].name) + '</div></div>' +
    '<div class="row-r"><button class="b-out b-sm" onclick="delHoliday(\'' + k + '\')">ลบ</button></div></div>'
  ).join('') || '<div class="empty">ยังไม่มีวันหยุดที่บันทึกไว้</div>';
}
async function addHoliday(){
  const f = $('hdFrom').value, t = $('hdTo').value || $('hdFrom').value;
  const name = $('hdName').value.trim();
  if (!f) return toast('กรุณาเลือกวันที่');
  if (!name) return toast('กรุณากรอกชื่อวันหยุด');
  if (t < f) return toast('ช่วงวันที่ไม่ถูกต้อง');
  const days = eachDate(f, t);
  if (days.length > 120) return toast('ช่วงวันที่ยาวเกินไป');
  const up = {};
  days.forEach(d => up[d] = { name, createdBy:ME.uid, createdAt:Date.now() });
  try {
    await db.ref('holidays').update(up);
    Object.assign(HOLIDAYS, up);
    $('hdName').value = '';
    toast('เพิ่มวันหยุด ' + days.length + ' วันแล้ว');
    loadHolidayList();
  } catch(e){ toast('บันทึกไม่สำเร็จ: ' + e.message); }
}
async function delHoliday(key){
  if (!confirm('ลบวันหยุด ' + thaiDate(key) + ' ใช่หรือไม่')) return;
  await db.ref('holidays/' + key).remove();
  delete HOLIDAYS[key];
  loadHolidayList();
}
async function openHolidayToday(){
  const key = $('dbDay').value || dateKey();
  const name = prompt('ประกาศให้ ' + thaiDate(key) + ' เป็นวันหยุดเพราะเหตุใด' +
    '\n(เช่น น้ำท่วม อากาศแปรปรวน กิจกรรมเขตพื้นที่)');
  if (!name || !name.trim()) return;
  await db.ref('holidays/' + key).set({ name:name.trim(), createdBy:ME.uid, createdAt:Date.now() });
  HOLIDAYS[key] = { name:name.trim() };
  toast('ประกาศวันหยุดแล้ว ระบบจะไม่นับขาดงานในวันดังกล่าว');
  loadDashToday();
}

/* ============================================================
   ส่วนที่ 11 : ผูกเหตุการณ์
   ============================================================ */
document.addEventListener('keyup', e => {
  if (e.key !== 'Enter') return;
  if (!$('vLogin').classList.contains('hide') && e.target.id === 'lgPin') doLogin();
  if (!$('vSetup').classList.contains('hide') && e.target.id === 'suPin') doSetup();
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); });
});
window.addEventListener('beforeunload', stopCamera);

boot();
