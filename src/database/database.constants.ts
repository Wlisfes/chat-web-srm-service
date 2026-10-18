import { TbSrmUser, TbSrmUserConfig, TbSrmUserContact } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'

export const SRM_MYSQL_CONFIG_KEY = 'database.chat-web-srm'

export const SRM_MYSQL_ENTITIES = [TbSrmUser, TbSrmUserConfig, TbSrmUserContact]
