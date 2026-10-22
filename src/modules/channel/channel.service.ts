import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { DataBaseService, EntityManager, In, InjectRepository, Not, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, fetchResolver, fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as ChannelDto from '@/modules/channel/dto/channel.dto'

@Injectable()
export class ChannelService {
    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        @InjectRepository(Schema.TbSrmChannelPort) private readonly portRepository: Repository<Schema.TbSrmChannelPort>,
        @InjectRepository(Schema.TbSrmSimbankPort) private readonly simbankPortRepository: Repository<Schema.TbSrmSimbankPort>,
        @InjectRepository(Schema.TbSrmSimbank) private readonly simbankRepository: Repository<Schema.TbSrmSimbank>,
        private readonly database: DataBaseService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
    ) {}

    /** 通道静态枚举。 */
    public httpBaseSrmChannelEnums(): ChannelDto.ChannelEnumsResponseDto {
        return {
            statusOptions: Schema.TbSrmChannelStatusDefinition.options,
            portStatusOptions: Schema.TbSrmChannelPortStatusDefinition.options,
            typeOptions: Schema.TbSmsAppTypeDefinition.options
        }
    }

    /** 新增通道：别名按 创建人工号-方向MCC-类型-序号 自动生成，负责人默认当前登录人，新建通道默认停用。 */
    public async httpBaseSrmCreateChannel(principal: AuthPrincipal, input: ChannelDto.CreateChannelDto): Promise<Schema.TbSrmChannel> {
        const country = await this.findCountryRequired(input.countryKeyId)
        const ownerUserUid = input.ownerUserUid ?? principal.uid
        if (ownerUserUid !== principal.uid) await this.assertUserExists(ownerUserUid)
        return this.repository.manager.transaction(async manager => {
            const alias = await this.createAlias(manager, principal.number, country.mcc, input.type)
            return manager.save(
                manager.create(Schema.TbSrmChannel, {
                    alias,
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

    /** 编辑通道：别名、方向、类型不可修改；可调整负责人和发送参数。 */
    public async httpBaseSrmUpdateChannel(principal: AuthPrincipal, input: ChannelDto.UpdateChannelDto): Promise<Schema.TbSrmChannel> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.findChannelRequired(manager, input.keyId)
            if (input.ownerUserUid !== channel.ownerUserUid) await this.assertUserExists(input.ownerUserUid)
            manager.merge(Schema.TbSrmChannel, channel, {
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
            const channel = await this.findChannelRequired(manager, input.keyId)
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

    /** 删除通道：必须先停用、解绑全部端口并从路由中移除。 */
    public async httpBaseSrmDeleteChannel(input: ChannelDto.ChannelKeyDto): Promise<{ success: boolean }> {
        return this.repository.manager.transaction(async manager => {
            const channel = await this.findChannelRequired(manager, input.keyId)
            if (channel.status === Schema.TbSrmChannelStatus.ENABLE) throw new ConflictException('请先停用通道')
            if (await manager.existsBy(Schema.TbSrmRouteChannel, { channelKeyId: channel.keyId })) {
                throw new ConflictException('通道仍被路由使用，请先从路由中移除')
            }
            if (await manager.existsBy(Schema.TbSrmChannelPort, { channelKeyId: channel.keyId })) {
                throw new ConflictException('通道仍绑定端口，请先解绑')
            }
            await manager.delete(Schema.TbSrmChannel, { keyId: channel.keyId })
            return { success: true }
        })
    }

    /** 通道详情。 */
    public async httpBaseSrmChannelResolver(input: ChannelDto.ChannelKeyDto): Promise<Schema.TbSrmChannel> {
        return this.findChannelRequired(this.repository.manager, input.keyId)
    }

    /** 通道分页：附带端口数、引用路由数、方向和负责人。 */
    public async httpBaseSrmColumnChannel(input: ChannelDto.ListChannelDto): Promise<PageResult<ChannelDto.ChannelColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            const keyword = input.alias?.trim()
            if (keyword) qb.andWhere('t.alias LIKE :keyword', { keyword: `%${keyword}%` })
            if (isNotEmpty(input.type)) qb.andWhere('t.type = :type', { type: input.type })
            if (isNotEmpty(input.countryKeyId)) qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            if (isNotEmpty(input.ownerUserUid)) qb.andWhere('t.ownerUserUid = :ownerUserUid', { ownerUserUid: input.ownerUserUid })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            qb.orderBy('t.createTime', 'DESC').addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const keyIds = list.map(item => item.keyId)
            const [ports, routes] = keyIds.length
                ? await Promise.all([
                      this.portRepository.find({ select: { channelKeyId: true, status: true }, where: { channelKeyId: In(keyIds) } }),
                      this.repository.manager.find(Schema.TbSrmRouteChannel, {
                          select: { channelKeyId: true },
                          where: { channelKeyId: In(keyIds) }
                      })
                  ])
                : [[], []]
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
            const channel = await this.findChannelRequired(manager, input.channelKeyId)
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
                await this.assertChannelKeepsPort(manager, binding.channelKeyId, [binding.keyId])
            }
            binding.weight = input.weight
            binding.status = input.status
            binding.modifyBy = principal.uid
            return manager.save(binding)
        })
    }

    /** 批量解绑端口；启用中的通道不能解绑到一个启用端口都不剩。 */
    public async httpBaseSrmUnbindChannelPort(input: ChannelDto.UnbindChannelPortDto): Promise<{ count: number }> {
        return this.repository.manager.transaction(async manager => {
            const keyIds = [...new Set(input.keyIds)]
            const bindings = await manager.find(Schema.TbSrmChannelPort, { where: { keyId: In(keyIds) } })
            if (bindings.length === 0) return { count: 0 }
            for (const channelKeyId of new Set(bindings.map(item => item.channelKeyId))) {
                await this.assertChannelKeepsPort(
                    manager,
                    channelKeyId,
                    bindings.filter(item => item.channelKeyId === channelKeyId).map(item => item.keyId)
                )
            }
            await manager.delete(Schema.TbSrmChannelPort, { keyId: In(bindings.map(item => item.keyId)) })
            return { count: bindings.length }
        })
    }

    /** 通道端口分页：附带端口与设备当前状态。 */
    public async httpBaseSrmColumnChannelPort(
        input: ChannelDto.ListChannelPortDto
    ): Promise<PageResult<ChannelDto.ChannelPortColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const keyword = input.name?.trim()
        const keywordPortKeyIds = keyword ? await this.findPortKeyIdsByKeyword(keyword) : undefined
        if (keywordPortKeyIds?.length === 0) return fetchResolver({ page, size, total: 0, list: [] })
        return this.database.builder(this.portRepository, async qb => {
            qb.where('t.channelKeyId = :channelKeyId', { channelKeyId: input.channelKeyId })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            if (keywordPortKeyIds) qb.andWhere('t.portKeyId IN (:...keywordPortKeyIds)', { keywordPortKeyIds })
            qb.orderBy('t.simbankKeyId', 'ASC').addOrderBy('t.portKeyId', 'ASC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            const ports = list.length
                ? await this.simbankPortRepository.find({ where: { keyId: In(list.map(item => item.portKeyId)) } })
                : []
            const simbanks = list.length
                ? await this.simbankRepository.find({ where: { keyId: In([...new Set(list.map(item => item.simbankKeyId))]) } })
                : []
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

    /** 可绑定端口：未绑定任何通道、已激活且激活方向与通道方向一致的端口，可按设备筛选。 */
    public async httpBaseSrmAvailableChannelPort(input: ChannelDto.ListAvailablePortDto): Promise<PageResult<Schema.TbSrmSimbankPort>> {
        const { page, size } = fetchUntiePagination(input)
        const channel = await this.findChannelRequired(this.repository.manager, input.channelKeyId)
        return this.database.builder(this.simbankPortRepository, async qb => {
            qb.where(`NOT EXISTS (SELECT 1 FROM tb_srm_channel_port cp WHERE cp.port_key_id = t.keyId)`)
            qb.andWhere('t.activateStatus = :activateStatus', { activateStatus: Schema.TbSrmSimbankPortActivateStatus.ACTIVE })
            qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: channel.countryKeyId })
            if (isNotEmpty(input.simbankKeyId)) qb.andWhere('t.simbankKeyId = :simbankKeyId', { simbankKeyId: input.simbankKeyId })
            qb.orderBy('t.simbankKeyId', 'DESC').addOrderBy('t.port', 'ASC')
            qb.skip((page - 1) * size).take(size)
            const [list, total] = await qb.getManyAndCount()
            return fetchResolver({ page, size, total, list })
        })
    }

    /** 校验通道存在。 */
    private async findChannelRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmChannel> {
        const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId })
        if (!channel) throw new NotFoundException('通道不存在')
        return channel
    }

    /** 启用中的通道在停用或解绑端口后，必须还剩至少一个启用端口。 */
    private async assertChannelKeepsPort(manager: EntityManager, channelKeyId: number, removingKeyIds: number[]): Promise<void> {
        const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId: channelKeyId })
        if (channel?.status !== Schema.TbSrmChannelStatus.ENABLE) return
        const remaining = await manager.countBy(Schema.TbSrmChannelPort, {
            channelKeyId,
            status: Schema.TbSrmChannelPortStatus.ENABLE,
            keyId: Not(In(removingKeyIds))
        })
        if (remaining === 0) throw new ConflictException(`通道【${channel.alias}】启用中，至少保留一个启用端口，或先停用通道`)
    }

    /** 生成通道别名：创建人工号-方向MCC-类型-序号，序号在同一前缀下递增，两位补零。 */
    private async createAlias(manager: EntityManager, number: string, mcc: string, type: Schema.TbSmsAppType): Promise<string> {
        if (!number) throw new BadRequestException('当前账号缺少工号，不能生成通道别名')
        const prefix = `${number}-${mcc}-${type}-`.toUpperCase()
        const rows = await manager
            .createQueryBuilder(Schema.TbSrmChannel, 't')
            .setLock('pessimistic_write')
            .select('t.alias')
            .where('t.alias LIKE :prefix', { prefix: `${prefix}%` })
            .getMany()
        const max = rows.reduce((value, row) => Math.max(value, Number(row.alias.slice(prefix.length)) || 0), 0)
        const alias = `${prefix}${String(max + 1).padStart(2, '0')}`
        if (alias.length > 32) throw new BadRequestException('通道别名超过32位')
        return alias
    }

    /** 查询方向，别名需要使用 MCC。 */
    private async findCountryRequired(countryKeyId: number): Promise<feign.SkylineCountrySummaryResponseDto> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const [country] = await this.skylineFeignClient.httpBaseSkylineColumnCountryResolver(authorization, { keyIds: [countryKeyId] })
        if (!country) throw new BadRequestException('方向不存在')
        return country
    }

    /** 校验负责人账号存在。 */
    private async assertUserExists(uid: string): Promise<void> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(authorization, { uids: [uid] })
        if (!user) throw new BadRequestException('负责人不存在')
    }

    /** 按关键词查端口主键：SIM、ICCID 匹配端口，名称或别名匹配设备。 */
    private async findPortKeyIdsByKeyword(keyword: string): Promise<number[]> {
        const like = `%${keyword}%`
        const simbanks = await this.simbankRepository
            .createQueryBuilder('t')
            .select('t.keyId')
            .where('(t.name LIKE :like OR t.alias LIKE :like)', { like })
            .getMany()
        const qb = this.simbankPortRepository
            .createQueryBuilder('t')
            .select('t.keyId')
            .where('(t.sim LIKE :like OR t.iccid LIKE :like)', { like })
        if (simbanks.length) qb.orWhere('t.simbankKeyId IN (:...simbankKeyIds)', { simbankKeyIds: simbanks.map(item => item.keyId) })
        return (await qb.getMany()).map(item => item.keyId)
    }
}
