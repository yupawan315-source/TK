/*****************************************************************
 * ระบบลงเวลาปฏิบัติราชการอิเล็กทรอนิกส์ (BKM e-Time)
 * โมดูลแจ้งเตือนผ่าน Lark
 *
 * โครงการ Apps Script แยกต่างหาก ทำหน้าที่ตั้งเวลา อ่านข้อมูลจาก
 * Firebase Realtime Database แล้วส่งข้อความเข้ากลุ่ม Lark
 * ครูและผู้บริหารไม่ต้องเปิดโครงการนี้ เป็นกลไกเบื้องหลังทั้งหมด
 *
 * ก่อนใช้งานครั้งแรก ให้เรียก setupProperties() หนึ่งครั้งเพื่อใส่ค่าลับ
 * จากนั้นเรียก testLark() เพื่อทดสอบ แล้วจึงเรียก setupTriggers()
 *****************************************************************/

/* =============================================================
 * ส่วนที่ 1 : ค่าคงที่
 * ============================================================= */

/** คีย์ของค่าลับที่เก็บใน Script Properties */
const PROP = {
  EMAIL   : 'FB_CLIENT_EMAIL',
  KEY     : 'FB_PRIVATE_KEY',
  DB      : 'FB_DB_URL',
  WEBHOOK : 'LARK_WEBHOOK',
  APP     : 'APP_URL'          // ที่อยู่เว็บระบบลงเวลา ใส่หรือไม่ใส่ก็ได้
};

/** แสดงชื่อผู้ที่ยังไม่ลงเวลาในข้อความหรือไม่
 *  false = ไม่ระบุชื่อ (ค่าเริ่มต้นตามที่ตกลงไว้ ดูรายชื่อจากแดชบอร์ดแทน)
 *  true  = ระบุชื่อในข้อความสรุป */
const SHOW_NAMES = false;

const TZ = 'Asia/Bangkok';

/** เก็บรูปยืนยันการลงเวลาไว้กี่เดือนล่าสุด เดือนที่เก่ากว่านี้จะถูกลบอัตโนมัติ
 *  ข้อมูลเวลาการลงเวลาไม่ถูกลบ เก็บไว้ถาวรเพื่อใช้ออกรายงาน */
const PHOTO_KEEP_MONTHS = 3;

const LEAVE_NAME = {
  SICK:'ลาป่วย', BUSINESS:'ลากิจส่วนตัว', MATERNITY:'ลาคลอดบุตร',
  ORDAIN:'ลาอุปสมบท', STUDY:'ลาศึกษาต่อ',
  DUTY:'ไปราชการ', TRAINING:'อบรมสัมมนา',
  VACATION:'ลาพักผ่อน'   // เลิกใช้แล้ว คงไว้เพื่อแสดงชื่อของใบลาเดิมที่บันทึกไว้ก่อนหน้า
};

const TH_MONTH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_DAY = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

/* =============================================================
 * ส่วนที่ 2 : เครื่องมือวันที่
 * ============================================================= */

function pad_(n){ return (n < 10 ? '0' : '') + n; }

function now_(){
  // แปลงเวลาปัจจุบันให้อยู่ในเขตเวลาไทยเสมอ ไม่ขึ้นกับการตั้งค่าโครงการ
  const s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss').split(/[- :]/);
  return new Date(+s[0], +s[1]-1, +s[2], +s[3], +s[4], +s[5]);
}
function dateKey_(d){ d = d || now_();
  return d.getFullYear() + '-' + pad_(d.getMonth()+1) + '-' + pad_(d.getDate()); }
function monthKey_(d){ d = d || now_();
  return d.getFullYear() + '-' + pad_(d.getMonth()+1); }
function thaiDate_(key){
  const p = key.split('-').map(Number);
  const d = new Date(p[0], p[1]-1, p[2]);
  return 'วัน' + TH_DAY[d.getDay()] + 'ที่ ' + p[2] + ' ' + TH_MONTH[p[1]-1] + ' ' + (p[0]+543);
}
function thaiShort_(key){
  const p = key.split('-').map(Number);
  return p[2] + ' ' + TH_MONTH[p[1]-1] + ' ' + (p[0]+543);
}
function isWeekend_(key){
  const p = key.split('-').map(Number);
  const w = new Date(p[0], p[1]-1, p[2]).getDay();
  return w === 0 || w === 6;
}
/** วันจันทร์ถึงศุกร์ของสัปดาห์ที่วันที่นี้อยู่ */
function weekDays_(key){
  const p = key.split('-').map(Number);
  const d = new Date(p[0], p[1]-1, p[2]);
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out = [];
  for (var i = 0; i < 5; i++){
    const x = new Date(mon); x.setDate(mon.getDate() + i);
    out.push(dateKey_(x));
  }
  return out;
}

