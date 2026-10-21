import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 路由静态枚举响应：GET /route/enums。 */
export class RouteEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '路由状态选项', example: Schema.TbSrmRouteStatusDefinition.options },
    channelStatusOptions: { description: '路由通道状态选项', example: Schema.TbSrmRouteChannelStatusDefinition.options },
    typeOptions: { description: '短信类型选项', example: Schema.TbSrmChannelTypeDefinition.options }
}) {}

/** 新增路由入参：POST /route/create；方向 + 类型 + 客户唯一，userKeyId 不传或 0 表示默认路由。 */
export class CreateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['countryKeyId', 'type'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['userKeyId', 'status', 'remark'] as const))
) {}

/** 编辑路由入参：POST /route/update；方向、类型、客户创建后不可修改。 */
export class UpdateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['keyId', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['remark'] as const))
) {}

/** 路由主键入参：GET /route/resolve、POST /route/delete。 */
export class RouteKeyDto extends PickType(Schema.TbSrmRouteDto, ['keyId'] as const) {}

/** 路由分页入参：POST /route/column；userKeyId 传 0 只查默认路由。 */
export class ListRouteDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmRouteDto, ['countryKeyId', 'type', 'userKeyId', 'status'] as const))
) {}

/** 客户摘要。 */
export class RouteUserOptionDto {
    @ApiProperty({ description: '客户主键', example: 10241000 })
    keyId: number

    @ApiProperty({ description: '客户名称', required: false, example: '测试客户' })
    name?: string

    @ApiProperty({ description: '客户别名', required: false, example: 'RCK1024A7K9' })
    alias?: string
}

/** 路由列表项：附带方向、客户、通道数和可用通道数。 */
export class RouteColumnResponseDto extends IntersectionType(Schema.TbSrmRouteDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto

    @ApiProperty({ description: '客户信息，默认路由为空', required: false, type: RouteUserOptionDto })
    userKeyIdOptions?: RouteUserOptionDto

    @ApiProperty({ description: '路由下的通道数', example: 3 })
    channelCount: number

    @ApiProperty({ description: '可用通道数：路由通道启用且通道本身启用', example: 2 })
    activeChannelCount: number
}

/** 路由分页响应：POST /route/column。 */
export class RoutePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '路由列表', type: [RouteColumnResponseDto] })
    list: RouteColumnResponseDto[]
}

/** 路由加入通道入参：POST /route/channel/create；通道方向和类型必须与路由一致。 */
export class CreateRouteChannelDto extends IntersectionType(
    PickType(Schema.TbSrmRouteChannelDto, ['routeKeyId', 'channelKeyId'] as const),
    PartialType(PickType(Schema.TbSrmRouteChannelDto, ['priority', 'weight', 'status'] as const))
) {}

/** 编辑路由通道入参：POST /route/channel/update。 */
export class UpdateRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId', 'priority', 'weight', 'status'] as const) {}

/** 路由通道主键入参：POST /route/channel/delete。 */
export class RouteChannelKeyDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId'] as const) {}

/** 路由通道列表入参：GET /route/channel/list。 */
export class ListRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['routeKeyId'] as const) {}

/** 路由通道的通道摘要。 */
export class RouteChannelOptionDto extends PickType(Schema.TbSrmChannelDto, ['keyId', 'alias', 'type', 'countryKeyId', 'status'] as const) {
    @ApiProperty({ description: '启用的绑定端口数', example: 30 })
    enablePortCount: number
}

/** 路由通道列表项：附带通道信息、是否可用和同优先级内分流占比。 */
export class RouteChannelResponseDto extends Schema.TbSrmRouteChannelDto {
    @ApiProperty({ description: '通道信息', required: false, type: RouteChannelOptionDto })
    channelOptions?: RouteChannelOptionDto

    @ApiProperty({ description: '是否可用：路由通道启用、通道启用且有启用端口', example: true })
    active: boolean

    @ApiProperty({ description: '同优先级内的分流占比（百分比，只统计可用通道）', example: 60 })
    ratio: number
}
