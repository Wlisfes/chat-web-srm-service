import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { RabbitmqService } from '@wlisfes/chat-web-base-schema/rabbitmq'
import { ConfigService } from '@nestjs/config'
import * as constants from '@/modules/channel/channel-event.constants'
import * as Schema from '@wlisfes/chat-web-base-schema'

type ChannelSnapshot = Pick<Schema.TbSrmChannel, 'keyId' | 'alias' | 'type' | 'countryKeyId' | 'status' | 'sendInterval' | 'maxRetry'>

/**
 * 通道事件发布。
 *
 * - 通道新增、修改、启停、删除提交数据库后调用 publish，Dispatch 据此维护自己的通道副本；
 * - 启动时发布一份全量快照。快照队列只保留最新一条，SRM 多次启动不会堆积补发事件；
 * - 发布失败只记录日志，不影响已经提交的数据库操作，靠下次启动补发修复。
 */
@Injectable()
export class ChannelEventService implements OnApplicationBootstrap {
    private readonly logger = new Logger(ChannelEventService.name)

    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        private readonly rabbitmqService: RabbitmqService,
        private readonly configService: ConfigService
    ) {}

    public async onApplicationBootstrap(): Promise<void> {
        if (this.configService.get('NODE_ENV') !== 'development') {
            await this.republish()
        }
    }

    /** 发布一份全量快照，不往事件队列逐条补发。 */
    public async republish(): Promise<void> {
        try {
            await this.publishSnapshot()
        } catch (error) {
            this.logger.error(`通道快照发布失败：${error instanceof Error ? error.message : String(error)}`)
        }
    }

    private async publishSnapshot(): Promise<void> {
        const channels = await this.repository.find({
            select: ['keyId', 'alias', 'type', 'countryKeyId', 'status', 'sendInterval', 'maxRetry']
        })
        const version = Date.now()
        for (const channel of channels) {
            const queue = constants.smsChannelQueue(channel.alias)
            await this.rabbitmqService.assertQueue(queue, { durable: true })
            await this.rabbitmqService.bindQueue(queue, constants.SMS_CHANNEL_EXCHANGE, channel.alias)
        }
        const snapshot: constants.SmsChannelSnapshotPayload = {
            version,
            channels: channels.map(channel => this.eventOf(channel, false, version))
        }
        await this.rabbitmqService.publish(constants.SMS_EXCHANGE, constants.SMS_CHANNEL_SNAPSHOT_ROUTING_KEY, snapshot)
        return this.logger.log(`发布通道快照[${channels.length}]：${channels.map(item => item.alias).join('、')}`)
    }

    /** 发布通道当前状态；deleted 为 true 表示通道已删除。 */
    public async publish(channel: ChannelSnapshot, deleted = false): Promise<void> {
        try {
            const queue = constants.smsChannelQueue(channel.alias)
            // 先声明通道队列并绑定，保证选路投递时队列已存在。删除的通道不再有新消息（删除前必须停用并移出路由），队列保留供排查。
            if (!deleted) {
                await this.rabbitmqService.assertQueue(queue, { durable: true })
                await this.rabbitmqService.bindQueue(queue, constants.SMS_CHANNEL_EXCHANGE, channel.alias)
            }
            const event = this.eventOf(channel, deleted, Date.now())
            await this.rabbitmqService.publish(constants.SMS_EXCHANGE, constants.SMS_CHANNEL_EVENT_ROUTING_KEY, event)
        } catch (error) {
            this.logger.error(`通道事件发布失败：alias=${channel.alias}，原因=${error instanceof Error ? error.message : String(error)}`)
        }
    }

    private eventOf(channel: ChannelSnapshot, deleted: boolean, version: number): constants.SmsChannelEventPayload {
        return {
            channelKeyId: channel.keyId,
            alias: channel.alias,
            queue: constants.smsChannelQueue(channel.alias),
            type: channel.type,
            countryKeyId: channel.countryKeyId,
            status: channel.status,
            sendInterval: channel.sendInterval,
            maxRetry: channel.maxRetry,
            deleted,
            version
        }
    }
}
