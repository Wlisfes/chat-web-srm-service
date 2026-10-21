import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { DataBaseService, EntityManager, In, InjectRepository, Not, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

/** 规则匹配候选：附带方向国际区号，便于按号码前缀判断。 */
type RuleCandidate = Schema.TbSrmRouteRule & { countryKeyIdOptions?: feign.SkylineCountrySummary }

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
            ruleStatusOptions: Schema.TbSrmRouteRuleStatusDefinition.options,
            channelStatusOptions: Schema.TbSrmRouteChannelStatusDefinition.options,
            typeOptions: Schema.TbSrmChannelTypeDefinition.options
        }
    }

    /* ------------------------------ 路由 ------------------------------ */

    /** 新增路由：别名非空时全表唯一。新增路由一律为通用路由，绑定短信应用后自动变为定向路由。 */
    public async httpBaseSrmCreateRoute(principal: AuthPrincipal, input: RouteDto.CreateRouteDto): Promise<Schema.TbSrmRoute> {
        return this.repository.manager.transaction(async manager => {
            const alias = input.alias?.trim() || null
            await this.assertAliasAvailable(manager, alias)
            const status = input.status ?? Schema.TbSrmRouteStatus.ENABLE
            return manager.save(
                manager.create(Schema.TbSrmRoute, {
                    name: input.name.trim(),
                    alias,
                    type: Schema.TbSrmRouteType.GENERAL,
                    status,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑路由：可修改名称、别名、状态和备注；路由类型由短信应用绑定关系自动维护。 */
    public async httpBaseSrmUpdateRoute(principal: AuthPrincipal, input: RouteDto.UpdateRouteDto): Promise<Schema.TbSrmRoute> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            const alias = input.alias?.trim() || null
            await this.assertAliasAvailable(manager, alias, route.keyId)

            manager.merge(Schema.TbSrmRoute, route, {
                name: input.name.trim(),
                alias,
                status: input.status,
                remark: input.remark?.trim() || null,
                modifyBy: principal.uid
            })
            return manager.save(route)
        })
    }

    /** 删除路由：仍有短信应用绑定的定向路由不能删除；同时删除路由下的规则和规则通道。 */
    public async httpBaseSrmDeleteRoute(input: RouteDto.RouteKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            if (await manager.existsBy(Schema.TbSrmRouteApp, { routeKeyId: route.keyId })) {
                throw new ConflictException('路由仍有短信应用绑定，请先解绑或改绑')
            }
            const rules = await manager.find(Schema.TbSrmRouteRule, { select: { keyId: true }, where: { routeKeyId: route.keyId } })
            if (rules.length > 0) {
                await manager.delete(Schema.TbSrmRouteChannel, { ruleKeyId: In(rules.map(item => item.keyId)) })
                await manager.delete(Schema.TbSrmRouteRule, { routeKeyId: route.keyId })
            }
            await manager.delete(Schema.TbSrmRoute, { keyId: route.keyId })
            return { success: true }
        })
    }

    /** 路由详情。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<Schema.TbSrmRoute> {
        return this.findRouteRequired(this.repository.manager, input.keyId)
    }

    /** 路由分页：通用路由排在最前，附带规则数和绑定短信应用数。 */
    public async httpBaseSrmColumnRoute(input: RouteDto.ListRouteDto): Promise<PageResult<RouteDto.RouteColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            const keyword = input.name?.trim()
            if (keyword) qb.andWhere('(t.name LIKE :keyword OR t.alias LIKE :keyword)', { keyword: `%${keyword}%` })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            qb.orderBy('t.type', 'ASC').addOrderBy('t.createTime', 'DESC').addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const keyIds = list.map(item => item.keyId)
            const [rules, apps] = keyIds.length
                ? await Promise.all([
                      this.repository.manager.find(Schema.TbSrmRouteRule, {
                          select: { routeKeyId: true },
                          where: { routeKeyId: In(keyIds) }
                      }),
                      this.repository.manager.find(Schema.TbSrmRouteApp, {
                          select: { routeKeyId: true },
                          where: { routeKeyId: In(keyIds) }
                      })
                  ])
                : [[], []]
            const rows = list.map(item => ({
                ...item,
                ruleCount: rules.filter(rule => rule.routeKeyId === item.keyId).length,
                appCount: apps.filter(app => app.routeKeyId === item.keyId).length
            }))
            await feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, ['createBy', 'modifyBy'])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /** 路由下拉：通用路由排在最前。 */
    public async httpBaseSrmSelectRoute(): Promise<RouteDto.RouteSelectResponseDto[]> {
        return this.repository.find({
            select: { keyId: true, name: true, alias: true, type: true, status: true },
            order: { type: 'ASC', createTime: 'DESC', keyId: 'DESC' }
        })
    }

    /* ------------------------------ 路由规则 ------------------------------ */

    /** 新增路由规则：同一路由内 方向 + 类型 + 运营商 + 号码段 唯一；号码段必须以方向国际区号开头。 */
    public async httpBaseSrmCreateRouteRule(principal: AuthPrincipal, input: RouteDto.CreateRouteRuleDto): Promise<Schema.TbSrmRouteRule> {
        const country = await this.findCountryRequired(input.countryKeyId)
        const mnc = input.mnc?.trim() ?? ''
        const prefix = input.prefix?.trim() ?? ''
        if (prefix && !prefix.startsWith(country.code)) {
            throw new BadRequestException(`号码段必须以方向国际区号 ${country.code} 开头`)
        }
        return this.repository.manager.transaction(async manager => {
            await this.findRouteRequired(manager, input.routeKeyId)
            const where = { routeKeyId: input.routeKeyId, countryKeyId: input.countryKeyId, type: input.type, mnc, prefix }
            if (await manager.existsBy(Schema.TbSrmRouteRule, where)) throw new ConflictException('该路由已存在相同匹配条件的规则')
            return manager.save(
                manager.create(Schema.TbSrmRouteRule, {
                    ...where,
                    status: input.status ?? Schema.TbSrmRouteRuleStatus.ENABLE,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑路由规则：匹配条件不可修改，只能调整状态和备注。 */
    public async httpBaseSrmUpdateRouteRule(principal: AuthPrincipal, input: RouteDto.UpdateRouteRuleDto): Promise<Schema.TbSrmRouteRule> {
        return this.repository.manager.transaction(async manager => {
            const rule = await this.findRuleRequired(manager, input.keyId)
            rule.status = input.status
            rule.remark = input.remark?.trim() || null
            rule.modifyBy = principal.uid
            return manager.save(rule)
        })
    }

    /** 删除路由规则：同时删除规则下的通道配置。 */
    public async httpBaseSrmDeleteRouteRule(input: RouteDto.RouteRuleKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const rule = await this.findRuleRequired(manager, input.keyId)
            await manager.delete(Schema.TbSrmRouteChannel, { ruleKeyId: rule.keyId })
            await manager.delete(Schema.TbSrmRouteRule, { keyId: rule.keyId })
            return { success: true }
        })
    }

    /** 路由规则分页：路由可选，不传时查询全部路由的规则；附带所属路由、方向、通道数和可用通道数。 */
    public async httpBaseSrmColumnRouteRule(input: RouteDto.ListRouteRuleDto): Promise<PageResult<RouteDto.RouteRuleColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const repository = this.repository.manager.getRepository(Schema.TbSrmRouteRule)
        return this.database.builder(repository, async qb => {
            if (isNotEmpty(input.routeKeyId)) qb.andWhere('t.routeKeyId = :routeKeyId', { routeKeyId: input.routeKeyId })
            if (isNotEmpty(input.prefix?.trim())) qb.andWhere('t.prefix LIKE :prefix', { prefix: `%${input.prefix?.trim()}%` })
            if (isNotEmpty(input.countryKeyId)) qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            qb.orderBy('t.routeKeyId', 'ASC')
                .addOrderBy('t.countryKeyId', 'ASC')
                .addOrderBy('t.type', 'ASC')
                .addOrderBy('t.prefix', 'ASC')
                .addOrderBy('t.mnc', 'ASC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const routeKeyIds = [...new Set(list.map(item => item.routeKeyId))]
            const [channels, routes] = await Promise.all([
                this.findRuleChannels(list.map(item => item.keyId)),
                routeKeyIds.length
                    ? this.repository.find({
                          select: { keyId: true, name: true, alias: true, type: true, status: true },
                          where: { keyId: In(routeKeyIds) }
                      })
                    : Promise.resolve([] as Schema.TbSrmRoute[])
            ])
            const rows = list.map(item => {
                const own = channels.filter(channel => channel.ruleKeyId === item.keyId)
                const route = routes.find(row => row.keyId === item.routeKeyId)
                return {
                    ...item,
                    routeKeyIdOptions: route ? this.pickRoute(route) : undefined,
                    channelCount: own.length,
                    activeChannelCount: own.filter(channel => channel.active).length
                }
            })
            await Promise.all([
                feign.fetchAppendSkylineCountryOptions(this.skylineFeignClient, this.configService, rows, ['countryKeyId']),
                feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, ['createBy', 'modifyBy'])
            ])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /* ------------------------------ 规则通道 ------------------------------ */

    /** 规则加入通道：通道方向和类型必须与规则一致，同一规则不能重复加入同一通道。 */
    public async httpBaseSrmCreateRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.CreateRouteChannelDto
    ): Promise<Schema.TbSrmRouteChannel> {
        return this.repository.manager.transaction(async manager => {
            const rule = await this.findRuleRequired(manager, input.ruleKeyId)
            const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId: input.channelKeyId })
            if (!channel) throw new NotFoundException('通道不存在')
            if (channel.countryKeyId !== rule.countryKeyId || channel.type !== rule.type) {
                throw new BadRequestException(`通道【${channel.alias}】的方向或类型与规则不一致`)
            }
            if (await manager.existsBy(Schema.TbSrmRouteChannel, { ruleKeyId: rule.keyId, channelKeyId: channel.keyId })) {
                throw new ConflictException(`通道【${channel.alias}】已在该规则中`)
            }
            return manager.save(
                manager.create(Schema.TbSrmRouteChannel, {
                    ruleKeyId: rule.keyId,
                    channelKeyId: channel.keyId,
                    priority: input.priority ?? 1,
                    weight: input.weight ?? 100,
                    status: input.status ?? Schema.TbSrmRouteChannelStatus.ENABLE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑规则通道的优先级、权重和状态。 */
    public async httpBaseSrmUpdateRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.UpdateRouteChannelDto
    ): Promise<Schema.TbSrmRouteChannel> {
        return this.repository.manager.transaction(async manager => {
            const link = await manager.findOneBy(Schema.TbSrmRouteChannel, { keyId: input.keyId })
            if (!link) throw new NotFoundException('规则通道不存在')
            link.priority = input.priority
            link.weight = input.weight
            link.status = input.status
            link.modifyBy = principal.uid
            return manager.save(link)
        })
    }

    /** 从规则中移除通道。 */
    public async httpBaseSrmDeleteRouteChannel(input: RouteDto.RouteChannelKeyDto): Promise<{ success: boolean }> {
        const result = await this.repository.manager.delete(Schema.TbSrmRouteChannel, { keyId: input.keyId })
        if (!result.affected) throw new NotFoundException('规则通道不存在')
        return { success: true }
    }

    /** 规则通道列表：按优先级、权重排序，附带通道信息、是否可用和同优先级分流占比。 */
    public async httpBaseSrmListRouteChannel(input: RouteDto.ListRouteChannelDto): Promise<RouteDto.RouteChannelResponseDto[]> {
        return this.findRuleChannels([input.ruleKeyId])
    }

    /* ------------------------------ 短信应用绑定 ------------------------------ */

    /** 短信应用绑定路由：应用必须存在；已绑定其他路由的应用改绑到当前路由。当前路由变为定向路由，改绑后没有应用的原路由变回通用路由。 */
    public async httpBaseSrmBindRouteApp(
        principal: AuthPrincipal,
        input: RouteDto.BindRouteAppDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        const appKeyIds = [...new Set(input.appKeyIds)]
        const apps = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.authorization(), { keyIds: appKeyIds })
        if (apps.length !== appKeyIds.length) throw new NotFoundException('部分短信应用不存在')
        return this.repository.manager.transaction(async manager => {
            await this.findRouteRequired(manager, input.routeKeyId)
            const existed = await manager.find(Schema.TbSrmRouteApp, { where: { appKeyId: In(appKeyIds) } })
            const previousRouteKeyIds = existed.map(item => item.routeKeyId)
            for (const app of apps) {
                const binding = existed.find(item => item.appKeyId === app.keyId)
                if (binding) {
                    manager.merge(Schema.TbSrmRouteApp, binding, {
                        routeKeyId: input.routeKeyId,
                        userKeyId: app.userKeyId,
                        modifyBy: principal.uid
                    })
                    await manager.save(binding)
                } else {
                    await manager.insert(Schema.TbSrmRouteApp, {
                        appKeyId: app.keyId,
                        userKeyId: app.userKeyId,
                        routeKeyId: input.routeKeyId,
                        createBy: principal.uid,
                        modifyBy: principal.uid
                    })
                }
            }
            await this.syncRouteType(manager, [input.routeKeyId, ...previousRouteKeyIds], principal.uid)
            return { count: apps.length }
        })
    }

    /** 解绑短信应用：解绑后应用走通用路由；路由没有绑定应用后变回通用路由。 */
    public async httpBaseSrmUnbindRouteApp(
        principal: AuthPrincipal,
        input: RouteDto.UnbindRouteAppDto
    ): Promise<RouteDto.RouteCountResponseDto> {
        return this.repository.manager.transaction(async manager => {
            const keyIds = [...new Set(input.keyIds)]
            const bindings = await manager.find(Schema.TbSrmRouteApp, { select: { routeKeyId: true }, where: { keyId: In(keyIds) } })
            const result = await manager.delete(Schema.TbSrmRouteApp, { keyId: In(keyIds) })
            await this.syncRouteType(
                manager,
                bindings.map(item => item.routeKeyId),
                principal.uid
            )
            return { count: result.affected ?? 0 }
        })
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
                const userKeyIds = [...new Set(rows.map(item => item.userKeyId))]
                const [apps, users, routes] = await Promise.all([
                    this.smsFeignClient.httpBaseSmsColumnAppResolver(authorization, { keyIds: rows.map(item => item.appKeyId) }),
                    this.crmFeignClient.httpBaseCrmColumnUserResolver(authorization, { keyIds: userKeyIds }),
                    this.repository.find({
                        select: { keyId: true, name: true, alias: true, type: true, status: true },
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
     * 选路预览：先查短信应用绑定的定向路由，再按创建时间从早到晚依次查启用的通用路由。
     * 同一路由内按 号码段 > 运营商 > 方向 从细到粗匹配，跳过没有可用通道的规则；
     * 命中规则后取最高可用优先级内的通道按权重分流。
     */
    public async httpBaseSrmRoutePreview(input: RouteDto.RoutePreviewDto): Promise<RouteDto.RoutePreviewResponseDto> {
        const phone = input.phone.replace(/^(\+|00)/, '')
        const mnc = input.mnc?.trim() ?? ''
        const [app] = await this.smsFeignClient.httpBaseSmsColumnAppResolver(this.authorization(), { keyIds: [input.appKeyId] })
        if (!app) throw new NotFoundException('短信应用不存在')
        const type = input.type ?? (app.type as unknown as Schema.TbSrmChannelType)
        const base = { type, phone, appOptions: app, channels: [] as RouteDto.RoutePreviewChannelDto[] }

        const binding = await this.repository.manager.findOneBy(Schema.TbSrmRouteApp, { appKeyId: app.keyId })
        const bound = binding ? await this.repository.findOneBy({ keyId: binding.routeKeyId }) : null
        const generals = await this.repository.find({
            where: { type: Schema.TbSrmRouteType.GENERAL, status: Schema.TbSrmRouteStatus.ENABLE },
            order: { createTime: 'ASC', keyId: 'ASC' }
        })
        const routes = [bound, ...generals].filter(
            (route, index, list): route is Schema.TbSrmRoute =>
                !!route && route.status === Schema.TbSrmRouteStatus.ENABLE && list.findIndex(item => item?.keyId === route.keyId) === index
        )
        if (routes.length === 0)
            return { ...base, matched: false, fallback: false, message: '没有可用的路由：应用未绑定定向路由且没有启用的通用路由' }

        let firstMatch: { route: Schema.TbSrmRoute; rule: RuleCandidate; channels: RouteDto.RouteChannelResponseDto[] } | undefined
        for (const route of routes) {
            const candidates = await this.findMatchedRules(route.keyId, type, phone, mnc)
            const channels = await this.findRuleChannels(candidates.map(item => item.keyId))
            for (const rule of candidates) {
                const own = channels.filter(item => item.ruleKeyId === rule.keyId)
                firstMatch ??= { route, rule, channels: own }
                if (own.some(item => item.active)) {
                    return {
                        ...base,
                        matched: true,
                        fallback: route.keyId !== bound?.keyId,
                        message: `命中路由【${route.name}】规则：${this.describeRule(rule)}`,
                        routeOptions: this.pickRoute(route),
                        ruleOptions: rule,
                        channels: this.markSelected(own)
                    }
                }
            }
        }
        if (firstMatch) {
            return {
                ...base,
                matched: false,
                fallback: firstMatch.route.keyId !== bound?.keyId,
                message: `命中路由【${firstMatch.route.name}】规则：${this.describeRule(firstMatch.rule)}，但没有可用通道`,
                routeOptions: this.pickRoute(firstMatch.route),
                ruleOptions: firstMatch.rule,
                channels: this.markSelected(firstMatch.channels)
            }
        }
        return { ...base, matched: false, fallback: false, message: '定向路由和通用路由都没有匹配该号码和短信类型的启用规则' }
    }

    /* ------------------------------ 内部工具 ------------------------------ */

    /** 查询路由内与号码匹配的启用规则，并按 号码段长度 > 指定运营商 > 国际区号长度 从细到粗排序。 */
    private async findMatchedRules(
        routeKeyId: number,
        type: Schema.TbSrmChannelType,
        phone: string,
        mnc: string
    ): Promise<RuleCandidate[]> {
        const rules: RuleCandidate[] = await this.repository.manager.find(Schema.TbSrmRouteRule, {
            where: { routeKeyId, type, status: Schema.TbSrmRouteRuleStatus.ENABLE }
        })
        if (rules.length === 0) return []
        await feign.fetchAppendSkylineCountryOptions(this.skylineFeignClient, this.configService, rules, ['countryKeyId'])
        return rules
            .filter(rule => {
                const code = rule.countryKeyIdOptions?.code
                if (!code || !phone.startsWith(code)) return false
                if (rule.prefix && !phone.startsWith(rule.prefix)) return false
                return !rule.mnc || rule.mnc === mnc
            })
            .sort(
                (a, b) =>
                    b.prefix.length - a.prefix.length ||
                    Number(!!b.mnc) - Number(!!a.mnc) ||
                    (b.countryKeyIdOptions?.code.length ?? 0) - (a.countryKeyIdOptions?.code.length ?? 0)
            )
    }

    /** 查询规则下的通道：附带通道信息、可用状态和同规则同优先级内的分流占比。 */
    private async findRuleChannels(ruleKeyIds: number[]): Promise<RouteDto.RouteChannelResponseDto[]> {
        if (ruleKeyIds.length === 0) return []
        const manager = this.repository.manager
        const links = await manager.find(Schema.TbSrmRouteChannel, {
            where: { ruleKeyId: In(ruleKeyIds) },
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
        return rows.map(row => {
            const sum = rows
                .filter(item => item.active && item.ruleKeyId === row.ruleKeyId && item.priority === row.priority)
                .reduce((total, item) => total + item.weight, 0)
            return { ...row, ratio: row.active && sum > 0 ? Math.round((row.weight / sum) * 10000) / 100 : 0 }
        })
    }

    /** 标记本次参与分流的通道：最高可用优先级内的可用通道。 */
    private markSelected(channels: RouteDto.RouteChannelResponseDto[]): RouteDto.RoutePreviewChannelDto[] {
        const priority = Math.min(...channels.filter(item => item.active).map(item => item.priority))
        return channels.map(item => ({ ...item, selected: item.active && item.priority === priority }))
    }

    /** 规则描述：国际区号 / 类型 / 运营商 / 号码段。 */
    private describeRule(rule: RuleCandidate): string {
        const country = rule.countryKeyIdOptions
        const parts = [country ? `${country.code} ${country.cnName}` : String(rule.countryKeyId), rule.type]
        if (rule.mnc) parts.push(`MNC ${rule.mnc}`)
        if (rule.prefix) parts.push(`号码段 ${rule.prefix}`)
        return parts.join(' / ')
    }

    /** 路由摘要。 */
    private pickRoute(route: Schema.TbSrmRoute): RouteDto.RouteSelectResponseDto {
        return { keyId: route.keyId, name: route.name, alias: route.alias, type: route.type, status: route.status }
    }

    /** 按绑定关系同步路由类型：有绑定应用为定向路由，没有则为通用路由。 */
    private async syncRouteType(manager: EntityManager, routeKeyIds: number[], uid: string): Promise<void> {
        const keyIds = [...new Set(routeKeyIds)].filter(keyId => Number.isInteger(keyId) && keyId > 0)
        if (keyIds.length === 0) return
        const bindings = await manager.find(Schema.TbSrmRouteApp, { select: { routeKeyId: true }, where: { routeKeyId: In(keyIds) } })
        const bound = new Set(bindings.map(item => item.routeKeyId))
        const targeted = keyIds.filter(keyId => bound.has(keyId))
        const general = keyIds.filter(keyId => !bound.has(keyId))
        if (targeted.length > 0) {
            await manager.update(Schema.TbSrmRoute, { keyId: In(targeted) }, { type: Schema.TbSrmRouteType.TARGETED, modifyBy: uid })
        }
        if (general.length > 0) {
            await manager.update(Schema.TbSrmRoute, { keyId: In(general) }, { type: Schema.TbSrmRouteType.GENERAL, modifyBy: uid })
        }
    }

    /** 校验路由别名未被其他路由使用。 */
    private async assertAliasAvailable(manager: EntityManager, alias: string | null, keyId?: number): Promise<void> {
        if (!alias) return
        const where = keyId ? { alias, keyId: Not(keyId) } : { alias }
        if (await manager.existsBy(Schema.TbSrmRoute, where)) throw new ConflictException(`路由别名【${alias}】已存在`)
    }

    /** 校验路由存在。 */
    private async findRouteRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRoute> {
        const route = await manager.findOneBy(Schema.TbSrmRoute, { keyId })
        if (!route) throw new NotFoundException('路由不存在')
        return route
    }

    /** 校验规则存在。 */
    private async findRuleRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRouteRule> {
        const rule = await manager.findOneBy(Schema.TbSrmRouteRule, { keyId })
        if (!rule) throw new NotFoundException('路由规则不存在')
        return rule
    }

    /** 查询方向，号码段校验需要国际区号。 */
    private async findCountryRequired(countryKeyId: number): Promise<feign.SkylineCountrySummary> {
        const [country] = await this.skylineFeignClient.httpBaseSkylineColumnCountryResolver(this.authorization(), {
            keyIds: [countryKeyId]
        })
        if (!country) throw new BadRequestException('方向不存在')
        return country
    }

    /** 服务间凭据。 */
    private authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