/* =============================================================
 * ส่วนที่ 3 : เชื่อมต่อ Firebase ด้วยบัญชีบริการ
 * ============================================================= */

function props_(){ return PropertiesService.getScriptProperties(); }

/** อ่านค่าที่ไม่บังคับ คืนค่าว่างถ้ายังไม่ได้ตั้ง */
function opt_(key){ return props_().getProperty(key) || ''; }

function need_(key){
  const v = props_().getProperty(key);
  if (!v) throw new Error('ยังไม่ได้ตั้งค่า ' + key + ' กรุณาเรียกใช้ฟังก์ชัน setupProperties');
  return v;
}

/**
 * จัดรูปแบบ private_key ให้ถูกต้องเสมอ
 * รองรับทั้งกรณีที่ติดเครื่องหมายคำพูดมาจากไฟล์ JSON
 * กรณีที่ \n ยังเป็นข้อความ และกรณีที่การขึ้นบรรทัดหายไป
 */
function normalizeKey_(raw){
  var k = String(raw || '').trim();
  k = k.replace(/^["']+/, '').replace(/["',]+$/, '');   // ตัดเครื่องหมายคำพูดและจุลภาคที่ติดมา
  k = k.replace(/\\r/g, '').replace(/\\n/g, '\n');       // แปลง \n ที่เป็นข้อความให้ขึ้นบรรทัดจริง

  var m = k.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
  if (!m) throw new Error('รูปแบบ private_key ไม่ถูกต้อง ' +
    'ต้องขึ้นต้นด้วย -----BEGIN PRIVATE KEY----- และลงท้ายด้วย -----END PRIVATE KEY----- ' +
    '(ความยาวที่พบ ' + k.length + ' ตัวอักษร)');

  var body = m[2].replace(/[^A-Za-z0-9+/=]/g, '');      // เหลือเฉพาะเนื้อกุญแจ
  if (body.length < 800) throw new Error('private_key สั้นผิดปกติ ' +
    '(เนื้อกุญแจ ' + body.length + ' ตัวอักษร ควรมีราว 1,600) คัดลอกมาไม่ครบ');

  return '-----BEGIN ' + m[1] + '-----\n' +
         body.match(/.{1,64}/g).join('\n') +
         '\n-----END ' + m[1] + '-----\n';            // ประกอบ PEM ขึ้นใหม่ให้ถูกรูปแบบ
}

/** แลกกุญแจของบัญชีบริการเป็นโทเคนเข้าถึง เก็บแคชไว้ 50 นาที */
function accessToken_(){
  const cache = CacheService.getScriptCache();
  const hit = cache.get('FB_TOKEN');
  if (hit) return hit;

  const email = need_(PROP.EMAIL);
  const key = normalizeKey_(need_(PROP.KEY));
  const nowSec = Math.floor(Date.now() / 1000);

  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss   : email,
    scope : 'https://www.googleapis.com/auth/firebase.database ' +
            'https://www.googleapis.com/auth/userinfo.email',
    aud   : 'https://oauth2.googleapis.com/token',
    exp   : nowSec + 3600,
    iat   : nowSec
  }));
  const unsigned = header.replace(/=+$/, '') + '.' + claim.replace(/=+$/, '');
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsigned, key)).replace(/=+$/, '');

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:'post', muteHttpExceptions:true,
    payload:{ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion: unsigned + '.' + sig }
  });
  if (res.getResponseCode() !== 200)
    throw new Error('ขอโทเคนไม่สำเร็จ: ' + res.getContentText().slice(0, 300));

  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('FB_TOKEN', token, 3000);
  return token;
}

/** อ่านข้อมูลจาก Firebase ตามเส้นทางที่ระบุ */
function fbGet_(path){
  const base = need_(PROP.DB).replace(/\/+$/, '');
  const url = base + '/' + path + '.json?access_token=' + encodeURIComponent(accessToken_());
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
  const code = res.getResponseCode();
  if (code !== 200)
    throw new Error('อ่านข้อมูล ' + path + ' ไม่สำเร็จ (' + code + '): ' +
                    res.getContentText().slice(0, 200));
  const txt = res.getContentText();
  return (txt === 'null' || !txt) ? null : JSON.parse(txt);
}

