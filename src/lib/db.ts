import sql from "mssql";

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

const config: sql.config = {
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "HawaiDB",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true,
  },
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

let poolPromise: Promise<sql.ConnectionPool> | null = null;
let pool: sql.ConnectionPool | null = null;

async function connectWithRetry(attempt = 1): Promise<sql.ConnectionPool> {
  try {
    console.log(`[db] Connection attempt ${attempt}/${RETRY_MAX_ATTEMPTS}...`);
    const newPool = await sql.connect(config);
    console.log("[db] Connected to SQL Server successfully");
    return newPool;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[db] Connection attempt ${attempt} failed:`, error.message);

    if (attempt < RETRY_MAX_ATTEMPTS) {
      console.log(`[db] Retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectWithRetry(attempt + 1);
    }

    throw new Error("تعذر الاتصال بالخادم بعد عدة محاولات، حاول مرة أخرى");
  }
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  if (poolPromise) {
    return poolPromise;
  }

  poolPromise = connectWithRetry()
    .then((newPool) => {
      pool = newPool;

      pool.on("error", (err) => {
        console.error("[db] Pool error:", err.message);
        pool = null;
        poolPromise = null;
      });

      return pool;
    })
    .catch((err) => {
      poolPromise = null;
      throw err;
    });

  return poolPromise;
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
  if (pool) {
    await pool.close();
    pool = null;
    poolPromise = null;
    console.log("[db] Pool closed");
  }
}

export { sql };
