const WEBAPP_SPREADSHEET_ID =
  '1_NompYXCpYEPRmqFZUCLsfPgMawZFlyvaRt8VkEGhaw';

// 基本設定
const WEBAPP_TIME_ZONE = 'Asia/Tokyo';
const WEBAPP_CUSTOMER_SHEET_NAME = 'おともだちリスト';
const WEBAPP_CHANGE_LOG_SHEET_NAME = '変動ログ';

// 見出しより下、実データが始まる行
const WEBAPP_CUSTOMER_START_ROW = 6;
const WEBAPP_CHANGE_LOG_START_ROW = 2;
const WEBAPP_DAILY_START_ROW = 6;

// おともだちリスト側の列番号
const WEBAPP_CUSTOMER_COLUMNS = {
  code: 1,
  name: 2,
  reading: 3,
  balance: 4,
  lastVisit: 5,
  otoPoints: 6,
  memo: 7,
  visitCount: 8,
  firstVisit: 9,
};

// 日付シート側の列番号（実シートで固定）
const WEBAPP_DAILY_COLUMN_DEFAULTS = {
  no: 1,
  code: 2,
  lastVisit: 3,
  name: 4,
  balanceBefore: 5,
  withdrawable: 6,
  initialWithdrawal: 7,
  movementStart: 8,
  movementEnd: 17,
  endingRemaining: 18,
  balanceAfter: 19,
  nameMirror: 20,
  codeMirror: 21,
  noMirror: 22,
};

const WEBAPP_DAILY_COLUMNS = {
  ...WEBAPP_DAILY_COLUMN_DEFAULTS,
};

// 変動ログ側の列番号
const WEBAPP_CHANGE_LOG_COLUMNS = {
  recordDate: 1,
  code: 2,
  name: 3,
  previousLastVisit: 4,
  lastVisit: 5,
  balanceBefore: 6,
  balanceAfter: 7,
  chipChange: 8,
};

// 🌐 Webアプリから呼ばれる入口（JSONPにも対応）
function doGet(e) {
  const parameters = e && e.parameter ? e.parameter : {};
  const callback = parameters.callback || '';

  try {
    assertApiSecret_(parameters);

    const action = parameters.action || '';
    const data = dispatch_(action, parameters);

    return respond_(
      {
        success: true,
        data,
      },
      callback,
    );
  } catch (error) {
    console.error(error);

    return respond_(
      {
        success: false,
        error: error.message || String(error),
        code: error.code || '',
      },
      callback,
    );
  }
}

// 🔐 Cloudflare Workerからの呼び出しだけ通す
function assertApiSecret_(parameters) {
  const expectedSecret = PropertiesService
    .getScriptProperties()
    .getProperty('WEBAPP_API_SECRET');
  const actualSecret = String(parameters.apiSecret || '');

  if (!expectedSecret) {
    throw new Error('API secret is not configured');
  }

  if (actualSecret !== expectedSecret) {
    throw new Error('認証に失敗しました');
  }
}

function dispatch_(action, parameters) {
  switch (action) {
    case 'exportReadModel':
      return exportReadModel_();

    case 'getAllCustomers':
      return getAllCustomers_();

    case 'getCustomer':
      return getCustomer_(parameters.customerCode);

    case 'getHistory':
      return getHistory_(parameters.customerCode);

    case 'getTodayHistory':
      return getTodayHistory_();

    case 'getTodayActiveCustomers':
      return getTodayActiveCustomers_();

    case 'addTransaction':
      return addTransaction_(
        parameters.customerCode,
        parameters.chipChange,
        parameters.requestId,
        parameters.expectedBalance,
      );

    case 'enterCustomer':
      return enterCustomer_(parameters.customerCode);

    case 'checkoutCustomer':
      return checkoutCustomer_(
        parameters.customerCode,
        parameters.endingAmount,
        parameters.requestId,
        parameters.expectedBalance,
      );

    case 'createCustomer':
      return createCustomer_(
        parameters.customerName,
        parameters.initialBalance,
      );

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

function respond_(payload, callback) {
  const json = JSON.stringify(payload);

  if (callback) {
    return ContentService.createTextOutput(
      `${callback}(${json});`,
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// Full snapshots are built from one bulk read per source, never per customer.
function exportReadModel_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return buildReadModelSnapshot_();
  } finally {
    lock.releaseLock();
  }
}

function readModelRows_(sheet, startRow, width, progress = () => {}) {
  if (!sheet) throw verificationError_();
  const height = sheet.getLastRow() - startRow + 1;
  if (height <= 0) return [];
  progress('range_values_start', { rowCount: height });
  const range = sheet.getRange(startRow, 1, height, width);
  const values = range.getValues();
  progress('range_values_done', { rowCount: height });
  const displays = range.getDisplayValues();
  progress('range_displays_done', { rowCount: height });
  return values.map((row, index) => ({
    row, display: displays[index], rowNumber: startRow + index,
  }));
}

function readModelDate_(value, displayValue) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) return '';
    // Modern shop records use JST (UTC+09:00, no daylight saving).
    // Keep the original formatter for historical dates or a different timezone.
    if (WEBAPP_TIME_ZONE === 'Asia/Tokyo' &&
        timestamp >= Date.UTC(1970, 0, 1) && timestamp < Date.UTC(2100, 0, 1)) {
      return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
  }
  return formatSheetDate_(value, displayValue);
}

function readModelCode_(value) {
  const text = String(value == null ? '' : value).trim();
  // Do not let normalizeCode_ turn malformed identities into valid customers.
  if (!/^\d{1,4}$/.test(text)) throw verificationError_();
  return normalizeCode_(text);
}

function readModelHasValue_(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function readModelError_() {
  const error = verificationError_();
  return { readModelError: { code: error.code, error: error.message } };
}

// Caller holds the script lock, including timestamp reservation.
function nextReadModelTimestamp_() {
  const properties = PropertiesService.getScriptProperties();
  const saved = properties.getProperty('WEBAPP_READ_MODEL_TIMESTAMP');
  const previous = saved ? Date.parse(saved) : 0;
  if (!Number.isFinite(previous)) throw verificationError_();
  const timestamp = new Date(Math.max(Date.now(), previous + 1)).toISOString();
  properties.setProperty('WEBAPP_READ_MODEL_TIMESTAMP', timestamp);
  return timestamp;
}

function diagnoseReadModel() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    buildReadModelSnapshot_(true);
    console.log('Diagnostic finished. No spreadsheet or D1 data was changed.');
  } finally {
    lock.releaseLock();
  }
}

