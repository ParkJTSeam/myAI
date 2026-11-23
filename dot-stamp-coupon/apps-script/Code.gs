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
 *  - GameRewards : 미니게임 점수 보상 목록 (등급별)  ← 시트에서 수정 가능
 *  - GamePlays : 미니게임 남은 플레이 횟수 (자동 관리)
 *  - Config  : 통과 기준 수치, 미니게임 보상 확률 등 설정값
 *
 * 버전: APP_VERSION 참고 / 변경 기록은 CHANGELOG.md
 */

// 비워두면 이 스크립트가 연결된(컨테이너 바인딩) 스프레드시트를 사용합니다.
// 독립형 스크립트라면 스프레드시트 ID를 넣으세요.
const SPREADSHEET_ID = '';

const APP_VERSION = '1.2.1';

const SHEETS = {
  USERS:   { name: 'Users',   headers: ['이름', '가입일시', '최근접속'] },
  RECORDS: { name: 'Records', headers: ['날짜', '이름', '운동수치', '자동판정', '승인상태', '처리관리자', '처리일시', '입력일시', '비고'] },
  ADMINS:  { name: 'Admins',  headers: ['관리자이름', '비밀번호', '메모'] },
  COUPONS: { name: 'Coupons', headers: ['쿠폰코드', '이름', '발급일시', '보상ID', '보상이름', '대상월', '소모도장', '사용여부', '사용일시', '등급'] },
  REWARDS: { name: 'Rewards', headers: ['보상ID', '보상이름', '설명', '필요도장', '아이콘'] },
  GAMES:   { name: 'Games',   headers: ['일시', '이름', '점수', '최고단계'] },
  GAME_REWARDS: { name: 'GameRewards', headers: ['등급', '보상이름', '설명'] },
  GAME_PLAYS: { name: 'GamePlays', headers: ['이름', '남은횟수', '회복기준(ms)', '날짜'] },
  CONFIG:  { name: 'Config',  headers: ['키', '값', '설명'] },
};

const DEFAULT_CONFIG = [
  ['APP_TITLE', '도트 운동 도장판', '앱 제목'],
  ['PASS_THRESHOLD', 300, '이 값 이상이면 통과(초록), 미만이면 미통과(빨강)'],
  ['EXCHANGE_GRACE_DAYS', 7, '지난달 도장을 다음 달 며칠까지 교환할 수 있는지 (월말 승인 지연 대비)'],
  ['COUPON_PREFIX', 'FIT', '쿠폰 코드 앞글자'],
  ['GAME_DROP_START', 2500, '미니게임: 이 점수를 넘으면 보상 추첨 시작'],
  ['GAME_DROP_STEP', 500, '미니게임: 이 점수만큼 더 오를 때마다 한 번 더 추첨 + 확률 상승'],
  ['GAME_DROP_BASE', 15, '미니게임: 시작 점수 돌파 시 당첨 확률(%)'],
  ['GAME_DROP_INC', 5, '미니게임: 단계마다 늘어나는 당첨 확률(%p)'],
  ['GAME_DROP_MAX', 60, '미니게임: 최대 당첨 확률(%)'],
  ['GAME_DROP_DAILY_LIMIT', 3, '미니게임: 한 사람이 하루에 받을 수 있는 보상 수 (0 = 제한 없음)'],
  ['GAME_PLAY_MAX', 3, '미니게임: 최대 플레이 가능 횟수 (매일 0시에 가득 참)'],
  ['GAME_PLAY_RECOVER_MIN', 30, '미니게임: 플레이 횟수 1회가 회복되는 시간(분)'],
];

