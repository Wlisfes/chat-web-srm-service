import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { DataBaseService, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { RouteUtilsService } from '@/modules/route/route.utils.service'
import { ConfigService } from '@nestjs/config'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

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
            appStatusOptions: Schema.TbSrmRouteAppStatusDefinition.options,
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

    /** 路由详情：附带绑定的通道和短信应用。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<RouteDto.RouteResolverResponseDto> {
        return await this.routeUtilsService.findRouteRequired(this.repository.manager, input.keyId).then(async route => {
            const [channel, app] = await Promise.all([
                this.routeUtilsService.findRouteChannels([route.keyId]),
                this.routeUtilsService.findRouteApps([route.keyId])
            ])
            return {
                ...route,
                channels: channel.linksOptions.get(route.keyId) ?? [],
                apps: app.linksOptions.get(route.keyId) ?? []
            }
        })
    }

    /** 路由分页：按短信类型和优先级排序，附带绑定的通道和短信应用。 */
    public async httpBaseSrmColumnRoute(input: RouteDto.ListRouteDto): Promise<PageResult<RouteDto.RouteColumnResponseDto>> {
        const { page, size, vague } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            if (isNotEmpty(vague)) {
                qb.andWhere('(t.name LIKE :vague OR t.alias LIKE :vague)', { vague: `%${vague}%` })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            if (isNotEmpty(input.type)) {
                qb.andWhere('t.type = :type', { type: input.type })
            }
            qb.orderBy('t.type', 'ASC')
            qb.addOrderBy('t.priority', 'ASC')
            qb.addOrderBy('t.createTime', 'ASC')
            qb.addOrderBy('t.keyId', 'ASC')
            qb.skip((page - 1) * size).take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                const routeKeyIds = list.map(item => item.keyId)
                const [channel, app] = await Promise.all([
                    this.routeUtilsService.findRouteChannels(routeKeyIds),
                    this.routeUtilsService.findRouteApps(routeKeyIds)
                ])
                const items = list.map(item => ({
                    ...item,
                    channels: channel.linksOptions.get(item.keyId) ?? [],
                    apps: app.linksOptions.get(item.keyId) ?? []
                }))
                return fetchResolver({ page, size, total, list: items })
            })
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
                if (!binding || (binding.priority === item.priority && binding.weight === item.weight && binding.status === item.status))
                    continue
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

    /* ------------------------------ 短信应用绑定 ------------------------------ */

    /**
     * 短信应用绑定路由：以本次提交的应用列表为准。
     * 保留已选并更新状态，移除本路由未选应用；已绑定其他路由的应用改绑到当前路由。
     * 停用的绑定在选路时按未绑定处理。
     */
    public async httpBaseSrmBindRouteApp(
        principal: AuthPrincipal,
        input: RouteDto.BindRouteAppDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        const items = input.apps
        const appKeyIds = items.map(item => item.appKeyId)
        if (new Set(appKeyIds).size !== appKeyIds.length) throw new BadRequestException('不能重复选择相同短信应用')
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.routeUtilsService.authorization(), { keyIds: appKeyIds })
        if (apps.length !== appKeyIds.length) throw new NotFoundException('部分短信应用不存在')
        return this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
            if (apps.some(app => String(app.type) !== route.type)) throw new BadRequestException('短信应用类型与路由类型不一致')
            const current = await manager.find(Schema.TbSrmRouteApp, { where: { routeKeyId: route.keyId } })
            const selected = new Set(appKeyIds)
            const removed = current.filter(item => !selected.has(item.appKeyId))
            if (removed.length > 0) await manager.delete(Schema.TbSrmRouteApp, { keyId: In(removed.map(item => item.keyId)) })
            const submitted = new Map(items.map(item => [item.appKeyId, item]))
            const existed = await manager.find(Schema.TbSrmRouteApp, { where: { appKeyId: In(appKeyIds) } })
            for (const app of apps) {
                const item = submitted.get(app.keyId)
                const binding = existed.find(row => row.appKeyId === app.keyId)
                if (binding) {
                    if (binding.routeKeyId === route.keyId && binding.userKeyId === app.userKeyId && binding.status === item.status)
                        continue
                    manager.merge(Schema.TbSrmRouteApp, binding, {
                        routeKeyId: route.keyId,
                        userKeyId: app.userKeyId,
                        status: item.status,
                        modifyBy: principal.uid
                    })
                    await manager.save(binding)
                } else {
                    await manager.insert(Schema.TbSrmRouteApp, {
                        appKeyId: app.keyId,
                        userKeyId: app.userKeyId,
                        routeKeyId: route.keyId,
                        status: item.status,
                        createBy: principal.uid,
                        modifyBy: principal.uid
                    })
                }
            }
            return { count: apps.length }
        })
    }

    /** 给短信应用绑定补上应用、客户、路由和操作人信息。 */
    private async attachRouteAppOptions(rows: RouteDto.RouteAppColumnResponseDto[]): Promise<RouteDto.RouteAppColumnResponseDto[]> {
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
        return rows
    }
}
