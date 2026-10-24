import { Body, Get, Post, Query } from '@nestjs/common'
import { CurrentPrincipal, type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController, SuccessResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { RouteService } from '@/modules/route/route.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as RouteDto from '@/modules/route/dto/route.dto'

@ApifoxController('供应商关系管理-短信路由', 'route', { bearerAuth: true })
export class RouteController {
    constructor(private readonly routeService: RouteService) {}

    @ApiServiceDecorator(Get('enums'), {
        operation: { summary: '获取路由静态枚举' },
        response: { type: RouteDto.RouteEnumsResponseDto, description: '路由静态枚举' }
    })
    public async httpBaseSrmRouteEnums() {
        return this.routeService.httpBaseSrmRouteEnums()
    }

    @ApiServiceDecorator(Post('create'), {
        operation: { summary: '新增路由' },
        request: { source: 'body', type: RouteDto.CreateRouteDto },
        response: { type: Schema.TbSrmRouteDto, description: '新增后的路由' }
    })
    public async httpBaseSrmCreateRoute(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.CreateRouteDto) {
        return this.routeService.httpBaseSrmCreateRoute(principal, input)
    }

    @ApiServiceDecorator(Post('update'), {
        operation: { summary: '编辑路由' },
        request: { source: 'body', type: RouteDto.UpdateRouteDto },
        response: { type: Schema.TbSrmRouteDto, description: '编辑后的路由' }
    })
    public async httpBaseSrmUpdateRoute(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.UpdateRouteDto) {
        return this.routeService.httpBaseSrmUpdateRoute(principal, input)
    }

    @ApiServiceDecorator(Post('delete'), {
        operation: { summary: '删除路由' },
        request: { source: 'body', type: RouteDto.RouteKeyDto },
        response: { type: SuccessResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmDeleteRoute(@Body() input: RouteDto.RouteKeyDto) {
        return this.routeService.httpBaseSrmDeleteRoute(input)
    }

    @ApiServiceDecorator(Get('resolve'), {
        operation: { summary: '获取路由详情' },
        request: { source: 'query', type: RouteDto.RouteKeyDto },
        response: { type: RouteDto.RouteResolverResponseDto, description: '路由详情（含绑定的通道、短信应用和规则组）' }
    })
    public async httpBaseSrmRouteResolver(@Query() input: RouteDto.RouteKeyDto) {
        return this.routeService.httpBaseSrmRouteResolver(input)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询路由' },
        request: { source: 'body', type: RouteDto.ListRouteDto },
        response: { type: RouteDto.RoutePageResponseDto, description: '路由分页数据（含绑定的通道和短信应用）' }
    })
    public async httpBaseSrmColumnRoute(@Body() input: RouteDto.ListRouteDto) {
        return this.routeService.httpBaseSrmColumnRoute(input)
    }

    @ApiServiceDecorator(Post('channel/bind'), {
        operation: { summary: '更新路由通道绑定' },
        request: { source: 'body', type: RouteDto.BindRouteChannelDto },
        response: { type: RouteDto.RouteCountResponseDto, description: '绑定的通道数量' }
    })
    public async httpBaseSrmBindRouteChannel(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.BindRouteChannelDto) {
        return this.routeService.httpBaseSrmBindRouteChannel(principal, input)
    }

    @ApiServiceDecorator(Post('app/bind'), {
        operation: { summary: '短信应用绑定路由' },
        request: { source: 'body', type: RouteDto.BindRouteAppDto },
        response: { type: RouteDto.RouteCountResponseDto, description: '绑定数量' }
    })
    public async httpBaseSrmBindRouteApp(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.BindRouteAppDto) {
        return this.routeService.httpBaseSrmBindRouteApp(principal, input)
    }

    @ApiServiceDecorator(Post('rule/bind'), {
        operation: { summary: '更新路由规则绑定' },
        request: { source: 'body', type: RouteDto.BindRouteRuleDto },
        response: { type: RouteDto.RouteCountResponseDto, description: '绑定的规则数量' }
    })
    public async httpBaseSrmBindRouteRule(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.BindRouteRuleDto) {
        return this.routeService.httpBaseSrmBindRouteRule(principal, input)
    }
}
