> ## Documentation Index
> Fetch the complete documentation index at: https://platform.kimi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用 Batch API 批量处理任务

当你需要使用大语言模型处理大规模、低实时性要求的任务时，Batch API 是理想选择。它支持通过文件批量提交任务，相比实时 API 调用可以节省 40% 的推理费用。

<Note>
  Batch API 支持 `kimi-k2.6` 和 `kimi-k2.5` 模型。这些模型的 `temperature`、`top_p` 等参数不可修改，请勿在请求 body 中设置这些参数。
</Note>

<CardGroup cols={2}>
  <Card title="创建批处理任务" icon="plus" href="/api/batch-create">
    上传 JSONL 文件并创建批处理任务
  </Card>

  <Card title="列出批处理任务" icon="list" href="/api/batch-list">
    获取当前组织的批处理任务列表
  </Card>

  <Card title="获取任务详情" icon="circle-info" href="/api/batch-retrieve">
    查询指定批处理任务的状态和详细信息
  </Card>

  <Card title="取消批处理任务" icon="xmark" href="/api/batch-cancel">
    取消正在进行的批处理任务
  </Card>
</CardGroup>

## 使用流程

本指南通过一个文本分类的实例，展示 Batch API 的完整使用流程：

### 1. 构造输入文件

JSONL 文件中每行是一个独立的 JSON 对象，代表一个推理请求：

```json theme={null}
{"custom_id": "request-1", "method": "POST", "url": "/v1/chat/completions", "body": {"model": "kimi-k2.6", "messages": [{"role": "system", "content": "你是一个文本分类助手"}, {"role": "user", "content": "请分类这段文本：人工智能正在改变世界"}]}}
```

| 字段        | 是否必须 | 说明                                                  |
| ----------- | -------- | ----------------------------------------------------- |
| `custom_id` | 必须     | 自定义请求标识，用于追踪结果，需在文件内唯一          |
| `method`    | 必须     | 请求方法，固定为 `POST`                               |
| `url`       | 必须     | 请求地址，固定为 `/v1/chat/completions`               |
| `body`      | 必须     | 请求体，与 [Chat Completions API](/api/chat) 参数一致 |

<Warning>
  `body` 中的 `model` 必须是 `kimi-k2.6` 或 `kimi-k2.5`。这些模型的 `temperature`、`top_p`、`n`、`presence_penalty`、`frequency_penalty` 参数均不可修改，请勿在 `body` 中设置这些参数。
</Warning>

<Note>
  **输入文件要求：**

  * 文件必须为 `.jsonl` 格式，大小不能为空且不超过 100MB
  * 每行必须是合法的 JSON 对象，且包含 `custom_id`、`method`、`url`、`body` 四个字段
  * `custom_id` 在文件内必须唯一
  * 所有行的 `model` 必须相同，一个批次只允许一个模型
  * `method` 固定为 `POST`，`url` 固定为 `/v1/chat/completions`
  * 指定的模型必须存在且用户有访问权限
</Note>

### 2. 上传文件

通过[文件上传接口](/api/files-upload)上传 JSONL 文件，`purpose` 必须设置为 `"batch"`。

<CodeGroup>
  ```python Python theme={null}
  import os
  from openai import OpenAI
  from openai.types import FileObject

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  file_object: FileObject = client.files.create(
      file=open("batch_requests.jsonl", "rb"),
      purpose="batch",
  )
  print(file_object.id)  # 保存 file_id，下一步使用
  ```

  ```bash cURL theme={null}
  curl ${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/files \
    -H "Authorization: Bearer $MOONSHOT_API_KEY" \
    -F purpose="batch" \
    -F file="@batch_requests.jsonl"
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");
  const fs = require("fs");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      const fileObject = await client.files.create({
          file: fs.createReadStream("batch_requests.jsonl"),
          purpose: "batch"
      });
      console.log(fileObject.id);  // 保存 file_id，下一步使用
  }

  main();
  ```
</CodeGroup>

### 3. 创建任务

调用[创建批处理任务](/api/batch-create)接口，传入 `input_file_id` 和 `completion_window`。`completion_window` 建议根据数据量合理设置，较长的时间窗口可以提高任务完成率。

