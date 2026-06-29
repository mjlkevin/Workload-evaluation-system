> ## Documentation Index
> Fetch the complete documentation index at: https://platform.kimi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 基准测试最佳实践

基准测试是一项对稳定性要求极高的工程任务。 您需要与模型进行大量交互，即使是微小的系统偏差或网络波动也可能影响结果的准确性。 我们总结了以下最佳实践，帮助您的评估结果可复现且可信。

**重点提示：**

* 对于下表中未提到的 benchmark 或其他闭源 benchmark，推荐 temperature = 1.0，stream = true，top\_p = 0.95
* Reasoning 相关的 benchmark： maxtoken 推荐设置到 128k，并且总测试题量至少要到 500-1000 题才会获得一个相对低的测试方差。（比如 AIME2025 建议测试 32 次 30\*32=960 题）
* Code 相关的 benchmark：maxtoken 推荐设置到 256k
* Agentic Task 相关的 benchmark：如果需要 multi hop search，maxtoken 推荐设置到 256k 并配合 context management 机制；其他类型的 agentic task 推荐至少设置 16-64k 的 maxtoken

## K2.6 模型基准测试推荐参数

<div style={{ overflowX: 'auto' }}>
  <table style={{ minWidth: '900px' }}>
    <thead>
      <tr>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark 分类</th>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark</th>
        <th style={{ whiteSpace: 'nowrap' }}>Temperature</th>
        <th style={{ whiteSpace: 'nowrap' }}>Max token 推荐设置</th>
        <th style={{ whiteSpace: 'nowrap' }}>推荐测试次数</th>
        <th style={{ whiteSpace: 'nowrap' }}>Top-P</th>
        <th style={{ whiteSpace: 'nowrap' }}>其他</th>
      </tr>
    </thead>

    <tbody>
      <tr>
        <td rowSpan="7">Multi-modal</td>
        <td>MMMU-Pro</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MMMU-Pro w/ python</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 64k;<br />total max tokens = 256k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 50<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>CharXiv (RQ)</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>CharXiv (RQ) w/ python</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 64k;<br />total max tokens = 256k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 50<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MathVision</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MathVision w/ python</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 64k;<br />total max tokens = 256k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 50<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>V\* w/ python</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 64k;<br />total max tokens = 256k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 50<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="8">Agent</td>
        <td>HLE-Full w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>BrowseComp</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>DeepSearchQA</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>WideSearch</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>Toolathlon</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MCPMark</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>Claw Eval</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>APEX-Agents</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="7">Coding</td>
        <td>Terminal-Bench 2.0 (Terminus-2)</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 256k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>SWE-Bench Pro</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 32k;<br />total max tokens = 256k</td>
        <td>5次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>SWE-Bench Multilingual</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 32k;<br />total max tokens = 256k</td>
        <td>5次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>SWE-Bench Verified</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 32k;<br />total max tokens = 256k</td>
        <td>5次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 300<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>SciCode</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>OJBench (python)</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>8次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>LiveCodeBench (v6)</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="3">Math</td>
        <td>AIME 2026</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>HMMT 2026 (Feb)</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>IMO-AnswerBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="2">Knowledge</td>
        <td>HLE-Full</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>GPQA-Diamond</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>8次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>
    </tbody>
  </table>
</div>

## K2.5 模型基准测试推荐参数