/** อ่านเฉพาะรายชื่อคีย์ชั้นบนสุด ไม่ดึงข้อมูลข้างในมาด้วย */
function fbKeys_(path){
  const base = need_(PROP.DB).replace(/\/+$/, '');
  const url = base + '/' + path + '.json?shallow=true&access_token=' +
              encodeURIComponent(accessToken_());
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
  if (res.getResponseCode() !== 200)
    throw new Error('อ่านรายชื่อ ' + path + ' ไม่สำเร็จ (' + res.getResponseCode() + ')');
  const txt = res.getContentText();
  return (txt === 'null' || !txt) ? [] : Object.keys(JSON.parse(txt));
}

/** ลบข้อมูลตามเส้นทางที่ระบุ */
function fbDelete_(path){
  const base = need_(PROP.DB).replace(/\/+$/, '');
  const url = base + '/' + path + '.json?access_token=' +
              encodeURIComponent(accessToken_());
  const res = UrlFetchApp.fetch(url, { method:'delete', muteHttpExceptions:true });
  if (res.getResponseCode() !== 200)
    throw new Error('ลบ ' + path + ' ไม่สำเร็จ (' + res.getResponseCode() + '): ' +
                    res.getContentText().slice(0, 200));
  return true;
}

/* =============================================================
 * ส่วนที่ 4 : ส่งข้อความเข้า Lark
 * ============================================================= */

/** ทุกข้อความขึ้นต้นด้วยคำว่า "ลงเวลา" เพื่อให้ผ่านเงื่อนไข Custom Keywords */
function sendLark_(text){
  const url = need_(PROP.WEBHOOK);
  const res = UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    payload: JSON.stringify({ msg_type:'text', content:{ text:text } })
  });
  const body = res.getContentText();
  var ok = false;
  try { const j = JSON.parse(body); ok = (j.code === 0 || j.StatusCode === 0); } catch (e) {}
  if (!ok) Logger.log('ส่ง Lark ไม่สำเร็จ: ' + body.slice(0, 300));
  else Logger.log('ส่งข้อความเรียบร้อย');
  return ok;
}

/* =============================================================
 * ส่วนที่ 5 : รวบรวมสถานะ
 * ============================================================= */

const PERIOD_NAME = { AM:'ครึ่งวันเช้า', PM:'ครึ่งวันบ่าย' };
function isHalf_(l){ return !!l && (l.period === 'AM' || l.period === 'PM'); }

function fullName_(u){
  return (u.prefix || '') + (u.firstName || '') + ' ' + (u.lastName || '');
}

/** คืนสถานะของบุคลากรทุกคนในวันที่กำหนด
 *  null หมายถึงวันนั้นไม่ใช่วันทำการ */
function statusOf_(dateStr){
  if (isWeekend_(dateStr)) return null;

  const holidays = fbGet_('holidays') || {};
  if (holidays[dateStr]) return null;

  const users  = fbGet_('users') || {};
  const att    = fbGet_('attendance/' + dateStr.slice(0,7)) || {};
  const leaves = fbGet_('leaves') || {};

  const lv = Object.keys(leaves).map(function (k) { return leaves[k]; })
    .filter(function (l) {
      return l.status !== 'REJECTED' && l.dateFrom <= dateStr && dateStr <= l.dateTo;
    });

  const out = { date:dateStr, onTime:[], late:[], leave:[], pending:[], none:[], noOut:[] };

  Object.keys(users).sort().forEach(function (uid) {
    const u = users[uid];
    if (String(u.status) !== 'ACTIVE') return;
    const name = fullName_(u);
    const rec = (att[uid] || {})[dateStr];
    const mine = lv.filter(function (x) { return x.uid === uid; });
    const ap = mine.filter(function (x) { return x.status === 'APPROVED'; })[0];
    const l = ap || mine[0];
    const half = isHalf_(ap);

    if (rec && rec.checkIn){
      // ไปราชการช่วงเช้าที่อนุมัติแล้ว ไม่นับสาย ช่วงบ่ายไม่ต้องลงเวลาออก
      const late = rec.checkIn.late && !(half && ap.period === 'AM');
      (late ? out.late : out.onTime).push(name);
      if (!rec.checkOut && !(half && ap.period === 'PM')) out.noOut.push(name);
    } else if (half){
      out.none.push(name);
    } else if (l && l.status === 'APPROVED'){
      out.leave.push({ name:name, type:LEAVE_NAME[l.type] || l.type });
    } else if (l && l.status === 'PENDING'){
      out.pending.push({ name:name, type:LEAVE_NAME[l.type] || l.type });
    } else {
      out.none.push(name);
    }
  });

  out.total = out.onTime.length + out.late.length + out.leave.length +
              out.pending.length + out.none.length;
  return out;
}

