import { randomInt } from 'node:crypto'
import { Faker, en, zh_CN } from '@faker-js/faker'
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository, DataBaseService, EntityManager, In, Repository } from '@wlisfes/chat-web-base-schema/database'
import {
    FeignClientFinanceManager,
    resolveFeignServiceAuthorization,
    type FinanceSrmUserSummary
} from '@wlisfes/chat-web-base-schema/feign'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as constants from '@/modules/user/user.constants'
import chinaDivision from 'china-division'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as UserDto from '@/modules/user/dto/user.dto'

/** Finance 供应商钱包批量查询单次上限。 */
const SRM_USER_RESOLVE_LIMIT = 100

/** 供应商列表、详情展示的钱包字段：来自 Finance 供应商钱包。 */
interface SupplierBalanceFields {
    /** 财务币种编码。没有钱包时保留供应商资料上的币种；Finance 不可用时也不覆盖。 */
    currency?: string | null
    /** 余额（放大百万倍存储值）：按钱包币种计；Finance 不可用时为 null。 */
    balance: number | null
    /** 信用额度（放大百万倍存储值）：按钱包币种计；Finance 不可用时为 null。 */
    credit: number | null
}

@Injectable()
export class UserUtilsService {
    private readonly logger = new Logger(UserUtilsService.name)
    private readonly faker = new Faker({ locale: [zh_CN, en] })

    constructor(
        @InjectRepository(Schema.TbSrmUser) private readonly repository: Repository<Schema.TbSrmUser>,
        @InjectRepository(Schema.TbSrmUserConfig) private readonly configRepository: Repository<Schema.TbSrmUserConfig>,
        private readonly database: DataBaseService,
        private readonly financeFeignClient: FeignClientFinanceManager,
        private readonly configService: ConfigService
    ) {}

    /** 随机生成新增供应商表单初始化数据。 */
    public createFakerUser(): UserDto.UserFakerResponseDto {
        const email = this.faker.internet.email({
            provider: this.faker.helpers.arrayElement(['sugtbt.com', 'qabq.com', 'nqmo.com', 'uuf.me', 'end.tw', '69n.net'])
        })
        return {
            name: this.faker.company.name(),
            currency: 'USD',
            email,
            phone: this.faker.helpers.fromRegExp('1[3-9][0-9]{9}'),
            payMode: Schema.TbSrmUserPayMode.PREPAID,
            remark: this.faker.lorem.paragraph(),
            contact: {
                name: this.faker.person.fullName(),
                address: this.createFakerAddress().address,
                remark: this.faker.lorem.paragraph(),
                items: [{ type: '1024188', value: email }]
            }
        }
    }

    /** 随机生成测试地址：行政区划来自 china-division，街道门牌来自 faker。 */
    private createFakerAddress() {
        const FAKER_SKIP_CITY = ['市辖区', '县', '省直辖县级行政区划', '自治区直辖县级行政区划']
        const pcas: Schema.Omix = chinaDivision.pcas
        const province = this.faker.helpers.objectKey<Schema.Omix>(pcas)
        const city = this.faker.helpers.objectKey<Schema.Omix>(pcas[province])
        const area = this.faker.helpers.objectKey<Schema.Omix>(pcas[province][city])
        const street = this.faker.helpers.arrayElement<string>(pcas[province][city][area])
        const cityName = FAKER_SKIP_CITY.includes(city) ? '' : city
        const region = `${province}${cityName}${area === cityName ? '' : area}${street}`
        return {
            province,
            city,
            area,
            street,
            address: `${region}${this.faker.location.streetAddress(true).replace(/\s+/g, '')}`
        }
    }

    /** 获取必需的供应商详情。 */
    public async findRequired(keyId: number, manager?: EntityManager): Promise<Schema.TbSrmUser> {
        const repository = (manager ?? this.repository.manager).getRepository(Schema.TbSrmUser)
        const user = await this.database.builder(repository, qb => {
            qb.where('t.keyId = :keyId', { keyId })
            if (isNotEmpty(manager)) qb.setLock('pessimistic_write')
            return qb.getOne()
        })
        if (!user) throw new NotFoundException('供应商不存在')
        return user
    }

    /** 获取必需的供应商联系人；传入事务管理器时加写锁。 */
    public async findContactRequired(keyId: number, manager?: EntityManager): Promise<Schema.TbSrmUserContact> {
        const repository = (manager ?? this.repository.manager).getRepository(Schema.TbSrmUserContact)
        const contact = await this.database.builder(repository, qb => {
            qb.where('t.keyId = :keyId', { keyId })
            if (isNotEmpty(manager)) {
                qb.setLock('pessimistic_write')
            }
            return qb.getOne()
        })
        if (!contact) {
            throw new NotFoundException('联系人不存在')
        }
        return contact
    }