<div style={{ overflowX: 'auto' }}>
  <table style={{ minWidth: '900px' }}>
    <thead>
      <tr>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark 分类</th>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark</th>
        <th style={{ whiteSpace: 'nowrap' }}>Temperature</th>
        <th style={{ whiteSpace: 'nowrap' }}>Max token 推荐设置</th>
        <th style={{ whiteSpace: 'nowrap' }}>推荐测试次数</th>
        <th style={{ whiteSpace: 'nowrap' }}>Top-P</th>
        <th style={{ whiteSpace: 'nowrap' }}>其他</th>
      </tr>
    </thead>

    <tbody>
      <tr>
        <td rowSpan="10">Multi-modal</td>
        <td>MMMU-Pro</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>CharXiv (RQ)</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MathVision</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>MathVista</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>OCRBench</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>ZeroBench</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>WorldVQA</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>InfoVQA (val)</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>SimpleVQA</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>ZeroBench w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>max token = 64k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>推荐max steps = 30<br />thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="3">Code</td>
        <td>SWE系列</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 16k;<br />total max token = 256k</td>
        <td>5次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>Lcb + OJBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 128k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>TerminalBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 128k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td rowSpan="9">Reasoning</td>
        <td>AIME2025 no tools</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>AIME2025 w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>per turn tokens = 96k;<br />total max tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>HLE no tools</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>HLE w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 128k;<br />per step tokens = 48k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>HLE heavy</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 128k;<br />per step tokens = 48k</td>
        <td>1次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐max steps = 200<br />parallel n=8</td>
      </tr>

      <tr>
        <td>HMMT2025 no tools</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>HMMT2025 w/tools</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 96k;<br />total tokens = 96k</td>
        <td>32次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>IMO-AnswerBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>3次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>GPQA-Diamond</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>8次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}</td>
      </tr>

      <tr>
        <td>Agentic Search Task</td>
        <td>BrowseComp/ BrowseComp-ZH/Seal-0/ Frames</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 24k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐max steps = 250<br />推荐使用 context management 机制以防止上下文过长，保证足够的工具调用<br />在 system prompt 中带上今天的日期，并让模型在不确定时进行搜索</td>
      </tr>

      <tr>
        <td>Agentic Task</td>
        <td>Tau</td>
        <td>推荐设置：1.0</td>
        <td>>=16k</td>
        <td>4次</td>
        <td>top\_p=0.95</td>
        <td>thinking={`{"type": "enabled"}`}<br />推荐max steps = 100</td>
      </tr>
    </tbody>
  </table>
</div>

