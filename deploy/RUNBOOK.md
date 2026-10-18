# SRM 服务运行手册

## Nacos 配置清单

`chat-web-srm-service.yaml` 的相关配置如下。SRM 的 Feign 请求统一经 Gateway 转发：

```yaml
# 服务间凭据由各服务共享；真实值只保存在 Nacos。
gateway:
    feign:
        service_token: '<服务间共享凭据>'
        url: http://chat-web-gateway-service:5000
        timeout: 3000
    principal:
        secret: '<与网关一致的至少32位随机串>'
        maxAgeSeconds: 60
```

SRM 只读取 `gateway.feign.url/timeout`；缺少任一字段时部署校验会中止。所有 Feign 请求都通过 Gateway 的服务路由转发。

部署脚本 `deploy/bootstrap-nacos-config.cjs` 会在切换容器前校验上述字段，缺失时直接中止部署。

## 日志排障

容器日志为单行 JSON，日志中的 `requestId` 可串联网关和业务服务。容器启动后可直接检查标准输出和日志轮转配置：

```bash
docker logs --tail 100 chat-web-srm-service
docker inspect chat-web-srm-service --format '{{json .HostConfig.LogConfig}}'
```

| 项目                   | 基线                                                 |
| ---------------------- | ---------------------------------------------------- |
| 容器                   | `chat-web-srm-service`                               |
| 端口                   | `5070`                                               |
| Nacos Data ID / 服务名 | `chat-web-srm-service.yaml` / `chat-web-srm-service` |
| 数据库                 | `chat-web-srm`，专用账号仅授权 `chat-web-srm.*`      |
| Redis                  | index `4`                                            |
| Feign Gateway          | `http://chat-web-gateway-service:5000`               |
| 部署目录               | `/opt/chat-web-srm-service`                          |
| 网络                   | `chat-web-infrastructure`                            |
| 部署主机               | Home                                                 |
| Runner 标签            | `chat-home-server`                                   |

供应商主表为 `tb_srm_user`，配置子表 `tb_srm_user_config`，联系人子表 `tb_srm_user_contact`。供应商 CRUD 路由为 `/user/**`，服务间入口为 `/feign/srm/user/**`。

Company 部署机已废弃。本仓库只在 `chat-home-server` 安装专用 Self-hosted Runner，标签为 `chat-home-server`；禁止重新创建 Docker Runner 容器。部署目录中的 `.env` 只配置 NODE_ENV、PORT 和 Nacos 连接/注册参数，SRM MySQL、Redis 和 Feign Gateway 地址统一维护在云端 Nacos。

共享包包含 `forRootNacosRuntimeOptions` 后，SRM 在 `AppModule` 中直接调用 `NacosModule.forRoot(forRootNacosRuntimeOptions(process.env))`，由 base 统一把环境变量转换为完整 `NacosRuntimeOptions`。服务器 `.env` 必须显式提供 `NACOS_SERVER`、`NACOS_NAMESPACE`、`NACOS_SERVICE_NAME` 和 `PORT`；其余字段均由共享包提供默认值，只有确需覆盖时才配置。修改启动连接参数后必须重新创建容器，不能再依赖 Nacos 远端配置反向改变启动连接或注册参数。

仓库根目录和服务器 `deploy/.env.example` 均只用于进程启动和 Nacos 建连/注册；SRM 数据库、Redis index `4`、Gateway Feign 地址与超时直接读取远端 `chat-web-srm-service.yaml`。

Nacos 的 Redis 节点使用 `redis.host`、`redis.port`、`redis.database: 4`、`redis.tls` 和 `redis.connectTimeoutMs`；Redis 密码、用户名或 URL 只放在该 Data ID 中，不写入 `.env`。

## 同机 Nacos 注册地址

`chat-home-server` 生产 SRM 与 Gateway 同机同网络。生产 **禁止** 设置 `NACOS_REGISTER_IP=10.66.0.2`。

2026-09-17 P0：强制注册 WireGuard 地址后，`10.66.0.2:5070` 超时，同机 Gateway `/api/srm/health` 无响应，Gateway 部署 `Verify service routes` 等待约 18 分钟失败。Docker Desktop 不会把 `0.0.0.0:5070` 映射到 WG 网卡。正确做法是不设 `NACOS_REGISTER_IP`，注册容器网卡 IP。公网走 Nginx `80/443` → Gateway。跨服务事故主记录见 Gateway `deploy/RUNBOOK.md`。

`deploy/bootstrap-runtime.sh` 不得从 Gateway 或其他服务 `.env` 继承 `NACOS_REGISTER_IP`。只有把本机开发进程提供给远端 Gateway，并且已经从那台 Gateway 证实 `IP:port` 可达时，才允许设置该项。

常用验证：

```bash
docker inspect chat-web-srm-service --format '{{.Config.Image}} {{.State.Health.Status}}'
docker logs --tail 100 chat-web-srm-service
curl -fsS http://127.0.0.1:5070/health/live
curl -fsS http://127.0.0.1:5070/health
```

部署流水线每次发布前都会执行 `deploy/bootstrap-runtime.sh`，幂等创建 `chat-web-srm` 和专用账号，清除该账号的全局及历史数据库权限后只授权 `chat-web-srm.*`。人工恢复环境时也可单独执行该脚本。Schema 升级器只负责再次校验账号没有全局权限、其他数据库权限或角色授权并执行共享包增量 SQL，它本身不会创建数据库。数据库名包含连字符，在 SQL 中手工引用时必须使用反引号。

```sql
SELECT DATABASE(), CURRENT_USER();
SHOW GRANTS FOR CURRENT_USER();
```

部署失败时先检查 Nacos 配置、MySQL 授权、Schema 应用和容器健康。`deploy.sh` 会自动恢复上一镜像；数据库结构和业务数据不自动回滚。