function buildReadModelSnapshot_(diagnose = false, progress = () => {}) {
  const historyWarnings = new Map();
  const report = (customerCode, reason, details = {}) => {
    if (reason.startsWith('HISTORY_') || reason.startsWith('INVALID_LOG_')) {
      if (!historyWarnings.has(customerCode)) historyWarnings.set(customerCode, []);
      historyWarnings.get(customerCode).push({ reason, ...details });
    }
    if (diagnose) console.log(JSON.stringify({ customerCode, reason, ...details }));
  };
  progress('sheet_customer_read_start');
  const spreadsheet = getSpreadsheet_();
  const businessDate = getTodaySheetName_();
  const customers = new Map();
  for (const { row, display, rowNumber } of readModelRows_(
    spreadsheet.getSheetByName(WEBAPP_CUSTOMER_SHEET_NAME),
    WEBAPP_CUSTOMER_START_ROW, WEBAPP_CUSTOMER_COLUMNS.firstVisit,
  )) {
    if (!row.some(readModelHasValue_) && !display.some(readModelHasValue_)) continue;
    const code = readModelCode_(display[0] || row[0]);
    // Pre-numbered rows with no customer data are reserved for future registrations.
    if (!row.slice(1).some(readModelHasValue_) &&
        !display.slice(1).some(readModelHasValue_)) continue;
    if (customers.has(code)) throw verificationError_();
    const customer = customerRowToObject_(row, display);
    if (!customer || !customer.customerName) {
      console.error(JSON.stringify({
        code: 'READ_MODEL_CUSTOMER_NAME_MISSING',
        sheet: WEBAPP_CUSTOMER_SHEET_NAME,
        cell: 'B' + rowNumber,
        customerCode: code,
      }));
      throw verificationError_();
    }
    customers.set(code, { ...customer, customerCode: code, activeToday: false });
  }
  if (!customers.size) throw verificationError_();
  progress('sheet_customer_read_done', { customerCount: customers.size });

  progress('sheet_receipt_read_start');
  const unavailable = new Set();
  const completedWrites = [];
  for (const name of ['_WebappCheckoutReceipts', '_WebappTransactionReceipts']) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) continue;
    for (const { row, rowNumber } of readModelRows_(sheet, 2, 6)) {
      if (!row.some(readModelHasValue_)) continue;
      const code = readModelCode_(row[1]);
      if (!customers.has(code)) throw verificationError_();
      if (row[3] !== 'complete') {
        unavailable.add(code);
        report(code, 'INCOMPLETE_RECEIPT', { sheet: name, row: rowNumber });
      }
      else if (row[0] && row[4]) {
        try {
          const receipt = JSON.parse(row[4]);
          if (receipt.verified !== true || !codesMatch_(receipt.customerCode, code) ||
              !Number.isSafeInteger(receipt.newBalance)) throw verificationError_();
          completedWrites.push({ requestId: String(row[0]), customerCode: code,
            action: name === '_WebappCheckoutReceipts' ? 'checkoutCustomer' : 'addTransaction' });
        } catch (error) {
          unavailable.add(code);
          report(code, 'INVALID_RECEIPT', { sheet: name, row: rowNumber });
        }
      } else {
        unavailable.add(code);
        report(code, 'MISSING_RECEIPT', { sheet: name, row: rowNumber });
      }
    }
  }

  progress('sheet_receipt_read_done');
  progress('sheet_history_read_start');
  const histories = new Map();
  const latestLogs = new Map();
  const historyRows = readModelRows_(
    spreadsheet.getSheetByName(WEBAPP_CHANGE_LOG_SHEET_NAME),
    WEBAPP_CHANGE_LOG_START_ROW, WEBAPP_CHANGE_LOG_COLUMNS.chipChange,
    (stage, details) => progress('history_' + stage, details),
  );
  progress('history_parse_start', { rowCount: historyRows.length });
  let processedRows = 0;
  for (const { row, display, rowNumber } of historyRows) {
    if (++processedRows % 2000 === 0) {
      progress('history_parse_progress', { processedRows, rowCount: historyRows.length });
    }
    if (!row.some(readModelHasValue_) && !display.some(readModelHasValue_)) continue;
    const code = readModelCode_(display[1] || row[1]);
    if (!customers.has(code)) throw verificationError_();
    const date = readModelDate_(row[0], display[0]);
    const parsedDate = new Date(date + 'T00:00:00Z');
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date &&
      date <= businessDate;
    let transaction;
    let valid = false;
    try {
      if (!validDate) throw verificationError_();
      // Pass the already normalized date into the unchanged legacy parser.
      transaction = changeLogRowToTransaction_(
        [date, ...row.slice(1)], [date, ...display.slice(1)], rowNumber, code,
      );
      // The source parser intentionally omits zero changes.
      const before = numberFromCell_(row[5], display[5]);
      const after = numberFromCell_(row[6], display[6]);
      if (transaction) {
        if (![transaction.balanceBefore, transaction.balanceAfter, transaction.chipChange]
          .every(Number.isSafeInteger)) throw verificationError_();
        if (!histories.has(code)) histories.set(code, []);
        histories.get(code).push(transaction);
      } else if (![before, after].every(Number.isSafeInteger) || before !== after) {
        throw verificationError_();
      }
      valid = true;
    } catch (error) {
      report(code, validDate ? 'INVALID_LOG_VALUES' : 'INVALID_LOG_DATE',
        { sheet: WEBAPP_CHANGE_LOG_SHEET_NAME, row: rowNumber,
          recordedBefore: display[5], recordedAfter: display[6], recordedChange: display[7] });
    }
    // Legacy log completeness does not establish the current master balance.
    const previous = latestLogs.get(code);
    if (!previous || date > previous.date || (date === previous.date && rowNumber > previous.rowNumber)) {
      latestLogs.set(code, {
        date, rowNumber, valid,
        balance: transaction ? transaction.balanceAfter : numberFromCell_(row[6], display[6]),
      });
    }
  }

  progress('sheet_history_read_done');
  progress('sheet_today_read_start');
  const dailyByCode = new Map();
  const todayHistory = [];
  const dailySheet = spreadsheet.getSheetByName(businessDate);
  if (dailySheet) {
    refreshDailyColumns_(dailySheet);
    for (const entry of readModelRows_(dailySheet, WEBAPP_DAILY_START_ROW, getDailyReadWidth_())) {
      const { row, display, rowNumber } = entry;
      // Template rows can contain formulas, mirrors and row numbers without a visit.
      if (!readModelHasValue_(display[1]) && !readModelHasValue_(row[1])) {
        if ([3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
          .some(index => readModelHasValue_(row[index]) || readModelHasValue_(display[index]))) {
          throw verificationError_();
        }
        continue;
      }
      const code = readModelCode_(display[1] || row[1]);
      if (!customers.has(code)) throw verificationError_();
      const previous = dailyByCode.get(code);
      const ended = readModelHasValue_(display[17]) || readModelHasValue_(row[17]);
      const before = numberFromCell_(row[4], display[4]);
      const calculated = getDailyBalanceFromRow_(row, display, before);
      const confirmed = getDailyConfirmedBalanceFromRow_(row, display);
      let valid = [before, calculated, confirmed].every(Number.isSafeInteger) &&
        calculated === confirmed;
      for (let index = 6; index <= 18; index++) {
        if ((readModelHasValue_(row[index]) || readModelHasValue_(display[index])) &&
            !Number.isSafeInteger(numberFromCell_(row[index], display[index]))) valid = false;
      }
      if (previous && (!previous.ended || previous.balance !== before)) valid = false;
      if (!valid) {
        unavailable.add(code);
        report(code, 'INVALID_DAILY_ROW', { sheet: businessDate, row: rowNumber,
          before, calculated, confirmed, previousRow: previous ? previous.rowNumber : null });
      }
      const active = ended ? null : dailyRowToActiveCustomer_(row, display, businessDate, rowNumber);
      dailyByCode.set(code, { balance: calculated, ended, active, rowNumber });
      const movements = valid ? dailyRowToMovementTransactions_(row, display, businessDate, rowNumber) : [];
      if (valid) todayHistory.push(...movements);
      else todayHistory.push({ customerCode: code, rowNumber, ...readModelError_() });
    }
  }

  progress('sheet_today_read_done');
  progress('snapshot_build_start');
  const resources = [];
  const customerList = [];
  const activeCustomers = [];
  for (const code of [...customers.keys()].sort()) {
    const customer = customers.get(code);
    const daily = dailyByCode.get(code);
    const latest = latestLogs.get(code);
    if (!Number.isSafeInteger(customer.currentBalance) ||
        (daily && customer.currentBalance !== daily.balance)) {
      unavailable.add(code);
      report(code, 'BALANCE_VERIFICATION_FAILED', {
        masterBalance: customer.currentBalance,
        dailyBalance: daily ? daily.balance : null,
        dailyRow: daily ? daily.rowNumber : null,
        latestLogBalance: latest ? latest.balance : null,
        latestLogRow: latest ? latest.rowNumber : null,
        latestLogValid: latest ? latest.valid : null,
      });
    }
    if (daily) {
      customer.lastVisit = businessDate.replaceAll('-', '/');
      customer.activeToday = !daily.ended;
    }
    const failed = unavailable.has(code);
    // Keep the identity in list resources, but never expose an unverified balance.
    const listCustomer = failed ? {
      customerCode: code, customerName: customer.customerName,
      customerReading: customer.customerReading, ...readModelError_(),
    } : customer;
    customerList.push(listCustomer);
    resources.push({ key: 'customer:' + code, payload: failed ? readModelError_() : customer });

    const history = histories.get(code) || [];
    history.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) ||
      b.sourceRow - a.sourceRow);
    for (let index = 0; index < history.length; index++) {
      const current = history[index];
      const previous = history[index + 1];
      if (current.balanceBefore + current.chipChange !== current.balanceAfter ||
           (previous && previous.balanceAfter !== current.balanceBefore)) {
        report(code, 'HISTORY_CHAIN_MISMATCH', { sheet: WEBAPP_CHANGE_LOG_SHEET_NAME,
          row: current.sourceRow, before: current.balanceBefore,
          change: current.chipChange, after: current.balanceAfter,
          previousRow: previous ? previous.sourceRow : null,
          previousAfter: previous ? previous.balanceAfter : null,
          date: current.timestamp,
          previousDate: previous ? previous.timestamp : null });
      }
    }
    if (history.length && history[0].balanceAfter !== customer.currentBalance) {
      report(code, 'HISTORY_END_MISMATCH', { sheet: WEBAPP_CHANGE_LOG_SHEET_NAME,
        row: history[0].sourceRow, historyBalance: history[0].balanceAfter,
        masterBalance: customer.currentBalance, lastVisit: customer.lastVisit,
        historyDate: history[0].timestamp });
    }
    const warnings = historyWarnings.get(code) || [];
    // Never join valid observations across missing, invalid, or disconnected records.
    const invalidRows = warnings.filter(item => item.reason.startsWith('INVALID_LOG_'));
    for (let index = 0; index < history.length - 1; index++) {
      const current = history[index];
      const previous = history[index + 1];
      current.breakBefore = current.balanceBefore !== previous.balanceAfter ||
        invalidRows.some(item => item.row > Math.min(previous.sourceRow, current.sourceRow) &&
          item.row < Math.max(previous.sourceRow, current.sourceRow));
    }
    resources.push({
      key: 'history:' + code,
      payload: failed ? readModelError_() : warnings.length
        ? { transactions: history, warnings } : history,
    });
    if (daily && !daily.ended) {
      activeCustomers.push(failed || !daily.active ? {
        customerCode: code, customerName: customer.customerName,
        date: businessDate, rowNumber: daily.rowNumber, ...readModelError_(),
      } : daily.active);
    }
  }
  const safeTodayHistory = todayHistory.reverse().map(transaction =>
    unavailable.has(transaction.customerCode) ? {
      customerCode: transaction.customerCode,
      ...(transaction.transactionId ? { transactionId: transaction.transactionId } : {}),
      ...(transaction.rowNumber ? { rowNumber: transaction.rowNumber } : {}),
      ...readModelError_(),
    } : transaction);
  activeCustomers.sort((a, b) => a.rowNumber - b.rowNumber);
  resources.unshift(
    { key: 'customers', payload: customerList },
    { key: 'todayHistory', payload: safeTodayHistory },
    { key: 'activeCustomers', payload: activeCustomers },
  );
  // Reject a run spanning Tokyo midnight rather than publishing the wrong day.
  if (getTodaySheetName_() !== businessDate) throw verificationError_();
  progress('snapshot_build_done', { resourceCount: resources.length });
  return { schemaVersion: 1, sourceUpdatedAt: diagnose ? new Date().toISOString() : nextReadModelTimestamp_(), businessDate, resources, completedWrites };
}

function readModelSyncConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty('WEBAPP_READ_MODEL_SYNC_URL') || '').trim();
  const secret = properties.getProperty('WEBAPP_READ_MODEL_SYNC_SECRET');
  if (!/^https:\/\/[^/?#@\s]+\/internal\/read-model\/sync$/.test(url) ||
      !secret || !secret.trim()) {
    throw new Error('Configure the HTTPS read-model sync URL and sync secret in Script Properties.');
  }
  return { url, secret };
}

function postReadModel_(config, endpoint, payload) {
  // Do not echo response bodies, URLs or transport errors: they may contain credentials.
  let response;
  try {
    response = UrlFetchApp.fetch(config.url.replace(/\/sync$/, '/' + endpoint), {
      method: 'post', contentType: 'application/json',
      headers: { 'x-otomo-sync-secret': config.secret },
      payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: false,
    });
  } catch (error) {
    throw new Error('Read-model ' + endpoint + ' transport failed.');
  }
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    let reason = '';
    try {
      const body = JSON.parse(response.getContentText());
      const known = ['INVALID_SNAPSHOT_METADATA', 'INVALID_RESOURCE', 'SNAPSHOT_TOO_LARGE',
        'INCOMPLETE_SNAPSHOT', 'STATE_MISSING', 'SNAPSHOT_CONFLICT', 'BUCKET_TOO_LARGE',
        'SYNC_INTERNAL_ERROR'];
      if (body && known.includes(body.reason)) reason = body.reason;
    } catch (_) { /* Never include an untrusted response body in logs. */ }
    const error = new Error('Read-model ' + endpoint + ' failed (HTTP ' + status +
      (reason ? '; ' + reason : '') + ').');
    error.syncReason = reason;
    error.httpStatus = status;
    throw error;
  }
  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('Read-model ' + endpoint + ' returned an invalid acknowledgement.');
  }
  if (!result || result.success !== true) {
    throw new Error('Read-model ' + endpoint + ' was not acknowledged.');
  }
  return result.data;
}

