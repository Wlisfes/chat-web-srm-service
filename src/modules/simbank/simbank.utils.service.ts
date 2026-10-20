import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository, DataBaseService, EntityManager, In, Repository } from '@wlisfes/chat-web-base-schema/database'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { Faker, en, zh_CN } from '@faker-js/faker'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import * as constants from '@/modules/simbank/simbank.constants'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

/** 设备唯一性校验字段。 */
type SimbankUniqueInput = Pick<Schema.TbSrmSimbank, 'mac'> & Partial<Pick<Schema.TbSrmSimbank, 'keyId'>>

@Injectable()
export class SimbankUtilsService {
    private readonly faker = new Faker({ locale: [zh_CN, en] })

    constructor(
        @InjectRepository(Schema.TbSrmSimbank) private readonly repository: Repository<Schema.TbSrmSimbank>,
        private readonly database: DataBaseService,
        private readonly userUtilsService: UserUtilsService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
    ) {}

    /** MAC 地址统一转为大写冒号分隔格式，兼容 isMACAddress 支持的 -、:、空格、点分隔写法，例如 aabb.ccdd.eeff 转为 AA:BB:CC:DD:EE:FF。 */
    public fetchNormalizeMac(mac: string): string {
        const a = mac.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
        return (a.match(/.{2}/g) ?? []).join(':')
    }

    /** 获取设备创建命名锁，锁与事务连接绑定，最多等待 5 秒。 */
    public async acquireCreateLock(manager: EntityManager): Promise<boolean> {
        const [result] = (await manager.query('SELECT GET_LOCK(?, ?) AS acquired', [constants.SRM_SIMBANK_CREATE_LOCK, 5])) as Array<{
            acquired: number | string | null
        }>
        return Number(result?.acquired) === 1
    }

    /** 释放设备创建命名锁。 */
    public async releaseCreateLock(manager: EntityManager): Promise<void> {
        await manager.query('SELECT RELEASE_LOCK(?) AS released', [constants.SRM_SIMBANK_CREATE_LOCK])
    }

    /** 生成创建人工号维度自增的设备别名：SSK + 工号 + SMS + 4位分段序号，A001-Z999 后进入 AA01-ZZ99。 */
    public async generateAlias(manager: EntityManager, number: string): Promise<string> {
        const userNumber = number?.trim()
        if (!isNotEmpty(userNumber) || !/^[A-Za-z0-9]+$/.test(userNumber)) {
            throw new BadRequestException('当前登录账号缺少有效工号，无法生成设备别名')
        }
        const prefix = `${constants.SRM_SIMBANK_ALIAS_PREFIX}${userNumber}${constants.SRM_SIMBANK_ALIAS_TYPE}`
        const list = await this.database.builder(manager.getRepository(Schema.TbSrmSimbank), qb => {
            return qb
                .select(['t.keyId', 't.alias'])
                .where('t.alias LIKE :prefix', { prefix: `${prefix}%` })
                .getMany()
        })
        const maxSequence = list.reduce((max, item) => Math.max(max, this.parseAliasSequence(item.alias, prefix)), 0)
        return `${prefix}${this.formatAliasSequence(maxSequence + 1)}`
    }

    /** 把设备别名尾部4位序号转换为连续序号；不符合当前规则的别名返回0。 */
    public parseAliasSequence(alias: string, prefix: string): number {
        const code = alias?.startsWith(prefix) ? alias.slice(prefix.length) : ''
        const single = /^([A-Z])(\d{3})$/.exec(code)
        if (single && Number(single[2]) > 0) {
            return (single[1].charCodeAt(0) - 65) * constants.SRM_SIMBANK_ALIAS_SINGLE_MAX + Number(single[2])
        }
        const double = /^([A-Z])([A-Z])(\d{2})$/.exec(code)
        if (double && Number(double[3]) > 0) {
            const group = (double[1].charCodeAt(0) - 65) * 26 + double[2].charCodeAt(0) - 65
            return constants.SRM_SIMBANK_ALIAS_SINGLE_CAPACITY + group * constants.SRM_SIMBANK_ALIAS_DOUBLE_MAX + Number(double[3])
        }
        return 0
    }