// 미니게임 점수 보상 (등급: 노멀 / 레어 / 에픽 / 레전드)
const GRADES = ['노멀', '레어', '에픽', '레전드'];
const DEFAULT_GAME_REWARDS = [
  ['노멀', '커피 쿠폰 (1,500원)', '1,500원 이하 커피 1잔'],
  ['노멀', '뽀뽀 1회권', '뽀뽀 1회'],
  ['노멀', '심부름 1회권', '심부름 1회'],
  ['레어', '커피 쿠폰 (5,000원)', '5,000원 이하 커피 1잔'],
  ['레어', '빨래 1회권', '빨래 1회 대신 해주기'],
  ['레어', '귀 후벼주기 1분권', '귀 청소 1분'],
  ['에픽', '자동차 1회 이용권', '자동차 1회 이용'],
  ['에픽', '귀 후벼주기 3분권', '귀 청소 3분'],
  ['에픽', '안마 3분권', '안마 3분'],
  ['레전드', '근처 여행 1회권', '근처로 여행 1회'],
  ['레전드', '안마 5분권', '안마 5분'],
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
  tpl.appVersion = APP_VERSION;
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
  return { title: cfg.APP_TITLE, threshold: cfg.PASS_THRESHOLD, today: today_(), version: APP_VERSION };
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
    rev: getRev_(name),
  };
}

/** 사용자 데이터 변경 번호 (가벼운 확인용 · 화면 자동 갱신에 사용) */
function getUserRev(name) {
  return { rev: getRev_(cleanName_(name)) };
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
  bumpRev_(name);
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
  bumpRev_(name);
  return getUserMonth(name, date.slice(0, 7));
}

/* ───────────────────────── 미니게임 ───────────────────────── */

/** 게임 결과 저장. 세션(플레이 1회 사용)이 있어야 저장됨. 오늘/주간 최고 기록을 넘으면 플레이 횟수 전부 회복 */
function saveGameScore(name, score, maxLevel, sessionId) {
  name = cleanName_(name);
  score = Math.max(0, Math.min(1000000, Math.floor(Number(score) || 0)));
  maxLevel = Math.max(0, Math.min(20, Math.floor(Number(maxLevel) || 0)));
  return withLock_(function () {
    const cache = CacheService.getScriptCache();
    const key = 'gs_' + String(sessionId || '');
    const raw = cache.get(key);
    if (!raw) throw new Error('게임 세션이 만료돼서 기록을 저장하지 못했어요.');
    const ses = JSON.parse(raw);
    if (ses.name !== name) throw new Error('잘못된 게임 세션이에요.');
    if (ses.saved) throw new Error('이미 저장된 게임이에요.');
    ses.saved = true;
    cache.put(key, JSON.stringify(ses), 21600);

    const before = getGameRanking(name);
    sheet_('GAMES').appendRow([nowStr_(), name, score, maxLevel]);
    const records = [];
    if (before.today.best && score > before.today.best.score) records.push('오늘');
    if (before.week.best && score > before.week.best.score) records.push('주간');
    let plays;
    if (records.length) plays = playState_(name, function (st, now, max) { st.count = max; st.ts = now; });
    else plays = playState_(name);
    const after = getGameRanking(name);
    after.records = records;
    after.plays = plays;
    after.score = score;
    return after;
  });
}

/**
 * 순위: 오늘 / 이번 주(월요일 시작, 단 이번 달 1일 이전은 제외) / 이번 달.
 * 모든 기록은 매달 1일에 새로 시작합니다.
 */
function getGameRanking(name) {
  const today = today_();
  const monthStart = today.slice(0, 8) + '01';
  const weekStart = maxStr_(mondayOf_(today), monthStart);
  const per = { today: {}, week: {}, month: {} };
  let myPlaysToday = 0;
  rows_('GAMES').forEach(function (r) {
    const d = dateTime_(r[0]).slice(0, 10);
    if (d < monthStart || d > today) return;
    const n = String(r[1]).trim();
    const sc = Number(r[2]) || 0;
    const put = function (o) { if (!(n in o) || sc > o[n]) o[n] = sc; };
    put(per.month);
    if (d >= weekStart) put(per.week);
    if (d === today) { put(per.today); if (n === name) myPlaysToday++; }
  });
  const board = function (o) {
    const top = Object.keys(o).map(function (n) { return { name: n, score: o[n] }; }).sort(function (a, b) { return b.score - a.score; });
    return { top: top.slice(0, 10), best: top[0] || null, my: name && o[name] != null ? o[name] : 0 };
  };
  const res = { today: board(per.today), week: board(per.week), month: board(per.month), weekStart: weekStart, monthStart: monthStart };
  res.top = res.month.top;          // 이전 버전 호환
  res.myBest = res.month.my;
  res.myPlays = myPlaysToday;
  return res;
}

