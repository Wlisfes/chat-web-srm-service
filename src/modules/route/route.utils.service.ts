import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { type LinkIndex } from '@wlisfes/chat-web-base-schema/utils'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'
import { ConfigService } from '@nestjs/config'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class RouteUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService,
        private readonly channelUtilsService: ChannelUtilsService,
        private readonly smsFeignClient: feign.FeignClientSmsManager
    ) {}

    /** 校验并规范化组内条件：字段与操作符匹配，取值去空去重，方向必须存在、类型必须合法、号码段必须是数字。 */
    public async normalizeConditions(conditions: Schema.TbSrmRouteRuleCondition[]): Promise<Schema.TbSrmRouteRuleCondition[]> {
        const { COUNTRY, TYPE, PREFIX } = Schema.TbSrmRouteRuleField
        const { IN, NOT_IN, PREFIX: STARTS, NOT_PREFIX } = Schema.TbSrmRouteRuleOperator
        const result = conditions.map(condition => {
            const value = [...new Set(condition.value.map(item => String(item).replace(/^\+/, '').trim()).filter(Boolean))]
            if (value.length === 0) throw new BadRequestException('条件取值不能为空')
            const allowed = condition.field === PREFIX ? [STARTS, NOT_PREFIX] : [IN, NOT_IN]
            if (!allowed.includes(condition.operator))
                throw new BadRequestException(`条件字段 ${condition.field} 不支持操作符 ${condition.operator}`)
            if (condition.field === TYPE && value.some(item => !Object.values(Schema.TbSmsAppType).includes(item as Schema.TbSmsAppType))) {
                throw new BadRequestException('短信类型取值只能是 MRKT、NTFY、SOTP')
            }
            if (condition.field === PREFIX && value.some(item => !/^\d{1,15}$/.test(item))) {
                throw new BadRequestException('号码段只能是1-15位数字')
            }
            if (condition.field === COUNTRY && value.some(item => !/^\d+$/.test(item)))
                throw new BadRequestException('方向取值必须是国家/地区主键')
            return { field: condition.field, operator: condition.operator, value }
        })
        const countryKeyIds = [...new Set(result.filter(item => item.field === COUNTRY).flatMap(item => item.value.map(Number)))]
        if (countryKeyIds.length > 0) {
            const found = await this.findCountryNames(countryKeyIds)
            const missing = countryKeyIds.filter(keyId => !found.has(keyId))
            if (missing.length > 0) throw new BadRequestException(`方向不存在：${missing.join('、')}`)
        }
        return result
    }
    /** 批量查询方向中文名，按 100 个一批调用 Skyline Feign。 */
    public async findCountryNames(keyIds: number[]): Promise<Map<number, string>> {
        const unique = [...new Set(keyIds)].filter(keyId => Number.isInteger(keyId) && keyId > 0)
        const names = new Map<number, string>()
        for (let index = 0; index < unique.length; index += 100) {
            const countries = await this.skylineFeignClient.httpBaseSkylineColumnCountryResolver(this.authorization(), {
                keyIds: unique.slice(index, index + 100)
            })
            for (const country of countries) names.set(country.keyId, country.cnName)
        }
        return names
    }

    /** 查询路由下绑定的规则 */
    public async findRouteRules(routeKeyIds: number[]): Promise<LinkIndex<Schema.TbSrmRouteRule>> {
        const linksOptions = new Map<number, Array<Schema.TbSrmRouteRule>>()
        if (routeKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmRouteRule, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { sort: 'ASC', keyId: 'ASC' },
            select: ['keyId', 'routeKeyId', 'sort', 'status', 'remark', 'conditions']
        })
        for (const routeKeyId of routeKeyIds) {
            linksOptions.set(
                routeKeyId,
                links.filter(item => item.routeKeyId === routeKeyId)
            )
        }
        return { links, linksOptions }
    }

    /** 查询路由下绑定的应用：通过 SMS Feign 附带短信应用摘要。 */
    public async findRouteApps(routeKeyIds: number[]): Promise<LinkIndex<Schema.TbSrmRouteApp>> {
        const linksOptions = new Map<number, Array<Schema.TbSrmRouteApp>>()
        if (routeKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmRouteApp, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { keyId: 'ASC' },
            select: ['appKeyId', 'keyId', 'routeKeyId', 'userKeyId', 'status']
        })
        if (links.length === 0) {
            return { links: [], linksOptions }
        }
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.authorization(), {
            keyIds: [...new Set(links.map(item => item.appKeyId))]
        })
        const appOptions = new Map(apps.map(item => [item.keyId, item]))
        for (const routeKeyId of routeKeyIds) {
            const items = links.filter(item => item.routeKeyId === routeKeyId)
            linksOptions.set(
                routeKeyId,
                items.map(item => ({ ...item, appOptions: appOptions.get(item.appKeyId) }))
            )
        }
        return { links, linksOptions }
    }

    /** 查询路由下的通道：附带通道信息、可用状态和分流占比（同路由、同方向、同类型、同优先级的可用通道之间计算）。 */
    public async findRouteChannels(routeKeyIds: number[]): Promise<LinkIndex<Schema.TbSrmRouteChannel>> {
        const linksOptions = new Map<number, Array<Schema.TbSrmRouteChannel>>()
        if (routeKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmRouteChannel, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { priority: 'ASC', weight: 'DESC', keyId: 'ASC' },
            select: ['keyId', 'routeKeyId', 'channelKeyId', 'priority', 'weight', 'status']
        })
        if (links.length === 0) {
            return { links: [], linksOptions }
        }
        const channels = await this.channelUtilsService.findChannels(links.map(e => e.channelKeyId))
        for (const routeKeyId of routeKeyIds) {
            const items = links.filter(item => item.routeKeyId === routeKeyId)
            linksOptions.set(
                routeKeyId,
                items.map(e => ({ ...e, channelOptions: channels.linksOptions.get(e.channelKeyId) }))
            )
        }
        return { links, linksOptions }
    }

    /** 校验路由存在。 */
    public async findRouteRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRoute> {
        const route = await manager.findOneBy(Schema.TbSrmRoute, { keyId })
        if (!route) throw new NotFoundException('路由不存在')
        return route
    }

    /** 生成路由别名：LSK + 主键 + 路由类型，例如 LSK1002001-MRKT。 */
    public formatAlias(keyId: number, type: Schema.TbSrmRouteType): string {
        return `LSK${keyId}-${type}`
    }

    /** 服务间凭据。 */
    public authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
