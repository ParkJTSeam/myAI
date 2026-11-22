/**
 * ⌚ Garmin → Google Sheets → HTML 대시보드
 *
 * [설정 방법 요약]  (자세한 내용은 README.md)
 *  1) 스크립트 속성(Project Settings > Script properties)에 키 이름 "APIKEY" 로
 *     get_garmin_apikey.py 가 출력한 JSON 한 줄을 그대로 붙여넣기
 *     (또는 시트 메뉴 ⌚ 가민 > 🔑 APIKEY 등록)
 *  2) 메뉴 ⌚ 가민 > 🔄 오늘 동기화  → 시트에 데이터가 쌓이는지 확인
 *  3) 메뉴 ⌚ 가민 > ⏰ 매일 자동 동기화 켜기
 *  4) 배포 > 새 배포 > 웹 앱  → 대시보드 URL 사용
 *
 * APIKEY 없이 화면만 먼저 보고 싶으면: 메뉴 > 🧪 샘플 데이터 넣기
 */

// ───────────────────────── 사용자 설정 ─────────────────────────
const CONFIG = {
  SHEET_DAILY: '일일요약',
  SHEET_ACT: '활동기록',
  GOAL_SLEEP_HOURS: 7.5,     // 목표 수면시간
  GOAL_INTAKE_KCAL: 2200,    // 목표 섭취 칼로리
  GOAL_ACTIVE_MIN: 30,       // 하루 목표 강도 활동(분)
  SYNC_HOURS: [7, 22],       // 자동 동기화 시각 (아침: 지난밤 수면 확정 / 밤: 하루 활동 마감)
  BACKFILL_DAYS: 30,         // "최근 N일 가져오기" 일수
};

// ───────────────────────── 시트 컬럼 정의 ─────────────────────────
const DAILY_COLS = [
  ['date', '날짜'],
  ['sleepScore', '수면점수'],
  ['sleepHours', '총수면(h)'],
  ['deepMin', '깊은수면(분)'],
  ['lightMin', '얕은수면(분)'],
  ['remMin', 'REM수면(분)'],
  ['awakeMin', '깨어있음(분)'],
  ['bedTime', '취침'],
  ['wakeTime', '기상'],
  ['steps', '걸음수'],
  ['stepGoal', '걸음목표'],
  ['distanceKm', '이동거리(km)'],
  ['intensityMin', '강도활동(분)'],
  ['floors', '오른층수'],
  ['restingHR', '안정시심박'],
  ['avgStress', '평균스트레스'],
  ['bbHigh', '바디배터리최고'],
  ['bbLow', '바디배터리최저'],
  ['totalKcal', '총소모(kcal)'],
  ['activeKcal', '활동소모(kcal)'],
  ['bmrKcal', '기초대사(kcal)'],
  ['garminIntakeKcal', '섭취-가민(kcal)'],
  ['manualIntakeKcal', '섭취-직접입력(kcal)'],
  ['workoutCount', '운동횟수'],
  ['workoutMin', '운동시간(분)'],
  ['workoutKcal', '운동소모(kcal)'],
  ['updatedAt', '갱신시각'],
];
const ACT_COLS = [
  ['activityId', '활동ID'],
  ['date', '날짜'],
  ['startTime', '시작시각'],
  ['name', '활동명'],
  ['type', '종류'],
  ['durationMin', '시간(분)'],
  ['distanceKm', '거리(km)'],
  ['kcal', '칼로리(kcal)'],
  ['avgHR', '평균심박'],
  ['maxHR', '최대심박'],
];

const TEXT_KEYS = ['date', 'activityId', 'bedTime', 'wakeTime', 'startTime', 'updatedAt'];

const GC_API = 'https://connectapi.garmin.com';
const GC_UA = 'GCM-iOS-5.7.2.1';
const TZ = Session.getScriptTimeZone();

// ═════════════════════════ 메뉴 ═════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⌚ 가민')
    .addItem('🔄 오늘 동기화', 'syncToday')
    .addItem('📥 최근 ' + CONFIG.BACKFILL_DAYS + '일 가져오기', 'syncBackfill')
    .addSeparator()
    .addItem('⏰ 매일 자동 동기화 켜기', 'installTriggers')
    .addItem('⏹ 자동 동기화 끄기', 'removeTriggers')
    .addSeparator()
    .addItem('🔑 APIKEY 등록/변경', 'promptApiKey')
    .addItem('🩺 연결 테스트', 'testConnection')
    .addItem('🧪 샘플 데이터 넣기 (API 없이 테스트)', 'seedDemoData')
    .addToUi();
}

function promptApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('APIKEY 등록',
    'get_garmin_apikey.py 가 출력한 JSON 한 줄을 붙여넣으세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const v = res.getResponseText().trim();
  parseApiKey_(v); // 형식 검증
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APIKEY', v);
  props.deleteProperty('GC_OAUTH2');
  props.deleteProperty('GC_DISPLAY_NAME');
  ui.alert('✅ APIKEY 저장 완료. "🩺 연결 테스트"를 눌러 확인하세요.');
}

function testConnection() {
  const name = getDisplayName_();
  SpreadsheetApp.getUi().alert('✅ 가민 연결 성공!\n사용자: ' + name);
}

// ═════════════════════════ 동기화 ═════════════════════════
/** 트리거/메뉴용: 어제 + 오늘 동기화 (어제 데이터를 다시 받아 늦게 올라온 값까지 확정) */
function syncToday() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  syncDate(fmt_(yesterday));
  return syncDate(fmt_(today));
}

function syncBackfill() {
  const now = new Date();
  for (let i = CONFIG.BACKFILL_DAYS - 1; i >= 0; i--) {
    syncDate(fmt_(new Date(now.getTime() - i * 86400000)));
    Utilities.sleep(300); // 과도한 요청 방지
  }
  SpreadsheetApp.getActive().toast(CONFIG.BACKFILL_DAYS + '일치 동기화 완료', '⌚ 가민');
}

/** 특정 날짜(yyyy-MM-dd) 동기화. 웹 대시보드의 "새로고침" 버튼도 이 함수를 호출 */
function syncDate(dateStr) {
  const name = getDisplayName_();
  const summary = gcGet_('/usersummary-service/usersummary/daily/' + encodeURIComponent(name) +
    '?calendarDate=' + dateStr) || {};
  const sleepRes = gcGet_('/wellness-service/wellness/dailySleepData/' + encodeURIComponent(name) +
    '?date=' + dateStr + '&nonSleepBufferMinutes=60') || {};
  const acts = gcGet_('/activitylist-service/activities/search/activities?startDate=' + dateStr +
    '&endDate=' + dateStr + '&limit=50') || [];

  const sleep = sleepRes.dailySleepDTO || {};
  const scores = sleep.sleepScores || {};
  const min = s => (s == null ? '' : Math.round(s / 60));

  const activities = acts.map(a => ({
    activityId: String(a.activityId),
    date: dateStr,
    startTime: (a.startTimeLocal || '').slice(11, 16),
    name: a.activityName || '',
    type: (a.activityType && a.activityType.typeKey) || '',
    durationMin: a.duration ? Math.round(a.duration / 60) : '',
    distanceKm: a.distance ? round_(a.distance / 1000, 2) : '',
    kcal: a.calories ? Math.round(a.calories) : '',
    avgHR: a.averageHR ? Math.round(a.averageHR) : '',
    maxHR: a.maxHR ? Math.round(a.maxHR) : '',
  }));

  const row = {
    date: dateStr,
    sleepScore: (scores.overall && scores.overall.value) || '',
    sleepHours: sleep.sleepTimeSeconds ? round_(sleep.sleepTimeSeconds / 3600, 2) : '',
    deepMin: min(sleep.deepSleepSeconds),
    lightMin: min(sleep.lightSleepSeconds),
    remMin: min(sleep.remSleepSeconds),
    awakeMin: min(sleep.awakeSleepSeconds),
    bedTime: localTime_(sleep.sleepStartTimestampLocal),
    wakeTime: localTime_(sleep.sleepEndTimestampLocal),
    steps: nz_(summary.totalSteps),
    stepGoal: nz_(summary.dailyStepGoal),
    distanceKm: summary.totalDistanceMeters ? round_(summary.totalDistanceMeters / 1000, 2) : '',
    intensityMin: (summary.moderateIntensityMinutes != null || summary.vigorousIntensityMinutes != null)
      ? (summary.moderateIntensityMinutes || 0) + 2 * (summary.vigorousIntensityMinutes || 0) : '',
    floors: summary.floorsAscended != null ? Math.round(summary.floorsAscended) : '',
    restingHR: nz_(summary.restingHeartRate),
    avgStress: summary.averageStressLevel > 0 ? summary.averageStressLevel : '',
    bbHigh: nz_(summary.bodyBatteryHighestValue),
    bbLow: nz_(summary.bodyBatteryLowestValue),
    totalKcal: summary.totalKilocalories ? Math.round(summary.totalKilocalories) : '',
    activeKcal: summary.activeKilocalories ? Math.round(summary.activeKilocalories) : '',
    bmrKcal: summary.bmrKilocalories ? Math.round(summary.bmrKilocalories) : '',
    garminIntakeKcal: summary.consumedKilocalories ? Math.round(summary.consumedKilocalories) : '',
    // manualIntakeKcal 은 덮어쓰지 않음 (사용자가 직접 입력한 값 보존)
    workoutCount: activities.length,
    workoutMin: activities.reduce((s, a) => s + (Number(a.durationMin) || 0), 0),
    workoutKcal: activities.reduce((s, a) => s + (Number(a.kcal) || 0), 0),
    updatedAt: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
  };

  upsertDaily_(row);
  upsertActivities_(activities);
  return getDashboardData(dateStr);
}