// Manual editor entry point and five-minute reconciliation for script/API writes.
function runReadModelSync() {
  const startedAt = Date.now();
  let stage = 'starting';
  const progress = (nextStage, details = {}) => {
    stage = nextStage;
    console.log(JSON.stringify({ stage, elapsedMs: Date.now() - startedAt, ...details }));
  };
  progress('starting');
  try {
    const config = readModelSyncConfig_();
    progress('cloudflare_invalidate_start');
    const acknowledgement = postReadModel_(config, 'invalidate', {});
    let invalidationEpoch = acknowledgement && acknowledgement.invalidationEpoch;
    if (!Number.isSafeInteger(invalidationEpoch) || invalidationEpoch < 0) {
      throw new Error('Read-model invalidation epoch is missing or invalid.');
    }
    progress('cloudflare_invalidate_done');
    let snapshot;
    let published;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        // Read the latest generation without invalidating other in-progress syncs.
        const current = postReadModel_(config, 'epoch', {});
        invalidationEpoch = current && current.invalidationEpoch;
        if (!Number.isSafeInteger(invalidationEpoch) || invalidationEpoch < 0) {
          throw new Error('Read-model invalidation epoch is missing or invalid.');
        }
      }
      const lock = LockService.getScriptLock();
      progress('sheet_lock_wait');
      lock.waitLock(20000);
      try {
        progress('sheet_lock_acquired');
        snapshot = buildReadModelSnapshot_(false, progress);
      } finally {
        lock.releaseLock();
      }
      // Never attach a newer epoch to an old snapshot or replay a chip mutation.
      // Network waits must not hold the lock used by chip mutations.
      progress('cloudflare_publish_start', { resourceCount: snapshot.resources.length, attempt });
      try {
        published = postReadModel_(config, 'sync', { ...snapshot, invalidationEpoch });
        break;
      } catch (error) {
        if (error.syncReason !== 'SNAPSHOT_CONFLICT' || attempt === 3) throw error;
        progress('cloudflare_publish_conflict', { attempt });
      }
    }
    progress('cloudflare_publish_done');
    const report = { sourceUpdatedAt: snapshot.sourceUpdatedAt, resourceCount: snapshot.resources.length,
      durationMs: Date.now() - startedAt,
      unverifiedCustomers: published.unverifiedCustomers || [],
      unverifiedHistories: published.unverifiedHistories || [],
      historyWarnings: published.historyWarnings || [] };
    console.log(JSON.stringify(report));
    return report;
  } catch (error) {
    console.error(JSON.stringify({ stage, elapsedMs: Date.now() - startedAt, status: 'failed' }));
    throw error;
  }
}

// Installable handlers deliberately do not use or replace the existing onEdit.
function readModelOnEdit(e) {
  if (e && e.source && e.source.getId() !== WEBAPP_SPREADSHEET_ID) return;
  return runReadModelSync();
}

function readModelOnChange(e) {
  if (e && e.source && e.source.getId() !== WEBAPP_SPREADSHEET_ID) return;
  // Cell edits are already handled by the companion onEdit trigger.
  if (e && e.changeType === 'EDIT') return;
  return runReadModelSync();
}

// Opt-in only. Existing triggers, including unrelated onEdit handlers, are untouched.
function setupReadModelSync() {
  readModelSyncConfig_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const handlers = new Set(ScriptApp.getProjectTriggers().map(trigger => trigger.getHandlerFunction()));
    if (!handlers.has('runReadModelSync')) {
      ScriptApp.newTrigger('runReadModelSync').timeBased().everyMinutes(5).create();
    }
    if (!handlers.has('readModelOnEdit')) {
      ScriptApp.newTrigger('readModelOnEdit').forSpreadsheet(WEBAPP_SPREADSHEET_ID).onEdit().create();
    }
    if (!handlers.has('readModelOnChange')) {
      ScriptApp.newTrigger('readModelOnChange').forSpreadsheet(WEBAPP_SPREADSHEET_ID).onChange().create();
    }
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(WEBAPP_SPREADSHEET_ID);
}

function getCustomerSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(
    WEBAPP_CUSTOMER_SHEET_NAME,
  );

  if (!sheet) {
    throw new Error(
      `Sheet not found: ${WEBAPP_CUSTOMER_SHEET_NAME}`,
    );
  }

  return sheet;
}

function getChangeLogSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(
    WEBAPP_CHANGE_LOG_SHEET_NAME,
  );

  if (!sheet) {
    throw new Error(
      `Sheet not found: ${WEBAPP_CHANGE_LOG_SHEET_NAME}`,
    );
  }

  return sheet;
}

// 👥 おともだち一覧（今日の入力があれば今日の残高を優先）
function getAllCustomers_() {
  const customers = readCustomers_();
  const todayMap = getDailyBalanceMap_(getTodaySheetName_());

  for (const customer of customers) {
    const today = todayMap.get(
      stripLeadingZeroes_(customer.customerCode),
    );

    if (!today) {
      continue;
    }

    customer.currentBalance = today.balanceAfter;
    customer.lastVisit = today.date;
    customer.activeToday = today.activeToday;
  }

  customers.sort((a, b) =>
    String(a.customerCode).localeCompare(
      String(b.customerCode),
      'ja-JP',
      { numeric: true },
    ),
  );

  return customers;
}

function getCustomer_(customerCode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertNoPendingChipWrite_(customerCode);
    return readVerifiedCustomer_(customerCode);
  } finally {
    lock.releaseLock();
  }
}

function readVerifiedCustomer_(customerCode) {
  const normalizedCode = normalizeCode_(customerCode);
  const customer = readCustomers_().find((item) =>
    codesMatch_(item.customerCode, normalizedCode),
  );

  if (!customer) {
    throw new Error(
      `おともだちが見つかりません: ${normalizedCode}`,
    );
  }

  if (!Number.isSafeInteger(customer.currentBalance)) throw verificationError_();

  const todayMap = getDailyBalanceMap_(getTodaySheetName_());
  const today = todayMap.get(
    stripLeadingZeroes_(customer.customerCode),
  );

  if (today) {
    if (Number(customer.currentBalance) !== today.balanceAfter) {
      throw verificationError_();
    }
    customer.currentBalance = today.balanceAfter;
    customer.lastVisit = today.date;
  }

  customer.activeToday = Boolean(today && today.activeToday);

  return customer;
}

function getHistory_(customerCode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const normalizedCode = normalizeCode_(customerCode);
    assertNoPendingChipWrite_(normalizedCode);
    // Use the same durable records before and after midnight. Row order is
    // authoritative within a day; the sheet does not store event times.
    const transactions = readChangeLogRows_(normalizedCode);
    transactions.sort((a, b) =>
      String(b.timestamp).localeCompare(String(a.timestamp)) ||
      b.sourceRow - a.sourceRow,
    );
    for (let index = 0; index < transactions.length; index++) {
      const current = transactions[index];
      const previous = transactions[index + 1];
      if (current.balanceBefore + current.chipChange !== current.balanceAfter ||
          (previous && previous.balanceAfter !== current.balanceBefore)) {
        throw verificationError_();
      }
    }
    const customer = readVerifiedCustomer_(normalizedCode);
    if (transactions.length && transactions[0].balanceAfter !== Number(customer.currentBalance)) {
      throw verificationError_();
    }
    return transactions;
  } finally {
    lock.releaseLock();
  }
}

function verificationError_() {
  const error = new Error('記録の整合性を確認できません。操作を繰り返さず、日付シート・変動ログ・おともだちリストを確認してください。');
  error.code = 'RECORD_VERIFICATION_REQUIRED';
  return error;
}

// 変動ログから、指定したおともだちの履歴だけ読む
function readChangeLogRows_(
  customerCode,
  excludedRecordDate,
) {
  const sheet = getChangeLogSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_CHANGE_LOG_START_ROW) {
    return [];
  }

  const range = sheet.getRange(
    WEBAPP_CHANGE_LOG_START_ROW,
    1,
    lastRow - WEBAPP_CHANGE_LOG_START_ROW + 1,
    WEBAPP_CHANGE_LOG_COLUMNS.chipChange,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const transactions = [];

  for (let index = 0; index < values.length; index++) {
    const transaction = changeLogRowToTransaction_(
      values[index],
      displayValues[index],
      WEBAPP_CHANGE_LOG_START_ROW + index,
      customerCode,
    );

    if (transaction) {
      if (
        excludedRecordDate &&
        String(transaction.timestamp).startsWith(
          `${excludedRecordDate} `,
        )
      ) {
        continue;
      }

      transactions.push(transaction);
    }
  }

  return transactions;
}

function changeLogRowToTransaction_(
  row,
  displayRow,
  rowNumber,
  targetCustomerCode,
) {
  const customerCode = normalizeCode_(
    displayRow[WEBAPP_CHANGE_LOG_COLUMNS.code - 1] ||
      row[WEBAPP_CHANGE_LOG_COLUMNS.code - 1],
  );

  if (
    !customerCode ||
    !codesMatch_(customerCode, targetCustomerCode)
  ) {
    return null;
  }

  const recordDate = formatSheetDate_(
    row[WEBAPP_CHANGE_LOG_COLUMNS.recordDate - 1],
    displayRow[WEBAPP_CHANGE_LOG_COLUMNS.recordDate - 1],
  );
  const balanceAfter = numberFromCell_(
    row[WEBAPP_CHANGE_LOG_COLUMNS.balanceAfter - 1],
    displayRow[WEBAPP_CHANGE_LOG_COLUMNS.balanceAfter - 1],
  );
  const rawBalanceBefore = numberFromCell_(
    row[WEBAPP_CHANGE_LOG_COLUMNS.balanceBefore - 1],
    displayRow[WEBAPP_CHANGE_LOG_COLUMNS.balanceBefore - 1],
  );
  let chipChange = numberFromCell_(
    row[WEBAPP_CHANGE_LOG_COLUMNS.chipChange - 1],
    displayRow[WEBAPP_CHANGE_LOG_COLUMNS.chipChange - 1],
  );
  let balanceBefore = rawBalanceBefore;

  if (
    !Number.isFinite(chipChange) &&
    Number.isFinite(balanceBefore) &&
    Number.isFinite(balanceAfter)
  ) {
    chipChange = balanceAfter - balanceBefore;
  }

  if (
    !Number.isFinite(balanceBefore) &&
    Number.isFinite(balanceAfter) &&
    Number.isFinite(chipChange)
  ) {
    balanceBefore = balanceAfter - chipChange;
  }

  if (
    !recordDate ||
    !Number.isFinite(balanceBefore) ||
    !Number.isFinite(balanceAfter) ||
    !Number.isFinite(chipChange)
  ) {
    throw verificationError_();
  }

  if (balanceBefore + chipChange !== balanceAfter) throw verificationError_();
  if (chipChange === 0) return null;

  return {
    transactionId: `${recordDate}-${rowNumber}-${customerCode}`,
    sourceRow: rowNumber,
    customerCode,
    customerName: String(
      displayRow[WEBAPP_CHANGE_LOG_COLUMNS.name - 1] ||
        row[WEBAPP_CHANGE_LOG_COLUMNS.name - 1] ||
        '',
    ).trim(),
    timestamp: `${recordDate} 00:00:00`,
    chipChange,
    balanceBefore,
    balanceAfter,
  };
}