/** แปลงรายชื่อเป็นบรรทัดข้อความ ตามการตั้งค่า SHOW_NAMES */
function listLine_(label, arr, unit){
  if (!arr.length) return null;
  const n = arr.length + ' ' + (unit || 'ท่าน');
  if (!SHOW_NAMES) return label + ' ' + n;
  const names = arr.map(function (x) { return typeof x === 'string' ? x : x.name; });
  return label + ' ' + n + '\n  ' + names.join('\n  ');
}

/** ส่วนท้ายของข้อความเตือน ที่ต้องการให้กดไปลงเวลาต่อ */
function footerAction_(){
  const url = opt_(PROP.APP);
  return url ? '\n\nลงเวลาที่นี่\n' + url : '';
}

/** ส่วนท้ายแบบเรียบ ใส่เพียงลิงก์ ใช้กับข้อความแจ้งผลการพิจารณา */
function footerLink_(){
  const url = opt_(PROP.APP);
  return url ? '\n\nเปิดระบบ\n' + url : '';
}

/** ส่วนท้ายของข้อความสรุป ที่ชี้ไปดูรายละเอียดรายบุคคล */
function footer_(){
  const url = opt_(PROP.APP);
  if (SHOW_NAMES) return url ? '\n\nเปิดระบบ\n' + url : '';
  return '\n\nดูรายชื่อรายบุคคลได้ที่แดชบอร์ดในระบบ' + (url ? '\n' + url : '');
}

function cfgTime_(key, fallback){
  try {
    const c = fbGet_('config') || {};
    return c[key] || fallback;
  } catch (e) { return fallback; }
}

/* =============================================================
 * ส่วนที่ 6 : ข้อความแจ้งเตือนทั้งห้ารายการ
 * ============================================================= */

/** 07.30 น. เตือนผู้ที่ยังไม่ลงเวลาเข้า */
function notifyMorningRemind(){
  const today = dateKey_();
  const s = statusOf_(today);
  if (!s) return Logger.log('วันนี้ไม่ใช่วันทำการ ไม่ส่งข้อความ');

  const waiting = s.none.length + s.pending.length;
  if (!waiting) return Logger.log('ลงเวลาครบทุกท่านแล้ว ไม่ต้องเตือน');

  const cfg = fbGet_('config') || {};
  const done = s.onTime.length + s.late.length;

  sendLark_(
    'ลงเวลาราชการ — แจ้งเตือนก่อนเริ่มงาน\n' +
    thaiDate_(today) + '\n\n' +
    'ลงเวลาเข้าแล้ว ' + done + ' จาก ' + (s.total - s.leave.length) + ' ท่าน\n' +
    (listLine_('ยังไม่ได้ลงเวลา', s.none.concat(
        s.pending.map(function (x) { return x.name; }))) || '') + '\n\n' +
    'เวลาปฏิบัติราชการ ' + (cfg.timeStart || '08:00') + ' น. ' +
    'ผ่อนผันถึง ' + (cfg.timeLate || '09:00') + ' น.' + footerAction_()
  );
}

/** 08.15 น. สรุปสถานะภาคเช้า */
function notifyMorningSummary(){
  const today = dateKey_();
  const s = statusOf_(today);
  if (!s) return Logger.log('วันนี้ไม่ใช่วันทำการ ไม่ส่งข้อความ');

  const lines = [
    'ลงเวลาราชการ — สรุปภาคเช้า',
    thaiDate_(today), '',
    'ตรงเวลา ' + s.onTime.length + ' ท่าน',
    listLine_('มาสาย', s.late),
    listLine_('ลา', s.leave),
    listLine_('รออนุมัติการลา', s.pending),
    listLine_('ยังไม่ลงเวลา', s.none)
  ].filter(function (x) { return x !== null; });

  sendLark_(lines.join('\n') + footer_());
}

/** 15.20 น. เตือนผู้ที่ยังไม่ลงเวลาออก */
function notifyEveningRemind(){
  const today = dateKey_();
  const s = statusOf_(today);
  if (!s) return Logger.log('วันนี้ไม่ใช่วันทำการ ไม่ส่งข้อความ');
  if (!s.noOut.length) return Logger.log('ลงเวลาออกครบแล้ว ไม่ต้องเตือน');

  const cfg = fbGet_('config') || {};
  sendLark_(
    'ลงเวลาราชการ — แจ้งเตือนก่อนเลิกงาน\n\n' +
    (listLine_('ยังไม่ได้ลงเวลาออก', s.noOut) || '') + '\n\n' +
    'เวลาเลิกปฏิบัติราชการ ' + (cfg.timeEnd || '15:30') + ' น.' + footerAction_()
  );
}