/** 남은 플레이 횟수 + 순위 (게임 화면용) */
function getGameStatus(name) {
  name = cleanName_(name);
  const plays = withLock_(function () { return playState_(name); });
  return { plays: plays, ranking: getGameRanking(name) };
}

/**
 * 플레이 횟수 계산 (반드시 lock 안에서 호출).
 * - 날짜가 바뀌면(0시) 최대치로 리셋
 * - 최대치 미만이면 회복기준 시각부터 RECOVER_MIN 분마다 1회 회복
 * mutate(st, now, max) 로 횟수를 바꾼 뒤 시트에 저장합니다.
 */
function playState_(name, mutate) {
  const cfg = config_();
  const max = cfg.GAME_PLAY_MAX, per = cfg.GAME_PLAY_RECOVER_MIN * 60000;
  const sh = sheet_('GAME_PLAYS');
  const data = rows_('GAME_PLAYS');
  const idx = data.findIndex(function (r) { return String(r[0]).trim() === name; });
  const now = Date.now(), today = today_();
  let st = idx >= 0 ? { count: Number(data[idx][1]), ts: Number(data[idx][2]) || now, day: date_(data[idx][3]) } : null;
  if (!st || st.day !== today || !isFinite(st.count)) st = { count: max, ts: now, day: today };
  if (st.count > max) st.count = max;
  if (st.count < max) {
    const n = Math.floor((now - st.ts) / per);
    if (n > 0) { st.count = Math.min(max, st.count + n); st.ts = st.count >= max ? now : st.ts + n * per; }
  }
  if (mutate) mutate(st, now, max);
  const row = [name, st.count, st.ts, today];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, 4).setValues([row]);
  else sh.appendRow(row);
  return { count: st.count, max: max, nextAt: st.count < max ? st.ts + per : null, now: now, recoverMin: cfg.GAME_PLAY_RECOVER_MIN };
}

function mondayOf_(ymd) {
  const p = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return addDays_(ymd, -((dow + 6) % 7));
}
function maxStr_(a, b) { return a > b ? a : b; }

/* ───────────────────────── 미니게임 점수 보상 ───────────────────────── */

/** 게임 한 판 시작: 추첨 중복을 막기 위한 세션 발급 */
function startGameSession(name) {
  name = cleanName_(name);
  return withLock_(function () {
    let ok = false;
    const plays = playState_(name, function (st, now, max) {
      if (st.count <= 0) return;
      if (st.count >= max) st.ts = now; // 가득 찬 상태에서 쓰면 그때부터 회복 시간 계산
      st.count--;
      ok = true;
    });
    if (!ok) return { noPlays: true, plays: plays, info: dropInfo_(name) };
    const id = Utilities.getUuid();
    CacheService.getScriptCache().put('gs_' + id, JSON.stringify({ name: name, rolled: [], saved: false }), 21600);
    return { sessionId: id, info: dropInfo_(name), plays: plays };
  });
}