function getTodayHistory_() {
  const sheet = getOrCreateTodaySheet_();
  const dateText = getTodaySheetName_();

  return readDailyMovementRows_(sheet, dateText);
}

function getTodayActiveCustomers_() {
  const sheet = getOrCreateTodaySheet_();
  const dateText = getTodaySheetName_();

  return readDailyActiveCustomerRows_(sheet, dateText);
}

// 💰 うにょの増減を今日のシートに記入
function addTransaction_(customerCode, chipChange, requestId, expectedBalance) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const code = normalizeCode_(customerCode);
    const change = Number(chipChange || 0);

    if (!code) {
      throw new Error('おともだちNo.が空です');
    }

    if (!Number.isSafeInteger(change) || change === 0) {
      throw new Error('うにょ数が正しくありません');
    }

    const receipt = getCheckoutReceipt_(requestId, code, change, 'add');
    if (receipt && receipt.result) return { ...receipt.result, replayed: true };
    assertNoPendingChipWrite_(code);

    const masterRecord = getCustomerMasterRecord_(code);
    const customer = masterRecord.customer;
    const sheet = getOrCreateTodaySheet_();
    refreshDailyColumns_(sheet);

    const dailyRowLookup = findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
    const isNewDailyRow = !dailyRowLookup.existingRow;
    const rowNumber = getOrCreateDailyCustomerRow_(
      sheet,
      customer,
      dailyRowLookup,
    );

    const rowRange = sheet.getRange(
      rowNumber,
      1,
      1,
      getDailyReadWidth_(),
    );
    const values = rowRange.getValues()[0];
    const displayValues = rowRange.getDisplayValues()[0];

    const balanceBefore = numberFromCell_(
      values[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
      displayValues[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    );
    const dailyBalance = getDailyBalanceFromRow_(
      values,
      displayValues,
      balanceBefore,
    );
    const dailyConfirmedBalance = getDailyConfirmedBalanceFromRow_(
      values,
      displayValues,
    );
    const masterBalance = numberFromCell_(
      customer.currentBalance,
      customer.currentBalance,
    );
    const currentBalance = Number.isFinite(dailyConfirmedBalance)
      ? dailyConfirmedBalance
      : Number.isFinite(masterBalance)
        ? masterBalance
        : dailyBalance;
    const nextBalance = currentBalance + change;
    assertExpectedBalance_(currentBalance, expectedBalance);
    if (masterBalance !== currentBalance || dailyBalance !== currentBalance ||
        !Number.isSafeInteger(nextBalance)) throw verificationError_();

    if (nextBalance < 0) {
      throw new Error(
        '現在のうにょを超えて引き出すことはできません',
      );
    }

    claimChipReceipt_(receipt, requestId, code, change);

    writeDailyMovement_(
      sheet,
      rowNumber,
      change,
      values,
      displayValues,
    );

    const confirmedBalance = nextBalance;

    writeDailyConfirmedBalance_(
      sheet,
      rowNumber,
      confirmedBalance,
    );

    const todayDate = getTodaySheetName_();
    const previousLastVisit = customer.lastVisit;
    const shouldIncrementVisitCount =
      extractDateText_(previousLastVisit) !== todayDate;

    appendChangeLog_(
      customer,
      previousLastVisit,
      todayDate,
      currentBalance,
      confirmedBalance,
    );

    const updatedVisitCount = syncCustomerMasterAfterTransaction_(
      customer.customerCode,
      masterRecord.rowNumber,
      todayDate,
      shouldIncrementVisitCount,
      customer.visitCount,
      confirmedBalance,
    );

    verifyDailyChipWrite_(sheet, rowNumber, customer.customerCode, confirmedBalance);
    const result = {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      chipChange: change,
      newBalance: confirmedBalance,
      visitCount: updatedVisitCount,
      activeToday: true,
      verified: true,
      timestamp: `${getTodaySheetName_()} ${formatTime_(new Date())}`,
    };
    completeChipReceipt_(receipt, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 🚪 入店：本日の行だけ作成し、うにょ増減は記録しない
function enterCustomer_(customerCode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const code = normalizeCode_(customerCode);

    if (!code) {
      throw new Error('おともだちNo.が空です');
    }
    assertNoPendingChipWrite_(code);

    const masterRecord = getCustomerMasterRecord_(code);
    const customer = masterRecord.customer;
    const sheet = getOrCreateTodaySheet_();
    refreshDailyColumns_(sheet);

    const dailyRowLookup = findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
    const isNewDailyRow = !dailyRowLookup.existingRow;
    const rowNumber = getOrCreateDailyCustomerRow_(
      sheet,
      customer,
      dailyRowLookup,
    );
    const currentBalance = numberFromCell_(
      customer.currentBalance,
      customer.currentBalance,
    );
    const confirmedBalance = Number.isFinite(currentBalance)
      ? currentBalance
      : 0;

    if (isNewDailyRow) {
      writeDailyInitialWithdrawal_(sheet, rowNumber, 0);
    }

    writeDailyConfirmedBalance_(
      sheet,
      rowNumber,
      confirmedBalance,
    );

    const todayDate = getTodaySheetName_();
    const previousLastVisit = customer.lastVisit;
    const shouldIncrementVisitCount =
      extractDateText_(previousLastVisit) !== todayDate;
    const updatedVisitCount = syncCustomerMasterAfterTransaction_(
      customer.customerCode,
      masterRecord.rowNumber,
      todayDate,
      shouldIncrementVisitCount,
      customer.visitCount,
      confirmedBalance,
    );

    return {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      chipChange: 0,
      newBalance: confirmedBalance,
      visitCount: updatedVisitCount,
      activeToday: true,
      timestamp: `${todayDate} ${formatTime_(new Date())}`,
    };
  } finally {
    lock.releaseLock();
  }
}

// 🚪 退店時の手元うにょをR列へ記入
function checkoutCustomer_(customerCode, endingAmount, requestId, expectedBalance) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const code = normalizeCode_(customerCode);
    const amount = Number(endingAmount || 0);

    if (!code) {
      throw new Error('おともだちNo.が空です');
    }

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      !Number.isInteger(amount)
    ) {
      throw new Error('退店時のうにょ数が正しくありません');
    }

    const receipt = getCheckoutReceipt_(requestId, code, amount);
    if (receipt && receipt.result) {
      return { ...receipt.result, replayed: true };
    }
    assertNoPendingChipWrite_(code);

    const masterRecord = getCustomerMasterRecord_(code);
    const customer = masterRecord.customer;
    const sheet = getSpreadsheet_().getSheetByName(getTodaySheetName_());
    if (!sheet) {
      throw checkoutNotActiveError_();
    }
    refreshDailyColumns_(sheet);

    const dailyRowLookup = findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
    const rowNumber = dailyRowLookup.existingRow;
    if (!rowNumber) {
      throw checkoutNotActiveError_();
    }

    const rowRange = sheet.getRange(
      rowNumber,
      1,
      1,
      getDailyReadWidth_(),
    );
    const values = rowRange.getValues()[0];
    const displayValues = rowRange.getDisplayValues()[0];
    const balanceBefore = numberFromCell_(
      values[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
      displayValues[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    );
    const dailyBalance = getDailyBalanceFromRow_(
      values,
      displayValues,
      balanceBefore,
    );
    const dailyConfirmedBalance = getDailyConfirmedBalanceFromRow_(
      values,
      displayValues,
    );
    const masterBalance = numberFromCell_(
      customer.currentBalance,
      customer.currentBalance,
    );
    const currentBalance = Number.isFinite(dailyConfirmedBalance)
      ? dailyConfirmedBalance
      : Number.isFinite(masterBalance)
        ? masterBalance
        : dailyBalance;
    const previousEndingAmount = getDailyEndingAmountFromRow_(
      values,
      displayValues,
    );
    const confirmedBalance =
      currentBalance - previousEndingAmount + amount;
    assertExpectedBalance_(currentBalance, expectedBalance);

    if (masterBalance !== currentBalance || dailyBalance !== currentBalance ||
        !Number.isSafeInteger(confirmedBalance)) {
      throw new Error('退店後のうにょ計算に失敗しました');
    }

    // Claim before changing balances. An interrupted request must not run again.
    claimChipReceipt_(receipt, requestId, code, amount);

    sheet
      .getRange(
        rowNumber,
        WEBAPP_DAILY_COLUMNS.endingRemaining,
      )
      .setValue(amount)
      .setFontColor('#000000');

    writeDailyConfirmedBalance_(
      sheet,
      rowNumber,
      confirmedBalance,
    );

    const todayDate = getTodaySheetName_();
    const previousLastVisit = customer.lastVisit;
    const shouldIncrementVisitCount =
      extractDateText_(previousLastVisit) !== todayDate;

    appendChangeLog_(
      customer,
      previousLastVisit,
      todayDate,
      currentBalance,
      confirmedBalance,
    );

    const updatedVisitCount = syncCustomerMasterAfterTransaction_(
      customer.customerCode,
      masterRecord.rowNumber,
      todayDate,
      shouldIncrementVisitCount,
      customer.visitCount,
      confirmedBalance,
    );

    verifyDailyChipWrite_(sheet, rowNumber, customer.customerCode, confirmedBalance, amount);
    const result = {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      chipChange: confirmedBalance - currentBalance,
      newBalance: confirmedBalance,
      visitCount: updatedVisitCount,
      activeToday: false,
      verified: true,
      timestamp: `${todayDate} ${formatTime_(new Date())}`,
    };
    completeChipReceipt_(receipt, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Called under the checkout lock. Keep receipts across visits and dates.
function checkoutNotActiveError_() {
  const error = new Error('入店中の記録がありません。退店済みの場合は履歴をご確認ください。');
  error.code = 'CHECKOUT_NOT_ACTIVE';
  return error;
}

function getCheckoutReceipt_(requestId, code, amount, action = 'checkout') {
  if (!requestId) {
    const error = new Error('ページを再読み込みしてから操作してください。受付番号がありません。');
    error.code = 'CLIENT_UPDATE_REQUIRED';
    throw error;
  }
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(requestId))) {
    throw new Error('退店の受付番号が正しくありません');
  }
  const spreadsheet = getSpreadsheet_();
  const name = action === 'checkout' ? '_WebappCheckoutReceipts' : '_WebappTransactionReceipts';
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'request_id', 'customer_code', 'ending_amount', 'status', 'result', 'created_at',
    ]]);
  }
  const lastRow = sheet.getLastRow();
  const match = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(requestId))
      .matchEntireCell(true).matchCase(true).useRegularExpression(false).findNext()
    : null;
  if (!match) return { sheet, row: lastRow + 1 };

  const row = match.getRow();
  const saved = sheet.getRange(row, 1, 1, 6).getValues()[0];
  if (!codesMatch_(saved[1], code) || Number(saved[2]) !== amount) {
    throw new Error('同じ受付番号で退店内容を変更することはできません。履歴をご確認ください。');
  }
  if (saved[3] !== 'complete' || !saved[4]) {
    throw new Error('前回の退店処理の確認が必要です。再実行せず、日付シートと残高を確認してください。');
  }
  return { sheet, row, result: JSON.parse(saved[4]) };
}

