# crab-band

Claude Code 桌面端输入框上方的一行信息栏，只在桌面端显示（终端里不显示）。

- **5H / 7D**：两个用量窗口还剩多少（细进度条）、多久重置；剩余低于 15% 时数字变红。
- **小螃蟹 + WARM/COLD**：主会话提示缓存的冷热。WARM 显示还剩多久，COLD 显示「过期 …」；切换模型后显示「已失效」。缓存时长读 `promptCacheTtl` 设置，未设按 1 小时。这是按最近一次请求自己计时的估算值。
- **磁盘 / swap**（靠右）：数据卷可用空间（低于 10 GB 变红）和 swap 已用量，每分钟刷新一次。磁盘和 swap 读的是 macOS 命令，其他系统上这一段不显示。

一行放不下时自动换行。它不调用模型，不联网，只读本机数字。

## 安装

在终端的 Claude Code 会话里输入：

```
/plugin install crab-band --marketplace KenOU666/crab-band
```

问 `Add marketplace?` 时输入 `y`，范围选 user（直接回车），然后新开一个桌面端会话就能看到。

或者在 shell 里：

```bash
claude plugin install crab-band --marketplace KenOU666/crab-band
```

在桌面端里：点输入框旁边的 +，选 Plugins，用 `KenOU666/crab-band` 添加 marketplace，再添加插件。

## 卸载

```bash
claude plugin uninstall crab-band
```

## 开发

```bash
claude plugin test .
claude plugin validate .
```

小螃蟹的像素图和动画改写自 [robonuggets/ribbon](https://github.com/robonuggets/ribbon)（MIT），原作者的版权声明见 NOTICE。
