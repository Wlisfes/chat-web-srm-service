import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { DataBaseService, EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

@Injectable()
export class RouteService {
    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        @InjectRepository(Schema.TbSrmRouteChannel) private readonly routeChannelRepository: Repository<Schema.TbSrmRouteChannel>,
        @InjectRepository(Schema.TbSrmChannel) private readonly channelRepository: Repository<Schema.TbSrmChannel>,
        @InjectRepository(Schema.TbSrmChannelPort) private readonly portRepository: Repository<Schema.TbSrmChannelPort>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly crmFeignClient: feign.FeignClientCrmManager,
        private readonly configService: ConfigService
    ) {}

    /** 路由静态枚举。 */
    public httpBaseSrmRouteEnums(): RouteDto.RouteEnumsResponseDto {
        return {
            statusOptions: Schema.TbSrmRouteStatusDefinition.options,
            channelStatusOptions: Schema.TbSrmRouteChannelStatusDefinition.options,
            typeOptions: Schema.TbSrmChannelTypeDefinition.options
        }
    }

    /** 新增路由：方向 + 类型 + 客户唯一；userKeyId 为 0 表示默认路由。 */
    public async httpBaseSrmCreateRoute(principal: AuthPrincipal, input: RouteDto.CreateRouteDto): Promise<Schema.TbSrmRoute> {
        const userKeyId = input.userKeyId ?? Schema.TB_SRM_ROUTE_DEFAULT_USER_KEY_ID
        await this.assertCountryExists(input.countryKeyId)
        if (userKeyId !== Schema.TB_SRM_ROUTE_DEFAULT_USER_KEY_ID) await this.assertUserExists(userKeyId)
        return this.repository.manager.transaction(async manager => {
            if (await manager.existsBy(Schema.TbSrmRoute, { countryKeyId: input.countryKeyId, type: input.type, userKeyId })) {
                throw new ConflictException(userKeyId ? '该客户在这个方向和类型下已有专属路由' : '这个方向和类型已有默认路由')
            }
            return manager.save(
                manager.create(Schema.TbSrmRoute, {
                    countryKeyId: input.countryKeyId,
                    type: input.type,
                    userKeyId,
                    status: input.status ?? Schema.TbSrmRouteStatus.ENABLE,
                    remark: input.remark?.trim() || null,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑路由：只能修改状态和备注。 */
    public async httpBaseSrmUpdateRoute(principal: AuthPrincipal, input: RouteDto.UpdateRouteDto): Promise<Schema.TbSrmRoute> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            route.status = input.status
            route.remark = input.remark?.trim() || null
            route.modifyBy = principal.uid
            return manager.save(route)
        })
    }

    /** 删除路由：同时删除路由下的通道配置。 */
    public async httpBaseSrmDeleteRoute(input: RouteDto.RouteKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.keyId)
            await manager.delete(Schema.TbSrmRouteChannel, { routeKeyId: route.keyId })
            await manager.delete(Schema.TbSrmRoute, { keyId: route.keyId })
            return { success: true }
        })
    }

    /** 路由详情。 */
    public async httpBaseSrmRouteResolver(input: RouteDto.RouteKeyDto): Promise<Schema.TbSrmRoute> {
        return this.findRouteRequired(this.repository.manager, input.keyId)
    }

    /** 路由分页：附带方向、客户、通道数和可用通道数。 */
    public async httpBaseSrmColumnRoute(input: RouteDto.ListRouteDto): Promise<PageResult<RouteDto.RouteColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            if (isNotEmpty(input.countryKeyId)) qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            if (isNotEmpty(input.userKeyId)) qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            qb.orderBy('t.countryKeyId', 'ASC').addOrderBy('t.type', 'ASC').addOrderBy('t.userKeyId', 'ASC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const keyIds = list.map(item => item.keyId)
            const links = keyIds.length ? await this.routeChannelRepository.find({ where: { routeKeyId: In(keyIds) } }) : []
            const channels = links.length
                ? await this.channelRepository.find({
                      select: { keyId: true, status: true },
                      where: { keyId: In([...new Set(links.map(item => item.channelKeyId))]) }
                  })
                : []
            const enabled = new Set(channels.filter(item => item.status === Schema.TbSrmChannelStatus.ENABLE).map(item => item.keyId))
            const rows = list.map(item => {
                const own = links.filter(link => link.routeKeyId === item.keyId)
                return {
                    ...item,
                    channelCount: own.length,
                    activeChannelCount: own.filter(
                        link => link.status === Schema.TbSrmRouteChannelStatus.ENABLE && enabled.has(link.channelKeyId)
                    ).length
                }
            })
            await Promise.all([
                feign.fetchAppendSkylineCountryOptions(this.skylineFeignClient, this.configService, rows, ['countryKeyId']),
                feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, ['createBy', 'modifyBy']),
                this.appendUserOptions(rows)
            ])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /** 路由加入通道：通道方向和类型必须与路由一致，同一路由不能重复加入同一通道。 */
    public async httpBaseSrmCreateRouteChannel(
        principal: AuthPrincipal,
        input: RouteDto.CreateRouteChannelDto
    ): Promise<Schema.TbSrmRouteChannel> {
        return this.repository.manager.transaction(async manager => {
            const route = await this.findRouteRequired(manager, input.routeKeyId)
            const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId: input.channelKeyId })
            if (!channel) throw new NotFoundException('通道不存在')
            if (channel.countryKeyId !== route.countryKeyId || channel.type !== route.type) {
                throw new BadRequestException(`通道【${channel.alias}】的方向或类型与路由不一致`)
            }
            if (await manager.existsBy(Schema.TbSrmRouteChannel, { routeKeyId: route.keyId, channelKeyId: channel.keyId })) {
                throw new ConflictException(`通道【${channel.alias}】已在该路由中`)
            }
            return manager.save(
                manager.create(Schema.TbSrmRouteChannel, {
                    routeKeyId: route.keyId,
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
        const result = await this.routeChannelRepository.delete({ keyId: input.keyId })
        if (!result.affected) throw new NotFoundException('路由通道不存在')
        return { success: true }
    }

    /** 路由通道列表：按优先级、权重排序，附带通道信息、是否可用和同优先级分流占比。 */
    public async httpBaseSrmListRouteChannel(input: RouteDto.ListRouteChannelDto): Promise<RouteDto.RouteChannelResponseDto[]> {
        const links = await this.routeChannelRepository.find({
            where: { routeKeyId: input.routeKeyId },
            order: { priority: 'ASC', weight: 'DESC', keyId: 'ASC' }
        })
        if (links.length === 0) return []
        const channelKeyIds = links.map(item => item.channelKeyId)
        const [channels, ports] = await Promise.all([
            this.channelRepository.find({
                select: { keyId: true, alias: true, type: true, countryKeyId: true, status: true },
                where: { keyId: In(channelKeyIds) }
            }),
            this.portRepository.find({
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
            const sum = rows.filter(item => item.active && item.priority === row.priority).reduce((total, item) => total + item.weight, 0)
            return { ...row, ratio: row.active && sum > 0 ? Math.round((row.weight / sum) * 10000) / 100 : 0 }
        })
    }

    /** 校验路由存在。 */
    private async findRouteRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmRoute> {
        const route = await manager.findOneBy(Schema.TbSrmRoute, { keyId })
        if (!route) throw new NotFoundException('路由不存在')
        return route
    }

    /** 校验方向在 Skyline 存在。 */
    private async assertCountryExists(countryKeyId: number): Promise<void> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const [country] = await this.skylineFeignClient.httpBaseSkylineColumnCountryResolver(authorization, { keyIds: [countryKeyId] })
        if (!country) throw new BadRequestException('方向不存在')
    }

    /** 校验客户在 CRM 存在。 */
    private async assertUserExists(userKeyId: number): Promise<void> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const [user] = await this.crmFeignClient.httpBaseCrmColumnUserResolver(authorization, { keyIds: [userKeyId] })
        if (!user) throw new BadRequestException('客户不存在')
    }

    /** 专属路由附带客户名称和别名，默认路由不查询。 */
    private async appendUserOptions(rows: Array<Schema.TbSrmRoute & { userKeyIdOptions?: RouteDto.RouteUserOptionDto }>): Promise<void> {
        const keyIds = [...new Set(rows.map(item => item.userKeyId).filter(keyId => keyId > 0))]
        if (keyIds.length === 0) return
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const users = await this.crmFeignClient.httpBaseCrmColumnUserResolver(authorization, { keyIds })
        for (const row of rows) {
            if (row.userKeyId <= 0) continue
            const user = users.find(item => item.keyId === row.userKeyId)
            row.userKeyIdOptions = { keyId: row.userKeyId, name: user?.name, alias: user?.alias }
        }
    }
}
