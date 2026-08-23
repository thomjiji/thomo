# thomo-ollama-native

通过原生 Ollama `/api/chat` NDJSON 流提供模型调用，支持 thinking、工具调用、图片输入和 Ollama 推理指标。它与 Ollama `/v1` provider 使用不同的 provider id，可以并存。

## 加载

该扩展默认不随 thomo umbrella package 加载。临时加载 checkout：

```bash
pi -e /path/to/thomo/packages/thomo-ollama-native
```

需要持久加载时：

```bash
pi install /path/to/thomo/packages/thomo-ollama-native
pi list
```

重启 Pi 或执行 `/reload`。

## 配置

环境变量优先级为 `THOMO_OLLAMA_BASE_URL`、`OLLAMA_HOST`、`http://127.0.0.1:11434`：

```bash
THOMO_OLLAMA_BASE_URL=http://127.0.0.1:11434 \
THOMO_OLLAMA_MODELS=qwen3:8b \
pi
```

- `THOMO_OLLAMA_BASE_URL`：Ollama 服务地址。
- `OLLAMA_HOST`：未设置 `THOMO_OLLAMA_BASE_URL` 时使用的服务地址。
- `THOMO_OLLAMA_MODELS`：逗号分隔的初始模型列表；设置 endpoint 或模型列表时启用 `/api/tags` 刷新。
- `THOMO_OLLAMA_NATIVE=0`：启动时禁用扩展。

固定模型和多个 Ollama 地址写入 `~/.pi/agent/models.json`。provider 或模型的 `api` 必须为 `ollama-native`：

```json
{
  "providers": {
    "ollama-native": {
      "baseUrl": "http://127.0.0.1:11434",
      "api": "ollama-native",
      "apiKey": "ollama",
      "models": [
        {
          "id": "qwen3:8b",
          "name": "qwen3:8b (Ollama native)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 32768
        }
      ]
    }
  }
}
```

可用不同 provider id 配置多个地址，例如 `gsj-5-ollama-native` 和 `gsj-9-ollama-native`。使用 models.json 静态模型时不会探测默认的 localhost；需要动态发现时设置 `THOMO_OLLAMA_BASE_URL` 或 `OLLAMA_HOST`。

## 运行时控制

```text
/ollama-native off
/ollama-native on
```

`off` 只影响当前 Pi 进程。永久禁用时，在启动 Pi 前设置 `THOMO_OLLAMA_NATIVE=0`。

## 推理速度

Ollama 最终响应中的 `eval_count` 和 `eval_duration` 会传给 thomo-tps。回复过程中显示 Pi 侧实时估算，例如 `8.7t/s`；回复结束后显示服务端和 Pi 侧速度，例如 `srv 52.4t/s obs 8.7t/s`。服务端速度只能在回复结束后计算。

## 移除

如果单独安装过该 package：

```bash
pi remove /path/to/thomo/packages/thomo-ollama-native
```

不需要移除 package 时，可在启动 Pi 前设置 `THOMO_OLLAMA_NATIVE=0` 禁用扩展。
