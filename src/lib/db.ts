import sql from "mssql";

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

// Database target type
export type DbTarget = "local" | "cloud";

// Current database target (default to cloud for Azure SQL)
let currentDbTarget: DbTarget = "cloud";

// Local Database Config
const localConfig: sql.config = {
  server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || "localhost",
  database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || "HawaiDB",
  user: process.env.LOCAL_DB_USER || process.env.DB_USER || "",
  password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || "",
  options: {
    encrypt: process.env.LOCAL_DB_ENCRYPT === "true" || false,
    trustServerCertificate: process.env.LOCAL_DB_TRUST_CERT === "true" || process.env.DB_TRUST_SERVER_CERTIFICATE === "true" || true,
    enableArithAbort: true,
    charset: "utf8",
  } as any,
  connectionTimeout: 60000,
  requestTimeout: 60000,
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 60000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 2000,
  },
};

// Cloud Database Config
const cloudConfig: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || "",
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || "1433", 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || "HawaiRestaurant",
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || "",
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || "",
  options: {
    encrypt: process.env.CLOUD_DB_ENCRYPT !== "false" && process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === "true" || process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    enableArithAbort: true,
    charset: "utf8",
  } as any,
  connectionTimeout: 60000,
  requestTimeout: 60000,
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 60000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 2000,
  },
};

// Separate pools for local and cloud
let localPoolPromise: Promise<sql.ConnectionPool> | null = null;
let localPool: sql.ConnectionPool | null = null;
let cloudPoolPromise: Promise<sql.ConnectionPool> | null = null;
let cloudPool: sql.ConnectionPool | null = null;

// Legacy single pool (for backward compatibility, points to current target)
let poolPromise: Promise<sql.ConnectionPool> | null = null;
let pool: sql.ConnectionPool | null = null;

async function connectWithRetry(
  config: sql.config,
  target: DbTarget,
  attempt = 1
): Promise<sql.ConnectionPool> {
  try {
    console.log(`[db:${target}] Connection attempt ${attempt}/${RETRY_MAX_ATTEMPTS}...`);
    const newPool = await new sql.ConnectionPool(config).connect();
    console.log(`[db:${target}] Connected to SQL Server successfully`);
    return newPool;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[db:${target}] Connection attempt ${attempt} failed:`, error.message);

    if (attempt < RETRY_MAX_ATTEMPTS) {
      console.log(`[db:${target}] Retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectWithRetry(config, target, attempt + 1);
    }

    throw new Error(`تعذر الاتصال بـ ${target === "local" ? "الخادم المحلي" : "السحابة"} بعد عدة محاولات`);
  }
}

// Get Local Pool
export async function getLocalPool(): Promise<sql.ConnectionPool> {
  if (localPool && localPool.connected) {
    return localPool;
  }

  if (localPoolPromise) {
    return localPoolPromise;
  }

  localPoolPromise = connectWithRetry(localConfig, "local")
    .then((newPool) => {
      localPool = newPool;
      localPool.on("error", (err) => {
        console.error("[db:local] Pool error:", err.message);
        localPool = null;
        localPoolPromise = null;
      });
      return localPool;
    })
    .catch((err) => {
      localPoolPromise = null;
      throw err;
    });

  return localPoolPromise;
}

// Get Cloud Pool
export async function getCloudPool(): Promise<sql.ConnectionPool> {
  if (cloudPool && cloudPool.connected) {
    return cloudPool;
  }

  if (cloudPoolPromise) {
    return cloudPoolPromise;
  }

  cloudPoolPromise = connectWithRetry(cloudConfig, "cloud")
    .then((newPool) => {
      cloudPool = newPool;
      cloudPool.on("error", (err) => {
        console.error("[db:cloud] Pool error:", err.message);
        cloudPool = null;
        cloudPoolPromise = null;
      });
      return cloudPool;
    })
    .catch((err) => {
      cloudPoolPromise = null;
      throw err;
    });

  return cloudPoolPromise;
}

// Get current target pool (legacy compatibility)
export async function getPool(): Promise<sql.ConnectionPool> {
  const pool = await (currentDbTarget === "local" ? getLocalPool() : getCloudPool());
  // Auto-sync pages registry on first connection (non-blocking)
  import('./pages-sync').then(m => m.syncPagesRegistry(pool)).catch(() => {});
  return pool;
}

// Get pool by specific target
export async function getPoolByTarget(target: DbTarget): Promise<sql.ConnectionPool> {
  return target === "local" ? getLocalPool() : getCloudPool();
}

// Get current database target
export function getCurrentDbTarget(): DbTarget {
  return currentDbTarget;
}

