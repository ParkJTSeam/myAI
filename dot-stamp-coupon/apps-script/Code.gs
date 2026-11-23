/**
 * 도트 운동 도장판 + 쿠폰 발급 웹앱 (Google Apps Script)
 *
 * 시트 구성 (처음 실행 시 자동 생성)
 *  - Users   : 사용자 목록
 *  - Records : 날짜별 운동 수치 / 자동판정 / 관리자 승인상태
 *  - Admins  : 관리자 이름 / 비밀번호  ← 시트에서 언제든 수정 가능
 *  - Coupons : 도장을 소모해 교환한 쿠폰
 *  - Rewards : 교환 가능한 보상 목록 (필요 도장 수 / 만근)  ← 시트에서 수정 가능
 *  - Games   : 미니게임(도트 과일 합치기) 점수
 *  - Config  : 통과 기준 수치, 쿠폰 발급 기준 등 설정값
 */

// 비워두면 이 스크립트가 연결된(컨테이너 바인딩) 스프레드시트를 사용합니다.
// 독립형 스크립트라면 스프레드시트 ID를 넣으세요.
const SPREADSHEET_ID = '';

const SHEETS = {
  USERS:   { name: 'Users',   headers: ['이름', '가입일시', '최근접속'] },
  RECORDS: { name: 'Records', headers: ['날짜', '이름', '운동수치', '자동판정', '승인상태', '처리관리자', '처리일시', '입력일시', '비고'] },
  ADMINS:  { name: 'Admins',  headers: ['관리자이름', '비밀번호', '메모'] },
  COUPONS: { name: 'Coupons', headers: ['쿠폰코드', '이름', '발급일시', '보상ID', '보상이름', '대상월', '소모도장', '사용여부', '사용일시'] },
  REWARDS: { name: 'Rewards', headers: ['보상ID', '보상이름', '설명', '필요도장', '아이콘'] },
  GAMES:   { name: 'Games',   headers: ['일시', '이름', '점수', '최고단계'] },
  CONFIG:  { name: 'Config',  headers: ['키', '값', '설명'] },
};

const DEFAULT_CONFIG = [
  ['APP_TITLE', '도트 운동 도장판', '앱 제목'],
  ['PASS_THRESHOLD', 300, '이 값 이상이면 통과(초록), 미만이면 미통과(빨강)'],
  ['EXCHANGE_GRACE_DAYS', 7, '지난달 도장을 다음 달 며칠까지 교환할 수 있는지 (월말 승인 지연 대비)'],
  ['COUPON_PREFIX', 'FIT', '쿠폰 코드 앞글자'],
];

// 필요도장: 숫자 = 그달 도장 N개 소모 / '만근' = 그달 모든 날짜 승인 시 (도장 소모 없음, 월 1회)
const DEFAULT_REWARDS = [
  ['AMERICANO', '아메리카노', '1,500원 이하 아메리카노 1잔', 7, 'coffee'],
  ['MEAL', '식사 1회', '15,000원 이하 식사 1회', 14, 'meal'],
  ['CASH30', '현금 30,000원', '현금 30,000원 지급', 21, 'cash'],
  ['PERFECT', '만근 현금 50,000원', '그달 모든 날 승인 도장(만근) 달성 시', '만근', 'crown'],
];

const STATUS = { PENDING: '대기', APPROVED: '승인', REJECTED: '비승인' };

/* ───────────────────────── 웹앱 진입 ───────────────────────── */

