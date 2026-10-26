import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PageResult, fetchResolver, fetchUntiePagination, fetchVagueKeyword, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { DataBaseService, In, InjectRepository, Repository, Like } from '@wlisfes/chat-web-base-schema/database'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { RouteUtilsService } from '@/modules/route/route.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

@Injectable()
export class RouteService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly database: DataBaseService,
        private readonly smsFeignClient: feign.FeignClientSmsManager,
        private readonly routeUtilsService: RouteUtilsService,
        private readonly routeConfigEventService: RouteConfigEventService
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

    /** 新增路由：插入后按 LSK + 主键 + 路由类型生成别名；类型创建后不可修改。 */
    public async httpBaseSrmCreateRoute(principal: AuthPrincipal, input: RouteDto.CreateRouteDto): Promise<Schema.TbSrmRoute> {
        const result = await this.repository.manager.transaction(async manager => {
            const route = await manager.save(
                manager.create(Schema.TbSrmRoute, {
                    name: input.name.trim(),
                    type: input.type,
                    priority: input.priority ?? 1,
                    status: input.status ?? Schema.TbSrmRouteStatus.ENABLE,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
            route.alias = this.routeUtilsService.formatAlias(route.keyId, route.type)
            return manager.save(route)
        })
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('新增路由')
        return result
    }

    /** 编辑路由：只能修改名称、优先级、状态和备注。 */
    public async httpBaseSrmUpdateRoute(principal: AuthPrincipal, input: RouteDto.UpdateRouteDto): Promise<Schema.TbSrmRoute> {
        const result = await this.repository.manager.transaction(async manager => {
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
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('编辑路由')
        return result
    }

    /** 删除路由：仍有短信应用绑定时不能删除；同时删除路由下的规则组和通道配置。 */
    public async httpBaseSrmDeleteRoute(input: RouteDto.RouteKeyDto): Promise<{ success: boolean }> {
        const result = await this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.keyId)
            if (await manager.existsBy(Schema.TbSrmRouteApp, { routeKeyId: route.keyId })) {
                throw new ConflictException('路由仍有短信应用绑定，请先解绑或改绑')
            }
            await manager.delete(Schema.TbSrmRouteRule, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRouteChannel, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRoute, { keyId: route.keyId })
            return { success: true }
        })
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('删除路由')
        return result
    }

    /** 路由详情：附带绑定的通道、短信应用和规则组。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<RouteDto.RouteResolverResponseDto> {
        return await this.routeUtilsService.findRouteRequired(this.repository.manager, input.keyId).then(async route => {
            const [channel, app, rule] = await Promise.all([
                this.routeUtilsService.findRouteChannels([route.keyId]),
                this.routeUtilsService.findRouteApps([route.keyId]),
                this.routeUtilsService.findRouteRules([route.keyId])
            ])
            return {
                ...route,
                channels: channel.linksOptions.get(route.keyId) ?? [],
                apps: app.linksOptions.get(route.keyId) ?? [],
                rules: rule.linksOptions.get(route.keyId) ?? []
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
                const [channel, app, rule] = await Promise.all([
                    this.routeUtilsService.findRouteChannels(routeKeyIds),
                    this.routeUtilsService.findRouteApps(routeKeyIds),
                    this.routeUtilsService.findRouteRules(routeKeyIds)
                ])
                const items = list.map(item => ({
                    ...item,
                    channels: channel.linksOptions.get(item.keyId) ?? [],
                    apps: app.linksOptions.get(item.keyId) ?? [],
                    rules: rule.linksOptions.get(item.keyId) ?? []
                }))
                return fetchResolver({ page, size, total, list: items })
            })
        })
    }

    /** 规则组分页：按路由别名和规则组状态筛选，按路由、规则排序返回，并附带所属路由和方向名称。 */
    public async httpBaseSrmColumnRouteRule(input: RouteDto.ListRouteRuleDto): Promise<PageResult<RouteDto.RouteRuleColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const alias = fetchVagueKeyword(input.alias)
        return this.database.builder(this.repository.manager.getRepository(Schema.TbSrmRouteRule), async qb => {
            qb.innerJoin(Schema.TbSrmRoute, 'route', 'route.keyId = t.routeKeyId')
            if (isNotEmpty(alias)) {
                qb.andWhere('route.alias LIKE :alias', { alias: `%${alias}%` })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            qb.orderBy('t.routeKeyId', 'ASC')
            qb.addOrderBy('t.sort', 'ASC')
            qb.addOrderBy('t.keyId', 'ASC')
            qb.skip((page - 1) * size).take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                const routeKeyIds = [...new Set(list.map(item => item.routeKeyId))]
                const countryKeyIds = list.flatMap(item => this.routeUtilsService.findRuleCountryKeyIds(item))
                const [routes, countryNames] = await Promise.all([
                    this.routeUtilsService.findRoutes(routeKeyIds),
                    this.routeUtilsService.findCountryNames(countryKeyIds)
                ])
                const routeOptions = new Map(routes.map(route => [route.keyId, route]))
                return fetchResolver({
                    page,
                    size,
                    total,
                    list: list.map(item => ({
                        ...item,
                        routeOptions: routeOptions.get(item.routeKeyId),
                        countryOptions: this.routeUtilsService
                            .findRuleCountryKeyIds(item)
                            .filter(keyId => countryNames.has(keyId))
                            .map(keyId => ({ keyId, cnName: countryNames.get(keyId) }))
                    }))
                })
            })
        })
    }

    /**
     * 更新路由规则绑定：以本次提交的规则组列表为准配置规则。
     * 有主键的规则就地更新，没有主键的规则新增，未提交的规则删除；排序按列表下标写入。
     */
    public async httpBaseSrmBindRouteRule(
        principal: AuthPrincipal,
        input: RouteDto.BindRouteRuleDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        const items = input.list ?? []
        const keyIds = items.map(item => item.keyId).filter((keyId): keyId is number => Number.isInteger(keyId))
        if (new Set(keyIds).size !== keyIds.length) {
            throw new BadRequestException('不能重复提交相同规则组')
        }
        const normalized = await Promise.all(
            items.map(async (item, index) => ({
                keyId: item.keyId,
                sort: index,
                conditions: await this.routeUtilsService.normalizeConditions(item.conditions),
                status: item.status,
                remark: item.remark?.trim() || null
            }))
        )

        const result = await this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
            const current = await manager.find(Schema.TbSrmRouteRule, {
                where: { routeKeyId: route.keyId }
            })
            const currentById = new Map(current.map(rule => [rule.keyId, rule]))
            const missing = keyIds.filter(keyId => !currentById.has(keyId))
            if (missing.length > 0) {
                throw new NotFoundException('部分规则组不存在或不属于当前路由')
            }

            const selected = new Set(keyIds)
            const removed = current.filter(rule => !selected.has(rule.keyId))
            if (removed.length > 0) {
                await manager.delete(Schema.TbSrmRouteRule, {
                    keyId: In(removed.map(rule => rule.keyId))
                })
            }

            for (const item of normalized) {
                if (!item.keyId) continue
                const rule = currentById.get(item.keyId)
                if (!rule) continue
                const unchanged =
                    rule.sort === item.sort &&
                    rule.status === item.status &&
                    (rule.remark ?? null) === item.remark &&
                    JSON.stringify(rule.conditions ?? []) === JSON.stringify(item.conditions)
                if (unchanged) continue
                await manager.update(
                    Schema.TbSrmRouteRule,
                    { keyId: rule.keyId },
                    {
                        sort: item.sort,
                        conditions: item.conditions,
                        status: item.status,
                        remark: item.remark,
                        modifyBy: principal.uid
                    }
                )
            }

            const added = normalized.filter(item => !item.keyId)
            if (added.length > 0) {
                await manager.insert(
                    Schema.TbSrmRouteRule,
                    added.map(item => ({
                        routeKeyId: route.keyId,
                        sort: item.sort,
                        conditions: item.conditions,
                        status: item.status,
                        remark: item.remark,
                        createBy: principal.uid,
                        modifyBy: principal.uid
                    }))
                )
            }
            return { count: items.length }
        })
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('更新路由规则组')
        return result
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
        const result = await this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
            const items = input.channels
            const channelKeyIds = items.map(item => item.channelKeyId)
            if (new Set(channelKeyIds).size !== channelKeyIds.length) {
                throw new BadRequestException('不能重复选择相同通道')
            }
            const channels = await manager.find(Schema.TbSrmChannel, {
                where: { keyId: In(channelKeyIds) }
            })
            if (channels.length !== channelKeyIds.length) {
                throw new NotFoundException('部分通道不存在')
            }

            const current = await manager.find(Schema.TbSrmRouteChannel, {
                where: { routeKeyId: route.keyId }
            })
            const selected = new Set(channelKeyIds)
            const submitted = new Map(items.map(item => [item.channelKeyId, item]))
            const kept = current.filter(item => selected.has(item.channelKeyId))
            const existed = new Map(kept.map(item => [item.channelKeyId, item]))
            const removed = current.filter(item => !selected.has(item.channelKeyId))
            if (removed.length > 0) {
                await manager.delete(Schema.TbSrmRouteChannel, {
                    keyId: In(removed.map(item => item.keyId))
                })
            }

            for (const item of items) {
                const binding = existed.get(item.channelKeyId)
                if (!binding) {
                    continue
                }
                const unchanged = binding.priority === item.priority && binding.weight === item.weight && binding.status === item.status
                if (unchanged) {
                    continue
                }
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
                await manager.insert(
                    Schema.TbSrmRouteChannel,
                    added.map(channel => {
                        const item = submitted.get(channel.keyId)
                        return {
                            routeKeyId: route.keyId,
                            channelKeyId: channel.keyId,
                            priority: item.priority,
                            weight: item.weight,
                            status: item.status,
                            createBy: principal.uid,
                            modifyBy: principal.uid
                        }
                    })
                )
            }
            return { count: items.length }
        })
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('更新路由通道')
        return result
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
        if (new Set(appKeyIds).size !== appKeyIds.length) {
            throw new BadRequestException('不能重复选择相同短信应用')
        }
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.routeUtilsService.authorization(), {
            keyIds: appKeyIds
        })
        if (apps.length !== appKeyIds.length) {
            throw new NotFoundException('部分短信应用不存在')
        }

        const result = await this.repository.manager.transaction(async manager => {
            const route = await this.routeUtilsService.findRouteRequired(manager, input.routeKeyId)
            if (apps.some(app => String(app.type) !== route.type)) {
                throw new BadRequestException('短信应用类型与路由类型不一致')
            }

            const current = await manager.find(Schema.TbSrmRouteApp, {
                where: { routeKeyId: route.keyId }
            })
            const selected = new Set(appKeyIds)
            const removed = current.filter(item => !selected.has(item.appKeyId))
            if (removed.length > 0) {
                await manager.delete(Schema.TbSrmRouteApp, {
                    keyId: In(removed.map(item => item.keyId))
                })
            }

            const submitted = new Map(items.map(item => [item.appKeyId, item]))
            const bindings = await manager.find(Schema.TbSrmRouteApp, {
                where: { appKeyId: In(appKeyIds) }
            })
            const existed = new Map(bindings.map(item => [item.appKeyId, item]))
            for (const app of apps) {
                const item = submitted.get(app.keyId)
                const binding = existed.get(app.keyId)
                if (!binding) {
                    continue
                }
                const unchanged =
                    binding.routeKeyId === route.keyId && binding.userKeyId === app.userKeyId && binding.status === item.status
                if (unchanged) {
                    continue
                }
                manager.merge(Schema.TbSrmRouteApp, binding, {
                    routeKeyId: route.keyId,
                    userKeyId: app.userKeyId,
                    status: item.status,
                    modifyBy: principal.uid
                })
                await manager.save(binding)
            }

            const added = apps.filter(app => !existed.has(app.keyId))
            if (added.length > 0) {
                await manager.insert(
                    Schema.TbSrmRouteApp,
                    added.map(app => {
                        const item = submitted.get(app.keyId)
                        return {
                            appKeyId: app.keyId,
                            userKeyId: app.userKeyId,
                            routeKeyId: route.keyId,
                            status: item.status,
                            createBy: principal.uid,
                            modifyBy: principal.uid
                        }
                    })
                )
            }
            return { count: apps.length }
        })
        // 事务提交后广播选路配置变更，Channel 据此刷新选路缓存。
        await this.routeConfigEventService.publish('更新应用绑定')
        return result
    }
}
