# thomo-ollama-native

可选的 Ollama 原生 provider，直接请求 `/api/chat` NDJSON 流。它与现有 Ollama `/v1` provider 并存，不修改 Ollama，也不替换当前模型配置。

## 临时试用

不写入 Pi settings，当前运行结束后自动 unplug：

```bash
pi -e /path/to/thomo/packages/thomo-ollama-native
```

如果当前 checkout 已经在 `/workspace/thomo`：

```bash
THOMO_OLLAMA_MODELS=qwen3:8b pi -e /workspace/thomo/packages/thomo-ollama-native
```

没有设置 `THOMO_OLLAMA_MODELS` 时，在模型选择器刷新模型列表，provider 会从 Ollama `/api/tags` 发现模型。

## 持久安装和移除

```bash
pi install /path/to/thomo/packages/thomo-ollama-native
pi list
pi remove /path/to/thomo/packages/thomo-ollama-native
```

安装后运行 `/reload` 或重启 Pi。也可以在当前会话使用 `/ollama-native off` 临时移除 provider，使用 `/ollama-native on` 恢复。

## 配置

- `THOMO_OLLAMA_BASE_URL` 覆盖服务地址，默认 `http://127.0.0.1:11434`。
- `OLLAMA_HOST` 是没有设置上述变量时的备用地址。
- `THOMO_OLLAMA_MODELS` 使用逗号分隔的模型名，作为无需网络发现的初始模型列表。
- `THOMO_OLLAMA_NATIVE=0` 禁用扩展而不卸载 package。

模型名称会显示为 `模型名 (Ollama native)`，provider id 是 `ollama-native`。普通文本、thinking、工具调用、图片输入和 Ollama 完成指标均通过原生协议处理。

## 回滚

优先使用 `pi -e` 试用，因此无需回滚 settings。持久安装不满意时，停止 Pi，执行 `pi remove` 删除这个独立 package，再重启 Pi；现有 Ollama `/v1` provider 和其他 thomo 插件不会被删除。

若使用项目级安装，使用 `pi remove -l /path/to/thomo/packages/thomo-ollama-native`，并检查项目的 `.pi/settings.json`。
