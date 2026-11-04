import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-04T10:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-11-04T14:01:00Z' },
  { kind: 'seven_day', percentUsed: 36, resetsAt: '2026-11-07T19:00:00Z' },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
} as const

// df -k 的可用列是 KB：26214400 KB = 25 GB；8388608 KB = 8 GB
const DF_OK = 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s5 239095784 179000000 26214400 88% 3100000 263000000 1% /System/Volumes/Data\n'
const DF_LOW = DF_OK.replace('26214400', '8388608')
const SWAP = 'vm.swapusage: total = 20480.00M  used = 10240.00M  free = 10240.00M  (encrypted)\n'

/** 引擎侧的通用应答：用量、设置、本机命令都由测试给定。 */
const engine = (on: Parameters<Parameters<typeof test>[1]>[1], opts: { df?: string; ttl?: string; limits?: unknown[] } = {}) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: opts.limits ?? WINDOWS } }))
  on('settings.read', () => ({ value: opts.ttl === undefined ? {} : { promptCacheTtl: opts.ttl } }))
  on('process.run', (_, e) => {
    const stdout = e.argv[0] === 'df' ? (opts.df ?? DF_OK) : SWAP
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  // 代表引擎自己的绘制：插件交给下层时画出 engine
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const mount = ($: any, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'crab-band', surface, component: 'AbovePrompt', props: PROPS })

/** 所有 Svg 的 alt：进度条、螃蟹和冷热标签都画成 SVG。 */
const alts = async (band: any): Promise<string[]> => (await band.findAll({ type: 'Svg' })).map((x: any) => x.props.alt)

const texts = async (band: any): Promise<string> =>
  (await band.findAll({ type: 'Text' })).map((t: any) => t.text).join('|')

test('桌面端显示 5H 在前、7D 在后的剩余百分比和重置时间', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  const all = await texts(band)
  expect(all).toContain('64%')
  expect(all).toContain('90%')
  expect(all).toContain('3d 9h')
  expect(all).toContain('4h 1m')
  expect(await alts(band)).toEqual(expect.arrayContaining(['7D 剩余 64%', '5H 剩余 90%']))
  expect(all.indexOf('5H')).toBeLessThan(all.indexOf('7D'))
  expect((await band.find({ type: 'Text', text: /^64%$/ }))?.props.color).not.toBe('error')
  await band.unmount()
})

test('剩余低于 15% 时百分比变红', async ($, on) => {
  engine(on, { limits: [{ kind: 'seven_day', percentUsed: 98 }] })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  const all = await texts(band)
  expect((await band.find({ type: 'Text', text: /^2%$/ }))?.props.color).toBe('error')
  await band.unmount()
})

test('终端不显示，交给下层', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await mount($, 'terminal')
  expect(await texts(band)).not.toContain('7D')
  await band.unmount()
})

test('刚好 60 分钟写作 60m 而不是 1h 0m', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 0, context_tokens: 300000, model: 'claude-opus-5-5' })
  const band = await mount($)
  expect(await texts(band)).toContain('60m')
  await band.unmount()
})

test('磁盘段靠右：前面有一个撑开的空白', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  expect((await band.find({ key: 'grow' }))?.props.flexGrow).toBe(1)
  await band.unmount()
})

test('一行放不下时换行而不是截断', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  const row = await band.find({ key: 'row' })
  expect(row?.props.flexWrap).toBe('wrap')
  await band.unmount()
})

test('主会话发请求后缓存 WARM，显示剩余分钟和会动的螃蟹', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4 * 60, context_tokens: 300000, model: 'claude-opus-5-5' })
  const band = await mount($)
  const all = await texts(band)
  expect(all).toContain('56m')
  expect(await alts(band)).toEqual(expect.arrayContaining(['螃蟹，浮动中', 'WARM']))
  await band.unmount()
})

test('超过缓存时长变 COLD，显示已过期多久', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 2 * 3600 + 13 * 60, context_tokens: 300000, model: 'claude-opus-5-5' })
  const band = await mount($)
  const all = await texts(band)
  expect(all).toContain('过期 1h 13m')
  expect(await alts(band)).toEqual(expect.arrayContaining(['螃蟹，冻住了', 'COLD']))
  await band.unmount()
})

test('设置了 5 分钟缓存时，6 分钟前的请求已是 COLD', async ($, on) => {
  engine(on, { ttl: '5m' })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 6 * 60, context_tokens: 300000, model: 'claude-opus-5-5' })
  const band = await mount($)
  expect(await alts(band)).toContain('COLD')
  await band.unmount()
})

test('切换模型后立刻判定失效', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 60, context_tokens: 300000, model: 'claude-opus-5-5' })
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command',
    context_tokens: 300000, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 1,
  })
  const band = await mount($)
  const all = await texts(band)
  expect(await alts(band)).toContain('COLD')
  expect(all).toContain('已失效')
  await band.unmount()
})

test('/clear 后不显示缓存段', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 60, context_tokens: 300000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })
  const band = await mount($)
  const all = await texts(band)
  expect(await alts(band)).not.toContain('WARM')
  expect(await alts(band)).not.toContain('COLD')
  await band.unmount()
})

test('显示磁盘可用和 swap 用量', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  const all = await texts(band)
  expect(all).toContain('磁盘 25 GB')
  expect(all).toContain('swap 10 GB')
  expect((await band.find({ type: 'Text', text: /磁盘/ }))?.props.color).not.toBe('error')
  await band.unmount()
})

test('磁盘可用低于 10 GB 时变红', async ($, on) => {
  engine(on, { df: DF_LOW })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await mount($)
  expect(await texts(band)).toContain('磁盘 8.0 GB')
  expect((await band.find({ type: 'Text', text: /磁盘/ }))?.props.color).toBe('error')
  await band.unmount()
})
