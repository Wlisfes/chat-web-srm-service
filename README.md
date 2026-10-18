# chat-web-srm-service

独立 SRM 微服务，负责供应商、供应商配置与联系人。供应商主数据归 SRM 服务，币种等基础数据归 Finance 服务；SRM 只保存跨服务主键。

## 本地验证

```bash
node scripts/yarn-auth.cjs install --frozen-lockfile --check-files --ignore-scripts
yarn format:check
yarn test
node dist/cli/apply-schema.js
```

根目录 `.env` 只提供 `NODE_ENV`、`PORT` 和 Nacos 连接参数。数据库、Redis index `4` 和 Gateway Feign 地址/超时统一维护在 Nacos 远端 `chat-web-srm-service.yaml`；实际凭据不得提交到仓库。Feign 统一使用 `gateway.feign.url/timeout`，服务凭据使用 `gateway.feign.service_token`。

## API

- `/user/**`：供应商、供应商配置与联系人

供应商没有品牌、客户类型、认证状态字段，也没有短信应用概念。注册来源使用 Skyline 枚举 `CHUNK_SRM_USER_SOURCE`，联系方式类型使用 `CHUNK_SKYLINE_CONTACT_TYPE`。内部服务通过 SRM Feign（`/feign/srm`）查询供应商详情、批量详情和分页列表。

经网关访问时统一增加服务前缀 `/api/srm`。Swagger 地址为 `/api/swagger`，健康检查为 `/health/live` 和 `/health`。

首次部署时，部署引导只从现有 Chat Web 服务的部署环境准备 Nacos 和网络启动参数，不再创建数据库、账号或回写业务配置；`chat-web-srm` 数据库及账号需由外部基础设施预创建。业务容器仍保持 `synchronize: false`，表结构只由 Base Schema 增量 SQL 在服务启动前应用。

## 可观测性

Docker 部署输出结构化单行 JSON 日志，日志包含 `requestId` 并支持通过容器标准输出直接排障，完整命令见 `deploy/RUNBOOK.md`。
