<script setup lang="ts">
import { mdiCodeBraces, mdiDatabase, mdiTable, mdiTableEye } from '@mdi/js';
import { computed, onUnmounted, ref } from 'vue';

import { readEntry } from '../../service/readEntry';
import { isSqliteFile, loadSqlite, querySql, quoteIdentifier, type SqliteColumn, type SqliteDatabase, type SqliteTable } from './parser';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import { errorText } from '../../shared/utils';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

/** 每页行数 */
const PAGE_SIZE = 50;

const progress = ref(0);
const status = ref('正在读取文件…');
/** 文件头不是 SQLite，或数据库无法打开 */
const invalid = ref(false);

const tables = ref<SqliteTable[]>([]);
const counts = ref<Record<string, number>>({});
const active = ref('');
const columns = ref<SqliteColumn[]>([]);
const schema = ref('');
const rows = ref<(string | null)[][]>([]);
const total = ref(0);
const page = ref(0);
const showStruct = ref(false);
const busy = ref(false);

let db: SqliteDatabase | null = null;

/**
 * 表名是标识符，无法使用 ? 占位符，只能拼进语句：先核对它来自 sqlite_master 的白名单，
 * 再用 quoteIdentifier 加引号，两层校验都不通过就放弃查询
 */
const identifierOf = (name: string) =>
  tables.value.some((item) => item.name === name) ? quoteIdentifier(name) : null;

/** 取数入口，值一律使用 ? 占位符 */
const query = (sql: string, params: unknown[] = []) => querySql(db, sql, params);

const formatCell = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return `BLOB（${value.length} 字节）`;
  return String(value);
};

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

const rangeLabel = computed(() => {
  if (!total.value) return '无数据';
  const from = page.value * PAGE_SIZE + 1;
  const to = Math.min(total.value, from + rows.value.length - 1);
  return `${from}-${to} / 共 ${total.value} 行`;
});

const tableIcon = (table: SqliteTable) => (table.type === 'view' ? mdiTableEye : mdiTable);

const countRows = (ident: string) => Number(query(`SELECT COUNT(*) FROM ${ident}`)?.values?.[0]?.[0] ?? 0);

/** 进库后一次读出所有表的行数，供左侧清单显示 */
const loadCounts = () => {
  const next: Record<string, number> = {};
  for (const table of tables.value) {
    try {
      next[table.name] = countRows(quoteIdentifier(table.name));
    } catch {
      /* 视图或异常语句无法获取行数，该项留空 */
    }
  }
  counts.value = next;
};

const loadPage = (next: number) => {
  const ident = identifierOf(active.value);
  if (!db || !ident) return;
  const offset = Math.max(0, next) * PAGE_SIZE;
  const result = query(`SELECT * FROM ${ident} LIMIT ? OFFSET ?`, [PAGE_SIZE, offset]);
  rows.value = (result?.values ?? []).map((row) => row.map(formatCell));
  page.value = next;
};

const selectTable = (name: string) => {
  const ident = identifierOf(name);
  if (!db || !ident || busy.value || name === active.value) return;
  busy.value = true;
  active.value = name;
  page.value = 0;
  showStruct.value = false;
  try {
    // PRAGMA 的参数位置只接受标识符，无法绑定占位符，所以这里仍是拼接语句
    const info = query(`PRAGMA table_info(${ident})`);
    columns.value = (info?.values ?? []).map((row) => ({
      name: String(row[1]),
      type: row[2] ? String(row[2]) : '',
      notNull: Number(row[3]) === 1,
      primaryKey: Number(row[5]) > 0,
    }));
    schema.value = tables.value.find((item) => item.name === name)?.sql ?? '';
    if (counts.value[name] === undefined) {
      counts.value = { ...counts.value, [name]: countRows(ident) };
    }
    total.value = counts.value[name];
    loadPage(0);
  } catch (error) {
    fail(error);
  } finally {
    busy.value = false;
  }
};

const load = async () => {
  const { entry } = props;
  try {
    const bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    if (!isSqliteFile(bytes)) {
      invalid.value = true;
      return;
    }
    status.value = '正在解析数据库…';
    const SQL = await loadSqlite();
    if (done()) return;
    db = new SQL.Database(bytes);
    const list = query(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name"
    );
    tables.value = (list?.values ?? []).map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      sql: row[2] ? String(row[2]) : '',
    }));
    if (tables.value.length) {
      loadCounts();
      selectTable(tables.value[0].name);
    }
  } catch (error) {
    if (done()) return;
    // 库本身损坏时给出可读的提示，不关闭预览窗
    invalid.value = true;
    status.value = errorText(error);
  } finally {
    stop();
  }
};

load();

onUnmounted(() => {
  db?.close();
  db = null;
});
</script>