// ═════════════════════════ 자동 실행(트리거) ═════════════════════════
function installTriggers() {
  removeTriggers();
  CONFIG.SYNC_HOURS.forEach(h =>
    ScriptApp.newTrigger('syncToday').timeBased().everyDays(1).atHour(h).create());
  SpreadsheetApp.getActive().toast('매일 ' + CONFIG.SYNC_HOURS.join('시, ') + '시에 자동 동기화됩니다.', '⌚ 가민');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncToday')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ═════════════════════════ 웹 앱 (대시보드) ═════════════════════════
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('오늘의 건강 대시보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 대시보드에 필요한 데이터 묶음. dateStr 없으면 오늘 */
function getDashboardData(dateStr) {
  dateStr = dateStr || fmt_(new Date());
  const daily = readSheet_(CONFIG.SHEET_DAILY, DAILY_COLS);
  const byDate = {};
  daily.forEach(r => (byDate[r.date] = r));

  const trend = [];
  const base = parseDate_(dateStr);
  for (let i = 6; i >= 0; i--) {
    const d = fmt_(new Date(base.getTime() - i * 86400000));
    const r = byDate[d] || {};
    trend.push({
      date: d,
      sleepHours: num_(r.sleepHours),
      sleepScore: num_(r.sleepScore),
      steps: num_(r.steps),
      totalKcal: num_(r.totalKcal),
      intakeKcal: intakeOf_(r),
    });
  }

  const day = byDate[dateStr] || null;
  if (day) day.intakeKcal = intakeOf_(day);

  const activities = readSheet_(CONFIG.SHEET_ACT, ACT_COLS).filter(a => a.date === dateStr)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  return {
    date: dateStr,
    day: day,
    activities: activities,
    trend: trend,
    goals: {
      sleepHours: CONFIG.GOAL_SLEEP_HOURS,
      intakeKcal: CONFIG.GOAL_INTAKE_KCAL,
      activeMin: CONFIG.GOAL_ACTIVE_MIN,
    },
    hasApiKey: !!PropertiesService.getScriptProperties().getProperty('APIKEY'),
  };
}

/** 대시보드에서 섭취 칼로리를 직접 입력/수정 */
function saveIntake(dateStr, kcal) {
  const v = kcal === '' || kcal == null ? '' : Math.round(Number(kcal));
  upsertDaily_({ date: dateStr, manualIntakeKcal: v });
  return getDashboardData(dateStr);
}

// ═════════════════════════ 가민 인증 (APIKEY → OAuth2) ═════════════════════════
/**
 * APIKEY = garth 의 OAuth1 토큰 JSON (약 1년 유효)
 *   {"oauth_token":"...","oauth_token_secret":"...","mfa_token":null,"domain":"garmin.com"}
 * 이를 이용해 1시간짜리 OAuth2 access token 을 자동 발급/갱신합니다.
 */
function parseApiKey_(raw) {
  if (!raw) throw new Error('APIKEY 가 없습니다. 스크립트 속성에 "APIKEY" 를 등록하세요 (README 참고).');
  let k;
  try { k = JSON.parse(raw); } catch (e) {
    throw new Error('APIKEY 형식 오류: get_garmin_apikey.py 가 출력한 JSON 전체를 그대로 넣어주세요.');
  }
  if (!k.oauth_token || !k.oauth_token_secret) throw new Error('APIKEY 에 oauth_token / oauth_token_secret 이 없습니다.');
  return k;
}

function getAccessToken_(forceRefresh) {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('GC_OAUTH2');
  if (cached && !forceRefresh) {
    const t = JSON.parse(cached);
    if (t.expires_at - 60 > Date.now() / 1000) return t.access_token;
  }
  const key = parseApiKey_(props.getProperty('APIKEY'));
  const consumer = getConsumer_();
  const url = GC_API + '/oauth-service/oauth/exchange/user/2.0';
  const body = {};
  if (key.mfa_token) body.mfa_token = key.mfa_token;

  const opts = {
    method: 'post',
    headers: {
      'User-Agent': GC_UA,
      Authorization: oauth1Header_('POST', url, consumer, key, body),
    },
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true,
  };
  if (Object.keys(body).length) opts.payload = body;
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() !== 200) {
    throw new Error('가민 토큰 발급 실패(' + res.getResponseCode() + '). APIKEY 가 만료됐을 수 있습니다. ' +
      'get_garmin_apikey.py 를 다시 실행해 APIKEY 를 갱신하세요.\n' + res.getContentText().slice(0, 300));
  }
  const t = JSON.parse(res.getContentText());
  t.expires_at = Math.floor(Date.now() / 1000) + (t.expires_in || 3600);
  props.setProperty('GC_OAUTH2', JSON.stringify({ access_token: t.access_token, expires_at: t.expires_at }));
  return t.access_token;
}

function getConsumer_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('GC_CONSUMER');
  if (c) return JSON.parse(c);
  const res = UrlFetchApp.fetch('https://thegarth.s3.amazonaws.com/oauth_consumer.json');
  cache.put('GC_CONSUMER', res.getContentText(), 21600);
  return JSON.parse(res.getContentText());
}