function assertNoPendingChipWrite_(code) {
  for (const name of ['_WebappCheckoutReceipts', '_WebappTransactionReceipts']) {
    const sheet = getSpreadsheet_().getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) continue;
    const rows = sheet.getRange(2, 2, sheet.getLastRow() - 1, 3).getValues();
    if (rows.some((row) => codesMatch_(row[0], code) && row[2] !== 'complete')) {
      throw verificationError_();
    }
  }
}

function assertExpectedBalance_(currentBalance, expectedBalance) {
  if (expectedBalance !== undefined && Number(expectedBalance) !== currentBalance) {
    const error = new Error('表示後に残高が変更されました。保存はしていません。ページを再読み込みして残高を確認してください。');
    error.code = 'BALANCE_CHANGED';
    throw error;
  }
}

function claimChipReceipt_(receipt, requestId, code, amount) {
  if (!receipt) return;
  receipt.sheet.getRange(receipt.row, 1, 1, 6).setValues([[
    String(requestId), code, amount, 'pending', '', new Date(),
  ]]);
  SpreadsheetApp.flush();
  const saved = receipt.sheet.getRange(receipt.row, 1, 1, 4).getValues()[0];
  if (saved[0] !== String(requestId) || !codesMatch_(saved[1], code) ||
      saved[2] !== amount || saved[3] !== 'pending') throw verificationError_();
}

function completeChipReceipt_(receipt, result) {
  if (!receipt) return;
  const encoded = JSON.stringify(result);
  receipt.sheet.getRange(receipt.row, 4, 1, 2).setValues([['complete', encoded]]);
  SpreadsheetApp.flush();
  const saved = receipt.sheet.getRange(receipt.row, 4, 1, 2).getValues()[0];
  if (saved[0] !== 'complete' || saved[1] !== encoded) throw verificationError_();
}

function verifyDailyChipWrite_(sheet, rowNumber, code, balance, endingAmount) {
  SpreadsheetApp.flush();
  const row = sheet.getRange(rowNumber, 1, 1, getDailyReadWidth_()).getValues()[0];
  const calculated = getDailyBalanceFromRow_(row, row, Number(row[WEBAPP_DAILY_COLUMNS.balanceBefore - 1]));
  if (!codesMatch_(row[WEBAPP_DAILY_COLUMNS.code - 1], code) ||
      calculated !== balance ||
      row[WEBAPP_DAILY_COLUMNS.withdrawable - 1] !== balance ||
      row[WEBAPP_DAILY_COLUMNS.balanceAfter - 1] !== balance ||
      (endingAmount !== undefined && row[WEBAPP_DAILY_COLUMNS.endingRemaining - 1] !== endingAmount)) {
    throw verificationError_();
  }
}

function createCustomer_(customerName, initialBalance) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const name = String(customerName || '').trim();

    if (!name) {
      throw new Error('お名前を入力してください');
    }

    const balance = Math.max(
      0,
      Number(initialBalance || 0),
    );
    const sheet = getCustomerSheet_();
    const lastRow = Math.max(
      sheet.getLastRow(),
      WEBAPP_CUSTOMER_START_ROW - 1,
    );
    const customers = readCustomers_();
    const nextNumber =
      customers.reduce((max, customer) => {
        const number = Number(
          stripLeadingZeroes_(customer.customerCode),
        );
        return Number.isFinite(number)
          ? Math.max(max, number)
          : max;
      }, 0) + 1;

    const customerCode = String(nextNumber).padStart(4, '0');
    const targetRow = lastRow + 1;
    const customer = {
      customerCode,
      customerName: name,
      customerReading: name,
      currentBalance: balance,
      lastVisit: '',
      otoPoints: null,
      memo: '',
      visitCount: null,
      firstVisit: '',
      profilePublic: false,
    };

    sheet
      .getRange(targetRow, 1, 1, 9)
      .setValues([
        [
          customerCode,
          name,
          name,
          balance,
          '',
          '',
          '',
          '',
          '',
        ],
      ]);

    const todaySheet = getOrCreateTodaySheet_();
    const todayRowNumber = getOrCreateDailyCustomerRow_(
      todaySheet,
      {
        ...customer,
        currentBalance: 0,
      },
    );

    // 新規登録は店内行だけ作り、引き出し可能額は0から始める
    writeDailyConfirmedBalance_(
      todaySheet,
      todayRowNumber,
      0,
    );

    return {
      ...customer,
      currentBalance: 0,
      initialBalance: balance,
      todayRowNumber,
    };
  } finally {
    lock.releaseLock();
  }
}

function readCustomers_() {
  const sheet = getCustomerSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_CUSTOMER_START_ROW) {
    return [];
  }

  const range = sheet.getRange(
    WEBAPP_CUSTOMER_START_ROW,
    1,
    lastRow - WEBAPP_CUSTOMER_START_ROW + 1,
    WEBAPP_CUSTOMER_COLUMNS.firstVisit,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const customers = [];

  for (let index = 0; index < values.length; index++) {
    const customer = customerRowToObject_(
      values[index],
      displayValues[index],
    );

    if (customer) {
      customers.push(customer);
    }
  }

  return customers;
}

function customerRowToObject_(row, displayRow) {
  const customerCode = normalizeCode_(
    displayRow[WEBAPP_CUSTOMER_COLUMNS.code - 1] ||
      row[WEBAPP_CUSTOMER_COLUMNS.code - 1],
  );

  if (!customerCode) {
    return null;
  }

  return {
    customerCode,
    customerName: String(
      displayRow[WEBAPP_CUSTOMER_COLUMNS.name - 1] ||
        row[WEBAPP_CUSTOMER_COLUMNS.name - 1] ||
        '',
    ).trim(),
    customerReading: String(
      displayRow[WEBAPP_CUSTOMER_COLUMNS.reading - 1] ||
        row[WEBAPP_CUSTOMER_COLUMNS.reading - 1] ||
        '',
    ).trim(),
    // An unused customer bank balance is blank in the shop's master sheet.
    currentBalance: !readModelHasValue_(row[WEBAPP_CUSTOMER_COLUMNS.balance - 1]) &&
      !readModelHasValue_(displayRow[WEBAPP_CUSTOMER_COLUMNS.balance - 1])
      ? 0 : numberFromCell_(
        row[WEBAPP_CUSTOMER_COLUMNS.balance - 1],
        displayRow[WEBAPP_CUSTOMER_COLUMNS.balance - 1],
      ),
    lastVisit: String(
      displayRow[WEBAPP_CUSTOMER_COLUMNS.lastVisit - 1] || '',
    ).trim(),
    otoPoints: numberFromCell_(
      row[WEBAPP_CUSTOMER_COLUMNS.otoPoints - 1],
      displayRow[WEBAPP_CUSTOMER_COLUMNS.otoPoints - 1],
    ),
    memo: String(
      displayRow[WEBAPP_CUSTOMER_COLUMNS.memo - 1] || '',
    ),
    visitCount: numberFromCell_(
      row[WEBAPP_CUSTOMER_COLUMNS.visitCount - 1],
      displayRow[WEBAPP_CUSTOMER_COLUMNS.visitCount - 1],
    ),
    firstVisit: String(
      displayRow[WEBAPP_CUSTOMER_COLUMNS.firstVisit - 1] || '',
    ).trim(),
    profilePublic: false,
  };
}

function getCustomerFromMaster_(customerCode) {
  const customer = readCustomers_().find((item) =>
    codesMatch_(item.customerCode, customerCode),
  );

  if (!customer) {
    throw new Error(
      `おともだちが見つかりません: ${customerCode}`,
    );
  }

  return customer;
}

function getCustomerMasterRecord_(customerCode) {
  const sheet = getCustomerSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_CUSTOMER_START_ROW) {
    throw new Error(
      `おともだちが見つかりません: ${customerCode}`,
    );
  }

  const codeValues = sheet
    .getRange(
      WEBAPP_CUSTOMER_START_ROW,
      WEBAPP_CUSTOMER_COLUMNS.code,
      lastRow - WEBAPP_CUSTOMER_START_ROW + 1,
      1,
    )
    .getDisplayValues();
  let rowNumber = null;

  for (let index = 0; index < codeValues.length; index++) {
    if (codesMatch_(codeValues[index][0], customerCode)) {
      rowNumber = WEBAPP_CUSTOMER_START_ROW + index;
      break;
    }
  }

  if (!rowNumber) {
    throw new Error(
      `おともだちが見つかりません: ${customerCode}`,
    );
  }

  const range = sheet.getRange(
    rowNumber,
    1,
    1,
    WEBAPP_CUSTOMER_COLUMNS.firstVisit,
  );
  const customer = customerRowToObject_(
    range.getValues()[0],
    range.getDisplayValues()[0],
  );

  if (!customer) {
    throw new Error(
      `おともだちが見つかりません: ${customerCode}`,
    );
  }

  return {
    customer,
    rowNumber,
  };
}

function findCustomerMasterRow_(customerCode) {
  const sheet = getCustomerSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_CUSTOMER_START_ROW) {
    return null;
  }

  const values = sheet
    .getRange(
      WEBAPP_CUSTOMER_START_ROW,
      WEBAPP_CUSTOMER_COLUMNS.code,
      lastRow - WEBAPP_CUSTOMER_START_ROW + 1,
      1,
    )
    .getDisplayValues();

  for (let index = 0; index < values.length; index++) {
    if (codesMatch_(values[index][0], customerCode)) {
      return WEBAPP_CUSTOMER_START_ROW + index;
    }
  }

  return null;
}

function findCustomerMasterRows_(customerCode) {
  const sheet = getCustomerSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_CUSTOMER_START_ROW) {
    return [];
  }

  const values = sheet
    .getRange(
      WEBAPP_CUSTOMER_START_ROW,
      WEBAPP_CUSTOMER_COLUMNS.code,
      lastRow - WEBAPP_CUSTOMER_START_ROW + 1,
      1,
    )
    .getDisplayValues();
  const rowNumbers = [];

  for (let index = 0; index < values.length; index++) {
    if (codesMatch_(values[index][0], customerCode)) {
      rowNumbers.push(WEBAPP_CUSTOMER_START_ROW + index);
    }
  }

  return rowNumbers;
}

