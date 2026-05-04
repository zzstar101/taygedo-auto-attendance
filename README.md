# 塔吉多签到

基于 TypeScript 的塔吉多自动签到服务，首选运行在 GitHub Actions。

项目读取 `TAYGEDO_ACCOUNTS` JSON Secret，完成塔吉多 APP 签到和游戏签到后，把更新后的账号信息写回 `updated-accounts.json`，再由 workflow 用 `gh secret set` 覆写回同一个 Secret。

## 功能特点

- 🌟 支持多账号
- 🤖 支持 GitHub Actions 定时执行
- 📱 支持塔吉多 APP 签到和游戏签到
- 🔄 支持失败重试
- 💾 支持将刷新后的 token 写回 GitHub Secret
- 🚀 支持手动触发工作流
- 🔐 支持手动短信登录并写回账号 Secret
- 🔔 支持通知推送

## 快速开始

本项目默认围绕 GitHub Actions 使用。创建仓库后，先配置 Secrets，再启用工作流即可。

### GitHub Actions 部署

1. **Fork 或直接使用本仓库**

   如果你打算自己托管，先把仓库放到你的 GitHub 账号下。

2. **准备 `TAYGEDO_ACCOUNTS`**

   先按照 [准备账号 JSON](#准备账号-json) 获取账号信息，整理成 JSON 数组。

3. **配置 GitHub Secrets**

   进入仓库的 `Settings` -> `Secrets and variables` -> `Actions`，添加下列 Secrets：

   | Secret 名称 | 说明 | 是否必填 |
   |------------|------|---------|
   | `TAYGEDO_ACCOUNTS` | 塔吉多账号 JSON，多个账号放在同一个数组里 | 必填 |
   | `GH_SECRET_UPDATE_TOKEN` | 用于覆盖 `TAYGEDO_ACCOUNTS` 的 GitHub PAT | 必填 |
   | `TAYGEDO_NOTIFICATION_URLS` | 通知 URL，多个 URL 用逗号分隔 | 可选 |
   | `TAYGEDO_MAX_RETRIES` | 最大重试次数，默认 `3` | 可选 |

4. **启用 GitHub Actions**

   进入仓库的 `Actions` 页面，启用工作流。

5. **执行签到**

   工作流会按计划自动执行。你也可以在 `Actions` 页面手动运行 `attendance` 工作流。

### 手动登录工作流

如果你还没有 `TAYGEDO_ACCOUNTS`，或者想重新获取新的 `refreshToken`，可以直接用仓库里的 `login` 工作流。

这个工作流有两个模式：

1. `send-code`
   - 填手机号
   - 发送验证码
   - 产出一个 `deviceId`
2. `login`
   - 填手机号
   - 填短信验证码
   - 填同一个 `deviceId`
   - 填账号 `id` 和 `name`
   - 自动生成或更新 `TAYGEDO_ACCOUNTS`

第一次用时建议这样走：

1. 在 `Actions` 里手动运行 `login`
2. `mode` 选 `send-code`
3. 填 `phone`
4. 记录运行日志里的 `deviceId`
5. 收到短信后，再手动运行一次 `login`
6. `mode` 选 `login`
7. 把 `phone`、`captcha`、`device_id`、`account_id`、`account_name` 填好
8. 跑完后，工作流会把账号写进 `TAYGEDO_ACCOUNTS`

### 工作流说明

- **attendance** (`.github/workflows/attendance.yml`)
  - 每天定时执行一次
  - 支持手动触发
  - 签到结束后，会在至少一个账号刷新成功时更新 `TAYGEDO_ACCOUNTS`

## 配置说明

### 准备账号 JSON

项目提供了一个 `login` 手动工作流，可以先发验证码，再把登录结果写回 `TAYGEDO_ACCOUNTS`。如果你已经拿到了登录结果，也可以直接手动整理成账号 JSON。

推荐方式：

1. 先使用能登录塔吉多账号的现有工具或脚本完成手机号验证码登录。
2. 从登录结果里取出：
   - `uid`
   - `deviceId`
   - `refreshToken`
3. 如果已经知道绑定角色，也可以填入：
   - `roleId`
   - `roleName`
4. 把一个或多个账号整理成 JSON 数组，写入 `TAYGEDO_ACCOUNTS`。

目前可参考的获取来源：

- `nonebot-plugin-taygedo-helper` 的登录流程会保存 `uid`、`device_id`、`refresh_token`、`role_id`、`role_name`
- 如果你已经通过其他方式抓到塔吉多登录后的刷新凭证，也可以直接手动整理成下面的 JSON

一个账号的最小可用格式：

```json
[
  {
    "id": "main",
    "name": "主账号",
    "uid": "123456",
    "deviceId": "abcdef1234567890",
    "refreshToken": "your-refresh-token"
  }
]
```

多个账号直接继续往数组里追加：

```json
[
  {
    "id": "main",
    "name": "主账号",
    "uid": "123456",
    "deviceId": "abcdef1234567890",
    "refreshToken": "your-main-refresh-token"
  },
  {
    "id": "alt",
    "name": "小号",
    "uid": "654321",
    "deviceId": "abcdef9876543210",
    "refreshToken": "your-alt-refresh-token"
  }
]
```

如果你填了 `roleId` 和 `roleName`，项目会优先保留并在签到时尝试更新；如果没填，项目会在运行时通过塔吉多接口获取绑定角色。

### 1. 塔吉多账号

将账号配置为 JSON 数组，写入 `TAYGEDO_ACCOUNTS`。

```json
[
  {
    "id": "main",
    "name": "主账号",
    "uid": "123456",
    "deviceId": "abcdef1234567890",
    "refreshToken": "your-refresh-token",
    "roleId": "optional-role-id",
    "roleName": "optional-role-name"
  }
]
```

字段说明：

- `id`：账号唯一标识
- `name`：通知中显示的名称
- `uid`：塔吉多用户 ID
- `deviceId`：登录设备 ID
- `refreshToken`：当前可用的刷新凭证
- `roleId`：可选，游戏角色 ID
- `roleName`：可选，游戏角色名

`TAYGEDO_ACCOUNTS` 必须是合法 JSON，不要写成 JavaScript 对象，也不要在末尾多加逗号。复制到 GitHub Secret 时可以保留换行。

### 2. GitHub PAT

`GH_SECRET_UPDATE_TOKEN` 需要具备更新当前仓库 Secrets 的权限。工作流会使用它执行：

```bash
gh secret set TAYGEDO_ACCOUNTS < updated-accounts.json
```

配置步骤：

1. 在 GitHub 打开 `Settings` -> `Developer settings` -> `Personal access tokens`。
2. 创建一个细粒度 PAT。
3. Repository access 选择这个仓库。
4. 权限中给 Actions secrets 相关能力授予可写权限。
5. 复制生成的 token。
6. 回到本仓库 `Settings` -> `Secrets and variables` -> `Actions`。
7. 新建 Secret：`GH_SECRET_UPDATE_TOKEN`，值填刚生成的 PAT。

不要把 `GH_SECRET_UPDATE_TOKEN` 写进 `TAYGEDO_ACCOUNTS`，也不要提交到仓库。

### 3. 通知配置

`TAYGEDO_NOTIFICATION_URLS` 可填写一个或多个通知地址，多个地址使用英文逗号分隔。

### 4. 手动登录输入

`login` 工作流需要这些输入：

| 输入名 | 说明 |
|------|------|
| `mode` | `send-code` 或 `login` |
| `phone` | 手机号 |
| `captcha` | 短信验证码，仅 `login` 需要 |
| `device_id` | 两次登录要复用同一个 `deviceId` |
| `account_id` | 账号唯一标识，仅 `login` 需要 |
| `account_name` | 账号显示名，仅 `login` 需要 |

### 5. 重试配置

`TAYGEDO_MAX_RETRIES` 控制单个账号的最大重试次数，默认值为 `3`。

## Secret 配置示例

在 GitHub Actions Secrets 中最终至少要有这两项：

```text
TAYGEDO_ACCOUNTS=[
  {
    "id": "main",
    "name": "主账号",
    "uid": "123456",
    "deviceId": "abcdef1234567890",
    "refreshToken": "your-refresh-token"
  }
]

GH_SECRET_UPDATE_TOKEN=github_pat_xxx
```

可选项：

```text
TAYGEDO_MAX_RETRIES=3
TAYGEDO_NOTIFICATION_URLS=https://example.com/webhook
```

## 本地运行

```bash
pnpm install
TAYGEDO_ACCOUNTS='[{"id":"main","name":"主账号","uid":"123456","deviceId":"device","refreshToken":"token"}]' pnpm action
```

运行后会生成 `updated-accounts.json`。

## 注意事项

- `TAYGEDO_ACCOUNTS` 中的 token 会在每次签到后更新，请保持 Secret 可写。
- 如果所有账号都刷新失败，工作流不会覆盖 `TAYGEDO_ACCOUNTS`。
- 建议 `GH_SECRET_UPDATE_TOKEN` 使用细粒度 PAT，并只赋予目标仓库所需权限。
- 如果 `TAYGEDO_ACCOUNTS` 填错 JSON 格式，工作流会在解析配置时失败。
- 如果 `refreshToken` 失效，需要重新登录塔吉多账号并替换对应账号的 `refreshToken`。