/** 17.00 น. สรุปประจำวัน */
function notifyDailySummary(){
  const today = dateKey_();
  const s = statusOf_(today);
  if (!s) return Logger.log('วันนี้ไม่ใช่วันทำการ ไม่ส่งข้อความ');

  const work = s.onTime.length + s.late.length;
  const lines = [
    'ลงเวลาราชการ — สรุปประจำวัน',
    thaiDate_(today), '',
    'ปฏิบัติงาน ' + work + ' ท่าน (ตรงเวลา ' + s.onTime.length +
      ' สาย ' + s.late.length + ')',
    listLine_('ลา', s.leave),
    listLine_('ไม่ได้ลงเวลา', s.none),
    listLine_('รออนุมัติการลา', s.pending),
    listLine_('ไม่ได้ลงเวลาออก', s.noOut)
  ].filter(function (x) { return x !== null; });

  sendLark_(lines.join('\n') + footer_());
}

/** วันศุกร์ 17.30 น. สรุปรายสัปดาห์ */
function notifyWeeklySummary(){
  const today = dateKey_();
  const days = weekDays_(today).filter(function (d) { return d <= today; });
  var work = 0, onTime = 0, late = 0, leave = 0, none = 0, noOut = 0, used = 0;

  days.forEach(function (d) {
    const s = statusOf_(d);
    if (!s) return;
    used++;
    work   += s.onTime.length + s.late.length;
    onTime += s.onTime.length;
    late   += s.late.length;
    leave  += s.leave.length;
    none   += s.none.length;
    noOut  += s.noOut.length;
  });

  if (!used) return Logger.log('สัปดาห์นี้ไม่มีวันทำการ ไม่ส่งข้อความ');

  const expect = work + leave + none;
  const pct = expect ? (work / expect * 100).toFixed(1) : '0.0';

  sendLark_(
    'ลงเวลาราชการ — สรุปรายสัปดาห์\n' +
    thaiShort_(days[0]) + ' ถึง ' + thaiShort_(days[days.length-1]) +
    ' (' + used + ' วันทำการ)\n\n' +
    'มาปฏิบัติงาน ' + work + ' จาก ' + expect + ' ครั้ง คิดเป็นร้อยละ ' + pct + '\n' +
    'ตรงเวลา ' + onTime + ' ครั้ง\n' +
    'มาสาย ' + late + ' ครั้ง\n' +
    'ลา ' + leave + ' ครั้ง\n' +
    'ไม่ได้ลงเวลา ' + none + ' ครั้ง\n' +
    'ไม่ได้ลงเวลาออก ' + noOut + ' ครั้ง' + footer_()
  );
}

/* =============================================================
 * ส่วนที่ 6.1 : แจ้งเตือนความเคลื่อนไหวของใบลา
 * ทำงานทุกชั่วโมงในเวลาราชการ ตรวจว่ามีใบลาใหม่หรือมีการพิจารณา
 * จำรายการที่แจ้งไปแล้วไว้ เพื่อไม่ให้แจ้งซ้ำ
 * ============================================================= */

const SEEN_KEY = 'LEAVE_SEEN';     // เก็บสถานะใบลาที่แจ้งไปแล้ว
const SEEN_MAX = 300;              // จำกัดจำนวนรายการที่จำ กันค่าโตเกินขีด

function seenLoad_(){
  try { return JSON.parse(props_().getProperty(SEEN_KEY) || '{}'); }
  catch (e) { return {}; }
}
function seenSave_(obj){
  const keys = Object.keys(obj);
  if (keys.length > SEEN_MAX){
    // ตัดรายการเก่าออก เหลือเฉพาะที่ใหม่ที่สุด
    const trimmed = {};
    keys.sort().slice(-SEEN_MAX).forEach(function (k) { trimmed[k] = obj[k]; });
    obj = trimmed;
  }
  props_().setProperty(SEEN_KEY, JSON.stringify(obj));
}

function leaveRange_(l){
  return l.dateFrom === l.dateTo
    ? thaiShort_(l.dateFrom)
    : thaiShort_(l.dateFrom) + ' ถึง ' + thaiShort_(l.dateTo);
}