function syncCustomerMasterAfterTransaction_(
  customerCode,
  rowNumber,
  todayDate,
  shouldIncrementVisitCount,
  knownVisitCount,
  confirmedBalance,
) {
  const rowNumbers = findCustomerMasterRows_(customerCode);

  if (
    rowNumber &&
    rowNumbers.indexOf(rowNumber) === -1
  ) {
    rowNumbers.unshift(rowNumber);
  }

  if (rowNumbers.length === 0) {
    throw verificationError_();
  }

  const sheet = getCustomerSheet_();
  const formattedToday = todayDate.replaceAll('-', '/');
  const primaryRowNumber = rowNumbers[0];

  let currentVisitCount = Number(knownVisitCount);

  if (!Number.isFinite(currentVisitCount)) {
    const visitCountCell = sheet.getRange(
      primaryRowNumber,
      WEBAPP_CUSTOMER_COLUMNS.visitCount,
    );

    currentVisitCount = numberFromCell_(
      visitCountCell.getValue(),
      visitCountCell.getDisplayValue(),
    );
  }

  const nextVisitCount =
    (Number.isFinite(currentVisitCount)
      ? currentVisitCount
      : 0) + (shouldIncrementVisitCount ? 1 : 0);

  for (const targetRowNumber of rowNumbers) {
    const rowRange = sheet.getRange(
      targetRowNumber,
      WEBAPP_CUSTOMER_COLUMNS.balance,
      1,
      WEBAPP_CUSTOMER_COLUMNS.visitCount -
        WEBAPP_CUSTOMER_COLUMNS.balance +
        1,
    );
    const rowValues = rowRange.getValues()[0];

    // D/E/Hを一度に更新して、残高だけ取りこぼす事故を防ぐ
    if (Number.isFinite(confirmedBalance)) {
      rowValues[0] = confirmedBalance;
    }

    rowValues[
      WEBAPP_CUSTOMER_COLUMNS.lastVisit -
        WEBAPP_CUSTOMER_COLUMNS.balance
    ] = formattedToday;
    rowValues[
      WEBAPP_CUSTOMER_COLUMNS.visitCount -
        WEBAPP_CUSTOMER_COLUMNS.balance
    ] = nextVisitCount;

    rowRange.setValues([rowValues]);
  }

  SpreadsheetApp.flush();

  if (Number.isFinite(confirmedBalance)) {
    const savedRows = getCustomerMasterSyncRows_(
      customerCode,
    );
    const failedRows = savedRows.filter(
      (row) => row.balance !== confirmedBalance,
    );

    if (savedRows.length === 0 || failedRows.length > 0) {
      throw new Error(
        `Master balance did not update. expected=${confirmedBalance}, rows=${JSON.stringify(failedRows)}`,
      );
    }
  }

  return nextVisitCount;
}

function getCustomerMasterSyncRows_(customerCode) {
  const sheet = getCustomerSheet_();
  const rowNumbers = findCustomerMasterRows_(customerCode);

  return rowNumbers.map((rowNumber) => {
    const range = sheet.getRange(
      rowNumber,
      WEBAPP_CUSTOMER_COLUMNS.code,
      1,
      WEBAPP_CUSTOMER_COLUMNS.visitCount,
    );
    const values = range.getValues()[0];
    const displayValues = range.getDisplayValues()[0];

    return {
      rowNumber,
      code: String(
        displayValues[WEBAPP_CUSTOMER_COLUMNS.code - 1] ||
          values[WEBAPP_CUSTOMER_COLUMNS.code - 1] ||
          '',
      ).trim(),
      name: String(
        displayValues[WEBAPP_CUSTOMER_COLUMNS.name - 1] ||
          values[WEBAPP_CUSTOMER_COLUMNS.name - 1] ||
          '',
      ).trim(),
      balance: numberFromCell_(
        values[WEBAPP_CUSTOMER_COLUMNS.balance - 1],
        displayValues[WEBAPP_CUSTOMER_COLUMNS.balance - 1],
      ),
      lastVisit: String(
        displayValues[WEBAPP_CUSTOMER_COLUMNS.lastVisit - 1] ||
          '',
      ).trim(),
      visitCount: numberFromCell_(
        values[WEBAPP_CUSTOMER_COLUMNS.visitCount - 1],
        displayValues[WEBAPP_CUSTOMER_COLUMNS.visitCount - 1],
      ),
    };
  });
}

function updateCustomerVisitInfo_(
  customerCode,
  todayDate,
  shouldIncrementVisitCount,
  knownRowNumber,
  knownVisitCount,
  confirmedBalance,
) {
  const rowNumber =
    knownRowNumber || findCustomerMasterRow_(customerCode);

  return syncCustomerMasterAfterTransaction_(
    customerCode,
    rowNumber,
    todayDate,
    shouldIncrementVisitCount,
    knownVisitCount,
    confirmedBalance,
  );
}

function appendChangeLog_(
  customer,
  previousLastVisit,
  todayDate,
  balanceBefore,
  balanceAfter,
) {
  const chipChange = balanceAfter - balanceBefore;

  if (!Number.isFinite(chipChange) || chipChange === 0) {
    return;
  }

  const sheet = getChangeLogSheet_();
  const row = [
    todayDate.replaceAll('-', '/'),
    Number(stripLeadingZeroes_(customer.customerCode)),
    customer.customerName,
    previousLastVisit || '-',
    todayDate.replaceAll('-', '/'),
    balanceBefore,
    balanceAfter,
    chipChange,
  ];

  const range = sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      1,
      WEBAPP_CHANGE_LOG_COLUMNS.chipChange,
    );
  range.setValues([row]);
  SpreadsheetApp.flush();
  const saved = range.getValues()[0];
  if (!codesMatch_(saved[1], customer.customerCode) || saved[5] !== balanceBefore ||
      saved[6] !== balanceAfter || saved[7] !== chipChange) throw verificationError_();
}

// 📄 今日のシートを作成（既存なら表示状態にする）
function getOrCreateTodaySheet_() {
  const spreadsheet = getSpreadsheet_();
  const todayName = getTodaySheetName_();
  const existing = spreadsheet.getSheetByName(todayName);

  if (existing) {
    if (existing.isSheetHidden && existing.isSheetHidden()) {
      existing.showSheet();
    }
    refreshDailyColumns_(existing);
    console.log('今日のシートは既に存在:', todayName);
    return existing;
  }

  const template = getLatestDailySheet_();

  if (!template) {
    throw new Error(
      'コピー元の日付シートが見つかりません',
    );
  }

  const sheet = template.copyTo(spreadsheet);
  sheet.setName(todayName);
  sheet.showSheet();
  console.log('作成シート名:', todayName);
  spreadsheet.setActiveSheet(sheet);
  spreadsheet.moveActiveSheet(spreadsheet.getNumSheets());

  sheet.getRange('A1').setValue(`日付: ${todayName}`);
  refreshDailyColumns_(sheet);
  clearDailySheetInputs_(sheet);
  clearLegacyRightSideColumns_(sheet);
  SpreadsheetApp.flush();

  return sheet;
}

function refreshDailySheetDate_(sheet, todayName) {
  const dateCell = sheet.getRange('A1');
  const currentDate = extractDateText_(
    dateCell.getDisplayValue(),
  );

  if (currentDate !== todayName) {
    dateCell.setValue(`日付: ${todayName}`);
  }
}

function clearDailySheetInputs_(sheet) {
  refreshDailyColumns_(sheet);

  const lastRow = Math.max(sheet.getLastRow(), WEBAPP_DAILY_START_ROW);
  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;

  clearColumns_(
    sheet,
    [
      WEBAPP_DAILY_COLUMNS.no,
      WEBAPP_DAILY_COLUMNS.code,
      WEBAPP_DAILY_COLUMNS.lastVisit,
      WEBAPP_DAILY_COLUMNS.name,
      WEBAPP_DAILY_COLUMNS.balanceBefore,
      WEBAPP_DAILY_COLUMNS.withdrawable,
    ],
    height,
  );

  sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.initialWithdrawal,
      height,
      WEBAPP_DAILY_COLUMNS.movementEnd -
        WEBAPP_DAILY_COLUMNS.initialWithdrawal +
        1,
    )
    .clearContent()
    .setFontColor('#000000');

  // 終了時・台帳欄はコピー元の古い値だけ消す
  clearPlainValues_(
    sheet.getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.endingRemaining,
      height,
      WEBAPP_DAILY_COLUMNS.balanceAfter -
        WEBAPP_DAILY_COLUMNS.endingRemaining +
        1,
    ),
  );

  clearColumns_(
    sheet,
    [
      WEBAPP_DAILY_COLUMNS.nameMirror,
      WEBAPP_DAILY_COLUMNS.codeMirror,
      WEBAPP_DAILY_COLUMNS.noMirror,
    ],
    height,
  );

  clearLegacyRightSideColumns_(sheet);
}

function clearColumns_(sheet, columns, height) {
  for (const column of columns) {
    sheet
      .getRange(WEBAPP_DAILY_START_ROW, column, height, 1)
      .clearContent();
  }
}

function clearPlainValues_(range) {
  const formulas = range.getFormulas();

  for (let row = 0; row < formulas.length; row++) {
    for (let column = 0; column < formulas[row].length; column++) {
      if (!formulas[row][column]) {
        range.getCell(row + 1, column + 1).clearContent();
      }
    }
  }
}

// 以前の誤ったV/W/X書き込み跡を消す（正しい控え欄はT/U/V）
function clearLegacyRightSideColumns_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), WEBAPP_DAILY_START_ROW);
  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;

  sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.noMirror + 1,
      height,
      2,
    )
    .clearContent();
}

function getLatestDailySheet_() {
  const dailySheets = getSpreadsheet_()
    .getSheets()
    .map((sheet) => ({
      sheet,
      dateText: getDateTextFromSheet_(sheet),
    }))
    .filter((item) => item.dateText)
    .sort((a, b) =>
      String(b.dateText).localeCompare(String(a.dateText)),
    );

  return dailySheets.length ? dailySheets[0].sheet : null;
}

function getOrCreateDailyCustomerRow_(
  sheet,
  customer,
  dailyRowLookup,
) {
  refreshDailyColumns_(sheet);

  const lookup =
    dailyRowLookup ||
    findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
  const existingRow = lookup.existingRow;

  if (existingRow) {
    return existingRow;
  }

  const rowNumber = lookup.emptyRow || findFirstEmptyDailyRow_(sheet);
  const rowIndex = rowNumber - WEBAPP_DAILY_START_ROW + 1;

  sheet
    .getRange(
      rowNumber,
      WEBAPP_DAILY_COLUMNS.no,
      1,
      WEBAPP_DAILY_COLUMNS.withdrawable -
        WEBAPP_DAILY_COLUMNS.no +
        1,
    )
    .setValues([[
      rowIndex,
      customer.customerCode,
      customer.lastVisit,
      customer.customerName,
      customer.currentBalance,
      customer.currentBalance,
    ]]);

  sheet
    .getRange(
      rowNumber,
      WEBAPP_DAILY_COLUMNS.nameMirror,
      1,
      WEBAPP_DAILY_COLUMNS.noMirror -
        WEBAPP_DAILY_COLUMNS.nameMirror +
        1,
    )
    .setValues([[
      customer.customerName,
      customer.customerCode,
      rowIndex,
    ]]);

  return rowNumber;
}