<CodeGroup>
  ```python Python theme={null}
  import os
  from openai import OpenAI
  from openai.types import Batch

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  batch: Batch = client.batches.create(
      input_file_id="your_file_id",
      endpoint="/v1/chat/completions",
      completion_window="24h",
  )
  print(batch.id)  # 保存 batch_id，用于轮询状态
  ```

  ```bash cURL theme={null}
  curl ${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/batches \
    -H "Authorization: Bearer $MOONSHOT_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "input_file_id": "your_file_id",
      "endpoint": "/v1/chat/completions",
      "completion_window": "24h"
    }'
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      const batch = await client.batches.create({
          input_file_id: "your_file_id",
          endpoint: "/v1/chat/completions",
          completion_window: "24h"
      });
      console.log(batch.id);  // 保存 batch_id，用于轮询状态
  }

  main();
  ```
</CodeGroup>

### 4. 等待完成

创建后任务进入 `validating` 状态，系统将异步校验输入文件。校验通过后进入 `in_progress` 状态开始执行。你可以通过[获取任务详情](/api/batch-retrieve)接口轮询状态。

<CodeGroup>
  ```python Python theme={null}
  import os
  import time
  from openai import OpenAI
  from openai.types import Batch

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  while True:
      batch: Batch = client.batches.retrieve("your_batch_id")
      completed: int = batch.request_counts.completed if batch.request_counts else 0
      total: int = batch.request_counts.total if batch.request_counts else 0
      print(f"状态: {batch.status} ({completed}/{total})")

      if batch.status == "completed":
          break
      elif batch.status in ("failed", "expired", "cancelled"):
          print(f"任务异常终止: {batch.status}")
          break

      time.sleep(10)
  ```

  ```bash cURL theme={null}
  curl ${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/batches/your_batch_id \
    -H "Authorization: Bearer $MOONSHOT_API_KEY"
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      let batch = await client.batches.retrieve("your_batch_id");
      while (!["completed", "failed", "expired", "cancelled"].includes(batch.status)) {
          await new Promise(r => setTimeout(r, 10000));
          batch = await client.batches.retrieve("your_batch_id");
          console.log(`状态: ${batch.status} (${batch.request_counts.completed}/${batch.request_counts.total})`);
      }
  }

  main();
  ```
</CodeGroup>

### 5. 处理结果

任务完成后，`output_file_id` 字段包含结果文件 ID，通过[获取文件内容](/api/files-content)接口下载。如果有请求失败，`error_file_id` 包含错误文件 ID。

<CodeGroup>
  ```python Python theme={null}
  import json
  import os
  from openai import OpenAI

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  output = client.files.content("your_output_file_id")
  for line in output.text.strip().split("\n"):
      result: dict = json.loads(line)
      custom_id: str = result["custom_id"]
      content: str = result["response"]["body"]["choices"][0]["message"]["content"]
      print(f"{custom_id}: {content}")
  ```

  ```bash cURL theme={null}
  curl ${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/files/your_output_file_id/content \
    -H "Authorization: Bearer $MOONSHOT_API_KEY" \
    -o results.jsonl
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      const output = await client.files.content("your_output_file_id");
      const text = await output.text();
      for (const line of text.trim().split("\n")) {
          const data = JSON.parse(line);
          console.log(`${data.custom_id}: ${data.response.body.choices[0].message.content}`);
      }
  }

  main();
  ```
</CodeGroup>

输出文件中每行对应一个请求的处理结果：

```json theme={null}
{
  "id": "request-1",
  "custom_id": "request-1",
  "response": {
    "status_code": 200,
    "request_id": "",
    "body": {
      "id": "chatcmpl-xxx",
      "object": "chat.completion",
      "created": 1711475054,
      "model": "kimi-k2.6",
      "choices": [
        {
          "index": 0,
          "message": {
            "role": "assistant",
            "content": "这段文本属于科技类。"
          },
          "finish_reason": "stop"
        }
      ],
      "usage": {
        "prompt_tokens": 30,
        "completion_tokens": 10,
        "total_tokens": 40
      }
    }
  },
  "error": null
}
```

## 完整代码示例

以下是将上述步骤串联起来的完整脚本，可直接复制运行：