/** threshold(2500, 3000, ...) 를 넘었을 때 한 번 추첨. 당첨되면 쿠폰 발급 */
function rollGameDrop(name, sessionId, threshold, score) {
  name = cleanName_(name);
  const cfg = config_();
  threshold = Number(threshold); score = Number(score);
  const start = cfg.GAME_DROP_START, step = cfg.GAME_DROP_STEP;
  if (!(threshold >= start) || (threshold - start) % step !== 0 || !(score >= threshold)) throw new Error('잘못된 추첨 요청이에요.');
  return withLock_(function () {
    const cache = CacheService.getScriptCache();
    const key = 'gs_' + String(sessionId);
    const raw = cache.get(key);
    if (!raw) throw new Error('게임 세션이 만료됐어요. 새 게임을 시작하세요.');
    const ses = JSON.parse(raw);
    if (ses.name !== name) throw new Error('잘못된 게임 세션이에요.');
    if (ses.rolled.indexOf(threshold) >= 0) return { dropped: false, duplicate: true, threshold: threshold };
    ses.rolled.push(threshold);
    cache.put(key, JSON.stringify(ses), 21600);

    const k = (threshold - start) / step;
    const chance = dropChance_(cfg, k);
    const todayCount = gameDropsToday_(name);
    const limit = cfg.GAME_DROP_DAILY_LIMIT;
    if (limit > 0 && todayCount >= limit) return { dropped: false, limited: true, threshold: threshold, chance: chance, limit: limit };
    if (Math.random() * 100 >= chance) return { dropped: false, threshold: threshold, chance: chance };

    const grade = pickGrade_(k);
    const pool = gameRewards_().filter(function (r) { return r.grade === grade; });
    const all = gameRewards_();
    const reward = pool.length ? pool[Math.floor(Math.random() * pool.length)] : all[Math.floor(Math.random() * all.length)];
    const code = makeCouponCode_(cfg.COUPON_PREFIX);
    sheet_('COUPONS').appendRow([code, name, nowStr_(), 'GAME', reward.name, '게임', 0, '미사용', '', reward.grade]);
    bumpRev_(name);
    return {
      dropped: true, threshold: threshold, chance: chance, grade: reward.grade, rewardName: reward.name, desc: reward.desc, code: code,
      remainingToday: limit > 0 ? limit - todayCount - 1 : null,
    };
  });
}

function dropChance_(cfg, k) { return Math.min(cfg.GAME_DROP_MAX, cfg.GAME_DROP_BASE + cfg.GAME_DROP_INC * k); }

/** 단계(k)가 높을수록 높은 등급 비중 증가 */
function gradeWeights_(k) {
  return { '노멀': Math.max(30, 70 - 6 * k), '레어': 22 + 2 * k, '에픽': 7 + 2.5 * k, '레전드': 1 + 1.5 * k };
}
function pickGrade_(k) {
  const w = gradeWeights_(k);
  let total = 0; GRADES.forEach(function (g) { total += w[g]; });
  let x = Math.random() * total;
  for (let i = 0; i < GRADES.length; i++) { x -= w[GRADES[i]]; if (x < 0) return GRADES[i]; }
  return GRADES[0];
}

function gameDropsToday_(name) {
  const t = today_();
  return rows_('COUPONS').filter(function (r) {
    return String(r[1]).trim() === name && String(r[3]) === 'GAME' && dateTime_(r[2]).slice(0, 10) === t;
  }).length;
}

/** 확률표 (화면 안내용) */
function dropInfo_(name) {
  const cfg = config_();
  const rows = [];
  for (let k = 0; k < 8; k++) {
    const w = gradeWeights_(k);
    let total = 0; GRADES.forEach(function (g) { total += w[g]; });
    const chance = dropChance_(cfg, k);
    const g = {};
    GRADES.forEach(function (x) { g[x] = Math.round(chance * w[x] / total * 10) / 10; });
    rows.push({ score: cfg.GAME_DROP_START + cfg.GAME_DROP_STEP * k, chance: chance, grades: g });
  }
  const limit = cfg.GAME_DROP_DAILY_LIMIT;
  return {
    start: cfg.GAME_DROP_START, step: cfg.GAME_DROP_STEP, table: rows, limit: limit,
    remainingToday: name && limit > 0 ? Math.max(0, limit - gameDropsToday_(name)) : null,
    rewards: gameRewards_(),
  };
}