function doGet() {
  ensureSheets_();
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appTitle = config_().APP_TITLE;
  return tpl.evaluate()
    .setTitle(config_().APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 편집기에서 한 번 실행하면 모든 시트를 만들어 줍니다. (선택) */
function setup() {
  ensureSheets_();
}

/* ───────────────────────── 공통 ───────────────────────── */

function getBootstrap() {
  const cfg = config_();
  return { title: cfg.APP_TITLE, threshold: cfg.PASS_THRESHOLD, today: today_() };
}

/* ───────────────────────── 사용자 ───────────────────────── */

function userLogin(name) {
  name = cleanName_(name);
  withLock_(function () {
    const sh = sheet_('USERS');
    const data = rows_('USERS');
    const idx = data.findIndex(function (r) { return String(r[0]).trim() === name; });
    const now = nowStr_();
    if (idx >= 0) sh.getRange(idx + 2, 3).setValue(now);
    else sh.appendRow([name, now, now]);
  });
  return getUserMonth(name, today_().slice(0, 7));
}

function getUserMonth(name, ym) {
  name = cleanName_(name);
  if (!/^\d{4}-\d{2}$/.test(String(ym))) ym = today_().slice(0, 7);
  const cfg = config_();
  const records = {};
  let totalApproved = 0;
  let monthApproved = 0;
  rows_('RECORDS').forEach(function (r) {
    if (String(r[1]).trim() !== name) return;
    const d = date_(r[0]);
    const st = String(r[4] || STATUS.PENDING).trim();
    if (st === STATUS.APPROVED) totalApproved++;
    if (d.slice(0, 7) === ym) {
      const rv = recValue_(r, cfg);
      records[d] = { value: rv.value, pass: rv.pass, status: st, granted: rv.granted, note: rv.note };
      if (st === STATUS.APPROVED) monthApproved++;
    }
  });
  return {
    name: name, ym: ym, today: today_(),
    threshold: cfg.PASS_THRESHOLD,
    totalApproved: totalApproved, monthApproved: monthApproved,
    records: records,
    rewards: rewards_(),
    wallets: walletMonths_().map(function (m) { return wallet_(name, m); }),
    coupons: userCoupons_(name),
  };
}

/* ───────────────────────── 도장 교환 (쿠폰) ───────────────────────── */

/** 도장을 소모해서 보상 쿠폰으로 교환 */
function exchangeReward(name, rewardId, ym) {
  name = cleanName_(name);
  ym = String(ym || '');
  if (walletMonths_().indexOf(ym) < 0) throw new Error('지금은 ' + ym + ' 도장을 교환할 수 없어요.');
  const reward = rewards_().filter(function (r) { return r.id === String(rewardId); })[0];
  if (!reward) throw new Error('보상을 찾을 수 없어요.');
  let coupon;
  withLock_(function () {
    const w = wallet_(name, ym);
    let cost = 0;
    if (reward.perfect) {
      if (!w.perfect) throw new Error('만근(그달 모든 날 승인)을 달성해야 받을 수 있어요.');
      if (w.claimed.indexOf(reward.id) >= 0) throw new Error('이번 달 만근 보상은 이미 받았어요.');
    } else {
      cost = reward.cost;
      if (w.balance < cost) throw new Error('도장이 부족해요. (보유 ' + w.balance + ' / 필요 ' + cost + ')');
    }
    const code = makeCouponCode_(config_().COUPON_PREFIX);
    sheet_('COUPONS').appendRow([code, name, nowStr_(), reward.id, reward.name, ym, cost, '미사용', '']);
    coupon = { code: code, rewardName: reward.name, desc: reward.desc, icon: reward.icon, ym: ym, cost: cost, balanceAfter: w.balance - cost };
  });
  const data = getUserMonth(name, ym);
  data.newCoupon = coupon;
  return data;
}

function saveRecord(name, date, value) {
  name = cleanName_(name);
  date = String(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식이 올바르지 않아요.');
  if (date > today_()) throw new Error('미래 날짜는 기록할 수 없어요.');
  const v = Number(value);
  if (String(value).trim() === '' || !isFinite(v) || v < 0 || v > 100000) throw new Error('0 ~ 100000 사이의 숫자를 입력하세요.');
  const cfg = config_();
  const auto = v >= cfg.PASS_THRESHOLD ? '통과' : '미통과';

  withLock_(function () {
    const sh = sheet_('RECORDS');
    const data = rows_('RECORDS');
    const idx = data.findIndex(function (r) { return date_(r[0]) === date && String(r[1]).trim() === name; });
    const now = nowStr_();
    if (idx >= 0) {
      const st = String(data[idx][4]).trim();
      if (st === STATUS.APPROVED || st === STATUS.REJECTED) throw new Error('관리자가 이미 처리한 기록은 수정할 수 없어요.');
      sh.getRange(idx + 2, 3, 1, 3).setValues([[v, auto, STATUS.PENDING]]);
      sh.getRange(idx + 2, 8).setValue(now);
    } else {
      sh.appendRow([date, name, v, auto, STATUS.PENDING, '', '', now]);
    }
  });
  return getUserMonth(name, date.slice(0, 7));
}

/* ───────────────────────── 미니게임 ───────────────────────── */

function saveGameScore(name, score, maxLevel) {
  name = cleanName_(name);
  score = Math.max(0, Math.min(1000000, Math.floor(Number(score) || 0)));
  maxLevel = Math.max(0, Math.min(20, Math.floor(Number(maxLevel) || 0)));
  withLock_(function () { sheet_('GAMES').appendRow([nowStr_(), name, score, maxLevel]); });
  return getGameRanking(name);
}

function getGameRanking(name) {
  const best = {};
  let plays = 0;
  rows_('GAMES').forEach(function (r) {
    const n = String(r[1]).trim();
    const s = Number(r[2]) || 0;
    if (name && n === name) plays++;
    if (!(n in best) || s > best[n]) best[n] = s;
  });
  const list = Object.keys(best).map(function (n) { return { name: n, score: best[n] }; })
    .sort(function (a, b) { return b.score - a.score; });
  return { top: list.slice(0, 10), myBest: name && best[name] != null ? best[name] : 0, myPlays: plays };
}

/* ───────────────────────── 관리자 ───────────────────────── */

function adminLogin(auth) {
  const admin = verifyAdmin_(auth);
  return { name: admin, today: today_(), threshold: config_().PASS_THRESHOLD };
}

/** opts: { status: '대기'|'승인'|'비승인'|'전체', date: 'yyyy-MM-dd' | '', name: '' } */
function adminListRecords(auth, opts) {
  verifyAdmin_(auth);
  opts = opts || {};
  const cfg = config_();
  const status = opts.status || STATUS.PENDING;
  const date = String(opts.date || '');
  const q = String(opts.name || '').trim();
  const list = [];
  rows_('RECORDS').forEach(function (r) {
    const d = date_(r[0]);
    const n = String(r[1]).trim();
    const st = String(r[4] || STATUS.PENDING).trim();
    if (!d || !n) return;
    if (status !== '전체' && st !== status) return;
    if (date && d !== date) return;
    if (q && n.indexOf(q) < 0) return;
    const rv = recValue_(r, cfg);
    list.push({ date: d, name: n, value: rv.value, pass: rv.pass, granted: rv.granted, note: rv.note, status: st, admin: String(r[5] || ''), reviewedAt: dateTime_(r[6]) });
  });
  list.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name); });
  return { list: list.slice(0, 300), total: list.length, threshold: cfg.PASS_THRESHOLD };
}

