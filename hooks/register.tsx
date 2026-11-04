import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache, Sys, Window } from '../types'
import {
  DISK_LOW_BYTES, HUE, LOW_AT, ORANGE, YELLOW,
  barSvg, cacheView, crabSvg, fmtGb, fmtSpan, parseDfFree, parseSwapUsed, pillSvg, ttlOf,
} from './crab'

// 桌面端输入框上方一行：5H / 7D 剩余用量、提示缓存冷热（小螃蟹）、磁盘和 swap。
// 放不下时换行。缓存状态是按主会话最近一次请求自己计时的估算值。

const BAR_W = 56
const BAR_H = 4
const CRAB_SIZE = 18
/** 重画间隔：倒计时和冷热切换跟着走。 */
const TICK_MS = 30_000
/** 磁盘和 swap 的刷新间隔。 */
const SYS_MS = 60_000

const windows = atom({ plugin: 'crab-band', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'crab-band', key: 'cache' } as const, null as Cache | null)
const ttlMs = atom({ plugin: 'crab-band', key: 'ttlMs' } as const, ttlOf(undefined))
const sys = atom({ plugin: 'crab-band', key: 'sys' } as const, null as Sys | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H' }
const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }
const COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW }

/** 只留 5H 和 7D，5H 在前。 */
const clean = (list: readonly Window[]): Window[] =>
  list
    .filter(w => w.kind in ORDER)
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

/** 运行本机命令取一个值；命令失败或输出解析不了时为 null。 */
const probe = async ($: EngineInterface, argv: string[], parse: (s: string) => number | null): Promise<number | null> => {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? parse(r.stdout) : null
  } catch {
    return null
  }
}

const refreshSys = async ($: EngineInterface): Promise<void> => {
  // 数据卷才是用户数据所在；根目录 / 是只读系统卷
  const diskFree = await probe($, ['df', '-k', '/System/Volumes/Data'], parseDfFree)
  const swapUsed = await probe($, ['sysctl', 'vm.swapusage'], parseSwapUsed)
  await update($, sys, () => ({ diskFree, swapUsed }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const u = await $.session.usage()
    await update($, windows, () => clean(u.rateLimits))
    const ttl = await $.settings.read({ key: 'promptCacheTtl' })
    await update($, ttlMs, () => ttlOf(ttl))
    await refreshSys($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    $.clock.every(SYS_MS, () => refreshSys($))
    return r
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, windows, () => clean(e.rateLimits))
    return next(e)
  })

  // 恢复的会话按距上次回复的秒数起算；/clear 和 /compact 后对话从头开始，不显示缓存
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      await update($, cache, () => ({ lastAt }))
    }
    return r
  }).catch(($, e, next) => next(e))

  // 每个模型有自己的缓存：切换后旧缓存用不上，直到下一次请求重新写入
  on('classic.PostModelSwitch', async ($, e, next) => {
    const r = await next(e)
    await update($, cache, c => (c ? { lastAt: 0 } : c))
    return r
  }).catch(($, e, next) => next(e))

  // 主会话的每次请求读写缓存，倒计时从请求发出时重置；subagent 用自己的缓存，不算
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, () => ({ lastAt: now }))
    }
    yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const now = await $.clock.now()
    const list = await read($, windows)
    const view = cacheView(await read($, cache), await read($, ttlMs), now)
    const s = await read($, sys)

    const segments = []

    // 用量：小号浅色标签、细进度条、数字（告急时变红）、重置时间
    for (const w of list) {
      const left = Math.max(0, Math.round(100 - w.percentUsed))
      const name = NAMES[w.kind] ?? w.kind
      const col = COLORS[w.kind] ?? ORANGE
      const reset = w.resetsAt ? fmtSpan(Date.parse(w.resetsAt) - now) : ''
      segments.push(
        <Box key={`w-${w.kind}`} flexDirection="row" flexShrink={0} alignItems="center" columnGap={1}>
          <Text size="caption" weight="semibold" color="inactive">{name}</Text>
          {Svg ? <Svg source={barSvg(left, col, BAR_W, BAR_H)} alt={`${name} 剩余 ${left}%`} width={BAR_W} height={BAR_H} /> : null}
          <Text weight="semibold" color={left < LOW_AT ? 'error' : 'text'}>{`${left}%`}</Text>
          {reset ? <Text size="footnote" color="inactive">{reset}</Text> : null}
        </Box>,
      )
    }

    // 缓存：螃蟹、圆角 WARM/COLD 标签、剩余或已过期时长
    if (view) {
      const warm = view.mode === 'warm'
      const pill = pillSvg(view.mode)
      const span = view.span === null ? '已失效' : warm ? fmtSpan(view.span) : `过期 ${fmtSpan(view.span)}`
      segments.push(
        <Box key="cache" flexDirection="row" flexShrink={0} alignItems="center" columnGap={1}>
          {Svg ? (
            <Svg source={crabSvg(view.mode, CRAB_SIZE)} alt={warm ? '螃蟹，浮动中' : '螃蟹，冻住了'} width={CRAB_SIZE} height={CRAB_SIZE} isInteractive />
          ) : null}
          {Svg ? <Svg source={pill.source} alt={warm ? 'WARM' : 'COLD'} width={pill.w} height={pill.h} /> : null}
          <Text size="footnote" color={HUE[view.mode]}>{span}</Text>
        </Box>,
      )
    }

    // 磁盘和 swap 靠右：前面放一个撑开的空白
    if (s && (s.diskFree !== null || s.swapUsed !== null)) {
      segments.push(<Box key="grow" flexGrow={1} />)
      segments.push(
        <Box key="sys" flexDirection="row" flexShrink={0} alignItems="center">
          {s.diskFree !== null ? (
            <Text size="footnote" weight={s.diskFree < DISK_LOW_BYTES ? 'semibold' : 'regular'} color={s.diskFree < DISK_LOW_BYTES ? 'error' : 'inactive'}>
              {`磁盘 ${fmtGb(s.diskFree)}`}
            </Text>
          ) : null}
          {s.swapUsed !== null ? <Text size="footnote" color="inactive">{` · swap ${fmtGb(s.swapUsed)}`}</Text> : null}
        </Box>,
      )
    }

    if (segments.length === 0) return next(e)

    return (
      <Box key="row" flexDirection="row" flexWrap="wrap" columnGap={3} paddingX={1} alignItems="center">
        {segments}
      </Box>
    )
  })
}
