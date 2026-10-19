import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository, DataBaseService, EntityManager, Repository } from '@wlisfes/chat-web-base-schema/database'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

/** 设备唯一性校验字段。 */
type SimbankUniqueInput = Pick<Schema.TbSrmSimbank, 'mac'> & Partial<Pick<Schema.TbSrmSimbank, 'alias' | 'keyId'>>

@Injectable()
export class SimbankUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmSimbank) private readonly repository: Repository<Schema.TbSrmSimbank>,
        private readonly database: DataBaseService,
        private readonly userUtilsService: UserUtilsService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService
    ) {}

    /** MAC 地址统一转为大写冒号分隔格式，例如 aa-bb-cc-dd-ee-ff 转为 AA:BB:CC:DD:EE:FF。 */
    public fetchNormalizeMac(mac: string): string {
        return mac.trim().toUpperCase().replace(/-/g, ':')
    }

    /** 别名去除首尾空格，空字符串按未设置处理，避免空字符串触发唯一索引冲突。 */
    public fetchNormalizeAlias(alias?: string | null): string | null {
        return isNotEmpty(alias?.trim()) ? (alias as string).trim() : null
    }

    /** 获取必需的设备详情；传入事务管理器时加写锁。 */
    public async findRequired(keyId: number, manager?: EntityManager): Promise<Schema.TbSrmSimbank> {
        const repository = (manager ?? this.repository.manager).getRepository(Schema.TbSrmSimbank)
        const simbank = await this.database.builder(repository, qb => {
            qb.where('t.keyId = :keyId', { keyId })
            if (isNotEmpty(manager)) qb.setLock('pessimistic_write')
            return qb.getOne()
        })
        if (!simbank) throw new NotFoundException('设备不存在')
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
        if (!option) throw new BadRequestException('设备型号不存在或已禁用')
        const total = Number(option.json?.total)
        if (!Number.isInteger(total) || total < 1) throw new BadRequestException(`设备型号 ${option.label} 未配置有效的端口数`)
        return total
    }

    /** 校验 MAC 地址、别名全表唯一；编辑时排除当前设备。 */
    public async fetchCheckUnique(manager: EntityManager, input: SimbankUniqueInput): Promise<void> {
        const repository = manager.getRepository(Schema.TbSrmSimbank)
        const conflicts = await this.database.builder(repository, qb => {
            qb.select(['t.keyId', 't.mac', 't.alias'])
            qb.where(isNotEmpty(input.alias) ? '(t.mac = :mac OR t.alias = :alias)' : 't.mac = :mac', {
                mac: input.mac,
                alias: input.alias
            })
            if (isNotEmpty(input.keyId)) qb.andWhere('t.keyId != :keyId', { keyId: input.keyId })
            return qb.getMany()
        })
        if (conflicts.some(item => item.mac === input.mac)) throw new ConflictException(`MAC地址 ${input.mac} 已存在`)
        if (conflicts.some(item => isNotEmpty(input.alias) && item.alias === input.alias)) {
            throw new ConflictException(`设备别名 ${input.alias} 已存在`)
        }
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
}
