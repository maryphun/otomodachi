const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
const MAX_BLOB_BYTES = 1500 * 1024
const MAX_AGE_MS = 10 * 60 * 1000
const encoder = new TextEncoder()

export function readModelEnabled(env) {
  return env.READ_MODEL_ENABLED === 'true'
}

export function unavailable(message = 'データを同期中です。しばらく待ってから再読み込みしてください。') {
  const error = new Error(message)
  error.code = 'READ_MODEL_UNAVAILABLE'
  error.status = 503
  return error
}

function syncFailure(reason, message, status = 503) {
  const error = unavailable(message)
  error.syncReason = reason
  error.status = status
  return error
}

function database(env) {
  if (!env.ATTENDANCE_DB) throw unavailable('共有データベースが未設定です。')
  // No replica sessions: all reads use the D1 primary.
  return env.ATTENDANCE_DB
}

export function tokyoDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function bucketFor(key) {
  if (/^(customer|history):\d{4,}$/.test(key)) {
    return `group:${Math.floor(Number(key.split(':')[1]) / 25)}`
  }
  if (['customers', 'todayHistory', 'activeCustomers'].includes(key)) return key
  throw unavailable('Invalid read-model resource')
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

export async function currentEpoch(env) {
  const row = await database(env).prepare(
    'SELECT invalidation_epoch FROM read_model_state WHERE id = 1',
  ).first()
  if (!row) throw unavailable('共有データの初期設定が必要です。')
  return row.invalidation_epoch
}

export async function invalidateReadModel(env) {
  const row = await database(env).prepare(
    'UPDATE read_model_state SET dirty = 1, invalidation_epoch = invalidation_epoch + 1 WHERE id = 1 RETURNING invalidation_epoch',
  ).first()
  if (!row) throw unavailable('共有データの初期設定が必要です。')
  return row.invalidation_epoch
}

export async function beginReadModelWrite(env, parameters) {
  const id = parameters.requestId || crypto.randomUUID()
  if (!/^[A-Za-z0-9-]{16,80}$/.test(id)) throw unavailable('Invalid request ID')
  const db = database(env)
  const code = parameters.customerCode ? String(parameters.customerCode).trim().padStart(4, '0') : ''
  await db.prepare(
    'INSERT OR IGNORE INTO read_model_pending_writes (request_id, action, customer_code, started_at) VALUES (?, ?, ?, ?)',
  ).bind(id, parameters.action, code, new Date().toISOString()).run()
  const saved = await db.prepare('SELECT action, customer_code FROM read_model_pending_writes WHERE request_id = ?').bind(id).first()
  if (saved?.action !== parameters.action || saved?.customer_code !== code) throw unavailable('受付番号の内容が一致しません。')
  await invalidateReadModel(env)
  return id
}

export async function finishReadModelWrite(env, id) {
  await database(env).prepare('DELETE FROM read_model_pending_writes WHERE request_id = ?').bind(id).run()
}

export async function publishReadModel(env, snapshot, epoch) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.resources) ||
      !Number.isSafeInteger(epoch) || epoch < 0 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshot.sourceUpdatedAt || '') ||
      !Number.isFinite(Date.parse(snapshot.sourceUpdatedAt)) ||
      snapshot.businessDate !== tokyoDate() ||
      Date.parse(snapshot.sourceUpdatedAt) > Date.now() + 120000 ||
      Date.now() - Date.parse(snapshot.sourceUpdatedAt) > MAX_AGE_MS) {
    throw syncFailure('INVALID_SNAPSHOT_METADATA', '共有データの形式または更新日時を確認できません。')
  }

  const resources = new Map()
  let size = 0
  for (const resource of snapshot.resources) {
    if (!resource || resources.has(resource.key) || resource.payload === undefined) throw syncFailure('INVALID_RESOURCE', 'Duplicate or invalid resource')
    bucketFor(resource.key)
    resources.set(resource.key, resource.payload)
    size += encoder.encode(JSON.stringify(resource)).length
    if (size > MAX_SNAPSHOT_BYTES) throw syncFailure('SNAPSHOT_TOO_LARGE', 'Snapshot exceeds import limit')
  }
  const customers = resources.get('customers')
  if (!Array.isArray(customers) || !customers.length ||
      !Array.isArray(resources.get('todayHistory')) || !Array.isArray(resources.get('activeCustomers'))) {
    throw syncFailure('INCOMPLETE_SNAPSHOT', 'Incomplete source snapshot')
  }
  const codes = new Set()
  for (const customer of customers) {
    const code = String(customer.customerCode || '')
    if (!/^\d{4,}$/.test(code) || codes.has(code) ||
        !resources.has(`customer:${code}`) || !resources.has(`history:${code}`)) throw syncFailure('INCOMPLETE_SNAPSHOT', 'Incomplete customer snapshot')
    codes.add(code)
  }

  // Immutable, content-addressed buckets keep unchanged history out of D1 writes.
  const buckets = new Map()
  for (const [key, value] of [...resources].sort(([a], [b]) => a.localeCompare(b))) {
    const bucket = bucketFor(key)
    if (!buckets.has(bucket)) buckets.set(bucket, {})
    buckets.get(bucket)[key] = value
  }
  const db = database(env)
  const state = await db.prepare('SELECT * FROM read_model_state WHERE id = 1').first()
  if (!state) throw syncFailure('STATE_MISSING', 'Read-model state is missing')
  if (state.invalidation_epoch !== epoch || state.checked_at > snapshot.sourceUpdatedAt) {
    throw syncFailure('SNAPSHOT_CONFLICT', 'A newer synchronization is already in progress', 409)
  }
  const previous = JSON.parse(state.manifest)
  const manifest = {}
  const changed = []
  const now = new Date().toISOString()
  for (const [bucket, content] of buckets) {
    const payload = JSON.stringify(content)
    if (encoder.encode(payload).length > MAX_BLOB_BYTES) throw syncFailure('BUCKET_TOO_LARGE', 'History bucket exceeds import limit')
    const hash = await digest(payload)
    manifest[bucket] = hash
    if (previous[bucket] !== hash) changed.push([hash, payload, now])
  }
  // Multi-row INSERTs are storage writes only, never chip calculations or SQL transactions.
  for (let offset = 0; offset < changed.length; offset += 20) {
    const rows = changed.slice(offset, offset + 20)
    await db.prepare(`INSERT OR IGNORE INTO read_model_blobs (digest, payload, created_at) VALUES ${rows.map(() => '(?, ?, ?)').join(',')}`)
      .bind(...rows.flat()).run()
  }
  const manifestJson = JSON.stringify(manifest)
  const revision = await digest(`${snapshot.businessDate}:${manifestJson}`)
  // One conditional publication exposes a complete snapshot, never a partial import.
  const published = await db.prepare(`UPDATE read_model_state SET
    source_updated_at = CASE WHEN revision = ?1 THEN source_updated_at ELSE ?2 END,
    manifest = ?3, revision = ?1, checked_at = ?2, business_date = ?4,
    dirty = 0, published_at = ?5
    WHERE id = 1 AND invalidation_epoch = ?6 AND checked_at <= ?2
    AND NOT EXISTS (SELECT 1 FROM json_each(?3) AS wanted
      WHERE NOT EXISTS (SELECT 1 FROM read_model_blobs WHERE digest = wanted.value))
    RETURNING revision`).bind(revision, snapshot.sourceUpdatedAt, manifestJson, snapshot.businessDate, now, epoch).first()
  if (!published) throw syncFailure('SNAPSHOT_CONFLICT', 'Snapshot changed before publication; synchronization must be retried', 409)
  // A durable Sheets receipt can resolve a lost HTTP response without replaying a write.
  const completed = (snapshot.completedWrites || []).filter(item =>
    /^[A-Za-z0-9-]{16,80}$/.test(item.requestId || '') &&
    ['checkoutCustomer', 'addTransaction'].includes(item.action) && /^\d{4}$/.test(item.customerCode || ''))
  if (completed.length) {
    await db.prepare(`DELETE FROM read_model_pending_writes WHERE EXISTS (
      SELECT 1 FROM json_each(?1) r WHERE json_extract(r.value, '$.requestId') = request_id
      AND json_extract(r.value, '$.action') = action
      AND json_extract(r.value, '$.customerCode') = customer_code)`)
      .bind(JSON.stringify(completed)).run()
  }
  return { sourceUpdatedAt: revision === state.revision ? state.source_updated_at : snapshot.sourceUpdatedAt,
    checkedAt: snapshot.sourceUpdatedAt, businessDate: snapshot.businessDate, revision,
    unverifiedCustomers: [...resources].filter(([key, value]) => key.startsWith('customer:') && value.readModelError).map(([key]) => key.split(':')[1]),
    unverifiedHistories: [...resources].filter(([key, value]) => key.startsWith('history:') && value.readModelError).map(([key]) => key.split(':')[1]),
    historyWarnings: [...resources].filter(([key, value]) => key.startsWith('history:') && value.warnings?.length).map(([key]) => key.split(':')[1]),
  }
}