// G列は入店だけの場合でも0を明示しておく
function writeDailyInitialWithdrawal_(sheet, rowNumber, amount) {
  sheet
    .getRange(rowNumber, WEBAPP_DAILY_COLUMNS.initialWithdrawal)
    .setValue(amount)
    .setFontColor('#d00000');
}

// F列とS列はWebアプリで確定した残高に合わせる
function writeDailyConfirmedBalance_(sheet, rowNumber, balance) {
  sheet
    .getRange(rowNumber, WEBAPP_DAILY_COLUMNS.withdrawable)
    .setValue(balance)
    .setFontColor('#000000');

  sheet
    .getRange(rowNumber, WEBAPP_DAILY_COLUMNS.balanceAfter)
    .setValue(balance)
    .setFontColor('#d00000');
}

function findDailyCustomerRow_(sheet, customerCode) {
  refreshDailyColumns_(sheet);

  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_DAILY_START_ROW) {
    return null;
  }

  const values = sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.code,
      lastRow - WEBAPP_DAILY_START_ROW + 1,
      1,
    )
    .getDisplayValues();

  for (let index = 0; index < values.length; index++) {
    if (codesMatch_(values[index][0], customerCode)) {
      return WEBAPP_DAILY_START_ROW + index;
    }
  }

  return null;
}

function findDailyCustomerRowOrFirstEmpty_(sheet, customerCode) {
  refreshDailyColumns_(sheet);

  const lastRow = Math.max(sheet.getLastRow(), WEBAPP_DAILY_START_ROW);
  const width =
    WEBAPP_DAILY_COLUMNS.endingRemaining -
    WEBAPP_DAILY_COLUMNS.code +
    1;
  const displayValues = sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.code,
      lastRow - WEBAPP_DAILY_START_ROW + 1,
      width,
    )
    .getDisplayValues();
  let emptyRow = null;

  for (let index = 0; index < displayValues.length; index++) {
    const rowNumber = WEBAPP_DAILY_START_ROW + index;
    const row = displayValues[index];
    const code = row[0];
    const endingText = String(
      row[
        WEBAPP_DAILY_COLUMNS.endingRemaining -
          WEBAPP_DAILY_COLUMNS.code
      ] || '',
    ).trim();

    // R列が入っている行は退店済み。再来店時は新しい行を使う
    if (
      codesMatch_(code, customerCode) &&
      !endingText
    ) {
      return {
        existingRow: rowNumber,
        emptyRow,
      };
    }

    if (!emptyRow && !String(code || '').trim()) {
      emptyRow = rowNumber;
    }
  }

  return {
    existingRow: null,
    emptyRow: emptyRow || lastRow + 1,
  };
}

function findFirstEmptyDailyRow_(sheet) {
  refreshDailyColumns_(sheet);

  const lastRow = Math.max(sheet.getLastRow(), WEBAPP_DAILY_START_ROW);
  const values = sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.code,
      lastRow - WEBAPP_DAILY_START_ROW + 1,
      1,
    )
    .getDisplayValues();

  for (let index = 0; index < values.length; index++) {
    if (!String(values[index][0] || '').trim()) {
      return WEBAPP_DAILY_START_ROW + index;
    }
  }

  return lastRow + 1;
}

// 入出金をシートに書く。最初の引き出しだけG列、それ以降は横へ
function writeDailyMovement_(
  sheet,
  rowNumber,
  change,
  rowValues,
  rowDisplayValues,
) {
  refreshDailyColumns_(sheet);

  const isWithdrawal = change < 0;
  const amount = Math.abs(change);
  const movementCell = getDailyMovementCell_(
    rowValues,
    rowDisplayValues,
    change,
  );

  if (movementCell) {
    const targetCell = sheet.getRange(
      rowNumber,
      movementCell.column,
    );

    targetCell
      .setValue(movementCell.value)
      .setFontColor(movementCell.fontColor);
    return;
  }

  if (isWithdrawal) {
    const initialCell = sheet.getRange(
      rowNumber,
      WEBAPP_DAILY_COLUMNS.initialWithdrawal,
    );

    if (!String(initialCell.getDisplayValue()).trim()) {
      initialCell.setValue(amount);
      initialCell.setFontColor('#d00000');
      return;
    }
  }

  const targetCell = findFirstEmptyMovementCell_(
    sheet,
    rowNumber,
  );

  if (isWithdrawal) {
    targetCell.setValue(`▲${formatNumber_(amount)}`);
    targetCell.setFontColor('#d00000');
    return;
  }

  targetCell.setValue(amount);
  targetCell.setFontColor('#000000');
}

function getDailyMovementCell_(
  row,
  displayRow,
  change,
) {
  if (!row || !displayRow) {
    return null;
  }

  const isWithdrawal = change < 0;
  const amount = Math.abs(change);

  if (isWithdrawal) {
    const initialText = String(
      displayRow[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1] ||
        row[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1] ||
        '',
    ).trim();

    if (!initialText) {
      return {
        column: WEBAPP_DAILY_COLUMNS.initialWithdrawal,
        value: amount,
        fontColor: '#d00000',
      };
    }
  }

  for (
    let column = WEBAPP_DAILY_COLUMNS.movementStart;
    column <= WEBAPP_DAILY_COLUMNS.movementEnd;
    column++
  ) {
    const text = String(
      displayRow[column - 1] ||
        row[column - 1] ||
        '',
    ).trim();

    if (!text) {
      return {
        column,
        value: isWithdrawal
          ? `\u25b2${formatNumber_(amount)}`
          : amount,
        fontColor: isWithdrawal ? '#d00000' : '#000000',
      };
    }
  }

  throw new Error(
    'No empty movement cell is available today',
  );
}

function findFirstEmptyMovementCell_(sheet, rowNumber) {
  refreshDailyColumns_(sheet);

  const width =
    WEBAPP_DAILY_COLUMNS.movementEnd -
    WEBAPP_DAILY_COLUMNS.movementStart +
    1;
  const range = sheet.getRange(
    rowNumber,
    WEBAPP_DAILY_COLUMNS.movementStart,
    1,
    width,
  );
  const values = range.getDisplayValues()[0];

  for (let index = 0; index < values.length; index++) {
    if (!String(values[index] || '').trim()) {
      return sheet.getRange(
        rowNumber,
        WEBAPP_DAILY_COLUMNS.movementStart + index,
      );
    }
  }

  throw new Error(
    '本日の記入欄がいっぱいです',
  );
}

function getDailyBalanceMap_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const map = new Map();

  if (!sheet) {
    return map;
  }

  refreshDailyColumns_(sheet);

  const dateText =
    getDateTextFromSheet_(sheet) || sheetName;
  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_DAILY_START_ROW) {
    return map;
  }

  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;
  const width = getDailyReadWidth_();
  const range = sheet.getRange(
    WEBAPP_DAILY_START_ROW,
    1,
    height,
    width,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();

  for (let index = 0; index < values.length; index++) {
    const row = values[index];
    const displayRow = displayValues[index];
    const customerCode = normalizeCode_(
      displayRow[WEBAPP_DAILY_COLUMNS.code - 1] ||
        row[WEBAPP_DAILY_COLUMNS.code - 1],
    );

    if (!customerCode) {
      continue;
    }

    const balanceBefore = numberFromCell_(
      row[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
      displayRow[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    );

    if (!Number.isFinite(balanceBefore)) {
      continue;
    }

    const inputBalance = getDailyInputBalanceFromRow_(
      row,
      displayRow,
      balanceBefore,
    );
    const confirmedBalance = getDailyConfirmedBalanceFromRow_(
      row,
      displayRow,
    );
    const endingText = String(
      displayRow[WEBAPP_DAILY_COLUMNS.endingRemaining - 1] ||
        row[WEBAPP_DAILY_COLUMNS.endingRemaining - 1] ||
        '',
    ).trim();
    let balanceAfter = balanceBefore;

    if (inputBalance.hasMovement) {
      balanceAfter = inputBalance.balance;
    } else if (Number.isFinite(confirmedBalance)) {
      balanceAfter = confirmedBalance;
    }

    map.set(stripLeadingZeroes_(customerCode), {
      balanceAfter,
      date: dateText.replaceAll('-', '/'),
      activeToday: !endingText,
    });
  }

  return map;
}

function readDailyRows_(sheet, dateText) {
  refreshDailyColumns_(sheet);

  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_DAILY_START_ROW) {
    return [];
  }

  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;
  const width = getDailyReadWidth_();
  const range = sheet.getRange(
    WEBAPP_DAILY_START_ROW,
    1,
    height,
    width,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const rows = [];

  for (let index = 0; index < values.length; index++) {
    const row = dailyRowToTransaction_(
      values[index],
      displayValues[index],
      dateText,
      WEBAPP_DAILY_START_ROW + index,
    );

    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

// 今日履歴用：G:Qの各入力を1件ずつ返す
function readDailyMovementRows_(sheet, dateText) {
  refreshDailyColumns_(sheet);

  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_DAILY_START_ROW) {
    return [];
  }

  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;
  const width = getDailyReadWidth_();
  const range = sheet.getRange(
    WEBAPP_DAILY_START_ROW,
    1,
    height,
    width,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const transactions = [];

  for (let index = 0; index < values.length; index++) {
    const rowNumber = WEBAPP_DAILY_START_ROW + index;
    const rowTransactions = dailyRowToMovementTransactions_(
      values[index],
      displayValues[index],
      dateText,
      rowNumber,
    );

    transactions.push(...rowTransactions);
  }

  return transactions.reverse();
}

// 店内一覧用：本日うにょ入力があり、まだ退店していない行だけ返す
function readDailyActiveCustomerRows_(sheet, dateText) {
  refreshDailyColumns_(sheet);

  const lastRow = sheet.getLastRow();

  if (lastRow < WEBAPP_DAILY_START_ROW) {
    return [];
  }

  const height = lastRow - WEBAPP_DAILY_START_ROW + 1;
  const width = getDailyReadWidth_();
  const range = sheet.getRange(
    WEBAPP_DAILY_START_ROW,
    1,
    height,
    width,
  );
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const customers = [];

  for (let index = 0; index < values.length; index++) {
    const customer = dailyRowToActiveCustomer_(
      values[index],
      displayValues[index],
      dateText,
      WEBAPP_DAILY_START_ROW + index,
    );

    if (customer) {
      customers.push(customer);
    }
  }

  return customers;
}

function dailyRowToActiveCustomer_(
  row,
  displayRow,
  dateText,
  rowNumber,
) {
  const customerCode = normalizeCode_(
    displayRow[WEBAPP_DAILY_COLUMNS.code - 1] ||
      row[WEBAPP_DAILY_COLUMNS.code - 1],
  );

  if (!customerCode) {
    return null;
  }

  const endingText = String(
    displayRow[WEBAPP_DAILY_COLUMNS.endingRemaining - 1] ||
      row[WEBAPP_DAILY_COLUMNS.endingRemaining - 1] ||
      '',
  ).trim();

  if (endingText) {
    return null;
  }

  const balanceBefore = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
  );

  if (!Number.isFinite(balanceBefore)) {
    return null;
  }

  let currentBalance = balanceBefore;
  let movementCount = 0;
  let lastMovementAmount = 0;

  const addMovement = (amount) => {
    if (!Number.isFinite(amount) || amount === 0) {
      return;
    }

    movementCount++;
    lastMovementAmount = amount;
    currentBalance += amount;
  };

  const initialWithdrawal = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
  );

  if (
    Number.isFinite(initialWithdrawal) &&
    initialWithdrawal !== 0
  ) {
    addMovement(-Math.abs(initialWithdrawal));
  }

  for (
    let column = WEBAPP_DAILY_COLUMNS.movementStart;
    column <= WEBAPP_DAILY_COLUMNS.movementEnd;
    column++
  ) {
    const movement = numberFromCell_(
      row[column - 1],
      displayRow[column - 1],
    );

    addMovement(movement);
  }

  if (movementCount === 0) {
    const balanceAfterText = String(
      displayRow[WEBAPP_DAILY_COLUMNS.balanceAfter - 1] ||
        row[WEBAPP_DAILY_COLUMNS.balanceAfter - 1] ||
        '',
    ).trim();

    if (!balanceAfterText) {
      return null;
    }

    const confirmedBalance = numberFromCell_(
      row[WEBAPP_DAILY_COLUMNS.balanceAfter - 1],
      displayRow[WEBAPP_DAILY_COLUMNS.balanceAfter - 1],
    );

    if (!Number.isFinite(confirmedBalance)) {
      return null;
    }

    currentBalance = confirmedBalance;
  }

  return {
    customerCode,
    customerName: String(
      displayRow[WEBAPP_DAILY_COLUMNS.name - 1] ||
        row[WEBAPP_DAILY_COLUMNS.name - 1] ||
        '',
    ).trim(),
    date: dateText,
    rowNumber,
    balanceBefore,
    currentBalance,
    chipChange: currentBalance - balanceBefore,
    movementCount,
    lastMovementAmount,
  };
}

function dailyRowToMovementTransactions_(
  row,
  displayRow,
  dateText,
  rowNumber,
) {
  const customerCode = normalizeCode_(
    displayRow[WEBAPP_DAILY_COLUMNS.code - 1] ||
      row[WEBAPP_DAILY_COLUMNS.code - 1],
  );

  if (!customerCode) {
    return [];
  }

  const customerName = String(
    displayRow[WEBAPP_DAILY_COLUMNS.name - 1] ||
      row[WEBAPP_DAILY_COLUMNS.name - 1] ||
      '',
  ).trim();
  const balanceBefore = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
  );

  if (!Number.isFinite(balanceBefore)) {
    return [];
  }

  const transactions = [];
  let runningBalance = balanceBefore;
  let movementIndex = 0;

  const addMovement = (column, chipChange) => {
    if (!Number.isFinite(chipChange) || chipChange === 0) {
      return;
    }

    movementIndex++;
    const before = runningBalance;
    runningBalance += chipChange;

    transactions.push({
      transactionId: `${dateText}-${rowNumber}-${customerCode}-${column}`,
      customerCode,
      customerName,
      timestamp: `${dateText} 00:00:${String(movementIndex).padStart(2, '0')}`,
      chipChange,
      balanceBefore: before,
      balanceAfter: runningBalance,
    });
  };

  const initialWithdrawal = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
  );

  if (
    Number.isFinite(initialWithdrawal) &&
    initialWithdrawal !== 0
  ) {
    addMovement(
      WEBAPP_DAILY_COLUMNS.initialWithdrawal,
      -Math.abs(initialWithdrawal),
    );
  }

  for (
    let column = WEBAPP_DAILY_COLUMNS.movementStart;
    column <= WEBAPP_DAILY_COLUMNS.movementEnd;
    column++
  ) {
    const movement = numberFromCell_(
      row[column - 1],
      displayRow[column - 1],
    );

    addMovement(column, movement);
  }

  const endingAmount = getDailyEndingAmountFromRow_(
    row,
    displayRow,
  );

  if (endingAmount !== 0) {
    addMovement(
      WEBAPP_DAILY_COLUMNS.endingRemaining,
      endingAmount,
    );
  }

  return transactions;
}

