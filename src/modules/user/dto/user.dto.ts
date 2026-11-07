import { ApiProperty, ApiPropertyOptional, IntersectionType, OmitType, PartialType, PickType } from '@nestjs/swagger'
import { IsEmail, ArrayMaxSize, IsArray, IsDefined, IsInt, IsOptional, Min, IsString, MaxLength, ValidateNested } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import { Transform, Type } from 'class-transformer'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 新增供应商时同步新增的联系人信息：CreateUserDto.contact 字段结构，见 POST /user/create。 */
export class CreateUserContactItemDto extends PickType(Schema.TbSrmUserContactDto, ['name', 'items', 'address', 'remark'] as const) {}

/** 新增供应商入参：POST /user/create；供应商别名由服务端按创建人工号生成，状态、注册来源不传时使用默认值。 */
export class CreateUserDto extends IntersectionType(
    PickType(Schema.TbSrmUserDto, ['name', 'currency', 'email', 'phone', 'payMode', 'remark'] as const),
    PartialType(PickType(Schema.TbSrmUserDto, ['status', 'source'] as const))
) {
    @ApiProperty({ description: '联系人信息，新增供应商时必填，同一事务内创建一条联系人', type: CreateUserContactItemDto })
    @IsDefined({ message: '联系人信息必填' })
    @ValidateNested()
    @Type(() => CreateUserContactItemDto)
    contact: CreateUserContactItemDto
}

/** 更新供应商入参：POST /user/update；供应商别名创建后不可修改。 */
export class UpdateUserDto extends IntersectionType(
    OmitType(CreateUserDto, ['contact'] as const),
    PickType(Schema.TbSrmUserDto, ['keyId'] as const)
) {}

/** 更新供应商状态入参：POST /user/status/update。 */
export class UpdateUserStatusDto extends PickType(Schema.TbSrmUserDto, ['keyId', 'status'] as const) {}

/** 获取供应商详情入参：GET /user/resolve。 */
export class ResolveUserDto extends PickType(Schema.TbSrmUserDto, ['keyId'] as const) {}

/** 获取供应商下拉选项入参：GET /user/select。name 可空，空字符串表示不过滤。 */
export class SelectUserDto {
    @ApiPropertyOptional({ description: '模糊匹配供应商名称；不传或空字符串表示不过滤', example: '昊天' })
    @Transform(({ value }) => (typeof value === 'string' && !value.trim() ? undefined : value))
    @IsOptional()
    @IsString({ message: '供应商名称必须是字符串' })
    @MaxLength(64, { message: '供应商名称长度不能超过64位' })
    name?: string
}

/** 分页查询供应商入参：POST /user/column。 */
export class ListUserDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmUserDto, ['name', 'alias', 'ownerUserUid', 'status', 'currency', 'payMode', 'source'] as const))
) {
    @ApiProperty({ description: '邮箱，模糊匹配', required: false, example: 'gmail.com' })
    @IsOptional()
    @IsString({ message: '邮箱必须是字符串' })
    @MaxLength(128, { message: '邮箱最多128个字符' })
    email?: string

    @ApiProperty({
        description: '归属部门：Skyline 组织主键集合，包含下级部门',
        required: false,
        type: Number,
        isArray: true,
        example: [1001]
    })
    @IsOptional()
    @IsArray({ message: '归属部门必须是数组' })
    @ArrayMaxSize(100, { message: '归属部门最多选择100个' })
    @Type(() => Number)
    @IsInt({ each: true, message: '归属部门主键必须是整数' })
    ownerOrganizationKeyIds?: number[]
}

/** 供应商静态枚举响应：GET /user/enums。 */
export class UserEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '供应商状态选项', example: Schema.TbSrmUserStatusDefinition.options },
    payModeOptions: { description: '付款模式选项', example: Schema.TbSrmUserPayModeDefinition.options },
    stageOptions: { description: '供应商阶段选项', example: Schema.TbSrmUserStageDefinition.options },
    contactStatusOptions: { description: '联系人状态选项', example: Schema.TbSrmUserContactStatusDefinition.options }
}) {}

/** 供应商列表项及详情响应：POST /user/column 列表项、GET /user/resolve。 */
export class UserColumnResponseDto extends Schema.TbSrmUserDto {
    @ApiProperty({ description: '归属人信息（含所属组织 organizations）', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto

    @ApiProperty({
        description: '余额（放大百万倍存储值）：来自 Finance 供应商钱包；没有钱包时为 0，Finance 不可用时为 null',
        example: 0,
        nullable: true
    })
    balance: number | null

    @ApiProperty({
        description: '信用额度（放大百万倍存储值）：来自 Finance 供应商钱包；没有钱包时为 0，Finance 不可用时为 null',
        example: 0,
        nullable: true
    })
    credit: number | null
}

/** 分页查询供应商响应：POST /user/column。 */
export class UserPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '供应商列表', type: [UserColumnResponseDto] })
    list: UserColumnResponseDto[]
}

