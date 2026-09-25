import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

export interface SqliteColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

export interface SqliteTable {
  name: string;
  type: string;
  sql: string;
}

export interface SqliteResult {
  columns: string[];
  values: unknown[][];
}

export interface SqliteDatabase {
  /** 第二个参数绑定 SQL 里的 ? 占位符 */
  exec(sql: string, params?: unknown[]): SqliteResult[];
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqliteDatabase;
}

/** SQLite 文件头，用来在交给 WASM 之前先排除扩展名不符的文件 */
const HEADER = 'SQLite format 3\0';

export const isSqliteFile = (bytes: Uint8Array) => {
  if (bytes.length < HEADER.length + 16) return false;
  for (let index = 0; index < HEADER.length; index += 1) {
    if (bytes[index] !== HEADER.charCodeAt(index)) return false;
  }
  return true;
};

/**
 * 只允许读取类语句：组件本身只发出这几类查询，任何写入型 SQL 都进不了 WASM
 */
const READ_ONLY = /^\s*(select|with|pragma)\b/i;

export const isReadOnly = (sql: string) => READ_ONLY.test(sql);

/**
 * 唯一的取数入口。语句一律使用 ? 占位符，值通过 bind 传入，不做字符串拼接
 * 标识符无法参数化，由调用方先过白名单再交给 quoteIdentifier
 */
export const querySql = (db: SqliteDatabase | null, sql: string, params: unknown[] = []): SqliteResult | null => {
  if (!db || !isReadOnly(sql)) return null;
  return db.exec(sql, params)[0] ?? null;
};

/** 标识符统一双引号包裹并转义；名字来自 sqlite_master，且调用前会核对白名单 */
export const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

let pending: Promise<SqlJsStatic> | null = null;

/** WASM 有 650KB 左右，只在真正打开数据库时加载一次 */
export const loadSqlite = (): Promise<SqlJsStatic> => {
  if (!pending) {
    pending = initSqlJs({ locateFile: () => wasmUrl }) as Promise<SqlJsStatic>;
  }
  return pending;
};