function oauth1Header_(method, url, consumer, token, bodyParams) {
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const oauth = {
    oauth_consumer_key: consumer.consumer_key,
    oauth_nonce: Utilities.getUuid().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token.oauth_token,
    oauth_version: '1.0',
  };
  const all = Object.assign({}, oauth, bodyParams || {});
  const paramStr = Object.keys(all).sort().map(k => enc(k) + '=' + enc(all[k])).join('&');
  const baseStr = [method.toUpperCase(), enc(url), enc(paramStr)].join('&');
  const signKey = enc(consumer.consumer_secret) + '&' + enc(token.oauth_token_secret);
  oauth.oauth_signature = Utilities.base64Encode(
    Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, baseStr, signKey));
  return 'OAuth ' + Object.keys(oauth).map(k => enc(k) + '="' + enc(oauth[k]) + '"').join(', ');
}

/** Garmin Connect API GET (401 이면 토큰 재발급 후 1회 재시도) */
function gcGet_(path, _retried) {
  const res = UrlFetchApp.fetch(GC_API + path, {
    headers: { Authorization: 'Bearer ' + getAccessToken_(!!_retried), 'User-Agent': GC_UA },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401 && !_retried) return gcGet_(path, true);
  if (code === 204 || code === 404) return null;
  if (code !== 200) throw new Error('가민 API 오류 ' + code + ' : ' + path + '\n' + res.getContentText().slice(0, 300));
  const txt = res.getContentText();
  return txt ? JSON.parse(txt) : null;
}

function getDisplayName_() {
  const props = PropertiesService.getScriptProperties();
  let name = props.getProperty('GC_DISPLAY_NAME');
  if (!name) {
    const p = gcGet_('/userprofile-service/socialProfile');
    name = p && p.displayName;
    if (!name) throw new Error('가민 사용자 정보를 가져오지 못했습니다.');
    props.setProperty('GC_DISPLAY_NAME', name);
  }
  return name;
}

// ═════════════════════════ 시트 입출력 ═════════════════════════
function getSheet_(name, cols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[1])])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // 날짜·시각·ID 컬럼은 텍스트로 유지 (자동 날짜 변환 방지)
    cols.forEach((c, i) => {
      if (TEXT_KEYS.indexOf(c[0]) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function readSheet_(name, cols) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
  return values.map(v => {
    const o = {};
    cols.forEach((c, i) => {
      const x = v[i];
      if (x instanceof Date) {
        // 시각만 있는 값(1899-12-30 기준)은 HH:mm, 그 외는 yyyy-MM-dd
        o[c[0]] = x.getFullYear() < 1901 ? Utilities.formatDate(x, TZ, 'HH:mm') : fmt_(x);
      } else {
        o[c[0]] = x;
      }
    });
    return o;
  });
}

function upsertDaily_(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(CONFIG.SHEET_DAILY, DAILY_COLS);
    const rows = readSheet_(CONFIG.SHEET_DAILY, DAILY_COLS);
    const idx = rows.findIndex(r => r.date === row.date);
    const merged = Object.assign({}, idx >= 0 ? rows[idx] : {}, row);
    const values = [DAILY_COLS.map(c => (merged[c[0]] == null ? '' : merged[c[0]]))];
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, DAILY_COLS.length).setValues(values);
    } else {
      sh.appendRow(values[0]);
      sortByDate_(sh, DAILY_COLS.length);
    }
  } finally {
    lock.releaseLock();
  }
}