/** decision: '승인' | '비승인' */
function adminReview(auth, date, name, decision) {
  const admin = verifyAdmin_(auth);
  if (decision !== STATUS.APPROVED && decision !== STATUS.REJECTED) throw new Error('잘못된 처리값입니다.');
  name = cleanName_(name);
  withLock_(function () {
    const sh = sheet_('RECORDS');
    const data = rows_('RECORDS');
    const idx = data.findIndex(function (r) { return date_(r[0]) === date && String(r[1]).trim() === name; });
    if (idx < 0) throw new Error('기록을 찾을 수 없어요.');
    sh.getRange(idx + 2, 5, 1, 3).setValues([[decision, admin, nowStr_()]]);
  });
  return { ok: true };
}

/** 관리자가 원하는 날짜에 합격(승인) 도장을 직접 찍어줌. 기록이 없어도 가능, 수치는 선택 */
function adminGrantStamp(auth, name, date, value, memo) {
  const admin = verifyAdmin_(auth);
  name = cleanName_(name);
  date = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜를 선택하세요.');
  if (date > today_()) throw new Error('미래 날짜에는 도장을 줄 수 없어요.');
  const known = rows_('USERS').some(function (r) { return String(r[0]).trim() === name; });
  if (!known) throw new Error('등록되지 않은 사용자예요. (한 번 이상 로그인한 사용자만 가능)');
  const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
  const v = hasValue ? Number(value) : '';
  if (hasValue && (!isFinite(v) || v < 0 || v > 100000)) throw new Error('수치는 0 ~ 100000 사이로 입력하세요.');
  const cfg = config_();
  const note = '관리자부여' + (String(memo || '').trim() ? ': ' + String(memo).trim().slice(0, 100) : '');
  let existed = false;
  withLock_(function () {
    const sh = sheet_('RECORDS');
    const data = rows_('RECORDS');
    const idx = data.findIndex(function (r) { return date_(r[0]) === date && String(r[1]).trim() === name; });
    const now = nowStr_();
    if (idx >= 0) {
      existed = true;
      const row = data[idx];
      const nv = hasValue ? v : row[2];
      const auto = nv === '' ? '관리자부여' : (Number(nv) >= cfg.PASS_THRESHOLD ? '통과' : '미통과');
      sh.getRange(idx + 2, 3, 1, 7).setValues([[nv, auto, STATUS.APPROVED, admin, now, row[7], note]]);
    } else {
      const auto = v === '' ? '관리자부여' : (v >= cfg.PASS_THRESHOLD ? '통과' : '미통과');
      sh.appendRow([date, name, v, auto, STATUS.APPROVED, admin, now, now, note]);
    }
  });
  return { ok: true, existed: existed, wallet: wallet_(name, date.slice(0, 7)) };
}

