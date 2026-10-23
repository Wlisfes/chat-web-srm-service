import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { DataBaseService, EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'
import { RouteUtilsService, type RouteMessage } from '@/modules/route/route.utils.service'

@Injectable()
export class RouteService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly crmFeignClient: feign.FeignClientCrmManager,
        private readonly smsFeignClient: feign.FeignClientSmsManager,
        private readonly configService: ConfigService,
        private readonly routeUtilsService: RouteUtilsService
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

    /** 新增路由：别名按 LSK + 归属人工号 + 路由类型 + 分段序号自动生成；类型创建后不可修改。 */
    public async httpBaseSrmCreateRoute(principal: AuthPrincipal, input: RouteDto.CreateRouteDto): Promise<Schema.TbSrmRoute> {
        const ownerUserUid = input.ownerUserUid ?? principal.uid
        const ownerNumber = await this.routeUtilsService.resolveOwnerNumber(principal, ownerUserUid)
        return this.repository.manager.transaction(async manager => {
            const alias = await this.routeUtilsService.generateAlias(manager, ownerNumber, input.type)
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
            const route = await this.routeUtilsService.findRouteRequired(manager, input.keyId)
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
            const route = await this.routeUtilsService.findRouteRequired(manager, input.keyId)
            if (await manager.existsBy(Schema.TbSrmRouteApp, { routeKeyId: route.keyId })) {
                throw new ConflictException('路由仍有短信应用绑定，请先解绑或改绑')
            }
            await manager.delete(Schema.TbSrmRouteRule, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRouteChannel, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRoute, { keyId: route.keyId })
            return { success: true }
        })
    }

    /** 路由详情：附带绑定的通道列表（含通道信息、可用状态和同优先级分流占比）。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<RouteDto.RouteResolverResponseDto> {
        const route = await this.routeUtilsService.findRouteRequired(this.repository.manager, input.keyId)
        const channels = await this.routeUtilsService.findRouteChannels([route.keyId])

        return { ...route, channels }
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
                      this.routeUtilsService.findRouteChannels(keyIds),
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
            const countryNames = await this.routeUtilsService.findCountryNames(
                rules.flatMap(rule => this.routeUtilsService.countryKeyIdsOf(rule))
            )
            const rows = list.map(item => {
                const own = channels.filter(channel => channel.routeKeyId === item.keyId)
                const ownRules = rules.filter(rule => rule.routeKeyId === item.keyId)
                return {
                    ...item,
                    ruleCount: ownRules.length,
                    ruleSummary: ownRules.map(rule => `(${this.routeUtilsService.describeRule(rule, countryNames)})`).join(' 或 '),
                    channelCount: own.length,
                    activeChannelCount: own.filter(channel => channel.active).length,
                    coverages: this.routeUtilsService.groupCoverages(own),
                    appCount: apps.filter(app => app.routeKeyId === item.keyId).length
                }
            })
            await Promise.all([
                feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, [
                    'ownerUserUid',
                    'createBy',
                    'modifyBy'
                ]),
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
        const conditions = await this.routeUtilsService.normalizeConditions(input.conditions)
        return this.repository.manager.transaction(async manager => {
            await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
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
        const conditions = await this.routeUtilsService.normalizeConditions(input.conditions)
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
        const countryNames = await this.routeUtilsService.findCountryNames(
            rules.flatMap(rule => this.routeUtilsService.countryKeyIdsOf(rule))
        )
        return rules.map(rule => ({ ...rule, description: this.routeUtilsService.describeRule(rule, countryNames) }))
    }

    /* ------------------------------ 路由通道 ------------------------------ */

    /**
     * 更新路由通道绑定：以本次提交的通道集合为准，保留已选通道、移除未选通道、新增新选通道。
     * 已选通道按本次提交更新优先级、权重和状态。通道可以是不同方向和类型。
     */
    public async httpBaseSrmBindRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.BindRouteChannelDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
            const items = input.channels
            const channelKeyIds = items.map(item => item.channelKeyId)
            if (new Set(channelKeyIds).size !== channelKeyIds.length) throw new BadRequestException('不能重复选择相同通道')
            const channels = await manager.find(Schema.TbSrmChannel, { where: { keyId: In(channelKeyIds) } })
            if (channels.length !== channelKeyIds.length) throw new NotFoundException('部分通道不存在')
            const current = await manager.find(Schema.TbSrmRouteChannel, { where: { routeKeyId: route.keyId } })
            const selected = new Set(channelKeyIds)
            const removed = current.filter(item => !selected.has(item.channelKeyId))
            if (removed.length > 0) await manager.delete(Schema.TbSrmRouteChannel, { keyId: In(removed.map(item => item.keyId)) })
            const existed = new Map(current.filter(item => selected.has(item.channelKeyId)).map(item => [item.channelKeyId, item]))
            for (const item of items) {
                const binding = existed.get(item.channelKeyId)
                if (!binding || (binding.priority === item.priority && binding.weight === item.weight && binding.status === item.status)) continue
                await manager.update(
                    Schema.TbSrmRouteChannel,
                    { keyId: binding.keyId },
                    {
                        priority: item.priority,
                        weight: item.weight,
                        status: item.status,
                        modifyBy: principal.uid
                    }
                )
            }
            const added = channels.filter(channel => !existed.has(channel.keyId))
            if (added.length > 0) {
                const submitted = new Map(items.map(item => [item.channelKeyId, item]))
                await manager.insert(
                    Schema.TbSrmRouteChannel,
                    added.map(channel => ({
                        routeKeyId: route.keyId,
                        channelKeyId: channel.keyId,
                        priority: submitted.get(channel.keyId).priority,
                        weight: submitted.get(channel.keyId).weight,
                        status: submitted.get(channel.keyId).status,
                        createBy: principal.uid,
                        modifyBy: principal.uid
                    }))
                )
            }
            return { count: items.length }
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
        const rows = await this.routeUtilsService.findRouteChannels([input.routeKeyId])
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
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.routeUtilsService.authorization(), { keyIds: appKeyIds })
        if (apps.length !== appKeyIds.length) throw new NotFoundException('部分短信应用不存在')
        return this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
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
                const authorization = this.routeUtilsService.authorization()
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
        const [app] = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.routeUtilsService.authorization(), {
            keyIds: [input.appKeyId]
        })
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
            this.routeUtilsService.findRouteChannels(routeKeyIds),
            this.repository.manager.find(Schema.TbSrmRouteRule, {
                where: { routeKeyId: In(routeKeyIds), status: Schema.TbSrmRouteRuleStatus.ENABLE },
                order: { sort: 'ASC', keyId: 'ASC' }
            })
        ])
        const countryNames = await this.routeUtilsService.findCountryNames(
            rules.flatMap(rule => this.routeUtilsService.countryKeyIdsOf(rule))
        )
        const message: RouteMessage = { countryKeyId: input.countryKeyId, type, phone: input.phone?.replace(/^\+/, '').trim() ?? '' }
        for (const route of routes) {
            const rule = rules.find(item => item.routeKeyId === route.keyId && this.routeUtilsService.matchRule(item, message))
            if (!rule) {
                base.steps.push({ routeOptions: this.routeUtilsService.pickRoute(route), admitted: false, channels: [], matched: false })
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
                routeOptions: this.routeUtilsService.pickRoute(route),
                admitted: true,
                ruleDescription: this.routeUtilsService.describeRule(rule, countryNames),
                channels: this.routeUtilsService.markSelected(own),
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
}