function upsertActivities_(acts) {
  if (!acts.length) return;
  const sh = getSheet_(CONFIG.SHEET_ACT, ACT_COLS);
  const existing = readSheet_(CONFIG.SHEET_ACT, ACT_COLS);
  const pos = {};
  existing.forEach((a, i) => (pos[String(a.activityId)] = i + 2));
  acts.forEach(a => {
    const vals = [ACT_COLS.map(c => (a[c[0]] == null ? '' : a[c[0]]))];
    if (pos[a.activityId]) sh.getRange(pos[a.activityId], 1, 1, ACT_COLS.length).setValues(vals);
    else sh.appendRow(vals[0]);
  });
  sortByDate_(sh, ACT_COLS.length, [{ column: 2, ascending: true }, { column: 3, ascending: true }]);
}

function sortByDate_(sh, ncols, spec) {
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, ncols).sort(spec || { column: 1, ascending: true });
}

// ═════════════════════════ 샘플 데이터 ═════════════════════════
function seedDemoData() {
  const now = new Date();
  const types = [['running', '아침 러닝'], ['cycling', '퇴근길 라이딩'], ['strength_training', '근력 운동'], ['walking', '산책']];
  for (let i = 13; i >= 0; i--) {
    const d = fmt_(new Date(now.getTime() - i * 86400000));
    const r = (a, b) => Math.round(a + Math.random() * (b - a));
    const deep = r(50, 110), light = r(180, 260), rem = r(70, 120), awake = r(5, 30);
    const acts = [];
    if (Math.random() < 0.7) {
      const t = types[r(0, types.length - 1)];
      const dur = r(25, 70);
      acts.push({ activityId: 'demo-' + d, date: d, startTime: '0' + r(6, 8) + ':' + r(10, 59), name: t[1], type: t[0],
        durationMin: dur, distanceKm: t[0] === 'strength_training' ? '' : round_(dur * (t[0] === 'cycling' ? 0.4 : 0.15), 2),
        kcal: dur * r(7, 11), avgHR: r(120, 150), maxHR: r(155, 180) });
    }
    const bmr = 1650, active = r(350, 900) + acts.reduce((s, a) => s + a.kcal, 0) * 0.6;
    upsertDaily_({
      date: d, sleepScore: r(60, 92), sleepHours: round_((deep + light + rem) / 60, 2),
      deepMin: deep, lightMin: light, remMin: rem, awakeMin: awake,
      bedTime: '23:' + String(r(0, 59)).padStart(2, '0'), wakeTime: '0' + r(6, 7) + ':' + String(r(0, 59)).padStart(2, '0'),
      steps: r(4000, 14000), stepGoal: 8000, distanceKm: round_(r(30, 110) / 10, 2),
      intensityMin: r(10, 80), floors: r(2, 20), restingHR: r(52, 62), avgStress: r(20, 45),
      bbHigh: r(70, 100), bbLow: r(10, 35),
      totalKcal: Math.round(bmr + active), activeKcal: Math.round(active), bmrKcal: bmr,
      garminIntakeKcal: '', manualIntakeKcal: r(1700, 2700),
      workoutCount: acts.length, workoutMin: acts.reduce((s, a) => s + a.durationMin, 0),
      workoutKcal: acts.reduce((s, a) => s + a.kcal, 0),
      updatedAt: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' (샘플)',
    });
    upsertActivities_(acts);
  }
  SpreadsheetApp.getActive().toast('14일치 샘플 데이터를 넣었습니다.', '⌚ 가민');
}

// ═════════════════════════ 유틸 ═════════════════════════
function fmt_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function parseDate_(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
function round_(n, k) { const m = Math.pow(10, k); return Math.round(n * m) / m; }
function nz_(v) { return v == null ? '' : v; }
function num_(v) { return v === '' || v == null || isNaN(Number(v)) ? null : Number(v); }
function intakeOf_(r) { return num_(r.manualIntakeKcal) != null ? num_(r.manualIntakeKcal) : num_(r.garminIntakeKcal); }
/** 가민의 *TimestampLocal 값은 "현지시각을 UTC처럼 담은" ms → UTC로 포맷해야 현지 시각이 나옴 */
function localTime_(ms) { return ms ? Utilities.formatDate(new Date(ms), 'UTC', 'HH:mm') : ''; }
