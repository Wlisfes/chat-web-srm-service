import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository, EntityManager, In, Repository } from '@wlisfes/chat-web-base-schema/database'
import { type LinkIndex, type LinkOptions } from '@wlisfes/chat-web-base-schema/utils'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ConfigService } from '@nestjs/config'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class ChannelUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmChannel) private readonly repository: Repository<Schema.TbSrmChannel>,
        @InjectRepository(Schema.TbSrmChannelPort) private readonly portRepository: Repository<Schema.TbSrmChannelPort>,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
    ) {}

    /** 获取必需的通道详情；传入事务管理器时使用该事务的仓库。 */
    public async findChannelRequired(manager: EntityManager, keyId: number): Promise<Schema.TbSrmChannel> {
        const channel = await manager.findOneBy(Schema.TbSrmChannel, { keyId })
        if (!channel) {
            throw new NotFoundException('通道不存在')
        }
        return channel
    }

    /** 获取必需的通道详情；传入事务管理器时使用该事务的仓库。 */
    public async findChannels(channelKeyIds: number[]): Promise<LinkOptions<Schema.TbSrmChannel>> {
        const linksOptions = new Map<number, Schema.TbSrmChannel>()
        if (channelKeyIds.length === 0) {
            return { links: [], linksOptions }
        }
        const links = await this.repository.manager.find(Schema.TbSrmChannel, {
            where: { keyId: In(channelKeyIds) },
            select: ['keyId', 'alias', 'name', 'status', 'type', 'sendInterval', 'maxRetry']
        })
        for (const channelKeyId of channelKeyIds) {
            linksOptions.set(
                channelKeyId,
                links.find(item => item.keyId === channelKeyId)
            )
        }
        return { links, linksOptions }
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
        if (alias.length > 32) {
            throw new BadRequestException('通道别名超过32位')
        }
        return alias
    }

    /** 取归属人工号：当前登录人直接用工号，其他人通过 Skyline 账号还原。 */
    public async resolveOwnerNumber(principal: AuthPrincipal, ownerUserUid: string): Promise<string> {
        if (ownerUserUid === principal.uid) {
            return this.requireEmployeeNumber(principal.number, '当前登录账号')
        }
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [ownerUserUid] })
        if (!user) {
            throw new BadRequestException('归属人不存在')
        }
        return this.requireEmployeeNumber(user.number, '归属人')
    }

    /** 把别名尾部序号转换为连续序号；不符合当前规则的历史别名返回0。 */
    public parseAliasSequence(alias: string, prefix: string): number {
        const code = alias?.startsWith(prefix) ? alias.slice(prefix.length) : ''
        const single = /^([A-Z])(\d{3})$/.exec(code)
        if (single && Number(single[2]) > 0) {
            return (single[1].charCodeAt(0) - 65) * 999 + Number(single[2])
        }
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

    /** 校验归属人账号存在。 */
    public async assertUserExists(uid: string): Promise<void> {
        const [user] = await this.skylineFeignClient.httpBaseSkylineColumnUserResolver(this.authorization(), { uids: [uid] })
        if (!user) {
            throw new BadRequestException('归属人不存在')
        }
    }

    /** 查询通道全部绑定的端口，不分页；供通道详情使用。 */
    public async findChannelPorts(channelKeyId: number): Promise<Schema.TbSrmChannelPort[]> {
        return this.portRepository.find({
            where: { channelKeyId },
            order: { simbankKeyId: 'ASC', portKeyId: 'ASC' }
        })
    }

    /** 批量查询通道绑定端口，按通道主键索引。 */
    public async findChannelPortLinks(channelKeyIds: number[]): Promise<LinkIndex<Schema.TbSrmChannelPort>> {
        const linksOptions = new Map<number, Schema.TbSrmChannelPort[]>()
        if (channelKeyIds.length === 0) return { links: [], linksOptions }
        const links = await this.portRepository.find({
            where: { channelKeyId: In(channelKeyIds) },
            order: { simbankKeyId: 'ASC', portKeyId: 'ASC' },
            select: ['keyId', 'channelKeyId', 'status']
        })
        for (const channelKeyId of channelKeyIds) {
            linksOptions.set(
                channelKeyId,
                links.filter(item => item.channelKeyId === channelKeyId)
            )
        }
        return { links, linksOptions }
    }

    /** 批量查询引用通道的路由绑定，按通道主键索引。 */
    public async findChannelRouteLinks(channelKeyIds: number[]): Promise<LinkIndex<Schema.TbSrmRouteChannel>> {
        const linksOptions = new Map<number, Schema.TbSrmRouteChannel[]>()
        if (channelKeyIds.length === 0) return { links: [], linksOptions }
        const links = await this.repository.manager.find(Schema.TbSrmRouteChannel, {
            where: { channelKeyId: In(channelKeyIds) },
            select: ['keyId', 'channelKeyId', 'routeKeyId', 'status']
        })
        for (const channelKeyId of channelKeyIds) {
            linksOptions.set(
                channelKeyId,
                links.filter(item => item.channelKeyId === channelKeyId)
            )
        }
        return { links, linksOptions }
    }

    private requireEmployeeNumber(number: string | undefined, label: string): string {
        const userNumber = number?.trim()
        if (!userNumber || !/^[A-Za-z0-9]+$/.test(userNumber)) {
            throw new BadRequestException(`${label}缺少有效工号，无法生成通道别名`)
        }
        return userNumber
    }

    private authorization(): string {
        return feign.resolveFeignServiceAuthorization(this.configService)
    }
}