    /** 按主键批量查询供应商基础信息，用于列表关联展示。 */
    public async findByKeyIds(keyIds: number[]): Promise<Array<Pick<Schema.TbSrmUser, 'keyId' | 'name' | 'alias'>>> {
        const uniqueKeyIds = [...new Set(keyIds)]
        if (uniqueKeyIds.length === 0) {
            return []
        }
        return this.repository.find({ select: { keyId: true, name: true, alias: true }, where: { keyId: In(uniqueKeyIds) } })
    }

    /** 按主键批量查询供应商详情，供 Feign 批量查询使用，单次最多 100 个。 */
    public async findColumnResolver(keyIds: number[]): Promise<Schema.TbSrmUser[]> {
        const uniqueKeyIds = [...new Set(keyIds)].filter(keyId => Number.isInteger(keyId) && keyId > 0)
        if (uniqueKeyIds.length === 0) {
            return []
        }
        if (uniqueKeyIds.length > 100) {
            throw new BadRequestException('单次最多查询100个供应商')
        }
        return this.repository.find({ where: { keyId: In(uniqueKeyIds) } })
    }

    /** 查询供应商配置；未配置时返回默认值。传入事务管理器时锁定配置行，供后续校验上限时串行处理。 */
    public async findConfig(
        userKeyId: number,
        manager?: EntityManager
    ): Promise<Pick<Schema.TbSrmUserConfig, 'userKeyId' | 'simbankLimit'>> {
        const repository = (manager ?? this.configRepository.manager).getRepository(Schema.TbSrmUserConfig)
        const config = await this.database.builder(repository, qb => {
            qb.where('t.userKeyId = :userKeyId', { userKeyId })
            if (isNotEmpty(manager)) {
                qb.setLock('pessimistic_write')
            }
            return qb.getOne()
        })
        return { userKeyId, simbankLimit: config?.simbankLimit ?? Schema.TB_SRM_USER_CONFIG_DEFAULT_SIMBANK_LIMIT }
    }

    /** 新增供应商配置；已存在时直接返回，保证一个供应商只有一条配置。 */
    public async saveConfig(manager: EntityManager, userKeyId: number, uid: string): Promise<Schema.TbSrmUserConfig> {
        const repository = manager.getRepository(Schema.TbSrmUserConfig)
        const config = await this.database.builder(repository, qb => {
            return qb.where('t.userKeyId = :userKeyId', { userKeyId }).setLock('pessimistic_write').getOne()
        })
        if (config) {
            return config
        }
        return repository.save(repository.create({ userKeyId, createBy: uid, modifyBy: uid }))
    }

    /** 生成供应商别名：RSK + 创建人工号 + 4位数字或大写字母随机码；查询碰撞后重试，数据库唯一索引兜底防止并发重复。 */
    public async generateAlias(manager: EntityManager, number: string): Promise<string> {
        const userNumber = number?.trim()
        if (!isNotEmpty(userNumber) || !/^[A-Za-z0-9]+$/.test(userNumber)) {
            throw new BadRequestException('当前登录账号缺少有效工号，无法生成供应商别名')
        }
        const repository = manager.getRepository(Schema.TbSrmUser)
        for (let attempt = 0; attempt < constants.SRM_USER_ALIAS_MAX_ATTEMPTS; attempt += 1) {
            const code = Array.from(
                { length: constants.SRM_USER_ALIAS_RANDOM_LENGTH },
                () => constants.SRM_USER_ALIAS_RANDOM_CHARACTERS[randomInt(constants.SRM_USER_ALIAS_RANDOM_CHARACTERS.length)]
            ).join('')
            const alias = `${constants.SRM_USER_ALIAS_PREFIX}${userNumber}${code}`
            const exists = await this.database.builder(repository, qb => qb.where('t.alias = :alias', { alias }).getExists())
            if (!exists) {
                return alias
            }
        }
        throw new ConflictException('供应商别名生成失败，请重试')
    }

