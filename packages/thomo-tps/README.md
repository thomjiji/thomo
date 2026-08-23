# thomo-tps

在 Pi 默认 status bar 的统计信息区域显示模型输出速度（TPS，tokens per second）。插件只增加 TPS，不替换默认 footer 的其他信息，也不注册命令。

没有 provider 服务器指标时，速度按当前 session 已完成回复的总输出 token 数和总耗时计算；模型回复流式输出时会实时显示估算值。Ollama native provider 提供指标时，状态栏同时显示 `server` decode TPS 和 `observed` Pi 侧 TPS。

## 使用

安装 umbrella package 后自动加载：

```bash
pi install git:github.com/thomjiji/thomo
```

也可以只加载这个插件：

```bash
pi install /path/to/thomo/packages/thomo-tps
```

安装后运行 `/reload`，或重启 Pi。