<CodeGroup>
  ```python Python expandable theme={null}
  import json
  import os
  import time
  from pathlib import Path

  from openai import OpenAI

  MODEL = "kimi-k2.6"

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )


  def create_input_jsonl() -> Path:
      """构造 JSONL 输入文件，每行是一个分类请求。"""
      texts: list[str] = [
          "哈姆雷特是莎士比亚最著名的悲剧作品之一",
          "科学家发现新的潜在宜居行星",
          "2024年人工智能发展报告",
          "如何制作一道美味的红烧肉",
          "最新iPhone发布会详细信息",
      ]

      requests: list[dict] = []
      for i, text in enumerate(texts):
          requests.append({
              "custom_id": f"text_{i}",
              "method": "POST",
              "url": "/v1/chat/completions",
              "body": {
                  "model": MODEL,
                  "messages": [
                      {"role": "system", "content": "你是一个文本分类专家，请将文本分类为：文学类/新闻类/学术类/科技类/生活类"},
                      {"role": "user", "content": f"请对以下文本进行分类：{text}"},
                  ],
              },
          })

      output_path = Path("classification_requests.jsonl")
      with output_path.open("w", encoding="utf-8") as f:
          for req in requests:
              f.write(json.dumps(req, ensure_ascii=False) + "\n")
      return output_path


  # 1. 构造输入文件
  input_file: Path = create_input_jsonl()

  # 2. 上传文件
  file_object = client.files.create(file=input_file, purpose="batch")
  print(f"文件已上传: {file_object.id}")

  # 3. 创建批处理任务
  batch = client.batches.create(
      input_file_id=file_object.id,
      endpoint="/v1/chat/completions",
      completion_window="24h",
  )
  print(f"任务已创建: {batch.id}")

  # 4. 轮询等待完成
  while True:
      batch = client.batches.retrieve(batch.id)
      print(f"状态: {batch.status} ({batch.request_counts.completed}/{batch.request_counts.total})")
      if batch.status == "completed":
          break
      elif batch.status in ("failed", "expired", "cancelled"):
          print(f"任务异常终止: {batch.status}")
          exit(1)
      time.sleep(10)

  # 5. 处理结果
  output = client.files.content(batch.output_file_id)
  for line in output.text.strip().split("\n"):
      data: dict = json.loads(line)
      print(f"{data['custom_id']}: {data['response']['body']['choices'][0]['message']['content']}")
  ```

  ```javascript Node.js expandable theme={null}
  const OpenAI = require("openai");
  const fs = require("fs");

  const MODEL = "kimi-k2.6";

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  // 1. 构造输入文件
  const texts = [
      "哈姆雷特是莎士比亚最著名的悲剧作品之一",
      "科学家发现新的潜在宜居行星",
      "2024年人工智能发展报告",
      "如何制作一道美味的红烧肉",
      "最新iPhone发布会详细信息"
  ];

  const lines = texts.map((text, i) => JSON.stringify({
      custom_id: `text_${i}`,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
          model: MODEL,
          messages: [
              { role: "system", content: "你是一个文本分类专家，请将文本分类为：文学类/新闻类/学术类/科技类/生活类" },
              { role: "user", content: `请对以下文本进行分类：${text}` }
          ]
      }
  }));
  fs.writeFileSync("classification_requests.jsonl", lines.join("\n") + "\n");

  async function main() {
      // 2. 上传文件
      const fileObject = await client.files.create({
          file: fs.createReadStream("classification_requests.jsonl"),
          purpose: "batch"
      });
      console.log(`文件已上传: ${fileObject.id}`);

      // 3. 创建批处理任务
      const batch = await client.batches.create({
          input_file_id: fileObject.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h"
      });
      console.log(`任务已创建: ${batch.id}`);

      // 4. 轮询等待完成
      let current = batch;
      while (!["completed", "failed", "expired", "cancelled"].includes(current.status)) {
          await new Promise(r => setTimeout(r, 10000));
          current = await client.batches.retrieve(batch.id);
          console.log(`状态: ${current.status} (${current.request_counts.completed}/${current.request_counts.total})`);
      }

      if (current.status !== "completed") {
          console.error(`任务异常终止: ${current.status}`);
          return;
      }

      // 5. 下载并处理结果
      const output = await client.files.content(current.output_file_id);
      const text = await output.text();
      for (const line of text.trim().split("\n")) {
          const data = JSON.parse(line);
          console.log(`${data.custom_id}: ${data.response.body.choices[0].message.content}`);
      }
  }

  main();
  ```