let gameRewardsCache_ = null;
function gameRewards_() {
  if (gameRewardsCache_) return gameRewardsCache_;
  let rows = rows_('GAME_REWARDS').filter(function (r) { return String(r[1]).trim() !== ''; });
  if (!rows.length) rows = DEFAULT_GAME_REWARDS;
  gameRewardsCache_ = rows.map(function (r) {
    const g = String(r[0]).trim();
    return { grade: GRADES.indexOf(g) >= 0 ? g : '노멀', name: String(r[1]).trim(), desc: String(r[2] || '') };
  });
  return gameRewardsCache_;
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
    bumpRev_(name);
  });
  return { ok: true };
}

/** 관리자가 원하는 날짜에 합격(승인) 도장을 직접 찍어줌. 기록이 없어도 가능, 수치는 선택 */
function adminGrantStamp(auth, name, date, value, memo) {
  return adminGrantStampRange(auth, name, date, date, value, memo, false);
}

/**
 * 기간 일괄 합격 도장. from~to (포함) 각 날짜에 승인 도장을 찍음.
 * - 기록 없음 → 새로 생성 / 대기·비승인 → 승인으로 변경
 * - 이미 승인된 날은 기간 부여일 때 건너뜀 (하루 부여일 때는 수치·메모 갱신)
 * - skipWeekend: 토·일 제외 / 오늘 이후 날짜는 자동 제외 / 최대 93일
 */
function adminGrantStampRange(auth, name, from, to, value, memo, skipWeekend) {
  const admin = verifyAdmin_(auth);
  name = cleanName_(name);
  from = String(from || ''); to = String(to || from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('날짜를 선택하세요.');
  if (from > to) { const t = from; from = to; to = t; }
  const today = today_();
  if (from > today) throw new Error('미래 날짜에는 도장을 줄 수 없어요.');
  let future = 0;
  const dates = [];
  for (let d = from; d <= to; d = addDays_(d, 1)) {
    if (d > today) { future++; continue; }
    if (skipWeekend && isWeekend_(d)) continue;
    dates.push(d);
    if (dates.length > 93) throw new Error('한 번에 최대 93일까지 부여할 수 있어요.');
  }
  const total = (function () { let n = 0; for (let d = from; d <= to; d = addDays_(d, 1)) n++; return n; })();
  const weekend = total - future - dates.length;
  if (!dates.length) throw new Error('부여할 날짜가 없어요. (주말 제외/미래 날짜 확인)');

  const known = rows_('USERS').some(function (r) { return String(r[0]).trim() === name; });
  if (!known) throw new Error('등록되지 않은 사용자예요. (한 번 이상 로그인한 사용자만 가능)');
  const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
  const v = hasValue ? Number(value) : '';
  if (hasValue && (!isFinite(v) || v < 0 || v > 100000)) throw new Error('수치는 0 ~ 100000 사이로 입력하세요.');
  const cfg = config_();
  const note = '관리자부여' + (String(memo || '').trim() ? ': ' + String(memo).trim().slice(0, 100) : '');
  const single = from === to;
  const autoOf = function (val) { return val === '' ? '관리자부여' : (Number(val) >= cfg.PASS_THRESHOLD ? '통과' : '미통과'); };
  const res = { created: 0, updated: 0, already: 0, weekend: weekend, future: future, days: dates.length };

  withLock_(function () {
    const sh = sheet_('RECORDS');
    const data = rows_('RECORDS');
    const index = {};
    data.forEach(function (r, i) { if (String(r[1]).trim() === name) index[date_(r[0])] = i; });
    const now = nowStr_();
    const newRows = [];
    dates.forEach(function (d) {
      const i = index[d];
      if (i === undefined) {
        newRows.push([d, name, v, autoOf(v), STATUS.APPROVED, admin, now, now, note]);
        res.created++;
        return;
      }
      const row = data[i];
      if (String(row[4]).trim() === STATUS.APPROVED && !single) { res.already++; return; }
      const nv = hasValue ? v : row[2];
      sh.getRange(i + 2, 3, 1, 7).setValues([[nv, autoOf(nv), STATUS.APPROVED, admin, now, row[7], note]]);
      res.updated++;
    });
    if (newRows.length) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  });
  bumpRev_(name);
  res.ok = true;
  res.existed = res.updated > 0;
  res.wallet = wallet_(name, to > today ? today.slice(0, 7) : to.slice(0, 7));
  return res;
}

function addDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function isWeekend_(ymd) {
  const p = ymd.split('-').map(Number);
  const w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return w === 0 || w === 6;
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
    bumpRev_(String(data[idx][1]).trim());
    sh.getRange(idx + 2, 8, 1, 2).setValues([used ? ['미사용', ''] : ['사용', nowStr_()]]);
  });
  return adminListCoupons(auth);
}

