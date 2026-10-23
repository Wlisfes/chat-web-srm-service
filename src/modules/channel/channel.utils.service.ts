import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository, EntityManager, In, Not, Repository } from '@wlisfes/chat-web-base-schema/database'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class ChannelUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        @InjectRepository(Schema.TbSrmChannelPort) private readonly portRepository: Repository<Schema.TbSrmChannelPort>,
        @InjectRepository(Schema.TbSrmSimbank) private readonly simbankRepository: Repository<Schema.TbSrmSimbank>,
        @InjectRepository(Schema.TbSrmSimbankPort) private readonly simbankPortRepository: Repository<Schema.TbSrmSimbankPort>,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
    ) {}

    /** 获取必需的通道详情；传入事务管理器时使用该事务的仓库。 */
    public async findChannelRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmChannel> {
        const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId })
        if (!channel) throw new NotFoundException('通道不存在')
        return channel
    }

    /** 启用中的通道在停用或解绑端口后，必须还剩至少一个启用端口。 */
    public async assertChannelKeepsPort(manager: EntityManager, channelKeyId: number, removingKeyIds: number[]): Promise<void> {
        const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId: channelKeyId })
        if (channel?.status !== Schema.TbSrmChannelStatus.ENABLE) return
        const remaining = await manager.countBy(Schema.TbSrmChannelPort, {
            channelKeyId,
            status: Schema.TbSrmChannelPortStatus.ENABLE,
            keyId: Not(In(removingKeyIds))
        })
        if (remaining === 0) throw new ConflictException(`通道【${channel.alias}】启用中，至少保留一个启用端口，或先停用通道`)
    }

    /**
     * 生成通道别名：TSK + 归属人工号 + 类型 + 分段序号，例如 TSK1233-MRKT-A001。
     * 序号规则与短信应用别名一致：同一工号同一类型内 A001-Z999，用完后进入 AA01-ZZ99。
     */
    public async createAlias(manager: EntityManager, number: string, type: Schema.TbSmsAppType): Promise<string> {
        const prefix = `TSK${number}-${type}-`
        const rows = await manager
            .createQueryBuilder(Schema.TbSrmChannel, 't')
            .setLock('pessimistic_write')
            .select('t.alias')
            .where('t.alias LIKE :prefix', { prefix: `${prefix}%` })
            .getMany()
        const max = rows.reduce((value, row) => Math.max(value, this.parseAliasSequence(row.alias, prefix)), 0)
        const alias = `${prefix}${this.formatAliasSequence(max + 1)}`
        if (alias.length > 32) throw new BadRequestException('通道别名超过32位')
        return alias
    }

    /** 取归属人工号：当前登录人直接用工号，其他人通过 Skyline 账号还原。 */
    public async resolveOwnerNumber(principal: AuthPrincipal, ownerUserUid: string): Promise<string> {
        if (ownerUserUid === principal.uid) return this.requireEmployeeNumber(principal.number, '当前登录账号')
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [ownerUserUid] })
        if (!user) throw new BadRequestException('归属人不存在')
        return this.requireEmployeeNumber(user.number, '归属人')
    }

    /** 把别名尾部序号转换为连续序号；不符合当前规则的历史别名返回0。 */
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
            throw new ConflictException('当前工号该类型通道别名序号已用完')
        }
        if (sequence <= singleCapacity) {
            const index = sequence - 1
            return `${String.fromCharCode(65 + Math.floor(index / 999))}${String((index % 999) + 1).padStart(3, '0')}`
        }
        const index = sequence - singleCapacity - 1
        const group = Math.floor(index / 99)
        return `${String.fromCharCode(65 + Math.floor(group / 26), 65 + (group % 26))}${String((index % 99) + 1).padStart(2, '0')}`
    }

    /** 查询方向，通道必须绑定已存在的方向。 */
    public async findCountryRequired(countryKeyId: number): Promise<feign.SkylineCountrySummaryResponseDto> {
        const authorization = this.authorization()
        const [country] = await this.skylineFeignClient.httpBaseSkylineColumnCountryResolver(authorization, { keyIds: [countryKeyId] })
        if (!country) throw new BadRequestException('方向不存在')
        return country
    }

    /** 校验归属人账号存在。 */
    public async assertUserExists(uid: string): Promise<void> {
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [uid] })
        if (!user) throw new BadRequestException('归属人不存在')
    }

    /** 按关键词查端口主键：SIM、ICCID 匹配端口，名称或别名匹配设备。 */
    public async findPortKeyIdsByKeyword(keyword: string): Promise<number[]> {
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

    /** 通道端口分页查询：按通道和启停状态筛选，支持按端口主键集合过滤。 */
    public async findChannelPortPage(
        input: { page: number; size: number; channelKeyId: number; status?: Schema.TbSrmChannelPortStatus },
        keywordPortKeyIds: number[] | undefined,
        database: import('@wlisfes/chat-web-base-schema/database').DataBaseService
    ): Promise<{ list: Schema.TbSrmChannelPort[]; total: number }> {
        return database.builder(this.portRepository, async qb => {
            qb.where('t.channelKeyId = :channelKeyId', { channelKeyId: input.channelKeyId })
            if (isNotEmpty(input.status)) qb.andWhere('t.status = :status', { status: input.status })
            if (keywordPortKeyIds) qb.andWhere('t.portKeyId IN (:...keywordPortKeyIds)', { keywordPortKeyIds })
            qb.orderBy('t.simbankKeyId', 'ASC').addOrderBy('t.portKeyId', 'ASC')
            qb.skip((input.page - 1) * input.size).take(input.size)
            const [list, total] = await qb.getManyAndCount()
            return { list, total }
        })
    }

    /** 查询通道全部绑定的端口，不分页；供通道详情使用。 */
    public async findChannelPorts(channelKeyId: number): Promise<Schema.TbSrmChannelPort[]> {
        return this.portRepository.find({
            where: { channelKeyId },
            order: { simbankKeyId: 'ASC', portKeyId: 'ASC' }
        })
    }

    /** 批量还原通道列表里的端口统计，供列表返回。 */
    public async findChannelPortStats(keyIds: number[]): Promise<{
        ports: Array<Pick<Schema.TbSrmChannelPort, 'channelKeyId' | 'status'>>
        routes: Array<Pick<Schema.TbSrmRouteChannel, 'channelKeyId'>>
    }> {
        if (keyIds.length === 0) return { ports: [], routes: [] }
        const [ports, routes] = await Promise.all([
            this.portRepository.find({ select: { channelKeyId: true, status: true }, where: { channelKeyId: In(keyIds) } }),
            this.repository.manager.find(Schema.TbSrmRouteChannel, {
                select: { channelKeyId: true },
                where: { channelKeyId: In(keyIds) }
            })
        ])
        return { ports, routes }
    }

    /** 批量查询端口绑定对应的端口和设备快照，供分页列表使用。 */
    public async findChannelPortSnapshots(
        portKeyIds: number[],
        simbankKeyIds: number[]
    ): Promise<{ ports: Schema.TbSrmSimbankPort[]; simbanks: Schema.TbSrmSimbank[] }> {
        const [ports, simbanks] = await Promise.all([
            portKeyIds.length ? this.simbankPortRepository.find({ where: { keyId: In(portKeyIds) } }) : [],
            simbankKeyIds.length ? this.simbankRepository.find({ where: { keyId: In(simbankKeyIds) } }) : []
        ])
        return { ports, simbanks }
    }

    private requireEmployeeNumber(number: string | undefined, label: string): string {
        const userNumber = number?.trim()
        if (!userNumber || !/^[A-Za-z0-9]+$/.test(userNumber)) throw new BadRequestException(`${label}缺少有效工号，无法生成通道别名`)
        return userNumber
    }

    private authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
