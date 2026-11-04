/** 一个用量窗口：哪个窗口、用掉多少、何时重置。 */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** 主会话缓存：最近一次请求的时间；lastAt 为 0 表示已被切换模型等操作判定失效。 */
export type Cache = { lastAt: number }

/** 本机资源：磁盘可用字节数和 swap 已用字节数，读不到时为 null。 */
export type Sys = { diskFree: number | null; swapUsed: number | null }

declare module 'claude-code' {
  interface PluginState {
    'crab-band': { windows: Window[]; cache: Cache | null; ttlMs: number; sys: Sys | null }
  }
}
