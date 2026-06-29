# 充值与限速

> 来源：https://platform.kimi.com/docs/pricing/limits.md

## 速率限制

基于账户的累计充值金额进行速率限制，具体如下：

| 用户等级 | 累计充值金额 | 并发 | RPM | TPM | TPD |
|---------|-----------|-----|-----|-----|-----|
| Tier0 | ¥ 0 | 1 | 3 | 500,000 | 1,500,000 |
| Tier1 | ¥ 50 | 50 | 200 | 2,000,000 | Unlimited |
| Tier2 | ¥ 100 | 100 | 500 | 3,000,000 | Unlimited |
| Tier3 | ¥ 500 | 200 | 5,000 | 3,000,000 | Unlimited |
| Tier4 | ¥ 5,000 | 400 | 5,000 | 4,000,000 | Unlimited |
| Tier5 | ¥ 20,000 | 1,000 | 10,000 | 5,000,000 | Unlimited |

如有更高需求请填写[提升速率表单](https://platform.kimi.com/contact-sales)。

## 限速概念解释

- **并发**：同一时间内最多处理的请求数
- **RPM**：requests per minute，一分钟内最多的请求数
- **TPM**：tokens per minute，一分钟内最多的 token 数
- **TPD**：tokens per day，一天内最多的 token 数

## 限速原因

- 防止滥用或误用API
- 确保公平访问
- 管理集群总负载

## 特别说明

- 将全力保障正常使用，但集群负载达上限时可能临时限流
- 代金券不计入累计充值总额