</CodeGroup>

## Batch 状态说明

| 状态          | 说明                           |
| ------------- | ------------------------------ |
| `validating`  | 已创建，正在校验输入数据       |
| `failed`      | 数据校验失败，任务终止         |
| `in_progress` | 数据校验通过，正在执行         |
| `finalizing`  | 执行完毕，正在准备结果         |
| `completed`   | 结果准备完毕，任务完成         |
| `expired`     | 未在 completion\_window 内完成 |
| `cancelling`  | 已发起取消，等待实际取消       |
| `cancelled`   | 取消完成，任务终止             |

## 任务管理

### 列出批处理任务

通过[列出批处理任务](/api/batch-list)接口查看当前组织下的所有批处理任务。

<CodeGroup>
  ```python Python theme={null}
  import os
  from openai import OpenAI
  from openai.pagination import SyncCursorPage
  from openai.types import Batch

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  batches: SyncCursorPage[Batch] = client.batches.list(limit=10)
  for batch in batches.data:
      print(f"{batch.id} - {batch.status} ({batch.request_counts.completed}/{batch.request_counts.total})")
  ```

  ```bash cURL theme={null}
  curl "${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/batches?limit=10" \
    -H "Authorization: Bearer $MOONSHOT_API_KEY"
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      const batches = await client.batches.list({ limit: 10 });
      for (const batch of batches.data) {
          console.log(`${batch.id} - ${batch.status} (${batch.request_counts.completed}/${batch.request_counts.total})`);
      }
  }

  main();
  ```
</CodeGroup>

### 取消批处理任务

通过[取消批处理任务](/api/batch-cancel)接口取消正在进行的任务。仅 `validating`、`in_progress`、`finalizing` 状态的任务可以取消。取消后任务状态会先变为 `cancelling`，最终变为 `cancelled`。

<CodeGroup>
  ```python Python theme={null}
  import os
  from openai import OpenAI
  from openai.types import Batch

  client = OpenAI(
      api_key=os.environ.get("MOONSHOT_API_KEY"),
      base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
  )

  batch: Batch = client.batches.cancel("your_batch_id")
  print(f"状态: {batch.status}")  # cancelling
  ```

  ```bash cURL theme={null}
  curl -X POST ${MOONSHOT_BASE_URL:-https://api.moonshot.cn/v1}/batches/your_batch_id/cancel \
    -H "Authorization: Bearer $MOONSHOT_API_KEY"
  ```

  ```javascript Node.js theme={null}
  const OpenAI = require("openai");

  const client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
  });

  async function main() {
      const batch = await client.batches.cancel("your_batch_id");
      console.log(`状态: ${batch.status}`);  // cancelling
  }

  main();
  ```
</CodeGroup>

## 多模态 Batch 任务

Batch API 支持在输入文件中包含图片和视频内容。与文本任务的区别主要在于 **构造输入文件** 这一步，其余流程（上传、创建任务、轮询、处理结果）完全一致。

