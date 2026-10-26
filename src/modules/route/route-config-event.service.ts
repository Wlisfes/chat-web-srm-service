import { Injectable, Logger } from '@nestjs/common'
import { RabbitmqService } from '@wlisfes/chat-web-base-schema/rabbitmq'
import * as constants from '@/modules/channel/channel-event.constants'

/**
 * 选路配置变更广播。
 *
 * - 路由、规则组、路由通道、应用绑定、通道变更提交数据库后调用 publish；
 * - 消息只带版本号，Channel 收到后整体重新加载选路缓存；
 * - 发布失败只记录日志，不影响已提交的数据库操作，由 Channel 的定时校对兜底。
 */
@Injectable()
export class RouteConfigEventService {
    private readonly logger = new Logger(RouteConfigEventService.name)

    constructor(private readonly rabbitmqService: RabbitmqService) {}

    public async publish(reason: string): Promise<void> {
        const payload: constants.RouteConfigChangedPayload = { version: Date.now() }
        try {
            await this.rabbitmqService.publish(constants.SMS_ROUTE_CONFIG_EXCHANGE, '', payload, { persistent: false })
            this.logger.log(`发布选路配置变更：${reason}，version=${payload.version}`)
        } catch (error) {
            this.logger.error(`选路配置变更发布失败：${reason}，原因=${error instanceof Error ? error.message : String(error)}`)
        }
    }
}
