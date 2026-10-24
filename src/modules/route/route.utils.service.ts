import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

/** 按路由主键索引的绑定记录。 */
export type RouteLinkIndex<T> = {
    links: T[]
    linksOptions: Map<number, T[]>
}

@Injectable()
export class RouteUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
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
    /** 规则组中引用的方向主键。 */
    public countryKeyIdsOf(rule: Schema.TbSrmRouteRule): number[] {
        return (rule.conditions ?? [])
            .filter(item => item.field === Schema.TbSrmRouteRuleField.COUNTRY)
            .flatMap(item => item.value.map(Number))
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

    /** 规则组描述：条件之间用“且”连接。 */
    public describeRule(rule: Schema.TbSrmRouteRule, countryNames: Map<number, string>): string {
        const fieldLabel = Object.fromEntries(Schema.TbSrmRouteRuleFieldDefinition.options.map(item => [item.value, item.label]))
        const operatorLabel = Object.fromEntries(Schema.TbSrmRouteRuleOperatorDefinition.options.map(item => [item.value, item.label]))
        return (rule.conditions ?? [])
            .map(condition => {
                const values = condition.value.map(item =>
                    condition.field === Schema.TbSrmRouteRuleField.COUNTRY ? (countryNames.get(Number(item)) ?? item) : item
                )
                return `${fieldLabel[condition.field]} ${operatorLabel[condition.operator]} ${values.join('/')}`
            })
            .join(' 且 ')
    }

    /** 查询路由下绑定的应用 */
    public async findRouteApps(routeKeyIds: number[]): Promise<RouteLinkIndex<Schema.TbSrmRouteApp>> {
        const linksOptions = new Map<number, Array<Schema.TbSrmRouteApp>>()
        if (routeKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmRouteApp, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { keyId: 'ASC' },
            select: ['appKeyId', 'keyId', 'routeKeyId', 'userKeyId', 'status']
        })
        for (const routeKeyId of routeKeyIds) {
            linksOptions.set(
                routeKeyId,
                links.filter(item => item.routeKeyId === routeKeyId)
            )
        }
        return { links, linksOptions }
    }

    /** 查询路由下的通道：附带通道信息、可用状态和分流占比（同路由、同方向、同类型、同优先级的可用通道之间计算）。 */
    public async findRouteChannels(routeKeyIds: number[]): Promise<RouteLinkIndex<Schema.TbSrmRouteChannel>> {
        const linksOptions = new Map<number, Array<Schema.TbSrmRouteChannel>>()
        if (routeKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmRouteChannel, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { priority: 'ASC', weight: 'DESC', keyId: 'ASC' },
            select: ['keyId', 'routeKeyId', 'channelKeyId', 'priority', 'weight', 'status']
        })
        for (const routeKeyId of routeKeyIds) {
            linksOptions.set(
                routeKeyId,
                links.filter(item => item.routeKeyId === routeKeyId)
            )
        }
        return { links, linksOptions }
    }

    /** 按 方向 + 类型 汇总路由覆盖范围。 */
    public groupCoverages(channels: RouteDto.RouteChannelResponseDto[]): RouteDto.RouteCoverageDto[] {
        const groups = new Map<string, RouteDto.RouteCoverageDto>()
        for (const item of channels) {
            if (!item.channelOptions) continue
            const { countryKeyId, type } = item.channelOptions
            const key = `${countryKeyId}:${type}`
            const group = groups.get(key) ?? { countryKeyId, type, channelCount: 0, activeChannelCount: 0 }
            group.channelCount += 1
            if (item.active) group.activeChannelCount += 1
            groups.set(key, group)
        }
        return [...groups.values()].sort((a, b) => a.countryKeyId - b.countryKeyId || a.type.localeCompare(b.type))
    }

    /** 校验路由存在。 */
    public async findRouteRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRoute> {
        const route = await manager.findOneBy(Schema.TbSrmRoute, { keyId })
        if (!route) throw new NotFoundException('路由不存在')
        return route
    }

    /** 取归属人工号：当前登录人直接用工号，其他人通过 Skyline 账号还原。 */
    public async resolveOwnerNumber(principal: AuthPrincipal, ownerUserUid: string): Promise<string> {
        if (ownerUserUid === principal.uid) return this.requireEmployeeNumber(principal.number, '当前登录账号')
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [ownerUserUid] })
        if (!user) throw new BadRequestException('归属人不存在')
        return this.requireEmployeeNumber(user.number, '归属人')
    }

    /** 校验账号工号可用于生成路由别名。 */
    public requireEmployeeNumber(number: string | undefined, label: string): string {
        const userNumber = number?.trim()
        if (!isNotEmpty(userNumber) || !/^[A-Za-z0-9]+$/.test(userNumber)) {
            throw new BadRequestException(`${label}缺少有效工号，无法生成路由别名`)
        }
        return userNumber
    }

    /**
     * 生成路由别名：LSK + 归属人工号 + 路由类型 + 分段序号，例如 LSK1233-MRKT-A001。
     * 序号规则与短信应用别名一致：A001-Z999，用完后进入 AA01-ZZ99。同一工号同一类型内自增。
     */
    public async generateAlias(manager: EntityManager, number: string, type: Schema.TbSrmRouteType): Promise<string> {
        const prefix = `LSK${number}-${type}-`
        const routes = await manager.find(Schema.TbSrmRoute, { select: { keyId: true, alias: true, type: true } })
        const maxSequence = routes.reduce((max, route) => {
            if (route.type !== type) return max
            return Math.max(max, this.parseAliasSequence(route.alias, prefix))
        }, 0)
        return `${prefix}${this.formatAliasSequence(maxSequence + 1)}`
    }

    /** 把别名尾部序号转换为连续序号；不符合当前规则的历史别名返回 0。 */
    public parseAliasSequence(alias: string, prefix: string): number {
        const code = alias?.startsWith(prefix) ? alias.slice(prefix.length) : ''
        const single = /^([A-Z])(\d{3})$/.exec(code)
        if (single && Number(single[2]) > 0) return (single[1].charCodeAt(0) - 65) * 999 + Number(single[2])
        const double = /^([A-Z])([A-Z])(\d{2})$/.exec(code)
        if (double && Number(double[3]) > 0) {
            const group = (double[1].charCodeAt(0) - 65) * 26 + double[2].charCodeAt(0) - 65
            return 26 * 999 + group * 99 + Number(double[3])
        }
        return 0
    }

    /** 把连续序号格式化为分段序号：A001-Z999，之后 AA01-ZZ99。 */
    public formatAliasSequence(sequence: number): string {
        const singleCapacity = 26 * 999
        const capacity = singleCapacity + 26 * 26 * 99
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > capacity) {
            throw new ConflictException('当前工号该类型路由别名序号已用完')
        }
        if (sequence <= singleCapacity) {
            const index = sequence - 1
            return `${String.fromCharCode(65 + Math.floor(index / 999))}${String((index % 999) + 1).padStart(3, '0')}`
        }
        const index = sequence - singleCapacity - 1
        const group = Math.floor(index / 99)
        return `${String.fromCharCode(65 + Math.floor(group / 26), 65 + (group % 26))}${String((index % 99) + 1).padStart(2, '0')}`
    }

    /** 服务间凭据。 */
    public authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
