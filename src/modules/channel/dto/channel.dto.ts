import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min, ValidateNested } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 通道静态枚举响应：GET /channel/enums。 */
export class ChannelEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '通道状态选项', example: Schema.TbSrmChannelStatusDefinition.options },
    portStatusOptions: { description: '绑定状态选项', example: Schema.TbSrmChannelPortStatusDefinition.options },
    typeOptions: { description: '通道类型选项', example: Schema.TbSmsAppTypeDefinition.options }
}) {}

/** 新增通道入参：POST /channel/create；别名按 TSK + 归属人工号 + 类型 + 分段序号自动生成，归属人默认当前登录人，新建通道默认停用。 */
export class CreateChannelDto extends IntersectionType(
    PickType(Schema.TbSrmChannelDto, ['name', 'countryKeyId', 'type', 'sendInterval', 'maxRetry'] as const),
    PartialType(PickType(Schema.TbSrmChannelDto, ['ownerUserUid', 'remark'] as const))
) {}

/** 编辑通道入参：POST /channel/update；别名、方向、类型创建后不可修改。 */
export class UpdateChannelDto extends IntersectionType(
    PickType(Schema.TbSrmChannelDto, ['keyId', 'name', 'ownerUserUid', 'sendInterval', 'maxRetry'] as const),
    PartialType(PickType(Schema.TbSrmChannelDto, ['remark'] as const))
) {}

/** 通道状态入参：POST /channel/status/update。 */
export class UpdateChannelStatusDto extends PickType(Schema.TbSrmChannelDto, ['keyId', 'status'] as const) {}

/** 通道主键入参：GET /channel/resolve、POST /channel/delete。 */
export class ChannelKeyDto extends PickType(Schema.TbSrmChannelDto, ['keyId'] as const) {}

/** 通道分页入参：POST /channel/column；alias 模糊匹配。 */
export class ListChannelDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmChannelDto, ['alias', 'type', 'countryKeyId', 'ownerUserUid', 'status'] as const))
) {}

/** 通道列表项：附带方向、归属人、绑定端口数、启用端口数和引用路由数。 */
export class ChannelColumnResponseDto extends IntersectionType(Schema.TbSrmChannelDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '绑定端口数', example: 32 })
    portCount: number

    @ApiProperty({ description: '启用的绑定端口数', example: 30 })
    enablePortCount: number

    @ApiProperty({ description: '引用该通道的路由数', example: 2 })
    routeCount: number

    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto

    @ApiProperty({ description: '归属人信息', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto
}

/** 通道分页响应：POST /channel/column。 */
export class ChannelPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '通道列表', type: [ChannelColumnResponseDto] })
    list: ChannelColumnResponseDto[]
}

/** 通道下拉项：GET /channel/select。 */
export class ChannelSelectResponseDto extends PickType(Schema.TbSrmChannelDto, [
    'keyId',
    'alias',
    'name',
    'type',
    'countryKeyId',
    'status'
] as const) {}

/** 绑定端口明细：端口、权重和绑定状态。 */
export class BindChannelPortItemDto extends PickType(Schema.TbSrmChannelPortDto, ['portKeyId', 'weight', 'status'] as const) {}

/** 更新通道端口绑定入参：POST /channel/port/bind；以本次提交的端口列表为准，包含端口、权重和绑定状态。 */
export class BindChannelPortDto extends PickType(Schema.TbSrmChannelPortDto, ['channelKeyId'] as const) {
    @ApiProperty({ description: '绑定端口列表', type: [BindChannelPortItemDto] })
    @IsArray({ message: '绑定端口列表必须是数组' })
    @ArrayNotEmpty({ message: '请选择要绑定的端口' })
    @ArrayMaxSize(500, { message: '单次最多绑定500个端口' })
    @ValidateNested({ each: true })
    @Type(() => BindChannelPortItemDto)
    list: BindChannelPortItemDto[]
}

/** 通道详情响应：GET /channel/resolve；附带该通道已绑定的端口。 */
export class ChannelResolverResponseDto extends Schema.TbSrmChannelDto {
    @ApiProperty({ description: '绑定的端口列表', type: [Schema.TbSrmChannelPortDto] })
    list: Schema.TbSrmChannelPortDto[]
}
