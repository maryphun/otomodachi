const WEBAPP_SPREADSHEET_ID =
  '1GtZKTWABc1nt9SKuQsmN5AC5DxG0QJnU6wOZqpfUmVg';

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

// 動作確認用
function testWebappGetAllCustomers() {
  const customers = getAllCustomers_();
  console.log('おともだち取得件数:', customers.length);
  console.log('先頭3件:', customers.slice(0, 3));
}

function dispatch_(action, parameters) {
  switch (action) {
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
      );

    case 'checkoutCustomer':
      return checkoutCustomer_(
        parameters.customerCode,
        parameters.endingAmount,
      );

    case 'createCustomer':
      return createCustomer_(
        parameters.customerName,
        parameters.initialBalance,
      );

    case 'updateCustomerProfilePublic':
      return {
        customerCode: normalizeCode_(parameters.customerCode),
        profilePublic:
          String(parameters.profilePublic) === 'true',
      };

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
  const normalizedCode = normalizeCode_(customerCode);
  const customer = readCustomers_().find((item) =>
    codesMatch_(item.customerCode, normalizedCode),
  );

  if (!customer) {
    throw new Error(
      `おともだちが見つかりません: ${normalizedCode}`,
    );
  }

  const todayMap = getDailyBalanceMap_(getTodaySheetName_());
  const today = todayMap.get(
    stripLeadingZeroes_(customer.customerCode),
  );

  if (today) {
    customer.currentBalance = today.balanceAfter;
    customer.lastVisit = today.date;
  }

  return customer;
}

function getHistory_(customerCode) {
  const normalizedCode = normalizeCode_(customerCode);
  const todayDate = getTodaySheetName_();
  const transactions = readChangeLogRows_(
    normalizedCode,
    todayDate,
  );
  const todaySheet = getSpreadsheet_().getSheetByName(todayDate);

  if (todaySheet) {
    const todayTransactions = readDailyMovementRows_(
      todaySheet,
      todayDate,
    ).filter((transaction) =>
      codesMatch_(
        transaction.customerCode,
        normalizedCode,
      ),
    );

    transactions.push(...todayTransactions);
  }

  transactions.sort((a, b) =>
    String(b.timestamp).localeCompare(String(a.timestamp)) ||
    String(b.transactionId).localeCompare(
      String(a.transactionId),
    ),
  );

  return transactions;
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
    !Number.isFinite(chipChange) ||
    chipChange === 0
  ) {
    return null;
  }

  return {
    transactionId: `${recordDate}-${rowNumber}-${customerCode}`,
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
function addTransaction_(customerCode, chipChange) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const code = normalizeCode_(customerCode);
    const change = Number(chipChange || 0);

    if (!code) {
      throw new Error('おともだちNo.が空です');
    }

    if (!Number.isFinite(change) || change === 0) {
      throw new Error('うにょ数が正しくありません');
    }

    const masterRecord = getCustomerMasterRecord_(code);
    const customer = masterRecord.customer;
    const sheet = getOrCreateTodaySheet_();
    refreshDailyColumns_(sheet);

    const dailyRowLookup = findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
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
    const currentBalance = getDailyBalanceFromRow_(
      values,
      displayValues,
      balanceBefore,
    );
    const nextBalance = currentBalance + change;

    if (nextBalance < 0) {
      throw new Error(
        '現在のうにょを超えて引き出すことはできません',
      );
    }

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
    const updatedVisitCount = updateCustomerVisitInfo_(
      customer.customerCode,
      todayDate,
      extractDateText_(previousLastVisit) !== todayDate,
      masterRecord.rowNumber,
      customer.visitCount,
    );

    appendChangeLog_(
      customer,
      previousLastVisit,
      todayDate,
      currentBalance,
      confirmedBalance,
    );

    return {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      chipChange: change,
      newBalance: confirmedBalance,
      visitCount: updatedVisitCount,
      timestamp: `${getTodaySheetName_()} ${formatTime_(new Date())}`,
    };
  } finally {
    lock.releaseLock();
  }
}

// 🚪 退店時の手元うにょをR列へ記入
function checkoutCustomer_(customerCode, endingAmount) {
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

    const masterRecord = getCustomerMasterRecord_(code);
    const customer = masterRecord.customer;
    const sheet = getOrCreateTodaySheet_();
    refreshDailyColumns_(sheet);

    const dailyRowLookup = findDailyCustomerRowOrFirstEmpty_(
      sheet,
      customer.customerCode,
    );
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
    const currentBalance = getDailyBalanceFromRow_(
      values,
      displayValues,
      balanceBefore,
    );
    const previousEndingAmount = getDailyEndingAmountFromRow_(
      values,
      displayValues,
    );
    const confirmedBalance =
      currentBalance - previousEndingAmount + amount;

    if (!Number.isFinite(confirmedBalance)) {
      throw new Error('退店後のうにょ計算に失敗しました');
    }

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
    const updatedVisitCount = updateCustomerVisitInfo_(
      customer.customerCode,
      todayDate,
      extractDateText_(previousLastVisit) !== todayDate,
      masterRecord.rowNumber,
      customer.visitCount,
    );

    appendChangeLog_(
      customer,
      previousLastVisit,
      todayDate,
      currentBalance,
      confirmedBalance,
    );

    return {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      chipChange: confirmedBalance - currentBalance,
      newBalance: confirmedBalance,
      visitCount: updatedVisitCount,
      timestamp: `${todayDate} ${formatTime_(new Date())}`,
    };
  } finally {
    lock.releaseLock();
  }
}

function createCustomer_(customerName, initialBalance) {
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

  return {
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
    currentBalance: numberFromCell_(
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

function updateCustomerVisitInfo_(
  customerCode,
  todayDate,
  shouldIncrementVisitCount,
  knownRowNumber,
  knownVisitCount,
) {
  const sheet = getCustomerSheet_();
  const rowNumber =
    knownRowNumber || findCustomerMasterRow_(customerCode);

  if (!rowNumber) {
    return null;
  }

  let currentVisitCount = Number(knownVisitCount);

  if (!Number.isFinite(currentVisitCount)) {
    const visitCountCell = sheet.getRange(
      rowNumber,
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

  sheet
    .getRange(rowNumber, WEBAPP_CUSTOMER_COLUMNS.lastVisit)
    .setValue(todayDate.replaceAll('-', '/'));
  sheet
    .getRange(rowNumber, WEBAPP_CUSTOMER_COLUMNS.visitCount)
    .setValue(nextVisitCount);

  return nextVisitCount;
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

  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      1,
      WEBAPP_CHANGE_LOG_COLUMNS.chipChange,
    )
    .setValues([row]);
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
  const values = sheet
    .getRange(
      WEBAPP_DAILY_START_ROW,
      WEBAPP_DAILY_COLUMNS.code,
      lastRow - WEBAPP_DAILY_START_ROW + 1,
      1,
    )
    .getDisplayValues();
  let emptyRow = null;

  for (let index = 0; index < values.length; index++) {
    const rowNumber = WEBAPP_DAILY_START_ROW + index;
    const code = values[index][0];

    if (codesMatch_(code, customerCode)) {
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
  const rows = readDailyRows_(sheet, dateText);

  for (const row of rows) {
    map.set(stripLeadingZeroes_(row.customerCode), {
      balanceAfter: row.balanceAfter,
      date: dateText.replaceAll('-', '/'),
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
    return null;
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