// Set database target
export async function setDbTarget(target: DbTarget): Promise<void> {
  console.log(`[db] Switching from ${currentDbTarget} to ${target}`);
  
  // Close current pool if connected
  if (target !== currentDbTarget) {
    await closePool();
  }
  
  currentDbTarget = target;
  console.log(`[db] Now using ${target} database`);
}

// Toggle between local and cloud
export async function toggleDbTarget(): Promise<DbTarget> {
  const newTarget = currentDbTarget === "local" ? "cloud" : "local";
  await setDbTarget(newTarget);
  return newTarget;
}

// Get connection info
export function getDbConnectionInfo() {
  return {
    target: currentDbTarget,
    local: {
      server: localConfig.server,
      database: localConfig.database,
    },
    cloud: {
      server: cloudConfig.server,
      database: cloudConfig.database,
    },
  };
}

export function getUserFriendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("ETIMEOUT") || message.includes("timeout")) {
    return "تعذر الاتصال بالخادم، يرجى التحقق من الإنترنت والمحاولة مرة أخرى";
  }
  if (message.includes("ECONNREFUSED") || message.includes("connect")) {
    return "تعذر الاتصال بالخادم، حاول مرة أخرى";
  }
  if (
    message.includes("Login failed") ||
    message.includes("password") ||
    message.includes("authentication")
  ) {
    return "خطأ في الاتصال بالخادم";
  }

  return "تعذر الاتصال بالخادم، حاول مرة أخرى";
}

export async function closePool(): Promise<void> {
  if (localPool) {
    await localPool.close();
    localPool = null;
    localPoolPromise = null;
  }
  if (cloudPool) {
    await cloudPool.close();
    cloudPool = null;
    cloudPoolPromise = null;
  }
  pool = null;
  poolPromise = null;
  console.log("[db] All pools closed");
}

export async function closeLocalPool(): Promise<void> {
  if (localPool) {
    await localPool.close();
    localPool = null;
    localPoolPromise = null;
    console.log("[db:local] Pool closed");
  }
}

export async function closeCloudPool(): Promise<void> {
  if (cloudPool) {
    await cloudPool.close();
    cloudPool = null;
    cloudPoolPromise = null;
    console.log("[db:cloud] Pool closed");
  }
}

const ALLOWED_INV_TABLES = ['TblCashMove', 'TblinvServHead'] as const;
type AllowedInvTable = (typeof ALLOWED_INV_TABLES)[number];

/**
 * Safely allocates the next invID for a given table and invType using SQL Server
 * application locks (sp_getapplock). Must be called inside an active transaction.
 * The application lock is released automatically on commit or rollback.
 *
 * @param transaction   Active sql.Transaction
 * @param tableName     Invoice table (TblCashMove or TblinvServHead)
 * @param invType       Invoice type (e.g. 'مصروفات', 'ايرادات', 'مبيعات')
 * @param lockTimeoutMs How long to wait for the application lock (default 5000ms)
 * @returns Next sequential invID
 * @throws Error with code 'TREASURY_BUSY' and statusCode 503 if lock cannot be acquired
 */
export async function allocateInvID(
  transaction: sql.Transaction,
  tableName: AllowedInvTable,
  invType: string,
  lockTimeoutMs: number = 5000
): Promise<number> {
  if (!ALLOWED_INV_TABLES.includes(tableName)) {
    throw new Error(`Invalid invoice table: ${tableName}`);
  }

  const lockResource = `SqlAllocator:${tableName}:invID:${invType}`;

  const lockReq = new sql.Request(transaction)
    .input('lockResource', sql.NVarChar(255), lockResource)
    .input('lockTimeout', sql.Int, lockTimeoutMs);

  const lockResult = await lockReq.query(`
    DECLARE @LockResult INT;
    EXEC @LockResult = sp_getapplock
      @Resource = @lockResource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = @lockTimeout;
    SELECT @LockResult AS lockResult;
  `);

  const result = lockResult.recordset[0].lockResult as number;
  if (result < 0) {
    const err = new Error('الخزينة مشغولة بعملية أخرى حاليًا. حاول مرة أخرى بعد لحظات.');
    (err as any).code = 'TREASURY_BUSY';
    (err as any).statusCode = 503;
    throw err;
  }

  const idReq = new sql.Request(transaction)
    .input('invType', sql.NVarChar(20), invType);
  const idResult = await idReq.query(`
    SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
    FROM [dbo].[${tableName}]
    WHERE invType = @invType;
  `);

  return idResult.recordset[0].newInvID as number;
}

export { sql };