/** แจ้งใบลาใหม่และผลการพิจารณา เรียกทุกชั่วโมงด้วยทริกเกอร์ */
function notifyLeaveChanges(){
  const leaves = fbGet_('leaves') || {};
  const ids = Object.keys(leaves);
  if (!ids.length) return Logger.log('ยังไม่มีใบลาในระบบ');

  const seen = seenLoad_();
  const first = Object.keys(seen).length === 0;
  const msgs = [];

  ids.forEach(function (id) {
    const l = leaves[id];
    if (!l || !l.status) return;
    if (seen[id] === l.status) return;          // สถานะไม่เปลี่ยน ไม่ต้องแจ้ง

    // ครั้งแรกสุดให้จดสถานะไว้เฉย ๆ ไม่ย้อนแจ้งของเก่าทั้งหมด
    if (!first){
      const who  = l.name || 'บุคลากร';
      const type = (LEAVE_NAME[l.type] || l.type) + (isHalf_(l) ? ' ' + PERIOD_NAME[l.period] : '');
      const when = leaveRange_(l) + ' รวม ' + (l.days || 0) + ' วันทำการ';

      if (l.status === 'PENDING'){
        msgs.push('ลงเวลาราชการ — ใบลาใหม่รอพิจารณา\n\n' +
          who + '\n' + type + ' ' + when + '\n' +
          'เหตุผล ' + (l.reason || '—') + footerAction_());
      } else if (l.status === 'APPROVED'){
        msgs.push('ลงเวลาราชการ — อนุมัติการลาแล้ว\n\n' +
          who + '\n' + type + ' ' + when +
          (l.comment ? '\nความเห็น ' + l.comment : '') + footerLink_());
      } else if (l.status === 'REJECTED'){
        msgs.push('ลงเวลาราชการ — ไม่อนุมัติการลา\n\n' +
          who + '\n' + type + ' ' + when +
          '\nเหตุผล ' + (l.comment || '—') + footerLink_());
      }
    }
    seen[id] = l.status;
  });

  seenSave_(seen);

  if (first) return Logger.log('บันทึกสถานะใบลาครั้งแรก ' + ids.length +
    ' รายการ ยังไม่ส่งข้อความ ครั้งต่อไปจึงจะแจ้งเฉพาะที่เปลี่ยนแปลง');
  if (!msgs.length) return Logger.log('ไม่มีใบลาที่เปลี่ยนแปลง');

  msgs.forEach(function (m) { sendLark_(m); Utilities.sleep(400); });
  Logger.log('แจ้งความเคลื่อนไหวใบลา ' + msgs.length + ' รายการ');
}

/** ล้างความจำเรื่องใบลา ใช้เมื่อต้องการเริ่มนับใหม่ */
function resetLeaveSeen(){
  props_().deleteProperty(SEEN_KEY);
  Logger.log('ล้างความจำเรื่องใบลาแล้ว การเรียกครั้งถัดไปจะจดสถานะใหม่โดยไม่ส่งข้อความ');
}

/* =============================================================
 * ส่วนที่ 6.2 : ลบรูปยืนยันการลงเวลาที่เก่าเกินกำหนด
 * ลบเฉพาะรูป ข้อมูลเวลาการลงเวลายังคงอยู่ครบเพื่อใช้ออกรายงาน
 * ============================================================= */

/** คืนเดือนที่เก่าที่สุดที่ยังเก็บรูปไว้ เช่น '2026-08' */
function cutoffMonth_(){
  const d = now_();
  d.setDate(1);
  d.setMonth(d.getMonth() - (PHOTO_KEEP_MONTHS - 1));
  return monthKey_(d);
}

/** ลบรูปของเดือนที่เก่ากว่าเกณฑ์ ใช้กับทริกเกอร์รายเดือน */
function purgeOldPhotos(){
  const cutoff = cutoffMonth_();
  var months;
  try { months = fbKeys_('photos'); }
  catch (e) { return Logger.log('อ่านรายชื่อเดือนไม่สำเร็จ: ' + e.message); }

  if (!months.length) return Logger.log('ยังไม่มีรูปในระบบ');

  const old = months.filter(function (m) {
    return /^\d{4}-\d{2}$/.test(m) && m < cutoff;
  }).sort();

  Logger.log('เดือนที่มีรูปทั้งหมด : ' + months.sort().join(', '));
  Logger.log('เก็บไว้ ' + PHOTO_KEEP_MONTHS + ' เดือน ตั้งแต่ ' + cutoff + ' เป็นต้นไป');

  if (!old.length) return Logger.log('ไม่มีเดือนที่ต้องลบ');

  var done = [];
  old.forEach(function (m) {
    try { fbDelete_('photos/' + m); done.push(m); }
    catch (e) { Logger.log('ลบเดือน ' + m + ' ไม่สำเร็จ: ' + e.message); }
  });

  if (!done.length) return Logger.log('ลบไม่สำเร็จสักเดือน');
  // ทำงานเงียบ ไม่แจ้งเข้า Lark เพราะเป็นงานดูแลระบบภายใน
  Logger.log('ลบรูปของเดือน ' + done.join(', ') + ' เรียบร้อย');
  Logger.log('ข้อมูลเวลาการลงเวลายังอยู่ครบ');
}

