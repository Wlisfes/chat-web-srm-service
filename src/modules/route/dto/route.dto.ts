import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min, ValidateNested } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto, VagueDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
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

/** 路由覆盖的 方向 + 类型。 */
export class RouteCoverageDto {
    @ApiProperty({ description: '方向：Skyline 国家/地区主键', example: 1007 })
    countryKeyId: number

    @ApiProperty({ description: '短信类型', enum: Schema.TbSmsAppType, example: Schema.TbSmsAppType.MRKT })
    type: Schema.TbSmsAppType

    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto

    @ApiProperty({ description: '该方向和类型下的通道数', example: 3 })
    channelCount: number

    @ApiProperty({ description: '该方向和类型下的可用通道数', example: 2 })
    activeChannelCount: number
}

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

/** 路由下拉项：GET /route/select。 */
export class RouteSelectResponseDto extends PickType(Schema.TbSrmRouteDto, [
    'keyId',
    'name',
    'alias',
    'type',
    'priority',
    'status'
] as const) {}

/* ------------------------------ 规则组 ------------------------------ */

/** 新增规则组入参：POST /route/rule/create。 */
export class CreateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId', 'conditions'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['sort', 'status', 'remark'] as const))
) {}

/** 编辑规则组入参：POST /route/rule/update；可修改排序、条件、状态和备注。 */
export class UpdateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['keyId', 'conditions', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['sort', 'remark'] as const))
) {}

/** 规则组主键入参：POST /route/rule/delete。 */
export class RouteRuleKeyDto extends PickType(Schema.TbSrmRouteRuleDto, ['keyId'] as const) {}

/** 规则组列表入参：GET /route/rule/list。 */
export class ListRouteRuleDto extends PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId'] as const) {}

/** 规则组列表项：附带规则组的中文描述。 */
export class RouteRuleResponseDto extends Schema.TbSrmRouteRuleDto {
    @ApiProperty({ description: '规则组描述', example: '方向 属于 中国 且 类型 属于 MRKT' })
    description: string
}

/* ------------------------------ 路由通道 ------------------------------ */

/** 绑定通道明细：通道、优先级、权重和绑定状态。 */
export class BindRouteChannelItemDto extends PickType(Schema.TbSrmRouteChannelDto, ['channelKeyId', 'priority', 'weight', 'status'] as const) {}

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

/** 路由通道的通道摘要。 */
export class RouteChannelOptionDto extends PickType(Schema.TbSrmChannelDto, ['keyId', 'alias', 'type', 'countryKeyId', 'status'] as const) {
    @ApiProperty({ description: '启用的绑定端口数', example: 30 })
    enablePortCount: number

    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto
}

/** 路由通道列表项：附带通道信息、是否可用和分流占比。 */
export class RouteChannelResponseDto extends Schema.TbSrmRouteChannelDto {
    @ApiProperty({ description: '通道信息', required: false, type: RouteChannelOptionDto })
    channelOptions?: RouteChannelOptionDto

    @ApiProperty({ description: '是否可用：路由通道启用、通道启用且有启用端口', example: true })
    active: boolean

    @ApiProperty({ description: '分流占比：同一路由内同方向、同类型、同优先级的可用通道之间按权重计算（百分比）', example: 60 })
    ratio: number
}

/** 路由详情响应：GET /route/resolve；附带路由绑定的通道和短信应用。 */
export class RouteResolverResponseDto extends Schema.TbSrmRouteDto {
    @ApiProperty({ description: '绑定的通道列表', type: [Schema.TbSrmRouteChannel] })
    channels: Schema.TbSrmRouteChannel[]

    @ApiProperty({ description: '绑定的短信应用列表', type: [Schema.TbSrmRouteApp] })
    apps: Schema.TbSrmRouteApp[]
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


/** 客户摘要。 */
export class RouteUserOptionDto {
    @ApiProperty({ description: '客户主键', example: 10241000 })
    keyId: number

    @ApiProperty({ description: '客户名称', required: false, example: '测试客户' })
    name?: string

    @ApiProperty({ description: '客户别名', required: false, example: 'RCK1024A7K9' })
    alias?: string
}

/** 短信应用绑定列表项：附带短信应用、客户和路由信息。 */
export class RouteAppColumnResponseDto extends IntersectionType(Schema.TbSrmRouteAppDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '短信应用信息', required: false, type: feign.SmsAppSummaryResponseDto })
    appKeyIdOptions?: feign.SmsAppSummaryResponseDto

    @ApiProperty({ description: '客户信息', required: false, type: RouteUserOptionDto })
    userKeyIdOptions?: RouteUserOptionDto

    @ApiProperty({ description: '路由信息', required: false, type: RouteSelectResponseDto })
    routeKeyIdOptions?: RouteSelectResponseDto
}