function dailyRowToTransaction_(
  row,
  displayRow,
  dateText,
  rowNumber,
) {
  const customerCode = normalizeCode_(
    displayRow[WEBAPP_DAILY_COLUMNS.code - 1] ||
      row[WEBAPP_DAILY_COLUMNS.code - 1],
  );

  if (!customerCode) {
    return null;
  }

  const balanceBefore = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.balanceBefore - 1],
  );
  const balanceAfter = getDailyBalanceFromRow_(
    row,
    displayRow,
    balanceBefore,
  );

  if (
    !Number.isFinite(balanceBefore) ||
    !Number.isFinite(balanceAfter)
  ) {
    return null;
  }

  const chipChange = balanceAfter - balanceBefore;

  if (chipChange === 0) {
    return null;
  }

  return {
    transactionId: `${dateText}-${rowNumber}-${customerCode}`,
    customerCode,
    customerName: String(
      displayRow[WEBAPP_DAILY_COLUMNS.name - 1] ||
        row[WEBAPP_DAILY_COLUMNS.name - 1] ||
        '',
    ).trim(),
    timestamp: `${dateText} 00:00:00`,
    chipChange,
    balanceBefore,
    balanceAfter,
  };
}

function getDailyConfirmedBalanceFromRow_(row, displayRow) {
  const balanceAfter = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.balanceAfter - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.balanceAfter - 1],
  );

  if (Number.isFinite(balanceAfter)) {
    return balanceAfter;
  }

  const withdrawable = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.withdrawable - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.withdrawable - 1],
  );

  return Number.isFinite(withdrawable)
    ? withdrawable
    : NaN;
}

function getDailyBalanceFromRow_(
  row,
  displayRow,
  balanceBefore,
) {
  if (!Number.isFinite(balanceBefore)) {
    return NaN;
  }

  const inputBalance = getDailyInputBalanceFromRow_(
    row,
    displayRow,
    balanceBefore,
  );

  if (!inputBalance.hasMovement) {
    return balanceBefore;
  }

  // G:Qの記入内容から毎回計算する。S列は古い値のことがあるため信用しない
  return inputBalance.balance;
}

function getDailyInputBalanceFromRow_(
  row,
  displayRow,
  balanceBefore,
) {
  let balance = balanceBefore;
  let hasMovement = false;

  const initialWithdrawal = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.initialWithdrawal - 1],
  );

  if (
    Number.isFinite(initialWithdrawal) &&
    initialWithdrawal !== 0
  ) {
    hasMovement = true;
    balance -= Math.abs(initialWithdrawal);
  }

  for (
    let column = WEBAPP_DAILY_COLUMNS.movementStart;
    column <= WEBAPP_DAILY_COLUMNS.movementEnd;
    column++
  ) {
    const movement = numberFromCell_(
      row[column - 1],
      displayRow[column - 1],
    );

    if (
      Number.isFinite(movement) &&
      movement !== 0
    ) {
      hasMovement = true;
      balance += movement;
    }
  }

  const endingAmount = getDailyEndingAmountFromRow_(
    row,
    displayRow,
  );

  if (
    Number.isFinite(endingAmount) &&
    endingAmount !== 0
  ) {
    hasMovement = true;
    balance += endingAmount;
  }

  return {
    balance,
    hasMovement,
  };
}

function getDailyEndingAmountFromRow_(row, displayRow) {
  const endingAmount = numberFromCell_(
    row[WEBAPP_DAILY_COLUMNS.endingRemaining - 1],
    displayRow[WEBAPP_DAILY_COLUMNS.endingRemaining - 1],
  );

  return Number.isFinite(endingAmount)
    ? endingAmount
    : 0;
}

// 日付シートの列は固定。古い値が混ざらないよう毎回戻す
function refreshDailyColumns_(sheet) {
  Object.assign(
    WEBAPP_DAILY_COLUMNS,
    WEBAPP_DAILY_COLUMN_DEFAULTS,
  );
  return WEBAPP_DAILY_COLUMNS;
}

function getDailyReadWidth_() {
  return Math.max(...Object.values(WEBAPP_DAILY_COLUMNS));
}

function getDateTextFromSheet_(sheet) {
  if (sheet.getName() === WEBAPP_CUSTOMER_SHEET_NAME) {
    return '';
  }

  return (
    extractDateText_(sheet.getName()) ||
    extractDateText_(sheet.getRange('A1').getDisplayValue())
  );
}

function formatSheetDate_(value, displayValue) {
  if (
    Object.prototype.toString.call(value) ===
    '[object Date]'
  ) {
    return Utilities.formatDate(
      value,
      WEBAPP_TIME_ZONE,
      'yyyy-MM-dd',
    );
  }

  const text = String(displayValue || value || '').trim();

  return extractDateText_(text) || text;
}

function extractDateText_(value) {
  const text = String(value || '');
  const match = text.match(
    /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/,
  );

  if (!match) {
    return '';
  }

  return [
    match[1],
    String(Number(match[2])).padStart(2, '0'),
    String(Number(match[3])).padStart(2, '0'),
  ].join('-');
}

function getTodaySheetName_() {
  return Utilities.formatDate(
    new Date(),
    WEBAPP_TIME_ZONE,
    'yyyy-MM-dd',
  );
}

function formatTime_(date) {
  return Utilities.formatDate(date, WEBAPP_TIME_ZONE, 'HH:mm:ss');
}

function normalizeCode_(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  const digits = text.replace(/[^0-9]/g, '');

  if (digits) {
    return digits.padStart(4, '0');
  }

  return text;
}

function stripLeadingZeroes_(value) {
  const stripped = normalizeCode_(value).replace(/^0+/, '');
  return stripped || '0';
}

function codesMatch_(left, right) {
  const leftText = normalizeCode_(left);
  const rightText = normalizeCode_(right);

  return (
    leftText === rightText ||
    stripLeadingZeroes_(leftText) ===
      stripLeadingZeroes_(rightText)
  );
}

function numberFromCell_(value, displayValue) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(displayValue || value || '').trim();

  if (!text) {
    return NaN;
  }

  const isNegative =
    text.includes('\u25b2') ||
    text.includes('\u25b3') ||
    text.includes('▲') ||
    text.includes('△') ||
    text.startsWith('-');
  const numberText = text.replace(/[^0-9.]/g, '');

  if (!numberText) {
    return NaN;
  }

  const number = Number(numberText);

  if (!Number.isFinite(number)) {
    return NaN;
  }

  return isNegative ? -number : number;
}

function formatNumber_(value) {
  return Number(value || 0).toLocaleString('ja-JP');
}
