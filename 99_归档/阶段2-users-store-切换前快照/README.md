# 阶段2 users-store 切换前快照（users.json）

## 状态：已移出 git 跟踪（2026-09-01，S3B3）

本目录的 `users.json`（S1「users.json 归档移出跟踪」产物，2026-08-25）经 S3B3
实取确认：**该文件在归档后仍被 git 跟踪**，内含 **40 条 bcrypt 密码散列**
（`passwordHash` 字段，`$2b$10$` 形态，首条即 username=mjlkevin / role=admin）。

原「移出跟踪」意图被归档动作抵消（移动后重新跟踪），已于 2026-09-01 执行
`git rm --cached` 真正移出跟踪：

- **本机文件保留**（路径：`/Users/kevin/AI/Workload-evaluation-system/99_归档/阶段2-users-store-切换前快照/users.json`），
  用户仍可核对，勿删除。
- `.gitignore` 已补该路径，防止误重新跟踪。
- 移出 commit 与台账登记见《阶段2-存储切换-实施计划.md》§10 S3B3 批次行。

## 历史改写裁定（架构侧，2026-09-01）

该文件在历史提交中仍可达（40 条 bcrypt 散列在仓库历史里）。架构侧已裁定
**不做 filter-repo 历史重写**：私有仓库 + bcrypt 非明文（不可逆），重写代价与
风险高于收益。**用户已被提示自行更换登录密码**。

- 历史中的散列无法直接还原密码（bcrypt 单向散列），但存在离线撞库风险；
  凡在旧版系统中使用过密码的用户，建议在切换 PG 后的新系统里更换密码。

## 相关

- 扫描防护：`scripts/check-tracked-secrets.js`（S3B3 起扫描面为全仓 git 跟踪文件，
  该路径已在 `.gitignore` 内，不再进入扫描面）。
