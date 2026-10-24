import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min, ValidateNested } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto, VagueDto } from '@wlisfes/chat-web-base-schema/utils'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 路由静态枚举响应：GET /route/enums。 */
export class RouteEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '路由状态选项', example: Schema.TbSrmRouteStatusDefinition.options },
    routeTypeOptions: { description: '路由类型选项', example: Schema.TbSrmRouteTypeDefinition.options },
    channelStatusOptions: { description: '路由通道状态选项', example: Schema.TbSrmRouteChannelStatusDefinition.options },
    appStatusOptions: { description: '短信应用绑定状态选项', example: Schema.TbSrmRouteAppStatusDefinition.options },
    ruleStatusOptions: { description: '规则组状态选项', example: Schema.TbSrmRouteRuleStatusDefinition.options },
    ruleFieldOptions: { description: '条件字段选项', example: Schema.TbSrmRouteRuleFieldDefinition.options },
    ruleOperatorOptions: { description: '条件操作符选项', example: Schema.TbSrmRouteRuleOperatorDefinition.options },
    typeOptions: { description: '短信类型选项', example: Schema.TbSmsAppTypeDefinition.options }
}) {}

/** 数量响应：批量绑定短信应用。 */
export class RouteCountResponseDto {
    @ApiProperty({ description: '处理数量', example: 2 })
    count: number
}

/* ------------------------------ 路由 ------------------------------ */

/** 新增路由入参：POST /route/create；别名按 LSK + 归属人工号 + 路由类型 + 分段序号自动生成，类型创建后不可修改。 */
export class CreateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['name', 'type'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['priority', 'status', 'ownerUserUid', 'remark'] as const))
) {}

/** 编辑路由入参：POST /route/update；只能修改名称、优先级、状态和备注。 */
export class UpdateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['keyId', 'name', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['priority', 'remark'] as const))
) {}

/** 路由主键入参：GET /route/resolve、POST /route/delete。 */
export class RouteKeyDto extends PickType(Schema.TbSrmRouteDto, ['keyId'] as const) {}

/** 路由分页入参：POST /route/column；vague 模糊匹配路由名称或别名。 */
export class ListRouteDto extends IntersectionType(
    PageDto,
    VagueDto,
    PartialType(PickType(Schema.TbSrmRouteDto, ['type', 'status'] as const))
) {}

/** 路由列表项：路由字段展开，并附带绑定的通道和短信应用。 */
export class RouteColumnResponseDto extends Schema.TbSrmRouteDto {
    @ApiProperty({ description: '绑定的通道列表', type: [Schema.TbSrmRouteChannel] })
    channels: Schema.TbSrmRouteChannel[]

    @ApiProperty({ description: '绑定的短信应用列表', type: [Schema.TbSrmRouteApp] })
    apps: Schema.TbSrmRouteApp[]
}

/** 路由分页响应：POST /route/column。 */
export class RoutePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '路由列表', type: [RouteColumnResponseDto] })
    list: RouteColumnResponseDto[]
}

/* ------------------------------ 规则组 ------------------------------ */

/** 绑定规则组明细：已有规则带主键，新增规则不带主键。排序由列表顺序决定，不接收单独的 sort。 */
export class BindRouteRuleItemDto extends IntersectionType(
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['keyId', 'remark'] as const)),
    PickType(Schema.TbSrmRouteRuleDto, ['conditions', 'status'] as const)
) {}

/** 更新路由规则绑定入参：POST /route/rule/bind；以本次提交的规则组列表为准配置条件、状态和备注，并按列表顺序写入排序。空列表表示清空该路由的规则组。 */
export class BindRouteRuleDto extends PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId'] as const) {
    @ApiProperty({ description: '规则组列表，按提交顺序匹配；空列表表示清空该路由的规则组', type: [BindRouteRuleItemDto] })
    @IsArray({ message: '规则组列表必须是数组' })
    @ArrayMaxSize(100, { message: '单次最多配置100个规则组' })
    @ValidateNested({ each: true })
    @Type(() => BindRouteRuleItemDto)
    list: BindRouteRuleItemDto[]
}

/* ------------------------------ 路由通道 ------------------------------ */

/** 绑定通道明细：通道、优先级、权重和绑定状态。 */
export class BindRouteChannelItemDto extends PickType(Schema.TbSrmRouteChannelDto, [
    'channelKeyId',
    'priority',
    'weight',
    'status'
] as const) {}

/** 更新路由通道绑定入参：POST /route/channel/bind；以本次提交的通道列表为准，包含通道、优先级、权重和绑定状态。路由可以挂不同方向和类型的通道。 */
export class BindRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['routeKeyId'] as const) {
    @ApiProperty({ description: '绑定通道列表', type: [BindRouteChannelItemDto] })
    @IsArray({ message: '绑定通道列表必须是数组' })
    @ArrayNotEmpty({ message: '请选择要绑定的通道' })
    @ArrayMaxSize(100, { message: '单次最多加入100个通道' })
    @ValidateNested({ each: true })
    @Type(() => BindRouteChannelItemDto)
    channels: BindRouteChannelItemDto[]
}

/** 路由详情响应：GET /route/resolve；附带绑定的通道、短信应用和规则组。 */
export class RouteResolverResponseDto extends Schema.TbSrmRouteDto {
    @ApiProperty({ description: '绑定的通道列表', type: [Schema.TbSrmRouteChannel] })
    channels: Schema.TbSrmRouteChannel[]

    @ApiProperty({ description: '绑定的短信应用列表', type: [Schema.TbSrmRouteApp] })
    apps: Schema.TbSrmRouteApp[]

    @ApiProperty({ description: '绑定的规则组列表', type: [Schema.TbSrmRouteRule] })
    rules: Schema.TbSrmRouteRule[]
}

/* ------------------------------ 短信应用绑定 ------------------------------ */

/** 绑定短信应用明细：短信应用和绑定状态。 */
export class BindRouteAppItemDto extends PickType(Schema.TbSrmRouteAppDto, ['appKeyId', 'status'] as const) {}

/** 短信应用绑定路由入参：POST /route/app/bind；以本次提交的应用列表为准更新绑定状态。只能绑定同类型路由，已绑定其他路由的应用会改绑到当前路由。 */
export class BindRouteAppDto extends PickType(Schema.TbSrmRouteAppDto, ['routeKeyId'] as const) {
    @ApiProperty({ description: '绑定短信应用列表', type: [BindRouteAppItemDto] })
    @IsArray({ message: '绑定短信应用列表必须是数组' })
    @ArrayNotEmpty({ message: '请选择短信应用' })
    @ArrayMaxSize(100, { message: '单次最多绑定100个短信应用' })
    @ValidateNested({ each: true })
    @Type(() => BindRouteAppItemDto)
    apps: BindRouteAppItemDto[]
}
