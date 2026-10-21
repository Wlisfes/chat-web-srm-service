import {
    TbSrmChannel,
    TbSrmChannelPort,
    TbSrmRoute,
    TbSrmRouteApp,
    TbSrmRouteChannel,
    TbSrmRouteRule,
    TbSrmSimbank,
    TbSrmSimbankMessage,
    TbSrmSimbankPort,
    TbSrmUser,
    TbSrmUserConfig,
    TbSrmUserContact
} from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'

export const SRM_MYSQL_CONFIG_KEY = 'database.chat-web-srm'

export const SRM_MYSQL_ENTITIES = [
    TbSrmUser,
    TbSrmUserConfig,
    TbSrmUserContact,
    TbSrmSimbank,
    TbSrmSimbankPort,
    TbSrmSimbankMessage,
    TbSrmChannel,
    TbSrmChannelPort,
    TbSrmRoute,
    TbSrmRouteRule,
    TbSrmRouteChannel,
    TbSrmRouteApp
]