对于第三方服务提供商，请参考 Kimi Vendor Verifier (KVV) 选择高精度服务。详情： [https://kimi.com/blog/kimi-vendor-verifier.html](https://kimi.com/blog/kimi-vendor-verifier.html)

**tool use参数兼容性**

当使用工具时，若thinking设置值为`{"type": "enabled"}`，请注意，为了确保模型的性能，会有以下约束：

* 为了避免思考内容与指定的 `tool_choice` 冲突，`tool_choice` 只能使用"auto"和"none"（默认值为"auto"），取任何其他值将会报错；
* 在多步工具调用过程中，您必须在将本轮会话中工具调用时assistant message里的 `reasoning_content` 保留在上下文当中，否则会报错；
* 官方内置的 builtin 的联网搜索 `$web_search` 工具暂时与 Kimi K2.5/K2.6 思考模式不兼容，可以选择先关闭思考模式后使用联网搜索工具 `$web_search`。

您可以参考[如何使用思考模型](/guide/use-kimi-k2-thinking-model)正确使用工具调用。

## K2-Thinking 系列模型基准测试推荐参数

<div style={{ overflowX: 'auto' }}>
  <table style={{ minWidth: '800px' }}>
    <thead>
      <tr>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark 分类</th>
        <th style={{ whiteSpace: 'nowrap' }}>Benchmark</th>
        <th style={{ whiteSpace: 'nowrap' }}>Temperature</th>
        <th style={{ whiteSpace: 'nowrap' }}>Max token 推荐设置</th>
        <th style={{ whiteSpace: 'nowrap' }}>推荐测试次数</th>
        <th style={{ whiteSpace: 'nowrap' }}>其他</th>
      </tr>
    </thead>

    <tbody>
      <tr>
        <td rowSpan="3">Code</td>
        <td>SWE系列</td>
        <td>推荐设置：0.7；<br />可接受的其他设置：1.0</td>
        <td>per step tokens = 16k;<br />total max token = 256k</td>
        <td>5次</td>

        <td />
      </tr>

      <tr>
        <td>Lcb + OJBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 128k</td>
        <td>1次</td>

        <td />
      </tr>

      <tr>
        <td>TerminalBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 128k</td>
        <td>3次</td>

        <td />
      </tr>

      <tr>
        <td rowSpan="9">Reasoning</td>
        <td>AIME2025 no tools</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 96k</td>
        <td>32次</td>

        <td />
      </tr>

      <tr>
        <td>AIME2025 w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 48k;<br />total max tokens = 128k</td>
        <td>16次</td>
        <td>推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>HLE no tools</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>1次</td>

        <td />
      </tr>

      <tr>
        <td>HLE w/ tools</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 128k;<br />per step tokens = 48k</td>
        <td>1次</td>
        <td>推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>HLE heavy</td>
        <td>推荐设置：1.0</td>
        <td>total max tokens = 128k;<br />per step tokens = 48k</td>
        <td>1次</td>
        <td>推荐max steps = 200<br />parallel n=8</td>
      </tr>

      <tr>
        <td>HMMT2025 no tools</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>32次</td>

        <td />
      </tr>

      <tr>
        <td>HMMT2025 w/tools</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 96k;<br />total tokens = 96k</td>
        <td>32次</td>
        <td>推荐 max steps = 120</td>
      </tr>

      <tr>
        <td>IMO-AnswerBench</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>3次</td>

        <td />
      </tr>

      <tr>
        <td>GPQA-Diamond</td>
        <td>推荐设置：1.0</td>
        <td>max tokens = 96k</td>
        <td>8次</td>

        <td />
      </tr>

      <tr>
        <td>Agentic Search Task</td>
        <td>BrowseComp/ BrowseComp-ZH/Seal-0/ Frames</td>
        <td>推荐设置：1.0</td>
        <td>per step tokens = 24k;<br />total max tokens = 256k</td>
        <td>4次</td>
        <td>推荐max steps = 250<br />推荐使用 context management 机制以防止上下文过长，保证足够的工具调用<br />在 system prompt 中带上今天的日期，并让模型在不确定时进行搜索</td>
      </tr>

      <tr>
        <td>Agentic Task</td>
        <td>Tau</td>
        <td>推荐设置：0.0</td>
        <td>>=16k</td>
        <td>4次</td>
        <td>推荐max steps = 100</td>
      </tr>
    </tbody>
  </table>
</div>

## API 推荐参数与注意事项

* 强烈推荐使用官方 API 来做 benchmark 测试，部分第三方 API 可能存在精度偏差
* 使用推荐的模型进行测试：
  * 对于 K2.6：使用 **`kimi-k2.6`** 进行测试
  * 对于 K2.5：使用 **`kimi-k2.5`** 进行测试
  * 对于 K2 系列：使用 **`kimi-k2-thinking-turbo`** 进行快速推理
* **必须设置：** `stream = true`
  * 非流式模式可能会导致随机的连接中断，难以控制
* **当前 API 默认设置：**
  * Kimi K2.6：
    * default max\_tokens = 32768
    * default thinking = `{"type": "enabled", "keep": null}`
    * default temperature = 1.0
    * default top\_p = 0.95
    * default n = 1
    * default presence\_penalty = 0.0
    * default frequency\_penalty = 0.0
  * Kimi K2 Thinking：
    * default temp = 1.0
    * default max token = 64000
  * Kimi K2.5：
    * default max\_tokens = 32768
    * default thinking = `{"type": "enabled"}`
    * default temperature = 1.0
    * default top\_p = 0.95
    * default n = 1
    * default presence\_penalty = 0.0
    * default frequency\_penalty = 0.0
* **超时设置：**
  * 使用 `stream = false` 时，`api.moonshot.cn` 超时时间为 **2 小时**，但某些 ISP 可能会提前终止连接
  * 因此我们建议您设置 `stream = true`
* **并发控制：**
  * 保持较低的并发数以避免速率限制
* **重试逻辑** 是必须的：
  * 处理服务器过载情况
  * 处理因随机服务器问题导致的意外完成原因
  * 处理复杂的网络问题

## FAQ

**Q1:** temperature 取值对不同模型是一致的吗？

**A:** 不同模型系列的 temperature 设置不同：

* k2.6 模型：temperature = 1.0
* k2.5 模型：temperature = 1.0
* k2-thinking 系列模型：推荐使用 temperature=1.0
* k2 其他系列模型：推荐使用 temperature=0.6

**Q2:** 为什么要用 stream=true？

**A:** 长输出可能需要若干分钟。 空闲的TCP连接有可能会被防火墙、负载均衡器和NAT网关等各种中间网络设备终止。 流式传输能保持连接活跃，显著提高可靠性。 生产数据显示，stream=false 的请求失败率远高于 stream=true。

**Q3:** 我应该使用多少并发数？

**A:** 您的API账户有特定的速率限制，参考[充值与限速说明](/pricing/limits)。 建议从较低的并发数开始。 如果遇到限流导致的 429 错误，则说明并发过高。 评估的准确性比速度更重要，请找到一个能让您保持在速率限制内合适的并发水平。

**Q5:** 为什么要重试某些错误？

**A:** 即使使用流式传输，发起请求时仍可能因为网络抖动等问题导致失败。 请对临时性故障（网络问题、服务器过载、速率限制）进行重试，以避免不必要的错误。

**Q6:** 为什么多轮对话和多步骤任务必须带上完整上下文和思考过程？

**A:** 完整上下文能帮助模型在多步推理过程中保持推理的连贯性，特别是在工具调用过程中。 如果省略思考过程，后续回复可能会不一致或质量下降，从而影响性能评估的准确性。

## 联系我们

如果您遇到任何问题，请发送邮件至 [api-service@moonshot.ai](mailto:api-service@moonshot.ai) 获得进一步的技术支持。
