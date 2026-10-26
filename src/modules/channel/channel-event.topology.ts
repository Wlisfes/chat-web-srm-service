import type { ConfirmChannel } from 'amqplib'
import * as constants from '@/modules/channel/channel-event.constants'

/**
 * 声明 SRM 仍负责的通道事件拓扑。选路消费已迁到 chat-web-channel-service。
 * 快照队列参数必须与 Dispatch 声明的完全一致。
 */
export async function setupMessageTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(constants.SMS_EXCHANGE, 'direct', { durable: true })
    await channel.assertExchange(constants.SMS_CHANNEL_EXCHANGE, 'direct', { durable: true })
    await channel.assertQueue(constants.SMS_CHANNEL_EVENT_QUEUE, { durable: true })
    await channel.bindQueue(constants.SMS_CHANNEL_EVENT_QUEUE, constants.SMS_EXCHANGE, constants.SMS_CHANNEL_EVENT_ROUTING_KEY)
    await channel.assertQueue(constants.SMS_CHANNEL_SNAPSHOT_QUEUE, {
        durable: true,
        maxLength: 1,
        overflow: 'drop-head'
    })
    await channel.bindQueue(constants.SMS_CHANNEL_SNAPSHOT_QUEUE, constants.SMS_EXCHANGE, constants.SMS_CHANNEL_SNAPSHOT_ROUTING_KEY)
    // 选路配置变更广播交换机；队列由每个 Channel 实例自己声明。
    await channel.assertExchange(constants.SMS_ROUTE_CONFIG_EXCHANGE, 'fanout', { durable: true })
}