function adminListUsers(auth) {
  verifyAdmin_(auth);
  return rows_('USERS').map(function (r) { return String(r[0]).trim(); }).filter(String).sort();
}

function adminListCoupons(auth) {
  verifyAdmin_(auth);
  const list = rows_('COUPONS').filter(function (r) { return r[0] !== ''; }).map(couponObj_).reverse();
  return { list: list };
}

function adminUseCoupon(auth, code) {
  verifyAdmin_(auth);
  withLock_(function () {
    const sh = sheet_('COUPONS');
    const data = rows_('COUPONS');
    const idx = data.findIndex(function (r) { return String(r[0]) === String(code); });
    if (idx < 0) throw new Error('쿠폰을 찾을 수 없어요.');
    const used = String(data[idx][7]).trim() === '사용';
    sh.getRange(idx + 2, 8, 1, 2).setValues([used ? ['미사용', ''] : ['사용', nowStr_()]]);
  });
  return adminListCoupons(auth);
}

function adminListGames(auth) {
  verifyAdmin_(auth);
  const list = rows_('GAMES').map(function (r) {
    return { at: dateTime_(r[0]), name: String(r[1]), score: Number(r[2]) || 0, maxLevel: Number(r[3]) || 0 };
  }).reverse().slice(0, 200);
  return { list: list, ranking: getGameRanking('').top };
}

/* ───────────────────────── 내부 함수 ───────────────────────── */

let rewardsCache_ = null;
/** 기록 한 줄의 수치/통과 여부. 수치 없이 관리자가 부여한 도장은 통과로 표시 */
function recValue_(r, cfg) {
  const note = String(r[8] || '');
  const granted = note.indexOf('관리자부여') === 0;
  const empty = r[2] === '' || r[2] === null;
  const v = empty ? null : Number(r[2]);
  return { value: v, pass: empty ? granted : v >= cfg.PASS_THRESHOLD, granted: granted, note: note };
}

function rewards_() {
  if (rewardsCache_) return rewardsCache_;
  let rows = rows_('REWARDS').filter(function (r) { return String(r[0]).trim() !== ''; });
  if (!rows.length) rows = DEFAULT_REWARDS;
  rewardsCache_ = rows.map(function (r) {
    const perfect = String(r[3]).trim() === '만근';
    return { id: String(r[0]).trim(), name: String(r[1]), desc: String(r[2]), perfect: perfect, cost: perfect ? 0 : Math.max(1, Number(r[3]) || 0), icon: String(r[4] || 'ticket') };
  }).sort(function (a, b) { return (a.perfect ? 1e9 : a.cost) - (b.perfect ? 1e9 : b.cost); });
  return rewardsCache_;
}

/** 교환 가능한 달: 이번 달 + (이번 달 초 유예기간 동안) 지난달 */
function walletMonths_() {
  const t = today_();
  const months = [t.slice(0, 7)];
  if (Number(t.slice(8)) <= config_().EXCHANGE_GRACE_DAYS) months.push(prevMonth_(t.slice(0, 7)));
  return months;
}

/** 한 달 도장 지갑: 승인 도장 수 - 교환에 소모한 도장 수 */
function wallet_(name, ym) {
  const approvedDays = {};
  rows_('RECORDS').forEach(function (r) {
    if (String(r[1]).trim() !== name || String(r[4]).trim() !== STATUS.APPROVED) return;
    const d = date_(r[0]);
    if (d.slice(0, 7) === ym) approvedDays[d] = true;
  });
  const approved = Object.keys(approvedDays).length;
  let used = 0;
  const claimed = [];
  rows_('COUPONS').forEach(function (r) {
    if (String(r[1]).trim() !== name || month_(r[5]) !== ym) return;
    used += Number(r[6]) || 0;
    claimed.push(String(r[3]));
  });
  const p = ym.split('-');
  const days = new Date(Number(p[0]), Number(p[1]), 0).getDate();
  return { ym: ym, approved: approved, used: used, balance: Math.max(0, approved - used), days: days, perfect: approved >= days, claimed: claimed };
}