/** ดูว่าจะลบเดือนใดบ้าง โดยยังไม่ลบจริง */
function previewPurgePhotos(){
  const cutoff = cutoffMonth_();
  const months = fbKeys_('photos').filter(function (m) {
    return /^\d{4}-\d{2}$/.test(m);
  }).sort();
  Logger.log('เดือนที่มีรูป : ' + (months.join(', ') || 'ไม่มี'));
  Logger.log('เกณฑ์ : เก็บตั้งแต่ ' + cutoff + ' เป็นต้นไป');
  const old = months.filter(function (m) { return m < cutoff; });
  Logger.log('เดือนที่จะถูกลบ : ' + (old.join(', ') || 'ไม่มี'));
  Logger.log('หมายเหตุ ฟังก์ชันนี้ยังไม่ลบจริง เรียก purgeOldPhotos เมื่อต้องการลบ');
}

/* =============================================================
 * ส่วนที่ 7 : ติดตั้งและทดสอบ
 * ============================================================= */

/**
 * ใส่ค่าลับลงใน Script Properties
 * วิธีใช้ : แก้ค่าในฟังก์ชันนี้ กดเรียกใช้หนึ่งครั้ง
 *           แล้ว **ลบค่าออกจากโค้ดทันที** เพื่อไม่ให้กุญแจค้างอยู่ในไฟล์
 */
function setupProperties(){
  const CLIENT_EMAIL = 'วางค่า client_email จากไฟล์ JSON';
  const PRIVATE_KEY  = 'วางค่า private_key จากไฟล์ JSON ทั้งบรรทัด';
  const DB_URL       = 'วางที่อยู่ฐานข้อมูล Realtime Database ของโรงเรียน';
  const WEBHOOK      = 'วางที่อยู่ Webhook ของ Lark';
  const APP_URL      = 'วางที่อยู่เว็บระบบลงเวลาบน GitHub Pages';

  if (CLIENT_EMAIL.indexOf('วางค่า') === 0 || PRIVATE_KEY.indexOf('วางค่า') === 0)
    throw new Error('กรุณาใส่ค่าในฟังก์ชัน setupProperties ก่อนเรียกใช้');
  if (!/^https:\/\/.+\.(firebasedatabase\.app|firebaseio\.com)\/?$/.test(DB_URL))
    throw new Error('ที่อยู่ฐานข้อมูลไม่ถูกต้อง ต้องขึ้นต้นด้วย https:// และลงท้ายด้วย .firebasedatabase.app');
  if (WEBHOOK.indexOf('https://') !== 0)
    throw new Error('กรุณาใส่ที่อยู่ Webhook ของ Lark');

  props_().setProperties({
    FB_CLIENT_EMAIL : CLIENT_EMAIL,
    FB_PRIVATE_KEY  : PRIVATE_KEY,
    FB_DB_URL       : DB_URL,
    LARK_WEBHOOK    : WEBHOOK,
    APP_URL         : APP_URL
  }, true);

  Logger.log('บันทึกค่าลับเรียบร้อย — กรุณาลบค่าออกจากโค้ดแล้วบันทึกไฟล์');
}

/** ตรวจค่าลับที่บันทึกไว้ โดยไม่แสดงค่าจริงออกมา */
function checkProperties(){
  const p = props_().getProperties();
  ['FB_CLIENT_EMAIL','FB_DB_URL','LARK_WEBHOOK','APP_URL'].forEach(function (k) {
    const v = p[k] || '';
    Logger.log(k + ' : ' + (v ? v.length + ' ตัวอักษร — ' + v.slice(0, 45) + '…' : 'ยังไม่มีค่า'));
  });

  const raw = p.FB_PRIVATE_KEY || '';
  if (!raw) return Logger.log('FB_PRIVATE_KEY : ยังไม่มีค่า');
  Logger.log('FB_PRIVATE_KEY : ' + raw.length + ' ตัวอักษร');
  Logger.log('  ขึ้นต้นด้วย : ' + JSON.stringify(raw.slice(0, 32)));
  Logger.log('  ลงท้ายด้วย : ' + JSON.stringify(raw.slice(-32)));
  Logger.log('  มี \\n เป็นข้อความ : ' + (raw.indexOf('\\n') >= 0 ? 'ใช่' : 'ไม่'));
  Logger.log('  มีการขึ้นบรรทัดจริง : ' + (raw.indexOf('\n') >= 0 ? 'ใช่' : 'ไม่'));
  try {
    const ok = normalizeKey_(raw);
    Logger.log('  ผลการจัดรูปแบบ : ผ่าน (' + ok.split('\n').length + ' บรรทัด)');
  } catch (e) {
    Logger.log('  ผลการจัดรูปแบบ : ไม่ผ่าน — ' + e.message);
  }
}