    /** 新增供应商，同一事务内初始化默认供应商配置并创建一条联系人；提交后创建 Finance 钱包。 */
    public async createUser(input: UserDto.CreateUserDto & { ownerUserUid: string; ownerUserNumber: string }): Promise<Schema.TbSrmUser> {
        if (!input.contact) {
            throw new BadRequestException('新增供应商必须填写联系人信息')
        }
        const user = await this.repository.manager.transaction(async manager => {
            const alias = await this.generateAlias(manager, input.ownerUserNumber)
            const created = await manager.save(this.buildUser(manager, { ...input, alias }))
            await this.saveConfig(manager, created.keyId, input.ownerUserUid)
            await manager.save(
                manager.create(Schema.TbSrmUserContact, {
                    userKeyId: created.keyId,
                    name: input.contact.name,
                    items: input.contact.items ?? [],
                    address: input.contact.address,
                    status: Schema.TbSrmUserContactStatus.ENABLE,
                    remark: input.contact.remark,
                    createBy: input.ownerUserUid,
                    modifyBy: input.ownerUserUid
                })
            )
            return created
        })
        const payMode =
            user.payMode === Schema.TbSrmUserPayMode.PREPAID
                ? Schema.TbFinanceSrmUserWalletPayMode.PREPAID
                : user.payMode === Schema.TbSrmUserPayMode.POSTPAID
                  ? Schema.TbFinanceSrmUserWalletPayMode.POSTPAID
                  : undefined
        if (!payMode) {
            await this.removeCreatedUser(user.keyId)
            throw new BadRequestException('付款模式格式错误')
        }
        try {
            await this.financeFeignClient.httpBaseFinanceCreateSrmUserWallet(resolveFeignServiceAuthorization(this.configService), {
                userKeyId: user.keyId,
                currency: user.currency,
                payMode
            })
        } catch (error) {
            await this.removeCreatedUser(user.keyId)
            const reason = error instanceof Error ? error.message : String(error)
            throw new ServiceUnavailableException(`创建供应商钱包失败：${reason}`)
        }
        return user
    }

    /** 钱包创建失败时删掉刚写入的供应商，避免留下没有钱包的账号。 */
    private async removeCreatedUser(userKeyId: number): Promise<void> {
        await this.repository.manager.transaction(async manager => {
            await manager.delete(Schema.TbSrmUserContact, { userKeyId })
            await manager.delete(Schema.TbSrmUserConfig, { userKeyId })
            await manager.delete(Schema.TbSrmUser, { keyId: userKeyId })
        })
    }

    /** 组装新供应商实体。 */
    private buildUser(manager: EntityManager, input: UserDto.CreateUserDto & { ownerUserUid: string; alias: string }): Schema.TbSrmUser {
        return manager.create(Schema.TbSrmUser, {
            ownerUserUid: input.ownerUserUid,
            name: input.name,
            alias: input.alias,
            currency: input.currency,
            email: input.email,
            phone: input.phone,
            status: input.status ?? Schema.TbSrmUserStatus.ENABLE,
            payMode: input.payMode,
            balance: 0,
            balanceUsd: 0,
            credit: 0,
            creditUsd: 0,
            level: 1,
            stage: Schema.TbSrmUserStage.CLUETRAIL,
            source: input.source ?? constants.SRM_USER_SOURCE_MANUAL,
            remark: input.remark
        })
    }

    /**
     * 为供应商列表追加 Finance 钱包，直接修改并返回原列表。
     * Finance 是供应商余额的权威来源；不可用时余额返回 null，不影响列表和详情的其他内容。
     */
    public async fetchAppendBalance<T extends { keyId: number }>(list: T[]): Promise<Array<T & SupplierBalanceFields>> {
        const accounts = await this.findAccounts(list.map(item => item.keyId))
        for (const item of list) {
            const account = (accounts.get(item.keyId) ?? {}) as FinanceSrmUserSummary
            Object.assign(item, { balance: account.balance ?? 0, credit: account.credit ?? 0 })
        }
        return list as Array<T & SupplierBalanceFields>
    }

    /** 按 100 个一批查询 Finance；失败时返回 undefined，由调用方展示为空余额。 */
    private async findAccounts(keyIds: number[]): Promise<Map<number, FinanceSrmUserSummary>> {
        const unique = [...new Set(keyIds)].filter(keyId => Number.isInteger(keyId) && keyId > 0)
        if (unique.length === 0) {
            return new Map()
        }
        try {
            const authorization = resolveFeignServiceAuthorization(this.configService)
            const groups = Array.from({ length: Math.ceil(unique.length / SRM_USER_RESOLVE_LIMIT) }, (_, index) =>
                unique.slice(index * SRM_USER_RESOLVE_LIMIT, (index + 1) * SRM_USER_RESOLVE_LIMIT)
            )
            const results = await Promise.all(
                groups.map(userKeyIds => this.financeFeignClient.httpBaseFinanceColumnSrmUserResolver(authorization, { userKeyIds }))
            )
            return new Map(results.flat().map(account => [account.userKeyId, account]))
        } catch (error) {
            this.logger.warn(`查询 Finance 供应商钱包失败，余额暂不展示：${error instanceof Error ? error.message : String(error)}`)
            return new Map()
        }
    }
}
