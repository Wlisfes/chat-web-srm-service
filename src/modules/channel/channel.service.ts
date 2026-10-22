import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataBaseService, EntityManager, In, InjectRepository, Not, Repository } from '@wlisfes/chat-web-base-schema/database'
import { fetchUntiePagination, fetchVagueKeyword, fetchVagueNumberKeyword } from '@wlisfes/chat-web-base-schema/utils'
import { PageResult, fetchResolver, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ConfigService } from '@nestjs/config'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as ChannelDto from '@/modules/channel/dto/channel.dto'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'

@Injectable()
export class ChannelService {
    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        @InjectRepository(Schema.TbSrmSimbankPort) private readonly simbankPortRepository: Repository<Schema.TbSrmSimbankPort>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService,
        private readonly simbankUtilsService: SimbankUtilsService,
        private readonly channelUtilsService: ChannelUtilsService
    ) {}

    /** 通道静态枚举。 */
    public httpBaseSrmChannelEnums(): ChannelDto.ChannelEnumsResponseDto {
        return {
            statusOptions: Schema.TbSrmChannelStatusDefinition.options,
            portStatusOptions: Schema.TbSrmChannelPortStatusDefinition.options,
            typeOptions: Schema.TbSmsAppTypeDefinition.options
        }
    }

    /** 新增通道：别名按 TSK + 归属人工号 + 类型 + 分段序号自动生成，归属人默认当前登录人，新建通道默认停用。 */
    public async httpBaseSrmCreateChannel(principal: AuthPrincipal, input: ChannelDto.CreateChannelDto): Promise<Schema.TbSrmChannel> {
        const country = await this.channelUtilsService.findCountryRequired(input.countryKeyId)
        const ownerUserUid = input.ownerUserUid ?? principal.uid
        const ownerNumber = await this.channelUtilsService.resolveOwnerNumber(principal, ownerUserUid)
        return this.repository.manager.transaction(async manager => {
            const alias = await this.channelUtilsService.createAlias(manager, ownerNumber, input.type)
            return manager.save(
                manager.create(Schema.TbSrmChannel, {
                    alias,
                    name: input.name.trim(),
                    type: input.type,
                    countryKeyId: input.countryKeyId,
                    ownerUserUid,
                    sendInterval: input.sendInterval,
                    maxRetry: input.maxRetry,
                    remark: input.remark?.trim() || null,
                    status: Schema.TbSrmChannelStatus.DISABLE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
        })
    }

    /** 编辑通道：别名、方向、类型不可修改；可调整名称、归属人和发送参数。 */
    public async httpBaseSrmUpdateChannel(principal: AuthPrincipal, input: ChannelDto.UpdateChannelDto): Promise<Schema.TbSrmChannel> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (input.ownerUserUid !== channel.ownerUserUid) await this.channelUtilsService.assertUserExists(input.ownerUserUid)
            manager.merge(Schema.TbSrmChannel, channel, {
                name: input.name.trim(),
                ownerUserUid: input.ownerUserUid,
                sendInterval: input.sendInterval,
                maxRetry: input.maxRetry,
                remark: input.remark?.trim() || null,
                modifyBy: principal.uid
            })
            return manager.save(channel)
        })
    }

    /** 启用、停用通道：启用前至少要有一个启用的绑定端口。 */
    public async httpBaseSrmChannelStatusUpdate(
        principal: AuthPrincipal,
        input: ChannelDto.UpdateChannelStatusDto
    ): Promise<Schema.TbSrmChannel> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (input.status === Schema.TbSrmChannelStatus.ENABLE) {
                const enabled = await manager.countBy(Schema.TbSrmChannelPort, {
                    channelKeyId: channel.keyId,
                    status: Schema.TbSrmChannelPortStatus.ENABLE
                })
                if (enabled === 0) throw new BadRequestException('通道没有启用的端口，不能启用')
            }
            channel.status = input.status
            channel.modifyBy = principal.uid
            return manager.save(channel)
        })
    }

    /** 删除通道：必须先停用并从路由中移除；通道绑定的端口在同一事务内一起解绑。 */
    public async httpBaseSrmDeleteChannel(input: ChannelDto.ChannelKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (channel.status === Schema.TbSrmChannelStatus.ENABLE) throw new ConflictException('请先停用通道')
            if (await manager.existsBy(Schema.TbSrmRouteChannel, { channelKeyId: channel.keyId })) {
                throw new ConflictException('通道仍被路由使用，请先从路由中移除')
            }
            await manager.delete(Schema.TbSrmChannelPort, { channelKeyId: channel.keyId })
            await manager.delete(Schema.TbSrmChannel, { keyId: channel.keyId })
            return { success: true }
        })
    }

    /** 通道详情：附带该通道已绑定的端口列表。 */
    public async httpBaseSrmChannelResolver(input: ChannelDto.ChannelKeyDto): Promise<ChannelDto.ChannelResolverResponseDto> {
        return await this.channelUtilsService.findChannelRequired(this.repository.manager, input.keyId).then(async channel => {
            return { ...channel, list: await this.channelUtilsService.findChannelPorts(channel.keyId) }
        })
    }

    /** 通道分页：附带端口数、引用路由数、方向和归属人。 */
    public async httpBaseSrmColumnChannel(input: ChannelDto.ListChannelDto): Promise<PageResult<ChannelDto.ChannelColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            const keyword = input.alias?.trim()
            if (keyword) qb.andWhere('(t.alias LIKE :keyword OR t.name LIKE :keyword)', { keyword: `%${keyword}%` })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            if (isNotEmpty(input.countryKeyId)) qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            if (isNotEmpty(input.ownerUserUid)) qb.andWhere('t.ownerUserUid = :ownerUserUid', { ownerUserUid: input.ownerUserUid })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            qb.orderBy('t.createTime', 'DESC').addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const keyIds = list.map(item => item.keyId)
            const { ports, routes } = await this.channelUtilsService.findChannelPortStats(keyIds)

            const rows = list.map(item => ({
                ...item,
                portCount: ports.filter(port => port.channelKeyId === item.keyId).length,
                enablePortCount: ports.filter(
                    port => port.channelKeyId === item.keyId && port.status === Schema.TbSrmChannelPortStatus.ENABLE
                ).length,
                routeCount: routes.filter(route => route.channelKeyId === item.keyId).length
            }))
            await Promise.all([
                feign.fetchAppendSkylineCountryOptions(this.skylineFeignClient, this.configService, rows, ['countryKeyId']),
                feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, rows, [
                    'ownerUserUid',
                    'createBy',
                    'modifyBy'
                ])
            ])
            return fetchResolver({ page, size, total, list: rows })
        })
    }

    /** 通道下拉。 */
    public async httpBaseSrmSelectChannel(): Promise<ChannelDto.ChannelSelectResponseDto[]> {
        return this.repository.find({
            select: { keyId: true, alias: true, type: true, countryKeyId: true, status: true },
            order: { createTime: 'DESC', keyId: 'DESC' }
        })
    }

    /** 批量绑定端口：端口必须存在、已激活且激活方向与通道方向一致，且未绑定任何通道。 */
    public async httpBaseSrmBindChannelPort(principal: AuthPrincipal, input: ChannelDto.BindChannelPortDto): Promise<{ count: number }> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.channelKeyId)
            const portKeyIds = [...new Set(input.portKeyIds)]
            const ports = await manager.find(Schema.TbSrmSimbankPort, { where: { keyId: In(portKeyIds) } })
            if (ports.length !== portKeyIds.length) throw new NotFoundException('部分端口不存在')
            const mismatched = ports.filter(
                port => port.activateStatus !== Schema.TbSrmSimbankPortActivateStatus.ACTIVE || port.countryKeyId !== channel.countryKeyId
            )
            if (mismatched.length > 0) {
                throw new BadRequestException(`端口未激活或激活方向与通道不一致：${mismatched.map(port => port.port).join('、')}`)
            }
            const bound = await manager.find(Schema.TbSrmChannelPort, { where: { portKeyId: In(portKeyIds) } })
            if (bound.length > 0) {
                const numbers = ports.filter(port => bound.some(item => item.portKeyId === port.keyId)).map(port => port.port)
                throw new ConflictException(`端口已绑定其他通道：${numbers.join('、')}`)
            }
            await manager.insert(
                Schema.TbSrmChannelPort,
                ports.map(port => ({
                    channelKeyId: input.channelKeyId,
                    portKeyId: port.keyId,
                    simbankKeyId: port.simbankKeyId,
                    weight: 1,
                    status: Schema.TbSrmChannelPortStatus.ENABLE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                }))
            )
            return { count: ports.length }
        })
    }

    /** 编辑端口绑定的权重和状态；停用通道最后一个启用端口时拒绝，避免启用中的通道没有端口。 */
    public async httpBaseSrmUpdateChannelPort(
        principal: AuthPrincipal,
        input: ChannelDto.UpdateChannelPortDto
    ): Promise<Schema.TbSrmChannelPort> {
        return this.repository.manager.transaction(async manager => {
            const binding = await manager.findOneBy(Schema.TbSrmChannelPort, { keyId: input.keyId })
            if (!binding) throw new NotFoundException('端口绑定不存在')
            if (input.status === Schema.TbSrmChannelPortStatus.DISABLE && binding.status === Schema.TbSrmChannelPortStatus.ENABLE) {
                await this.channelUtilsService.assertChannelKeepsPort(manager, binding.channelKeyId, [binding.keyId])
            }
            binding.weight = input.weight
            binding.status = input.status
            binding.modifyBy = principal.uid
            return manager.save(binding)
        })
    }

    /** 通道端口分页：附带端口与设备当前状态。 */
    public async httpBaseSrmColumnChannelPort(
        input: ChannelDto.ListChannelPortDto
    ): Promise<PageResult<ChannelDto.ChannelPortColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const keyword = input.name?.trim()
        const keywordPortKeyIds = keyword ? await this.channelUtilsService.findPortKeyIdsByKeyword(keyword) : undefined
        if (keywordPortKeyIds?.length === 0) return fetchResolver({ page, size, total: 0, list: [] })
        return this.channelUtilsService
            .findChannelPortPage({ page, size, ...input }, keywordPortKeyIds, this.database)
            .then(async ({ list, total }) => {
                const { ports, simbanks } = await this.channelUtilsService.findChannelPortSnapshots(
                    list.map(item => item.portKeyId),
                    [...new Set(list.map(item => item.simbankKeyId))]
                )
                return fetchResolver({
                    page,
                    size,
                    total,
                    list: list.map(item => ({
                        ...item,
                        portOptions: ports.find(port => port.keyId === item.portKeyId),
                        simbankOptions: simbanks.find(simbank => simbank.keyId === item.simbankKeyId)
                    }))
                })
            })
    }
}
