/** RabbitMQ 虚拟主机；SMS、Channel、SRM、Dispatch 的 Nacos `rabbitmq.vhost` 必须都是这个值。 */
export const SMS_RABBITMQ_VHOST = '/chat-sms'
/** 短信交换机。 */
export const SMS_EXCHANGE = 'chat.sms.exchange'
/** 提交队列：SMS 发布，Channel 消费并选路。 */
export const SMS_SUBMIT_QUEUE = 'chat.sms.submit'
export const SMS_SUBMIT_ROUTING_KEY = 'sms.submit'
/** 通道交换机：选路后按通道别名作为路由键投递到对应通道队列。 */
export const SMS_CHANNEL_EXCHANGE = 'chat.sms.channel.exchange'
/** 通道事件队列：SRM 在通道增删改、启停后发布，Dispatch 据此维护通道副本并订阅或取消通道队列。 */
export const SMS_CHANNEL_EVENT_QUEUE = 'chat.sms.channel.event'
export const SMS_CHANNEL_EVENT_ROUTING_KEY = 'sms.channel.event'
/** 通道快照队列：只保留最新一份全量补发，队列长度限制为 1。 */
export const SMS_CHANNEL_SNAPSHOT_QUEUE = 'chat.sms.channel.snapshot'
export const SMS_CHANNEL_SNAPSHOT_ROUTING_KEY = 'sms.channel.snapshot'

/** 通道队列名称。通道别名全表唯一且创建后不可修改。 */
export function smsChannelQueue(alias: string): string {
    return `chat.sms.channel.${alias}`
}
/** 选路失败的短信进入死信队列，供人工排查。 */
export const SMS_DEAD_EXCHANGE = 'chat.sms.dead.exchange'
export const SMS_SUBMIT_DEAD_QUEUE = 'chat.sms.submit.dead'
export const SMS_SUBMIT_DEAD_ROUTING_KEY = 'sms.submit.dead'

/** SMS 提交的短信。SMS 和 SRM 各声明一份，字段改动时要同步。 */
export interface SmsSubmitPayload {
    messageId: string
    appKeyId: number
    type: string
    countryKeyId: number
    toNumber: string
    content: string
    submittedAt: string
}

/**
 * 通道事件，携带通道完整状态。SRM 和 Dispatch 各声明一份，字段改动时要同步。
 * version 取发布时间毫秒数，Dispatch 只接受比副本更新的版本，重复或乱序投递都不会出错。
 */
/** 全量通道快照。SRM 每次启动只发布一条，队列里旧快照会丢掉。 */
export interface SmsChannelSnapshotPayload {
    version: number
    channels: SmsChannelEventPayload[]
}

export interface SmsChannelEventPayload {
    channelKeyId: number
    alias: string
    queue: string
    type: string
    countryKeyId: number
    status: string
    sendInterval: number
    maxRetry: number
    /** true 表示通道已删除。 */
    deleted: boolean
    version: number
}

/** 选路后投递到通道队列的短信。SRM 和 Dispatch 各声明一份，字段改动时要同步。 */
export interface SmsDispatchPayload extends SmsSubmitPayload {
    routeKeyId: number
    routeAlias: string
    channelKeyId: number
    channelAlias: string
    routedAt: string
}