function userCoupons_(name) {
  return rows_('COUPONS').filter(function (r) { return String(r[1]).trim() === name; }).map(couponObj_).reverse();
}

function couponObj_(r) {
  const rw = rewards_().filter(function (x) { return x.id === String(r[3]); })[0] || {};
  return {
    code: String(r[0]), name: String(r[1]), issuedAt: dateTime_(r[2]), rewardId: String(r[3]), rewardName: String(r[4]),
    desc: rw.desc || '', icon: rw.icon || 'ticket', ym: month_(r[5]), cost: Number(r[6]) || 0,
    used: String(r[7]).trim() === '사용', usedAt: dateTime_(r[8]),
  };
}

function prevMonth_(ym) {
  const p = ym.split('-').map(Number);
  const d = new Date(p[0], p[1] - 2, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function month_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM');
  return String(v || '').trim().slice(0, 7);
}

function makeCouponCode_(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return String(prefix || 'FIT') + '-' + s.slice(0, 4) + '-' + s.slice(4);
}

function verifyAdmin_(auth) {
  const name = String((auth && auth.name) || '').trim();
  const pw = String((auth && auth.password) || '');
  if (!name || !pw) throw new Error('관리자 이름과 비밀번호를 입력하세요.');
  const ok = rows_('ADMINS').some(function (r) {
    return String(r[0]).trim() === name && String(r[1]).trim() === pw.trim() && String(r[1]).trim() !== '';
  });
  if (!ok) throw new Error('관리자 정보가 올바르지 않아요.');
  return name;
}

function cleanName_(name) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('이름을 입력하세요.');
  if (name.length > 20) throw new Error('이름은 20자 이하로 입력하세요.');
  if (/^[=+\-@]/.test(name)) throw new Error('이름은 =, +, -, @ 로 시작할 수 없어요.');
  return name;
}

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets_() {
  Object.keys(SHEETS).forEach(function (k) { sheet_(k); });
}

const sheetCache_ = {};
function sheet_(key) {
  if (sheetCache_[key]) return sheetCache_[key];
  const def = SHEETS[key];
  const ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
      .setFontWeight('bold').setBackground('#222034').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (key === 'RECORDS') sh.getRange('A:A').setNumberFormat('@');
    if (key === 'ADMINS') {
      sh.getRange('B:B').setNumberFormat('@');
      sh.appendRow(['admin', '1234', '기본 관리자 - 비밀번호를 꼭 바꾸세요. 행을 추가하면 관리자도 늘어납니다.']);
    }
    if (key === 'CONFIG') sh.getRange(2, 1, DEFAULT_CONFIG.length, 3).setValues(DEFAULT_CONFIG);
    if (key === 'COUPONS') sh.getRange('F:F').setNumberFormat('@');
    if (key === 'REWARDS') {
      sh.getRange('D:D').setNumberFormat('@');
      sh.getRange(2, 1, DEFAULT_REWARDS.length, 5).setValues(DEFAULT_REWARDS.map(function (r) { return r.map(String); }));
    }
  }
  // 이전 버전 시트에 새로 추가된 열 제목 채우기
  const lastHeader = def.headers[def.headers.length - 1];
  if (String(sh.getRange(1, def.headers.length).getValue()) !== lastHeader) sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
  sheetCache_[key] = sh;
  return sh;
}

function rows_(key) {
  const sh = sheet_(key);
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, SHEETS[key].headers.length).getValues();
}

function config_() {
  const o = {};
  DEFAULT_CONFIG.forEach(function (r) { o[r[0]] = r[1]; });
  rows_('CONFIG').forEach(function (r) {
    const k = String(r[0]).trim();
    if (k && r[1] !== '') o[k] = r[1];
  });
  o.PASS_THRESHOLD = Number(o.PASS_THRESHOLD) || 300;
  o.EXCHANGE_GRACE_DAYS = Math.max(0, Math.floor(Number(o.EXCHANGE_GRACE_DAYS) || 0));
  o.APP_TITLE = String(o.APP_TITLE || '도트 운동 도장판');
  return o;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Seoul'; }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function date_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v || '').trim();
}
function dateTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  return String(v || '').trim();
}