<template>
  <div v-if="tables.length" class="preview-sqlite">
    <aside class="sq-side">
      <div class="sq-side-head">
        <v-icon size="14" :icon="mdiDatabase" />
        <span>数据表</span>
        <span class="sq-side-count">{{ tables.length }}</span>
      </div>
      <div class="sq-side-list">
        <button
          v-for="item in tables"
          :key="item.name"
          type="button"
          class="sq-tab"
          :class="{ 'is-active': item.name === active }"
          @click="selectTable(item.name)"
        >
          <v-icon size="14" :icon="tableIcon(item)" />
          <span class="sq-tab-name">{{ item.name }}</span>
          <span v-if="counts[item.name] !== undefined" class="sq-tab-count">{{ counts[item.name] }}</span>
        </button>
      </div>
    </aside>

    <section class="sq-main">
      <div class="sq-head">
        <span class="sq-name">{{ active }}</span>
        <span class="sq-meta">{{ columns.length }} 列</span>
        <span class="sq-flag">只读</span>
        <button type="button" class="sq-struct-btn" @click="showStruct = !showStruct">
          <v-icon size="14" :icon="mdiCodeBraces" />
          {{ showStruct ? '收起结构' : '表结构' }}
        </button>
      </div>

      <pre v-if="showStruct" class="sq-struct">{{ schema || '（视图或系统表，没有建表语句）' }}</pre>

      <div class="sq-grid">
        <table v-if="rows.length">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column.name">
                <span class="sq-col">{{ column.name }}</span>
                <span v-if="column.type" class="sq-col-type">{{ column.type }}</span>
                <span v-if="column.primaryKey" class="sq-col-pk">PK</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex" :class="{ 'is-null': cell === null }">
                {{ cell ?? 'NULL' }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="preview-hint">该表没有数据</div>
      </div>

      <footer class="sq-foot">
        <span>{{ rangeLabel }}</span>
        <div class="sq-pager">
          <button type="button" :disabled="page <= 0" @click="loadPage(page - 1)">上一页</button>
          <span class="sq-page">{{ page + 1 }} / {{ pages }}</span>
          <button type="button" :disabled="page >= pages - 1" @click="loadPage(page + 1)">下一页</button>
        </div>
      </footer>
    </section>
  </div>

  <div v-else class="preview-hint">
    {{ invalid ? '这不是有效的 SQLite 数据库' : loading ? `${status} ${Math.round(progress * 100)}%` : 'SQLite 数据库中没有可浏览的表' }}
  </div>
</template>

<style scoped>
.preview-sqlite {
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  gap: 12px;
  font-size: 12px;
}

.sq-side {
  flex: 0 0 196px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.sq-side-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}

.sq-side-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.sq-side-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 4px;
}

.sq-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: none;
  color: rgba(24, 24, 27, 0.8);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
}

.sq-tab:hover {
  background: rgba(24, 24, 27, 0.05);
}

.sq-tab.is-active {
  background: rgba(99, 102, 241, 0.08);
  color: rgb(79, 70, 229);
}

.sq-tab-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sq-tab-count {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.sq-tab.is-active .sq-tab-count {
  color: inherit;
  opacity: 0.7;
}

.sq-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.sq-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.sq-name {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.85);
}

.sq-meta {
  color: var(--muted);
  font-size: 11px;
}

.sq-flag {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.1);
  color: rgb(79, 70, 229);
  font-size: 10.5px;
}

.sq-struct-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: #fff;
  color: rgba(24, 24, 27, 0.7);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.sq-struct-btn:hover {
  background: rgba(24, 24, 27, 0.04);
}

.sq-struct {
  flex-shrink: 0;
  max-height: 132px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-bottom: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.03);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: rgba(24, 24, 27, 0.8);
}

.sq-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.sq-grid table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.sq-grid th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.03);
  font-weight: 500;
  white-space: nowrap;
  text-align: left;
}

.sq-col {
  color: rgba(24, 24, 27, 0.85);
}

.sq-col-type {
  margin-left: 5px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 400;
}

.sq-col-pk {
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.1);
  color: rgb(79, 70, 229);
  font-size: 9.5px;
}

.sq-grid td {
  max-width: 300px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(24, 24, 27, 0.85);
}

.sq-grid td.is-null {
  color: var(--muted);
  font-style: italic;
}

.sq-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}

.sq-pager {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sq-pager button {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: #fff;
  color: rgba(24, 24, 27, 0.75);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.sq-pager button:hover:not(:disabled) {
  background: rgba(24, 24, 27, 0.04);
}

.sq-pager button:disabled {
  color: rgba(24, 24, 27, 0.3);
  cursor: default;
}

.sq-page {
  font-variant-numeric: tabular-nums;
}
</style>