/** 供应商下拉选项响应：GET /user/select。 */
export class UserSelectResponseDto extends PickType(Schema.TbSrmUserDto, [
    'keyId',
    'ownerUserUid',
    'name',
    'alias',
    'currency',
    'email',
    'phone',
    'status'
] as const) {}

/** 获取供应商配置入参：GET /user/config/resolve。 */
export class ResolveUserConfigDto extends PickType(Schema.TbSrmUserConfigDto, ['userKeyId'] as const) {}

/** 供应商配置响应：GET /user/config/resolve，只返回供应商主键和 SIMBANK 设备最大数。 */
export class UserConfigResponseDto extends PickType(Schema.TbSrmUserConfigDto, ['userKeyId', 'simbankLimit'] as const) {}

/** 供应商详情响应：GET /user/resolve，在列表项基础上附带供应商配置。 */
export class UserResolveResponseDto extends UserColumnResponseDto {
    @ApiProperty({ description: '供应商配置，未配置时返回默认值', type: UserConfigResponseDto })
    config: UserConfigResponseDto
}

/** 新增供应商随机表单数据：GET /user/faker，供新增供应商表单初始化使用。 */
export class UserFakerResponseDto extends PickType(CreateUserDto, [
    'name',
    'currency',
    'email',
    'phone',
    'payMode',
    'remark',
    'contact'
] as const) {}

/** 新增供应商联系人入参：POST /user/contact/create。 */
export class CreateUserContactDto extends PickType(Schema.TbSrmUserContactDto, [
    'userKeyId',
    'name',
    'items',
    'address',
    'remark'
] as const) {}

/** 编辑供应商联系人入参：POST /user/contact/update。 */
export class UpdateUserContactDto extends PickType(Schema.TbSrmUserContactDto, ['keyId', 'name', 'items', 'address', 'remark'] as const) {}

/** 修改供应商联系人状态入参：POST /user/contact/status/update。 */
export class UpdateUserContactStatusDto extends PickType(Schema.TbSrmUserContactDto, ['keyId', 'status'] as const) {}

/** 分页查询供应商联系人入参：POST /user/contact/column。 */
export class ListUserContactDto extends IntersectionType(PageDto, PickType(Schema.TbSrmUserContactDto, ['userKeyId'] as const)) {}

/** 供应商联系人列表项响应：POST /user/contact/column。 */
export class UserContactColumnResponseDto extends Schema.TbSrmUserContactDto {
    @ApiProperty({
        description: '创建人选项，通过 Skyline 账号 Feign 按 createBy 还原',
        type: feign.SkylineUserOptionResponseDto,
        required: false
    })
    createByOptions?: feign.SkylineUserOptionResponseDto

    @ApiProperty({
        description: '更新人选项，通过 Skyline 账号 Feign 按 modifyBy 还原',
        type: feign.SkylineUserOptionResponseDto,
        required: false
    })
    modifyByOptions?: feign.SkylineUserOptionResponseDto
}

/** 分页查询供应商联系人响应：POST /user/contact/column。 */
export class UserContactPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '联系人列表', type: [UserContactColumnResponseDto] })
    list: UserContactColumnResponseDto[]
}

/** 校验邮箱是否可用入参：GET /user/email/validate。编辑时传当前主键以排除自身。 */
export class ValidateUserEmailDto {
    @ApiProperty({ description: '邮箱', example: 'consumer@example.com' })
    @IsEmail({}, { message: '邮箱格式错误' })
    @MaxLength(128, { message: '邮箱长度不能超过128位' })
    email: string

    @ApiProperty({ description: '编辑时排除的账号主键', required: false, example: 10241000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt({ message: '账号主键必须是整数' })
    @Min(1, { message: '账号主键必须大于0' })
    keyId?: number
}

/** 邮箱校验响应：GET /user/email/validate。 */
export class UserEmailValidateResponseDto {
    @ApiProperty({ description: '邮箱是否可以使用', example: true })
    available: boolean

    @ApiProperty({ description: '不可用时的原因', required: false, example: '该邮箱已注册为供应商' })
    message?: string
}