/** ตั้งหรือแก้ที่อยู่เว็บระบบลงเวลา โดยไม่กระทบค่าอื่น */
function setAppUrl(){
  const URL = 'วางที่อยู่เว็บระบบลงเวลาที่นี่';
  if (URL.indexOf('วาง') === 0) throw new Error('กรุณาใส่ที่อยู่เว็บก่อนเรียกใช้');
  props_().setProperty('APP_URL', URL.trim());
  Logger.log('บันทึกที่อยู่เว็บเรียบร้อย — กรุณาลบค่าออกจากโค้ดได้');
}

/** ทดสอบส่งข้อความเข้า Lark โดยไม่แตะฐานข้อมูล */
function testLark(){
  const ok = sendLark_('ลงเวลาราชการ — ทดสอบระบบแจ้งเตือน\n' +
    thaiDate_(dateKey_()) + '\n\nหากเห็นข้อความนี้ แสดงว่าเชื่อมต่อ Lark สำเร็จ' +
    footerAction_());
  Logger.log(ok ? 'สำเร็จ ตรวจดูข้อความในกลุ่ม Lark' : 'ไม่สำเร็จ ดูรายละเอียดในบันทึกด้านบน');
}

/** ทดสอบอ่านข้อมูลจาก Firebase โดยไม่ส่งข้อความ */
function testFirebase(){
  const users = fbGet_('users') || {};
  const active = Object.keys(users).filter(function (k) { return users[k].status === 'ACTIVE'; });
  Logger.log('เชื่อมต่อฐานข้อมูลสำเร็จ');
  Logger.log('บุคลากรที่ปฏิบัติงาน ' + active.length + ' ท่าน');
  const s = statusOf_(dateKey_());
  if (!s) Logger.log('วันนี้ไม่ใช่วันทำการ');
  else Logger.log('สถานะวันนี้ — ตรงเวลา ' + s.onTime.length + ' สาย ' + s.late.length +
    ' ลา ' + s.leave.length + ' ยังไม่ลงเวลา ' + s.none.length);
}

/** ทดสอบทั้งระบบ ส่งข้อความสรุปวันนี้จริงหนึ่งฉบับ */
function testFullFlow(){
  notifyDailySummary();
}

/** ทดสอบการแจ้งใบลา เรียกสองครั้ง ครั้งแรกจดสถานะ ครั้งที่สองจึงแจ้งที่เปลี่ยน */
function testLeaveNotify(){
  notifyLeaveChanges();
}

/** ตั้งทริกเกอร์ทั้งหมด เรียกซ้ำได้ ระบบจะลบของเดิมก่อนเสมอ */
function setupTriggers(){
  removeTriggers();
  const add = function (fn, hour, minute) {
    ScriptApp.newTrigger(fn).timeBased().atHour(hour).nearMinute(minute).everyDays(1).create();
  };
  add('notifyMorningRemind',  7, 30);
  add('notifyMorningSummary', 8, 15);
  add('notifyEveningRemind', 15, 20);
  add('notifyDailySummary',  17,  0);
  ScriptApp.newTrigger('notifyWeeklySummary').timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(17).nearMinute(30).create();

  // ตรวจความเคลื่อนไหวของใบลาทุกชั่วโมง
  ScriptApp.newTrigger('notifyLeaveChanges').timeBased().everyHours(1).create();

  // ลบรูปเก่า วันที่ 1 ของทุกเดือน เวลาประมาณตีสอง
  ScriptApp.newTrigger('purgeOldPhotos').timeBased()
    .onMonthDay(1).atHour(2).create();

  Logger.log('ตั้งทริกเกอร์เรียบร้อย 7 รายการ');
  Logger.log('หมายเหตุ Apps Script ทำงานในช่วงเวลา ไม่ตรงนาทีเป๊ะ อาจคลาดเคลื่อนได้ถึง 30 นาที');
  Logger.log('ตรวจสอบเขตเวลาของโครงการให้เป็น (GMT+07:00) Bangkok ที่หน้าการตั้งค่าโครงการ');
}

function removeTriggers(){
  const all = ScriptApp.getProjectTriggers();
  all.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('ลบทริกเกอร์เดิม ' + all.length + ' รายการ');
}

function listTriggers(){
  const all = ScriptApp.getProjectTriggers();
  if (!all.length) return Logger.log('ยังไม่มีทริกเกอร์');
  all.forEach(function (t) { Logger.log(t.getHandlerFunction() + ' — ' + t.getEventType()); });
}
