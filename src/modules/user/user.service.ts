import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import { InjectRepository, DataBaseService, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, isNotEmpty, fetchResolver, fetchUntiePagination } from '@wlisfes/chat-web-base-schema/utils'
import * as UserDto from '@/modules/user/dto/user.dto'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(Schema.TbSrmUser) private readonly repository: Repository<Schema.TbSrmUser>,
        @InjectRepository(Schema.TbSrmUserContact) private readonly contactRepository: Repository<Schema.TbSrmUserContact>,
        private readonly database: DataBaseService,
        private readonly userUtilsService: UserUtilsService,
        private readonly skylineFeignClient: feign.FeignClientSkylineManager,
        private readonly configService: ConfigService,
        private readonly routeConfigEventService: RouteConfigEventService
    ) {}

    /** 供应商静态枚举。 */
    public async httpBaseSrmUserEnums(): Promise<UserDto.UserEnumsResponseDto> {
        return {
            statusOptions: Schema.TbSrmUserStatusDefinition.options,
            payModeOptions: Schema.TbSrmUserPayModeDefinition.options,
            stageOptions: Schema.TbSrmUserStageDefinition.options,
            contactStatusOptions: Schema.TbSrmUserContactStatusDefinition.options
        }
    }

    /** 随机生成新增供应商表单初始化数据。 */
    public async httpBaseSrmUserFaker(): Promise<UserDto.UserFakerResponseDto> {
        return this.userUtilsService.createFakerUser()
    }

    /** 新增 SRM 供应商。 */
    public async httpBaseSrmCreateUser(principal: AuthPrincipal, input: UserDto.CreateUserDto): Promise<Schema.TbSrmUser> {
        return this.userUtilsService.createUser({ ...input, ownerUserUid: principal.uid, ownerUserNumber: principal.number })
    }

    /** 编辑 SRM 供应商。 */
    public async httpBaseSrmUpdateUser(input: UserDto.UpdateUserDto): Promise<Schema.TbSrmUser> {
        const result = await this.repository.manager.transaction(async manager => {
            const user = await this.userUtilsService.findRequired(input.keyId, manager)
            manager.merge(Schema.TbSrmUser, user, {
                name: input.name,
                currency: input.currency,
                email: input.email,
                phone: input.phone,
                payMode: input.payMode,
                remark: input.remark
            })
            return await manager.save(user)
        })
        await this.routeConfigEventService.publish(`供应商变更：keyId=${input.keyId}`)
        return result
    }

    /** 更新 SRM 供应商状态。 */
    public async httpBaseSrmUserStatusUpdate(input: UserDto.UpdateUserStatusDto): Promise<Schema.TbSrmUser> {
        const result = await this.repository.manager.transaction(async manager => {
            const user = await this.userUtilsService.findRequired(input.keyId, manager)
            user.status = input.status
            return await manager.save(user)
        })
        await this.routeConfigEventService.publish(`供应商状态变更：keyId=${input.keyId}`)
        return result
    }

    /** 分页查询 SRM 供应商，归属人通过账号 Feign 还原为 ownerUserUidOptions（含所属组织）。 */
    public async httpBaseSrmColumnUser(input: UserDto.ListUserDto): Promise<PageResult<UserDto.UserColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            if (isNotEmpty(input.name?.trim())) {
                qb.andWhere('(t.name LIKE :name OR t.keyId LIKE :name)', { name: `%${input.name?.trim()}%` })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            if (isNotEmpty(input.currency)) {
                qb.andWhere('t.currency = :currency', { currency: input.currency })
            }
            if (isNotEmpty(input.payMode)) {
                qb.andWhere('t.payMode = :payMode', { payMode: input.payMode })
            }
            if (isNotEmpty(input.source)) {
                qb.andWhere('t.source = :source', { source: input.source })
            }
            qb.orderBy('t.createTime', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                await feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, list, ['ownerUserUid'], {
                    fields: ['organizations']
                })
                return fetchResolver({ page, size, total, list })
            })
        })
    }

    /** 获取 SRM 供应商详情，归属人通过账号 Feign 还原为 ownerUserUidOptions（含所属组织），并附带供应商配置。 */
    public async httpBaseSrmUserResolver(query: UserDto.ResolveUserDto): Promise<UserDto.UserResolveResponseDto> {
        const user = await this.userUtilsService.findRequired(query.keyId)
        const [config] = await Promise.all([
            this.userUtilsService.findConfig(query.keyId),
            feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, [user], ['ownerUserUid'], {
                fields: ['organizations']
            })
        ])
        return Object.assign(user, { config })
    }

    /** 获取供应商配置；供应商不存在时抛出 NotFoundException，未配置时返回默认值。 */
    public async httpBaseSrmUserConfigResolver(query: UserDto.ResolveUserConfigDto): Promise<UserDto.UserConfigResponseDto> {
        await this.userUtilsService.findRequired(query.userKeyId)
        return this.userUtilsService.findConfig(query.userKeyId)
    }

    /** 获取 SRM 供应商下拉选项。 */
    public async httpBaseSrmSelectUser(query: UserDto.SelectUserDto): Promise<UserDto.UserSelectResponseDto[]> {
        return this.database.builder(this.repository, async qb => {
            qb.where('t.status = :status', { status: Schema.TbSrmUserStatus.ENABLE })
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.take(200)
            if (isNotEmpty(query.name?.trim())) {
                qb.andWhere('(t.name LIKE :name OR t.alias LIKE :name OR t.keyId LIKE :name)', { name: `%${query.name?.trim()}%` })
            }
            return (await qb.getMany()).map(user => ({
                keyId: user.keyId,
                ownerUserUid: user.ownerUserUid,
                name: user.name,
                alias: user.alias,
                currency: user.currency,
                email: user.email,
                phone: user.phone,
                status: user.status
            }))
        })
    }

    /** 新增供应商联系人，联系人状态默认有效。 */
    public async httpBaseSrmCreateUserContact(
        principal: AuthPrincipal,
        input: UserDto.CreateUserContactDto
    ): Promise<Schema.TbSrmUserContact> {
        await this.userUtilsService.findRequired(input.userKeyId)
        return this.contactRepository.save(
            this.contactRepository.create({
                userKeyId: input.userKeyId,
                name: input.name,
                items: input.items ?? [],
                address: input.address,
                status: Schema.TbSrmUserContactStatus.ENABLE,
                remark: input.remark,
                createBy: principal.uid,
                modifyBy: principal.uid
            })
        )
    }

    /** 编辑供应商联系人。 */
    public async httpBaseSrmUpdateUserContact(
        principal: AuthPrincipal,
        input: UserDto.UpdateUserContactDto
    ): Promise<Schema.TbSrmUserContact> {
        return this.repository.manager.transaction(async manager => {
            const contact = await this.userUtilsService.findContactRequired(input.keyId, manager)
            manager.merge(Schema.TbSrmUserContact, contact, {
                name: input.name,
                items: input.items ?? [],
                address: input.address,
                remark: input.remark,
                modifyBy: principal.uid
            })
            return await manager.save(contact)
        })
    }

    /** 修改供应商联系人状态。 */
    public async httpBaseSrmUserContactStatusUpdate(
        principal: AuthPrincipal,
        input: UserDto.UpdateUserContactStatusDto
    ): Promise<Schema.TbSrmUserContact> {
        return this.repository.manager.transaction(async manager => {
            const contact = await this.userUtilsService.findContactRequired(input.keyId, manager)
            contact.status = input.status
            contact.modifyBy = principal.uid
            return await manager.save(contact)
        })
    }

    /** 分页查询供应商联系人，按创建时间倒序；创建人、更新人通过账号 Feign 还原为 createByOptions、modifyByOptions。 */
    public async httpBaseSrmColumnUserContact(
        input: UserDto.ListUserContactDto
    ): Promise<PageResult<UserDto.UserContactColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.contactRepository, async qb => {
            qb.where('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            qb.orderBy('t.createTime', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                await feign.fetchAppendSkylineUserOptions(this.skylineFeignClient, this.configService, list, ['createBy', 'modifyBy'])
                return fetchResolver({ page, size, total, list })
            })
        })
    }
}