<Accordion title="图片批处理示例">
  图片有两种传入方式：

  * **base64 内嵌**：将图片编码为 base64 直接写入 JSONL，适合小图片。注意 base64 会使体积膨胀约 33%，请关注 100MB 文件大小限制。
  * **文件引用**：先通过文件接口上传图片（`purpose="image"`），然后在 JSONL 中通过 `ms://<file_id>` 引用，适合大图片或图片复用场景。

  以下示例同时提供了两种构建方式，按需选择即可：

  <CodeGroup>
    ```python Python expandable theme={null}
    import base64
    import json
    import os
    import time
    from pathlib import Path

    from openai import OpenAI
    from openai.types import Batch, FileObject
    
    client = OpenAI(
        api_key=os.environ.get("MOONSHOT_API_KEY"),
        base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
    )
    
    MODEL = "kimi-k2.6"
    PROMPT = "请分类这张图片：风景/人物/美食/建筑/其他"
    SYSTEM = "你是一个图片分类助手"


    def build_request_base64(custom_id: str, image_path: str) -> dict:
        """方式一：将图片编码为 base64 直接内嵌到 JSONL 中。
        适合小图片，无需额外上传步骤。"""
        with open(image_path, "rb") as f:
            image_data: str = base64.b64encode(f.read()).decode("utf-8")
        return {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    },
                ],
            },
        }


    def build_request_upload(custom_id: str, image_path: str) -> dict:
        """方式二：先上传图片获取 file_id，再通过 ms://<file_id> 引用。
        适合大图片或同一张图片被多个请求复用的场景。"""
        file_object: FileObject = client.files.create(
            file=open(image_path, "rb"),
            purpose="image",
        )
        print(f"图片已上传: {image_path} -> {file_object.id}")
        return {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"ms://{file_object.id}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    },
                ],
            },
        }


    # ====== 在这里选择构建方式 ======
    build_request = build_request_base64  # 或 build_request_upload
    # ================================
    
    # 1. 构造输入文件
    images: list[str] = ["image1.png", "image2.png", "image3.png"]
    requests: list[dict] = [build_request(f"img-{i}", path) for i, path in enumerate(images)]
    
    input_path = Path("image_batch_requests.jsonl")
    with input_path.open("w", encoding="utf-8") as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")
    
    # 2. 上传 JSONL 并创建任务
    file_object: FileObject = client.files.create(file=input_path, purpose="batch")
    batch: Batch = client.batches.create(
        input_file_id=file_object.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
    )
    print(f"任务已创建: {batch.id}")
    
    # 3. 轮询等待完成
    while True:
        batch = client.batches.retrieve(batch.id)
        print(f"状态: {batch.status} ({batch.request_counts.completed}/{batch.request_counts.total})")
        if batch.status == "completed":
            break
        elif batch.status in ("failed", "expired", "cancelled"):
            print(f"任务异常终止: {batch.status}")
            exit(1)
        time.sleep(10)
    
    # 4. 处理结果
    output = client.files.content(batch.output_file_id)
    for line in output.text.strip().split("\n"):
        data: dict = json.loads(line)
        print(f"{data['custom_id']}: {data['response']['body']['choices'][0]['message']['content']}")
    ```
    
    ```javascript Node.js expandable theme={null}
    const OpenAI = require("openai");
    const fs = require("fs");
    
    const client = new OpenAI({
        apiKey: process.env.MOONSHOT_API_KEY,
        baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
    });
    
    const MODEL = "kimi-k2.6";
    const PROMPT = "请分类这张图片：风景/人物/美食/建筑/其他";
    const SYSTEM = "你是一个图片分类助手";
    
    /** 方式一：将图片编码为 base64 直接内嵌到 JSONL 中。
     *  适合小图片，无需额外上传步骤。*/
    function buildRequestBase64(customId, imagePath) {
        const imageData = fs.readFileSync(imagePath).toString("base64");
        return {
            custom_id: customId,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
                model: MODEL,
                messages: [
                    { role: "system", content: SYSTEM },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:image/png;base64,${imageData}` } },
                            { type: "text", text: PROMPT },
                        ],
                    },
                ],
            },
        };
    }
    
    /** 方式二：先上传图片获取 file_id，再通过 ms://<file_id> 引用。
     *  适合大图片或同一张图片被多个请求复用的场景。*/
    async function buildRequestUpload(customId, imagePath) {
        const fileObject = await client.files.create({
            file: fs.createReadStream(imagePath),
            purpose: "image"
        });
        console.log(`图片已上传: ${imagePath} -> ${fileObject.id}`);
        return {
            custom_id: customId,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
                model: MODEL,
                messages: [
                    { role: "system", content: SYSTEM },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `ms://${fileObject.id}` } },
                            { type: "text", text: PROMPT },
                        ],
                    },
                ],
            },
        };
    }
    
    async function main() {
        // ====== 在这里选择构建方式 ======
        const useUpload = false; // 设为 true 使用文件引用方式
        // ================================
    
        // 1. 构造输入文件
        const images = ["image1.png", "image2.png", "image3.png"];
        const requests = [];
        for (let i = 0; i < images.length; i++) {
            const req = useUpload
                ? await buildRequestUpload(`img-${i}`, images[i])
                : buildRequestBase64(`img-${i}`, images[i]);
            requests.push(JSON.stringify(req));
        }
        fs.writeFileSync("image_batch_requests.jsonl", requests.join("\n") + "\n");
    
        // 2. 上传 JSONL 并创建任务
        const fileObject = await client.files.create({
            file: fs.createReadStream("image_batch_requests.jsonl"),
            purpose: "batch"
        });
        const batch = await client.batches.create({
            input_file_id: fileObject.id,
            endpoint: "/v1/chat/completions",
            completion_window: "24h"
        });
        console.log(`任务已创建: ${batch.id}`);
    
        // 3. 轮询等待完成
        let current = batch;
        while (!["completed", "failed", "expired", "cancelled"].includes(current.status)) {
            await new Promise(r => setTimeout(r, 10000));
            current = await client.batches.retrieve(batch.id);
            console.log(`状态: ${current.status} (${current.request_counts.completed}/${current.request_counts.total})`);
        }
    
        if (current.status !== "completed") {
            console.error(`任务异常终止: ${current.status}`);
            return;
        }
    
        // 4. 处理结果
        const output = await client.files.content(current.output_file_id);
        const text = await output.text();
        for (const line of text.trim().split("\n")) {
            const data = JSON.parse(line);
            console.log(`${data.custom_id}: ${data.response.body.choices[0].message.content}`);
        }
    }
    
    main();
    ```
  </CodeGroup>
</Accordion>

<Accordion title="视频批处理示例">
  视频有两种传入方式：

  * **base64 内嵌**：将视频编码为 base64 直接写入 JSONL，适合小视频。注意 base64 会使体积膨胀约 33%，请关注 100MB 文件大小限制。
  * **文件引用**：先通过文件接口上传视频（`purpose="video"`），然后在 JSONL 中通过 `ms://<file_id>` 引用，适合大视频或视频复用场景。

  以下示例同时提供了两种构建方式，按需选择即可：

  <CodeGroup>
    ```python Python expandable theme={null}
    import base64
    import json
    import os
    import time
    from pathlib import Path

    from openai import OpenAI
    from openai.types import Batch, FileObject
    
    MODEL = "kimi-k2.6"
    
    client = OpenAI(
        api_key=os.environ.get("MOONSHOT_API_KEY"),
        base_url=os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
    )
    
    PROMPT = "请总结这个视频的主要内容"
    SYSTEM = "你是一个视频内容分析助手"


    def build_request_base64(custom_id: str, video_path: str) -> dict:
        """方式一：将视频编码为 base64 直接内嵌到 JSONL 中。
        适合小视频，无需额外上传步骤。"""
        with open(video_path, "rb") as f:
            video_data: str = base64.b64encode(f.read()).decode("utf-8")
        return {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{video_data}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    },
                ],
            },
        }


    def build_request_upload(custom_id: str, video_path: str) -> dict:
        """方式二：先上传视频获取 file_id，再通过 ms://<file_id> 引用。
        适合大视频或同一个视频被多个请求复用的场景。"""
        file_object: FileObject = client.files.create(
            file=open(video_path, "rb"),
            purpose="video",
        )
        print(f"视频已上传: {video_path} -> {file_object.id}")
        return {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "video_url", "video_url": {"url": f"ms://{file_object.id}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    },
                ],
            },
        }


    # ====== 在这里选择构建方式 ======
    build_request = build_request_base64  # 或 build_request_upload
    # ================================
    
    # 1. 构造输入文件
    videos: list[str] = ["video1.mp4", "video2.mp4", "video3.mp4"]
    requests: list[dict] = [build_request(f"video-{i}", path) for i, path in enumerate(videos)]
    
    input_path = Path("video_batch_requests.jsonl")
    with input_path.open("w", encoding="utf-8") as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")
    
    # 2. 上传 JSONL 并创建任务
    batch_file: FileObject = client.files.create(file=input_path, purpose="batch")
    batch: Batch = client.batches.create(
        input_file_id=batch_file.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
    )
    print(f"任务已创建: {batch.id}")
    
    # 3. 轮询等待完成
    while True:
        batch = client.batches.retrieve(batch.id)
        print(f"状态: {batch.status} ({batch.request_counts.completed}/{batch.request_counts.total})")
        if batch.status == "completed":
            break
        elif batch.status in ("failed", "expired", "cancelled"):
            print(f"任务异常终止: {batch.status}")
            exit(1)
        time.sleep(10)
    
    # 4. 处理结果
    output = client.files.content(batch.output_file_id)
    for line in output.text.strip().split("\n"):
        data: dict = json.loads(line)
        print(f"{data['custom_id']}: {data['response']['body']['choices'][0]['message']['content']}")
    ```
    
    ```javascript Node.js expandable theme={null}
    const OpenAI = require("openai");
    const fs = require("fs");
    
    const client = new OpenAI({
        apiKey: process.env.MOONSHOT_API_KEY,
        baseURL: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
    });
    
    const MODEL = "kimi-k2.6";
    const PROMPT = "请总结这个视频的主要内容";
    const SYSTEM = "你是一个视频内容分析助手";
    
    /** 方式一：将视频编码为 base64 直接内嵌到 JSONL 中。
     *  适合小视频，无需额外上传步骤。*/
    function buildRequestBase64(customId, videoPath) {
        const videoData = fs.readFileSync(videoPath).toString("base64");
        return {
            custom_id: customId,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
                model: MODEL,
                messages: [
                    { role: "system", content: SYSTEM },
                    {
                        role: "user",
                        content: [
                            { type: "video_url", video_url: { url: `data:video/mp4;base64,${videoData}` } },
                            { type: "text", text: PROMPT },
                        ],
                    },
                ],
            },
        };
    }
    
    /** 方式二：先上传视频获取 file_id，再通过 ms://<file_id> 引用。
     *  适合大视频或同一个视频被多个请求复用的场景。*/
    async function buildRequestUpload(customId, videoPath) {
        const fileObject = await client.files.create({
            file: fs.createReadStream(videoPath),
            purpose: "video"
        });
        console.log(`视频已上传: ${videoPath} -> ${fileObject.id}`);
        return {
            custom_id: customId,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
                model: MODEL,
                messages: [
                    { role: "system", content: SYSTEM },
                    {
                        role: "user",
                        content: [
                            { type: "video_url", video_url: { url: `ms://${fileObject.id}` } },
                            { type: "text", text: PROMPT },
                        ],
                    },
                ],
            },
        };
    }
    
    async function main() {
        // ====== 在这里选择构建方式 ======
        const useUpload = false; // 设为 true 使用文件引用方式
        // ================================
    
        // 1. 构造输入文件
        const videos = ["video1.mp4", "video2.mp4", "video3.mp4"];
        const requests = [];
        for (let i = 0; i < videos.length; i++) {
            const req = useUpload
                ? await buildRequestUpload(`video-${i}`, videos[i])
                : buildRequestBase64(`video-${i}`, videos[i]);
            requests.push(JSON.stringify(req));
        }
        fs.writeFileSync("video_batch_requests.jsonl", requests.join("\n") + "\n");
    
        // 2. 上传 JSONL 并创建任务
        const batchFile = await client.files.create({
            file: fs.createReadStream("video_batch_requests.jsonl"),
            purpose: "batch"
        });
        const batch = await client.batches.create({
            input_file_id: batchFile.id,
            endpoint: "/v1/chat/completions",
            completion_window: "24h"
        });
        console.log(`任务已创建: ${batch.id}`);
    
        // 3. 轮询等待完成
        let current = batch;
        while (!["completed", "failed", "expired", "cancelled"].includes(current.status)) {
            await new Promise(r => setTimeout(r, 10000));
            current = await client.batches.retrieve(batch.id);
            console.log(`状态: ${current.status} (${current.request_counts.completed}/${current.request_counts.total})`);
        }
    
        if (current.status !== "completed") {
            console.error(`任务异常终止: ${current.status}`);
            return;
        }
    
        // 4. 处理结果
        const output = await client.files.content(current.output_file_id);
        const text = await output.text();
        for (const line of text.trim().split("\n")) {
            const data = JSON.parse(line);
            console.log(`${data.custom_id}: ${data.response.body.choices[0].message.content}`);
        }
    }
    
    main();
    ```
  </CodeGroup>
</Accordion>

## 扩展建议

* 根据实际数据量调整 `completion_window`，较大的数据集建议设置 `3d` 或 `7d`
* 轮询间隔建议 10-60 秒，避免频繁请求
* 结果处理可以根据需求写入数据库或生成报告
* 建议对大文件做分批处理，每个文件控制在合理大小