    /** 把连续序号格式化为4位设备别名序号：A001-Z999，之后 AA01-ZZ99。 */
    public formatAliasSequence(sequence: number): string {
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > constants.SRM_SIMBANK_ALIAS_CAPACITY) {
            throw new ConflictException('当前工号设备别名序号已用完')
        }
        if (sequence <= constants.SRM_SIMBANK_ALIAS_SINGLE_CAPACITY) {
            const index = sequence - 1
            const letter = String.fromCharCode(65 + Math.floor(index / constants.SRM_SIMBANK_ALIAS_SINGLE_MAX))
            return `${letter}${String((index % constants.SRM_SIMBANK_ALIAS_SINGLE_MAX) + 1).padStart(3, '0')}`
        }
        const index = sequence - constants.SRM_SIMBANK_ALIAS_SINGLE_CAPACITY - 1
        const group = Math.floor(index / constants.SRM_SIMBANK_ALIAS_DOUBLE_MAX)
        const letters = String.fromCharCode(65 + Math.floor(group / 26), 65 + (group % 26))
        return `${letters}${String((index % constants.SRM_SIMBANK_ALIAS_DOUBLE_MAX) + 1).padStart(2, '0')}`
    }

    /** 获取必需的设备详情；传入事务管理器时加写锁。 */
    public async findRequired(keyId: number, manager?: EntityManager): Promise<Schema.TbSrmSimbank> {
        const repository = (manager ?? this.repository.manager).getRepository(Schema.TbSrmSimbank)
        const simbank = await this.database.builder(repository, qb => {
            qb.where('t.keyId = :keyId', { keyId })
            if (isNotEmpty(manager)) qb.setLock('pessimistic_write')
            return qb.getOne()
        })
        if (!simbank) {
            throw new NotFoundException('设备不存在')
        }
        return simbank
    }

    /** 按 Skyline 枚举 CHUNK_SRM_SIMBANK_MODEL 解析设备型号对应的端口数；型号不存在、已禁用或未配置端口数时抛出 BadRequestException。 */
    public async fetchModelTotal(model: number): Promise<number> {
        const type = Schema.TbSkylineChunkModuleType.CHUNK_SRM_SIMBANK_MODEL
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const record = await this.skylineFeignClient.httpBaseSkylineChunkOptionColumn(authorization, {
            module: Schema.TbSkylineChunkModule.CHUNK_SRM,
            types: [type]
        })
        const option = (record[type]?.options ?? []).find(item => Number(item.keyId) === Number(model))
        if (!option) {
            throw new BadRequestException('设备型号不存在或已禁用')
        }
        const total = Number(option.json?.total)
        if (!Number.isInteger(total) || total < 1) {
            throw new BadRequestException(`设备型号 ${option.label} 未配置有效的端口数`)
        }
        return total
    }

    /** 校验 MAC 地址全表唯一；编辑时排除当前设备。 */
    public async fetchCheckUnique(manager: EntityManager, input: SimbankUniqueInput): Promise<void> {
        const exists = await this.database.builder(manager.getRepository(Schema.TbSrmSimbank), qb => {
            qb.where('t.mac = :mac', { mac: input.mac })
            if (isNotEmpty(input.keyId)) qb.andWhere('t.keyId != :keyId', { keyId: input.keyId })
            return qb.getExists()
        })
        if (exists) throw new ConflictException(`MAC地址 ${input.mac} 已存在`)
    }

    /** 校验归属供应商存在。 */
    public async fetchCheckUser(userKeyId: number, manager?: EntityManager): Promise<Schema.TbSrmUser> {
        return this.userUtilsService.findRequired(userKeyId, manager)
    }

    /** 批量还原设备归属供应商为 userKeyIdOptions，供应商不存在时保留 { keyId }。 */
    public async fetchAppendUserOptions<T extends Pick<Schema.TbSrmSimbank, 'userKeyId'>>(list: T[]) {
        const users = await this.userUtilsService.findByKeyIds(list.map(item => item.userKeyId))
        const options = new Map(users.map(user => [user.keyId, user]))
        for (const item of list) {
            Object.assign(item, { userKeyIdOptions: options.get(item.userKeyId) ?? { keyId: item.userKeyId } })
        }
        return list
    }

    /** 批量还原设备的归属供应商、归属人（含所属组织）、创建人、更新人。 */
    public async fetchAppendColumnOptions<T extends Schema.TbSrmSimbank>(list: T[]) {
        await Promise.all([
            this.fetchAppendUserOptions(list),
            feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, list, ['ownerUserUid'], {
                fields: ['organizations']
            }),
            feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, list, ['createBy', 'modifyBy'])
        ])
        return list
    }

    /** 批量还原端口所属设备、供应商、归属人，以及端口创建人、更新人。 */
    public async fetchAppendPortColumnOptions<T extends Schema.TbSrmSimbankPort>(list: T[]) {
        const simbankKeyIds = [...new Set(list.map(item => item.simbankKeyId))]
        const simbanks = simbankKeyIds.length ? await this.repository.find({ where: { keyId: In(simbankKeyIds) } }) : []
        await Promise.all([
            this.fetchAppendColumnOptions(simbanks),
            feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, list, ['createBy', 'modifyBy'])
        ])
        const options = new Map(simbanks.map(item => [item.keyId, item]))
        for (const item of list) {
            Object.assign(item, { simbankOptions: options.get(item.simbankKeyId) ?? { keyId: item.simbankKeyId } })
        }
        return list
    }
    /** 生成插卡模拟数据：SIM 为国内手机号，ICCID 为 20 位数字，IMEI 为 15 位数字。 */
    public createPortCardFaker(): { sim: string; iccid: string; imei: string } {
        return {
            sim: `+86${this.faker.helpers.fromRegExp('1[3-9][0-9]{9}')}`,
            iccid: this.faker.helpers.fromRegExp('89860[0-4][0-9]{14}'),
            imei: this.faker.phone.imei().replace(/\D/g, '')
        }
    }
}
