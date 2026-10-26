import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataBaseService, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { ChannelEventService } from '@/modules/channel/channel-event.service'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ConfigService } from '@nestjs/config'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as ChannelDto from '@/modules/channel/dto/channel.dto'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class ChannelService {
    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService,
        private readonly channelUtilsService: ChannelUtilsService,
        private readonly channelEventService: ChannelEventService,
        private readonly routeConfigEventService: RouteConfigEventService
    ) {}

    /** 发布通道事件；通道的启停、类型、方向会影响选路，同时广播选路配置变更。 */
    private async fetchChannelPublish(channel: Schema.TbSrmChannel, deleted?: boolean): Promise<Schema.TbSrmChannel> {
        await this.channelEventService.publish(channel, deleted)
        await this.routeConfigEventService.publish(`通道变更：${channel.alias}`)
        return channel
    }

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
        await this.channelUtilsService.findCountryRequired(input.countryKeyId)
        const ownerUserUid = input.ownerUserUid ?? principal.uid
        const ownerNumber = await this.channelUtilsService.resolveOwnerNumber(principal, ownerUserUid)
        const channel = await this.repository.manager.transaction(async manager => {
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
        return await this.fetchChannelPublish(channel)
    }

    /** 编辑通道：别名、方向、类型不可修改；可调整名称、归属人和发送参数。 */
    public async httpBaseSrmUpdateChannel(principal: AuthPrincipal, input: ChannelDto.UpdateChannelDto): Promise<Schema.TbSrmChannel> {
        const channel = await this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (input.ownerUserUid !== channel.ownerUserUid) {
                await this.channelUtilsService.assertUserExists(input.ownerUserUid)
            }
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
        return await this.fetchChannelPublish(channel)
    }

    /** 启用、停用通道：启用前至少要有一个启用的绑定端口。 */
    public async httpBaseSrmChannelStatusUpdate(
        principal: AuthPrincipal,
        input: ChannelDto.UpdateChannelStatusDto
    ): Promise<Schema.TbSrmChannel> {
        const channel = await this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (input.status === Schema.TbSrmChannelStatus.ENABLE) {
                const enabled = await manager.countBy(Schema.TbSrmChannelPort, {
                    channelKeyId: channel.keyId,
                    status: Schema.TbSrmChannelPortStatus.ENABLE
                })
                if (enabled === 0) {
                    throw new BadRequestException('通道没有启用的端口，不能启用')
                }
            }
            channel.status = input.status
            channel.modifyBy = principal.uid
            return manager.save(channel)
        })
        return await this.fetchChannelPublish(channel)
    }

    /** 删除通道：必须先停用并从路由中移除；通道绑定的端口在同一事务内一起解绑。 */
    public async httpBaseSrmDeleteChannel(input: ChannelDto.ChannelKeyDto): Promise<{ success: boolean }> {
        const channel = await this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.keyId)
            if (channel.status === Schema.TbSrmChannelStatus.ENABLE) {
                throw new ConflictException('请先停用通道')
            }
            if (await manager.existsBy(Schema.TbSrmRouteChannel, { channelKeyId: channel.keyId })) {
                throw new ConflictException('通道仍被路由使用，请先从路由中移除')
            }
            await manager.delete(Schema.TbSrmChannelPort, { channelKeyId: channel.keyId })
            await manager.delete(Schema.TbSrmChannel, { keyId: channel.keyId })
            return channel
        })
        return await this.fetchChannelPublish(channel, true).then(() => {
            return { success: true }
        })
    }

    /** 通道详情：附带该通道已绑定的端口列表。 */
    public async httpBaseSrmChannelResolver(input: ChannelDto.ChannelKeyDto): Promise<ChannelDto.ChannelResolverResponseDto> {
        const channel = await this.channelUtilsService.findChannelRequired(this.repository.manager, input.keyId)
        return {
            ...channel,
            list: await this.channelUtilsService.findChannelPorts(channel.keyId)
        }
    }

    /** 通道分页：附带端口数、引用路由数、方向和归属人。 */
    public async httpBaseSrmColumnChannel(input: ChannelDto.ListChannelDto): Promise<PageResult<ChannelDto.ChannelColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            const keyword = input.alias?.trim()
            if (isNotEmpty(keyword)) {
                qb.andWhere('(t.alias LIKE :keyword OR t.name LIKE :keyword)', { keyword: `%${keyword}%` })
            }
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            if (isNotEmpty(input.countryKeyId)) qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            if (isNotEmpty(input.ownerUserUid)) qb.andWhere('t.ownerUserUid = :ownerUserUid', { ownerUserUid: input.ownerUserUid })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size).take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                const keyIds = list.map(item => item.keyId)
                const [port, route] = await Promise.all([
                    this.channelUtilsService.findChannelPortLinks(keyIds),
                    this.channelUtilsService.findChannelRouteLinks(keyIds)
                ])
                const items = list.map(item => {
                    const ports = port.linksOptions.get(item.keyId) ?? []
                    return {
                        ...item,
                        portCount: ports.length,
                        enablePortCount: ports.filter(port => port.status === Schema.TbSrmChannelPortStatus.ENABLE).length,
                        routeCount: route.linksOptions.get(item.keyId)?.length ?? 0
                    }
                })
                await feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, items, [
                    'ownerUserUid',
                    'createBy',
                    'modifyBy'
                ])
                return fetchResolver({ page, size, total, list: items })
            })
        })
    }

    /** 通道下拉。 */
    public async httpBaseSrmSelectChannel(): Promise<ChannelDto.ChannelSelectResponseDto[]> {
        return this.repository.find({
            select: { keyId: true, alias: true, type: true, countryKeyId: true, status: true },
            order: { createTime: 'DESC', keyId: 'DESC' }
        })
    }

    /**
     * 更新通道端口绑定：以本次提交的端口集合为准，保留已选端口、删除未选端口、新增新选端口。
     * 端口必须存在、已激活且激活方向与通道方向一致；已绑定到其他通道的端口会被拒绝。
     */
    public async httpBaseSrmBindChannelPort(principal: AuthPrincipal, input: ChannelDto.BindChannelPortDto): Promise<{ count: number }> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.channelUtilsService.findChannelRequired(manager, input.channelKeyId)
            const items = input.list
            const portKeyIds = items.map(item => item.portKeyId)
            if (new Set(portKeyIds).size !== portKeyIds.length) {
                throw new BadRequestException('不能重复选择相同端口')
            }

            const ports = await manager.find(Schema.TbSrmSimbankPort, {
                where: { keyId: In(portKeyIds) }
            })
            if (ports.length !== portKeyIds.length) {
                throw new NotFoundException('部分端口不存在')
            }
            const mismatched = ports.filter(port => {
                return port.activateStatus !== Schema.TbSrmSimbankPortActivateStatus.ACTIVE || port.countryKeyId !== channel.countryKeyId
            })
            if (mismatched.length > 0) {
                const numbers = mismatched.map(port => port.port).join('、')
                throw new BadRequestException(`端口未激活或激活方向与通道不一致：${numbers}`)
            }

            const bound = await manager.find(Schema.TbSrmChannelPort, {
                where: { portKeyId: In(portKeyIds) }
            })
            const conflicts = bound.filter(item => item.channelKeyId !== channel.keyId)
            if (conflicts.length > 0) {
                const conflictIds = new Set(conflicts.map(item => item.portKeyId))
                const numbers = ports.filter(port => conflictIds.has(port.keyId)).map(port => port.port)
                throw new ConflictException(`端口已绑定其他通道：${numbers.join('、')}`)
            }
            const hasEnabled = items.some(item => item.status === Schema.TbSrmChannelPortStatus.ENABLE)
            if (channel.status === Schema.TbSrmChannelStatus.ENABLE && !hasEnabled) {
                throw new ConflictException(`通道【${channel.alias}】启用中，至少保留一个启用端口，或先停用通道`)
            }

            const current = await manager.find(Schema.TbSrmChannelPort, {
                where: { channelKeyId: channel.keyId }
            })
            const selected = new Set(portKeyIds)
            const submitted = new Map(items.map(item => [item.portKeyId, item]))
            const kept = current.filter(item => selected.has(item.portKeyId))
            const existed = new Map(kept.map(item => [item.portKeyId, item]))
            const removed = current.filter(item => !selected.has(item.portKeyId))
            if (removed.length > 0) {
                await manager.delete(Schema.TbSrmChannelPort, {
                    keyId: In(removed.map(item => item.keyId))
                })
            }

            for (const item of items) {
                const binding = existed.get(item.portKeyId)
                if (!binding) {
                    continue
                }
                const unchanged = binding.weight === item.weight && binding.status === item.status
                if (unchanged) {
                    continue
                }
                await manager.update(
                    Schema.TbSrmChannelPort,
                    { keyId: binding.keyId },
                    {
                        weight: item.weight,
                        status: item.status,
                        modifyBy: principal.uid
                    }
                )
            }

            const added = ports.filter(port => !existed.has(port.keyId))
            if (added.length > 0) {
                await manager.insert(
                    Schema.TbSrmChannelPort,
                    added.map(port => {
                        const item = submitted.get(port.keyId)
                        return {
                            channelKeyId: channel.keyId,
                            portKeyId: port.keyId,
                            simbankKeyId: port.simbankKeyId,
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
    }
}
