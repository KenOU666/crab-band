// 纯函数：时间与字节的格式化、本机命令输出的解析、缓存冷热判断、小螃蟹 SVG。
// 小螃蟹的像素图和动画改写自 robonuggets/ribbon（MIT，见 NOTICE）。

import type { Cache } from '../types'

export const ORANGE = '#e8741a'
export const YELLOW = '#d9a21b'
export const HUE = { warm: '#cc6363', cold: '#4a90b8' } as const
/** 进度条底槽：半透明灰，浅色和深色主题下都看得见。 */
const TRACK = '#8a8a8a40'
/** SVG 作为图片画，读不到 App 的网页字体，用系统字体。 */
const FONT = '-apple-system, BlinkMacSystemFont, Helvetica, sans-serif'

export const LOW_AT = 15
export const DISK_LOW_BYTES = 10 * 1024 ** 3
export const DEFAULT_TTL_MS = 60 * 60 * 1000

export type Mode = 'warm' | 'cold'

/** 毫秒时长写成 `56m`、`4h 1m`、`3d 9h`；1 小时以内（含）都用分钟。 */
export const fmtSpan = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins <= 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** 字节数写成 GB：10 GB 以上取整，以下保留一位小数。 */
export const fmtGb = (bytes: number): string => {
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
}

/** `promptCacheTtl` 设置值换成毫秒；只认 `5m`，其余按 1 小时。 */
export const ttlOf = (value: unknown): number => (value === '5m' ? 5 * 60 * 1000 : DEFAULT_TTL_MS)

/** 从 `df -k <挂载点>` 的输出取可用字节数；第二行第 4 列是可用 KB。 */
export const parseDfFree = (stdout: string): number | null => {
  const cols = stdout.trim().split('\n')[1]?.trim().split(/\s+/)
  const kb = Number(cols?.[3])
  return Number.isFinite(kb) ? kb * 1024 : null
}

/** 从 `sysctl vm.swapusage` 的输出取 swap 已用字节数（单位 M 或 G）。 */
export const parseSwapUsed = (stdout: string): number | null => {
  const m = /used = ([\d.]+)([MG])/.exec(stdout)
  if (!m) return null
  return Number(m[1]) * (m[2] === 'G' ? 1024 ** 3 : 1024 ** 2)
}

/**
 * 缓存当前状态：lastAt 为 0（被切换模型判定失效）或超过 TTL 即 COLD。
 * WARM 时 span 是还剩多久，COLD 时是已过期多久；失效时 span 为 null。
 */
export const cacheView = (c: Cache | null, ttlMs: number, now: number): { mode: Mode; span: number | null } | null => {
  if (!c) return null
  if (c.lastAt <= 0) return { mode: 'cold', span: null }
  const idle = Math.max(0, now - c.lastAt)
  return idle < ttlMs ? { mode: 'warm', span: ttlMs - idle } : { mode: 'cold', span: idle - ttlMs }
}

const svgDoc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/** 细进度条：left 为剩余百分比，圆角底槽上叠一段同色填充。 */
export const barSvg = (left: number, color: string, w: number, h: number): string => {
  const fill = Math.max(0, Math.min(w, (left / 100) * w))
  const r = h / 2
  return svgDoc(w, h, `<rect width="${w}" height="${h}" rx="${r}" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect width="${Math.max(fill, h)}" height="${h}" rx="${r}" fill="${color}"/>` : ''))
}

/** WARM / COLD 圆角标签：同色 20% 透明底、同色字。返回 SVG 和宽高。 */
export const pillSvg = (mode: Mode): { source: string; w: number; h: number } => {
  const word = mode === 'warm' ? 'WARM' : 'COLD'
  const hue = HUE[mode]
  const w = 46
  const h = 18
  const body =
    `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${hue}" fill-opacity=".2"/>` +
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing=".4" fill="${hue}">${word}</text>`
  return { source: svgDoc(w, h, body), w, h }
}

// ---------- 小螃蟹：WARM 时浮动，COLD 时冻在冰块里 ----------
const PIX = ['..X..X..', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXXXXXXX', 'X..XX..X']

const mix = (a: string, b: string, t: number): string =>
  '#' +
  [1, 3, 5]
    .map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0'))
    .join('')

// 合成一条 path：逐格 rect 在小数尺寸下会留缝
const pixels = (u: number, fill: string): string => {
  let d = ''
  PIX.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') d += `M${x * u} ${y * u}h${u}v${u}h${-u}z`
    }),
  )
  return `<path d="${d}" fill="${fill}"/>`
}

/** 边长 size 的小螃蟹 SVG 文档；动画用 SMIL，Svg 元素要开 isInteractive。 */
export const crabSvg = (mode: Mode, size: number): string => {
  const ease = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"'
  let body: string
  if (mode === 'warm') {
    const u = size / 10
    body =
      `<g transform="translate(${u} ${1.6 * u})" shape-rendering="crispEdges">` +
      `<ellipse cx="${4 * u}" cy="${7.75 * u}" rx="${3 * u}" ry="${0.42 * u}" fill="#000" opacity=".25" shape-rendering="auto">` +
      `<animate attributeName="rx" values="${3 * u};${2.3 * u};${3 * u}" dur="1.2s" repeatCount="indefinite" ${ease}/></ellipse>` +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-1.1 * u};0 0" dur="1.2s" repeatCount="indefinite" ${ease}/>` +
      pixels(u, HUE.warm) +
      `</g></g>`
  } else {
    const u = size / 12.2
    const ice = mix(HUE.cold, '#ffffff', 0.5)
    const bx = -1.2 * u
    const by = -1.2 * u
    const bw = 10.4 * u
    const bh = 9.4 * u
    body = `<g transform="translate(${1.6 * u} ${1.6 * u})">` + pixels(u, ice)
    body += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${1.5 * u}" fill="${HUE.cold}" fill-opacity=".28" stroke="${ice}" stroke-width="${0.38 * u}"/>`
    for (const ix of [1.4, 4.4, 7.2]) {
      body += `<path d="M${bx + ix * u} ${by + bh}h${0.9 * u}l${-0.45 * u} ${1.5 * u}z" fill="${ice}"/>`
    }
    body += '</g>'
  }
  return svgDoc(size, size, body)
}