function syncFrom(row) {
  return { sourceUpdatedAt: row.source_updated_at, checkedAt: row.checked_at,
    businessDate: row.business_date, revision: row.revision }
}

function assertReadable(row) {
  if (!row || !row.revision || row.dirty || row.pending_count || row.business_date !== tokyoDate() ||
      !Number.isFinite(Date.parse(row.checked_at)) || Date.now() - Date.parse(row.checked_at) > MAX_AGE_MS) {
    throw unavailable()
  }
}

export async function readModelStatus(env) {
  const row = await database(env).prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM read_model_pending_writes) AS pending_count
    FROM read_model_state s WHERE s.id = 1`).first()
  assertReadable(row)
  return syncFrom(row)
}

export async function readResource(env, key) {
  const bucket = bucketFor(key)
  // State, pending-write guard, and data are read in the same SQL statement.
  const row = await database(env).prepare(`SELECT s.*, b.payload,
    (SELECT COUNT(*) FROM read_model_pending_writes) AS pending_count
    FROM read_model_state s LEFT JOIN read_model_blobs b
      ON b.digest = json_extract(s.manifest, ?1) WHERE s.id = 1`)
    .bind(`$."${bucket}"`).first()
  assertReadable(row)
  const payload = row.payload && JSON.parse(row.payload)[key]
  if (payload === undefined || payload === null) throw unavailable('おともだちの同期済みデータが見つかりません。')
  if (payload.readModelError) {
    const error = unavailable('なんかおかしい...メリーに確認して')
    error.code = payload.readModelError.code || error.code
    throw error
  }
  if (Array.isArray(payload) && payload.some(item => item?.readModelError)) {
    const error = unavailable('なんかおかしい...メリーに確認して')
    error.code = 'RECORD_VERIFICATION_REQUIRED'
    throw error
  }
  if (key.startsWith('history:') && !Array.isArray(payload)) {
    if (!Array.isArray(payload.transactions) || !Array.isArray(payload.warnings)) throw unavailable()
    return { success: true, data: payload.transactions, historyWarnings: payload.warnings, sync: syncFrom(row) }
  }
  return { success: true, data: payload, sync: syncFrom(row) }
}

export async function pruneReadModel(env) {
  // Publication checks every referenced blob, so GC racing an import fails closed.
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
  await database(env).prepare(`DELETE FROM read_model_blobs WHERE created_at < ?1
    AND digest NOT IN (SELECT value FROM json_each((SELECT manifest FROM read_model_state WHERE id = 1)))`)
    .bind(cutoff).run()
}