function adminListGames(auth) {
  verifyAdmin_(auth);
  const list = rows_('GAMES').map(function (r) {
    return { at: dateTime_(r[0]), name: String(r[1]), score: Number(r[2]) || 0, maxLevel: Number(r[3]) || 0 };
  }).reverse().slice(0, 200);
  const rk = getGameRanking('');
  return { list: list, ranking: rk.month.top, today: rk.today.top, week: rk.week.top, weekStart: rk.weekStart };
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
  const isGame = String(r[3]) === 'GAME';
  let rw;
  if (isGame) rw = gameRewards_().filter(function (x) { return x.name === String(r[4]); })[0] || {};
  else rw = rewards_().filter(function (x) { return x.id === String(r[3]); })[0] || {};
  return {
    code: String(r[0]), name: String(r[1]), issuedAt: dateTime_(r[2]), rewardId: String(r[3]), rewardName: String(r[4]),
    desc: rw.desc || '', icon: isGame ? 'gift' : (rw.icon || 'ticket'), ym: isGame ? '' : month_(r[5]), cost: Number(r[6]) || 0,
    used: String(r[7]).trim() === '사용', usedAt: dateTime_(r[8]),
    game: isGame, grade: isGame ? String(r[9] || '노멀') : '',
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
  // 새 버전에서 추가된 설정 키를 기존 Config 시트에 채워 넣기
  const have = {};
  rows_('CONFIG').forEach(function (r) { have[String(r[0]).trim()] = true; });
  const missing = DEFAULT_CONFIG.filter(function (r) { return !have[r[0]]; });
  if (missing.length) {
    const sh = sheet_('CONFIG');
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  }
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
    if (key === 'GAME_PLAYS') sh.getRange('D:D').setNumberFormat('@');
    if (key === 'GAME_REWARDS') sh.getRange(2, 1, DEFAULT_GAME_REWARDS.length, 3).setValues(DEFAULT_GAME_REWARDS);
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
  ['GAME_DROP_START', 'GAME_DROP_STEP', 'GAME_DROP_BASE', 'GAME_DROP_INC', 'GAME_DROP_MAX', 'GAME_DROP_DAILY_LIMIT', 'GAME_PLAY_MAX', 'GAME_PLAY_RECOVER_MIN'].forEach(function (k) {
    const def = DEFAULT_CONFIG.filter(function (r) { return r[0] === k; })[0][1];
    const n = Number(o[k]);
    o[k] = isFinite(n) && String(o[k]).trim() !== '' ? n : def;
  });
  o.GAME_DROP_STEP = Math.max(1, o.GAME_DROP_STEP);
  o.GAME_PLAY_MAX = Math.max(1, Math.floor(o.GAME_PLAY_MAX));
  o.GAME_PLAY_RECOVER_MIN = Math.max(1, o.GAME_PLAY_RECOVER_MIN);
  o.APP_TITLE = String(o.APP_TITLE || '도트 운동 도장판');
  return o;
}

/** 사용자별 변경 번호: 도장/쿠폰이 바뀔 때마다 갱신 → 화면이 감지해서 즉시 새로고침 */
function bumpRev_(name) {
  CacheService.getScriptCache().put('rev_' + name, String(Date.now()), 21600);
}
function getRev_(name) {
  const c = CacheService.getScriptCache();
  let v = c.get('rev_' + name);
  if (!v) { v = String(Date.now()); c.put('rev_' + name, v, 21600); }
  return v;
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
