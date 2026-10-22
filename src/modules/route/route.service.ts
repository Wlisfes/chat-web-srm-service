import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { DataBaseService, EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

/** 参与规则匹配的短信属性。 */
type RouteMessage = { countryKeyId: number; type: Schema.TbSmsAppType; phone: string }

@Injectable()
export class RouteService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly crmFeignClient: feign.FeignClientCrmManager,
        private readonly smsFeignClient: feign.FeignClientSmsManager,
        private readonly configService: ConfigService
    ) {}

    /** 路由静态枚举。 */
    public httpBaseSrmRouteEnums(): RouteDto.RouteEnumsResponseDto {
        return {
            statusOptions: Schema.TbSrmRouteStatusDefinition.options,
            routeTypeOptions: Schema.TbSrmRouteTypeDefinition.options,
            channelStatusOptions: Schema.TbSrmRouteChannelStatusDefinition.options,
            ruleStatusOptions: Schema.TbSrmRouteRuleStatusDefinition.options,
            ruleFieldOptions: Schema.TbSrmRouteRuleFieldDefinition.options,
            ruleOperatorOptions: Schema.TbSrmRouteRuleOperatorDefinition.options,
            typeOptions: Schema.TbSmsAppTypeDefinition.options
        }
    }

    /* ------------------------------ 路由 ------------------------------ */

    /** 新增路由：别名按 SK + 归属人工号 + 路由类型 + 分段序号自动生成；类型创建后不可修改。 */
    public async httpBaseSrmCreateRoute(principal: AuthPrincipal, input: RouteDto.CreateRouteDto): Promise<Schema.TbSrmRoute> {
        const ownerUserUid = input.ownerUserUid ?? principal.uid
        const ownerNumber = await this.resolveOwnerNumber(principal, ownerUserUid)
        return this.repository.manager.transaction(async manager => {
            const alias = await this.generateAlias(manager, ownerNumber, input.type)
            return manager.save(
                manager.create(Schema.TbSrmRoute, {
                    name: input.name.trim(),
                    alias,
                    type: input.type,
                    priority: input.priority ?? 1,
                    status: input.status ?? Schema.TbSrmRouteStatus.ENABLE,
                    ownerUserUid,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑路由：只能修改名称、优先级、状态和备注。 */
    public async httpBaseSrmUpdateRoute(principal: AuthPrincipal, input: RouteDto.UpdateRouteDto): Promise<Schema.TbSrmRoute> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            manager.merge(Schema.TbSrmRoute, route, {
                name: input.name.trim(),
                priority: input.priority ?? route.priority,
                status: input.status,
                remark: input.remark?.trim() || null,
                modifyBy: principal.uid
            })
            return manager.save(route)
        })
    }

    /** 删除路由：仍有短信应用绑定时不能删除；同时删除路由下的规则组和通道配置。 */
    public async httpBaseSrmDeleteRoute(input: RouteDto.RouteKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            if (await manager.existsBy(Schema.TbSrmRouteApp, { routeKeyId: route.keyId })) {
                throw new ConflictException('路由仍有短信应用绑定，请先解绑或改绑')
            }
            await manager.delete(Schema.TbSrmRouteRule, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRouteChannel, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRoute, { keyId: route.keyId })
            return { success: true }
        })
    }

    /** 路由详情。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<Schema.TbSrmRoute> {
        return this.findRouteRequired(this.repository.manager, input.keyId)
    }

    /** 路由分页：按短信类型和优先级排序，附带规则摘要、通道数、覆盖的方向和类型、绑定短信应用数。 */
    public async httpBaseSrmColumnRoute(input: RouteDto.ListRouteDto): Promise<PageResult<RouteDto.RouteColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            const keyword = input.name?.trim()
            if (keyword) qb.andWhere('(t.name LIKE :keyword OR t.alias LIKE :keyword)', { keyword: `%${keyword}%` })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            qb.orderBy('t.type', 'ASC').addOrderBy('t.priority', 'ASC').addOrderBy('t.createTime', 'ASC').addOrderBy('t.keyId', 'ASC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const keyIds = list.map(item => item.keyId)
            const [channels, rules, apps] = keyIds.length
                ? await Promise.all([
                      this.findRouteChannels(keyIds),
                      this.repository.manager.find(Schema.TbSrmRouteRule, {
                          where: { routeKeyId: In(keyIds), status: Schema.TbSrmRouteRuleStatus.ENABLE },
                          order: { sort: 'ASC', keyId: 'ASC' }
                      }),
                      this.repository.manager.find(Schema.TbSrmRouteApp, {
                          select: { routeKeyId: true },
                          where: { routeKeyId: In(keyIds) }
                      })
                  ])
                : [[], [], []]
            const countryNames = await this.findCountryNames(rules.flatMap(rule => this.countryKeyIdsOf(rule)))
            const rows = list.map(item => {
                const own = channels.filter(channel => channel.routeKeyId === item.keyId)
                const ownRules = rules.filter(rule => rule.routeKeyId === item.keyId)
                return {
                    ...item,
                    ruleCount: ownRules.length,
                    ruleSummary: ownRules.map(rule => `(${this.describeRule(rule, countryNames)})`).join(' 或 '),
                    channelCount: own.length,
                    activeChannelCount: own.filter(channel => channel.active).length,
                    coverages: this.groupCoverages(own),
                    appCount: apps.filter(app => app.routeKeyId === item.keyId).length
                }
            })
            await Promise.all([
                feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, ['ownerUserUid', 'createBy', 'modifyBy']),
                feign.fetchAppendSkylineCountryOptions(
                    this.skylineFeignClient,
                    this.configService,
                    rows.flatMap(row => row.coverages),
                    ['countryKeyId']
                )
            ])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /** 路由下拉：按短信类型和优先级排序。 */
    public async httpBaseSrmSelectRoute(): Promise<RouteDto.RouteSelectResponseDto[]> {
        return this.repository.find({
            select: { keyId: true, name: true, alias: true, type: true, priority: true, status: true },
            order: { type: 'ASC', priority: 'ASC', createTime: 'ASC', keyId: 'ASC' }
        })
    }

    /* ------------------------------ 规则组 ------------------------------ */

    /** 新增规则组：校验条件字段、操作符和取值。 */
    public async httpBaseSrmCreateRouteRule(principal: AuthPrincipal, input: RouteDto.CreateRouteRuleDto): Promise<Schema.TbSrmRouteRule> {
        const conditions = await this.normalizeConditions(input.conditions)
        return this.repository.manager.transaction(async manager => {
            await this.findRouteRequired(manager, input.routeKeyId)
            return manager.save(
                manager.create(Schema.TbSrmRouteRule, {
                    routeKeyId: input.routeKeyId,
                    sort: input.sort ?? 0,
                    conditions,
                    status: input.status ?? Schema.TbSrmRouteRuleStatus.ENABLE,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑规则组：可修改排序、条件、状态和备注。 */
    public async httpBaseSrmUpdateRouteRule(principal: AuthPrincipal, input: RouteDto.UpdateRouteRuleDto): Promise<Schema.TbSrmRouteRule> {
        const conditions = await this.normalizeConditions(input.conditions)
        return this.repository.manager.transaction(async manager => {
            const rule = await manager.findOneBy(Schema.TbSrmRouteRule, { keyId: input.keyId })
            if (!rule) throw new NotFoundException('规则组不存在')
            manager.merge(Schema.TbSrmRouteRule, rule, {
                sort: input.sort ?? rule.sort,
                conditions,
                status: input.status,
                remark: input.remark?.trim() || null,
                modifyBy: principal.uid
            })
            return manager.save(rule)
        })
    }

    /** 删除规则组。 */
    public async httpBaseSrmDeleteRouteRule(input: RouteDto.RouteRuleKeyDto): Promise<{ success: boolean }> {
        const result = await this.repository.manager.delete(Schema.TbSrmRouteRule, { keyId: input.keyId })
        if (!result.affected) throw new NotFoundException('规则组不存在')
        return { success: true }
    }

    /** 路由下的规则组：附带中文描述。 */
    public async httpBaseSrmListRouteRule(input: RouteDto.ListRouteRuleDto): Promise<RouteDto.RouteRuleResponseDto[]> {
        const rules = await this.repository.manager.find(Schema.TbSrmRouteRule, {
            where: { routeKeyId: input.routeKeyId },
            order: { sort: 'ASC', keyId: 'ASC' }
        })
        const countryNames = await this.findCountryNames(rules.flatMap(rule => this.countryKeyIdsOf(rule)))
        return rules.map(rule => ({ ...rule, description: this.describeRule(rule, countryNames) }))
    }

    /* ------------------------------ 路由通道 ------------------------------ */

    /** 路由批量加入通道：通道可以是不同方向和类型，同一路由不能重复加入同一通道。 */
    public async httpBaseSrmCreateRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.CreateRouteChannelDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.routeKeyId)
            const channelKeyIds = [...new Set(input.channelKeyIds)]
            const channels = await manager.find(Schema.TbSrmChannel, { where: { keyId: In(channelKeyIds) } })
            if (channels.length !== channelKeyIds.length) throw new NotFoundException('部分通道不存在')
            const existed = await manager.find(Schema.TbSrmRouteChannel, {
                where: { routeKeyId: route.keyId, channelKeyId: In(channelKeyIds) }
            })
            if (existed.length > 0) {
                const aliases = channels.filter(item => existed.some(link => link.channelKeyId === item.keyId)).map(item => item.alias)
                throw new ConflictException(`通道已在该路由中：${aliases.join('、')}`)
            }
            await manager.insert(
                Schema.TbSrmRouteChannel,
                channels.map(channel => ({
                    routeKeyId: route.keyId,
                    channelKeyId: channel.keyId,
                    priority: input.priority ?? 1,
                    weight: input.weight ?? 100,
                    status: input.status ?? Schema.TbSrmRouteChannelStatus.ENABLE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                }))
            )
            return { count: channels.length }
        })
    }

    /** 编辑路由通道的优先级、权重和状态。 */
    public async httpBaseSrmUpdateRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.UpdateRouteChannelDto
    ): Promise<Schema.TbSrmRouteChannel> {
        return this.repository.manager.transaction(async manager => {
            const link = await manager.findOneBy(Schema.TbSrmRouteChannel, { keyId: input.keyId })
            if (!link) throw new NotFoundException('路由通道不存在')
            link.priority = input.priority
            link.weight = input.weight
            link.status = input.status
            link.modifyBy = principal.uid
            return manager.save(link)
        })
    }

    /** 从路由中移除通道。 */
    public async httpBaseSrmDeleteRouteChannel(input: RouteDto.RouteChannelKeyDto): Promise<{ success: boolean }> {
        const result = await this.repository.manager.delete(Schema.TbSrmRouteChannel, { keyId: input.keyId })
        if (!result.affected) throw new NotFoundException('路由通道不存在')
        return { success: true }
    }

    /** 路由通道列表：按方向、类型、优先级排序，附带通道信息、是否可用和分流占比。 */
    public async httpBaseSrmListRouteChannel(input: RouteDto.ListRouteChannelDto): Promise<RouteDto.RouteChannelResponseDto[]> {
        const rows = await this.findRouteChannels([input.routeKeyId])
        await feign.fetchAppendSkylineCountryOptions(
            this.skylineFeignClient,
            this.configService,
            rows.map(row => row.channelOptions).filter((item): item is RouteDto.RouteChannelOptionDto => !!item),
            ['countryKeyId']
        )
        return rows.sort(
            (a, b) =>
                (a.channelOptions?.countryKeyId ?? 0) - (b.channelOptions?.countryKeyId ?? 0) ||
                String(a.channelOptions?.type).localeCompare(String(b.channelOptions?.type)) ||
                a.priority - b.priority ||
                b.weight - a.weight
        )
    }

    /* ------------------------------ 短信应用绑定 ------------------------------ */

    /** 短信应用绑定路由：只能绑定同类型路由；已绑定其他路由的应用改绑到当前路由。 */
    public async httpBaseSrmBindRouteApp(
        principal: AuthPrincipal,
        input: RouteDto.BindRouteAppDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        const appKeyIds = [...new Set(input.appKeyIds)]
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.authorization(), { keyIds: appKeyIds })
        if (apps.length !== appKeyIds.length) throw new NotFoundException('部分短信应用不存在')
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.routeKeyId)
            if (apps.some(app => String(app.type) !== route.type)) throw new BadRequestException('短信应用类型与路由类型不一致')
            const existed = await manager.find(Schema.TbSrmRouteApp, { where: { appKeyId: In(appKeyIds) } })
            for (const app of apps) {
                const binding = existed.find(item => item.appKeyId === app.keyId)
                if (binding) {
                    manager.merge(Schema.TbSrmRouteApp, binding, {
                        routeKeyId: route.keyId,
                        userKeyId: app.userKeyId,
                        modifyBy: principal.uid
                    })
                    await manager.save(binding)
                } else {
                    await manager.insert(Schema.TbSrmRouteApp, {
                        appKeyId: app.keyId,
                        userKeyId: app.userKeyId,
                        routeKeyId: route.keyId,
                        createBy: principal.uid,
                        modifyBy: principal.uid
                    })
                }
            }
            return { count: apps.length }
        })
    }

    /** 解绑短信应用：解绑后应用按优先级使用同类型路由，路由类型不变。 */
    public async httpBaseSrmUnbindRouteApp(input: RouteDto.UnbindRouteAppDto): Promise<RouteDto.RouteCountResponseDto> {
        const result = await this.repository.manager.delete(Schema.TbSrmRouteApp, { keyId: In([...new Set(input.keyIds)]) })
        return { count: result.affected ?? 0 }
    }

    /** 短信应用绑定分页：附带短信应用、客户和路由信息。 */
    public async httpBaseSrmColumnRouteApp(input: RouteDto.ListRouteAppDto): Promise<PageResult<RouteDto.RouteAppColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const repository = this.repository.manager.getRepository(Schema.TbSrmRouteApp)
        return this.database.builder(repository, async qb => {
            if (isNotEmpty(input.routeKeyId)) qb.andWhere('t.routeKeyId = :routeKeyId', { routeKeyId: input.routeKeyId })
            if (isNotEmpty(input.userKeyId)) qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            if (isNotEmpty(input.appKeyId)) qb.andWhere('t.appKeyId = :appKeyId', { appKeyId: input.appKeyId })
            qb.orderBy('t.modifyTime', 'DESC').addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const rows: RouteDto.RouteAppColumnResponseDto[] = list.map(item => ({ ...item }))
            if (rows.length > 0) {
                const authorization = this.authorization()
                const [apps, users, routes] = await Promise.all([
                    this.smsFeignClient.httpBaseSmsColumnAppResolver(authorization, { keyIds: rows.map(item => item.appKeyId) }),
                    this.crmFeignClient.httpBaseCrmColumnUserResolver(authorization, {
                        keyIds: [...new Set(rows.map(item => item.userKeyId))]
                    }),
                    this.repository.find({
                        select: { keyId: true, name: true, alias: true, type: true, priority: true, status: true },
                        where: { keyId: In([...new Set(rows.map(item => item.routeKeyId))]) }
                    })
                ])
                for (const row of rows) {
                    const user = users.find(item => item.keyId === row.userKeyId)
                    row.appKeyIdOptions = apps.find(item => item.keyId === row.appKeyId)
                    row.userKeyIdOptions = { keyId: row.userKeyId, name: user?.name, alias: user?.alias }
                    row.routeKeyIdOptions = routes.find(item => item.keyId === row.routeKeyId)
                }
            }
            await feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, ['createBy', 'modifyBy'])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /* ------------------------------ 选路预览 ------------------------------ */

    /**
     * 选路预览：先试绑定的同类型路由，再按优先级依次试其他启用的同类型路由。
     * 短信满足路由任意一个启用的规则组才进入该路由；进入后筛出方向和类型一致的通道，
     * 取最高可用优先级内的通道按权重分流。没有进入或没有可用通道就尝试下一条路由。
     */
    public async httpBaseSrmRoutePreview(input: RouteDto.RoutePreviewDto): Promise<RouteDto.RoutePreviewResponseDto> {
        const [app] = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.authorization(), { keyIds: [input.appKeyId] })
        if (!app) throw new NotFoundException('短信应用不存在')
        const type = input.type ?? app.type
        const binding = await this.repository.manager.findOneBy(Schema.TbSrmRouteApp, { appKeyId: app.keyId })
        const bound = binding ? await this.repository.findOneBy({ keyId: binding.routeKeyId }) : null
        const routeType = type as unknown as Schema.TbSrmRouteType
        const sameType = await this.repository.find({
            where: { type: routeType, status: Schema.TbSrmRouteStatus.ENABLE },
            order: { priority: 'ASC', createTime: 'ASC', keyId: 'ASC' }
        })
        const boundMatches = bound?.status === Schema.TbSrmRouteStatus.ENABLE && bound.type === routeType ? bound : null
        const routes = [boundMatches, ...sameType.filter(route => route.keyId !== boundMatches?.keyId)].filter(
            (route): route is Schema.TbSrmRoute => !!route
        )
        const base = { type, appOptions: app, steps: [] as RouteDto.RoutePreviewStepDto[] }
        if (routes.length === 0) {
            return { ...base, matched: false, fallback: false, message: '没有可用的路由：没有启用的同类型路由' }
        }
        const routeKeyIds = routes.map(route => route.keyId)
        const [channels, rules] = await Promise.all([
            this.findRouteChannels(routeKeyIds),
            this.repository.manager.find(Schema.TbSrmRouteRule, {
                where: { routeKeyId: In(routeKeyIds), status: Schema.TbSrmRouteRuleStatus.ENABLE },
                order: { sort: 'ASC', keyId: 'ASC' }
            })
        ])
        const countryNames = await this.findCountryNames(rules.flatMap(rule => this.countryKeyIdsOf(rule)))
        const message: RouteMessage = { countryKeyId: input.countryKeyId, type, phone: input.phone?.replace(/^\+/, '').trim() ?? '' }
        for (const route of routes) {
            const rule = rules.find(item => item.routeKeyId === route.keyId && this.matchRule(item, message))
            if (!rule) {
                base.steps.push({ routeOptions: this.pickRoute(route), admitted: false, channels: [], matched: false })
                continue
            }
            const own = channels.filter(
                item =>
                    item.routeKeyId === route.keyId &&
                    item.channelOptions?.countryKeyId === input.countryKeyId &&
                    item.channelOptions?.type === type
            )
            const matched = own.some(item => item.active)
            base.steps.push({
                routeOptions: this.pickRoute(route),
                admitted: true,
                ruleDescription: this.describeRule(rule, countryNames),
                channels: this.markSelected(own),
                matched
            })
            if (matched) {
                const boundHit = route.keyId === boundMatches?.keyId
                return {
                    ...base,
                    matched: true,
                    fallback: !!boundMatches && !boundHit,
                    message: `命中${boundHit ? '绑定' : '同类型'}路由【${route.name}】`
                }
            }
        }
        const admitted = base.steps.some(step => step.admitted)
        return {
            ...base,
            matched: false,
            fallback: !!bound,
            message: admitted
                ? '命中规则的路由都没有该方向和类型的可用通道，短信将进入待分配'
                : '没有路由的规则组匹配这条短信，短信将进入待分配'
        }
    }

    /* ------------------------------ 内部工具 ------------------------------ */

    /** 校验并规范化组内条件：字段与操作符匹配，取值去空去重，方向必须存在、类型必须合法、号码段必须是数字。 */
    private async normalizeConditions(conditions: Schema.TbSrmRouteRuleCondition[]): Promise<Schema.TbSrmRouteRuleCondition[]> {
        const { COUNTRY, TYPE, PREFIX } = Schema.TbSrmRouteRuleField
        const { IN, NOT_IN, PREFIX: STARTS, NOT_PREFIX } = Schema.TbSrmRouteRuleOperator
        const result = conditions.map(condition => {
            const value = [...new Set(condition.value.map(item => String(item).replace(/^\+/, '').trim()).filter(Boolean))]
            if (value.length === 0) throw new BadRequestException('条件取值不能为空')
            const allowed = condition.field === PREFIX ? [STARTS, NOT_PREFIX] : [IN, NOT_IN]
            if (!allowed.includes(condition.operator))
                throw new BadRequestException(`条件字段 ${condition.field} 不支持操作符 ${condition.operator}`)
            if (
                condition.field === TYPE &&
                value.some(item => !Object.values(Schema.TbSmsAppType).includes(item as Schema.TbSmsAppType))
            ) {
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

    /** 判断短信是否命中规则组：组内条件全部满足；没有条件的规则组不命中。 */
    private matchRule(rule: Schema.TbSrmRouteRule, message: RouteMessage): boolean {
        if (!rule.conditions?.length) return false
        return rule.conditions.every(condition => {
            const { field, operator, value } = condition
            if (field === Schema.TbSrmRouteRuleField.PREFIX) {
                const hit = !!message.phone && value.some(item => message.phone.startsWith(item))
                return operator === Schema.TbSrmRouteRuleOperator.PREFIX ? hit : !hit
            }
            const actual = field === Schema.TbSrmRouteRuleField.COUNTRY ? String(message.countryKeyId) : message.type
            const hit = value.includes(actual)
            return operator === Schema.TbSrmRouteRuleOperator.IN ? hit : !hit
        })
    }

    /** 规则组中引用的方向主键。 */
    private countryKeyIdsOf(rule: Schema.TbSrmRouteRule): number[] {
        return (rule.conditions ?? [])
            .filter(item => item.field === Schema.TbSrmRouteRuleField.COUNTRY)
            .flatMap(item => item.value.map(Number))
    }

    /** 批量查询方向中文名。 */
    private async findCountryNames(keyIds: number[]): Promise<Map<number, string>> {
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
    private describeRule(rule: Schema.TbSrmRouteRule, countryNames: Map<number, string>): string {
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

    /** 查询路由下的通道：附带通道信息、可用状态和分流占比（同路由、同方向、同类型、同优先级的可用通道之间计算）。 */
    private async findRouteChannels(routeKeyIds: number[]): Promise<RouteDto.RouteChannelResponseDto[]> {
        if (routeKeyIds.length === 0) return []
        const manager = this.repository.manager
        const links = await manager.find(Schema.TbSrmRouteChannel, {
            where: { routeKeyId: In(routeKeyIds) },
            order: { priority: 'ASC', weight: 'DESC', keyId: 'ASC' }
        })
        if (links.length === 0) return []
        const channelKeyIds = [...new Set(links.map(item => item.channelKeyId))]
        const [channels, ports] = await Promise.all([
            manager.find(Schema.TbSrmChannel, {
                select: { keyId: true, alias: true, type: true, countryKeyId: true, status: true },
                where: { keyId: In(channelKeyIds) }
            }),
            manager.find(Schema.TbSrmChannelPort, {
                select: { channelKeyId: true },
                where: { channelKeyId: In(channelKeyIds), status: Schema.TbSrmChannelPortStatus.ENABLE }
            })
        ])
        const rows = links.map(link => {
            const channel = channels.find(item => item.keyId === link.channelKeyId)
            const enablePortCount = ports.filter(port => port.channelKeyId === link.channelKeyId).length
            return {
                ...link,
                channelOptions: channel ? { ...channel, enablePortCount } : undefined,
                active:
                    link.status === Schema.TbSrmRouteChannelStatus.ENABLE &&
                    channel?.status === Schema.TbSrmChannelStatus.ENABLE &&
                    enablePortCount > 0
            }
        })
        const sameGroup = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
            a.routeKeyId === b.routeKeyId &&
            a.priority === b.priority &&
            a.channelOptions?.countryKeyId === b.channelOptions?.countryKeyId &&
            a.channelOptions?.type === b.channelOptions?.type
        return rows.map(row => {
            const sum = rows.filter(item => item.active && sameGroup(item, row)).reduce((total, item) => total + item.weight, 0)
            return { ...row, ratio: row.active && sum > 0 ? Math.round((row.weight / sum) * 10000) / 100 : 0 }
        })
    }

    /** 按 方向 + 类型 汇总路由覆盖范围。 */
    private groupCoverages(channels: RouteDto.RouteChannelResponseDto[]): RouteDto.RouteCoverageDto[] {
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

    /** 标记本次参与分流的通道：最高可用优先级内的可用通道。 */
    private markSelected(channels: RouteDto.RouteChannelResponseDto[]): RouteDto.RoutePreviewChannelDto[] {
        const priority = Math.min(...channels.filter(item => item.active).map(item => item.priority))
        return channels.map(item => ({ ...item, selected: item.active && item.priority === priority }))
    }

    /** 路由摘要。 */
    private pickRoute(route: Schema.TbSrmRoute): RouteDto.RouteSelectResponseDto {
        return { keyId: route.keyId, name: route.name, alias: route.alias, type: route.type, priority: route.priority, status: route.status }
    }

    /** 校验路由存在。 */
    private async findRouteRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRoute> {
        const route = await manager.findOneBy(Schema.TbSrmRoute, { keyId })
        if (!route) throw new NotFoundException('路由不存在')
        return route
    }

    /** 取归属人工号：当前登录人直接用工号，其他人通过 Skyline 账号还原。 */
    private async resolveOwnerNumber(principal: AuthPrincipal, ownerUserUid: string): Promise<string> {
        if (ownerUserUid === principal.uid) return this.requireEmployeeNumber(principal.number, '当前登录账号')
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [ownerUserUid] })
        if (!user) throw new BadRequestException('归属人不存在')
        return this.requireEmployeeNumber(user.number, '归属人')
    }

    private requireEmployeeNumber(number: string | undefined, label: string): string {
        const userNumber = number?.trim()
        if (!isNotEmpty(userNumber) || !/^[A-Za-z0-9]+$/.test(userNumber)) {
            throw new BadRequestException(`${label}缺少有效工号，无法生成路由别名`)
        }
        return userNumber
    }

    /**
     * 生成路由别名：SK + 归属人工号 + 路由类型 + 4位分段序号。
     * 序号规则与短信应用别名一致：A001-Z999，用完后进入 AA01-ZZ99。同一工号同一类型内自增。
     */
    private async generateAlias(manager: EntityManager, number: string, type: Schema.TbSrmRouteType): Promise<string> {
        const prefix = `SK${number}${type}`
        const routes = await manager.find(Schema.TbSrmRoute, { select: { keyId: true, alias: true, type: true } })
        const maxSequence = routes.reduce((max, route) => {
            if (route.type !== type) return max
            return Math.max(max, this.parseAliasSequence(route.alias, prefix))
        }, 0)
        return `${prefix}${this.formatAliasSequence(maxSequence + 1)}`
    }

    /** 把别名尾部4位序号转换为连续序号；不符合当前规则的历史别名返回 0。 */
    private parseAliasSequence(alias: string, prefix: string): number {
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

    /** 把连续序号格式化为4位别名序号：A001-Z999，之后 AA01-ZZ99。 */
    private formatAliasSequence(sequence: number): string {
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
    private authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
