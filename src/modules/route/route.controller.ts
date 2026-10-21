import { Body, Get, Post, Query } from '@nestjs/common'
import { CurrentPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
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
        response: { type: Schema.TbSrmRouteDto, description: '路由详情' }
    })
    public async httpBaseSrmRouteResolver(@Query() input: RouteDto.RouteKeyDto) {
        return this.routeService.httpBaseSrmRouteResolver(input)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询路由' },
        request: { source: 'body', type: RouteDto.ListRouteDto },
        response: { type: RouteDto.RoutePageResponseDto, description: '路由分页数据' }
    })
    public async httpBaseSrmColumnRoute(@Body() input: RouteDto.ListRouteDto) {
        return this.routeService.httpBaseSrmColumnRoute(input)
    }

    @ApiServiceDecorator(Post('channel/create'), {
        operation: { summary: '路由加入通道' },
        request: { source: 'body', type: RouteDto.CreateRouteChannelDto },
        response: { type: Schema.TbSrmRouteChannelDto, description: '新增后的路由通道' }
    })
    public async httpBaseSrmCreateRouteChannel(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: RouteDto.CreateRouteChannelDto
    ) {
        return this.routeService.httpBaseSrmCreateRouteChannel(principal, input)
    }

    @ApiServiceDecorator(Post('channel/update'), {
        operation: { summary: '编辑路由通道优先级、权重和状态' },
        request: { source: 'body', type: RouteDto.UpdateRouteChannelDto },
        response: { type: Schema.TbSrmRouteChannelDto, description: '编辑后的路由通道' }
    })
    public async httpBaseSrmUpdateRouteChannel(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: RouteDto.UpdateRouteChannelDto
    ) {
        return this.routeService.httpBaseSrmUpdateRouteChannel(principal, input)
    }

    @ApiServiceDecorator(Post('channel/delete'), {
        operation: { summary: '从路由移除通道' },
        request: { source: 'body', type: RouteDto.RouteChannelKeyDto },
        response: { type: SuccessResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmDeleteRouteChannel(@Body() input: RouteDto.RouteChannelKeyDto) {
        return this.routeService.httpBaseSrmDeleteRouteChannel(input)
    }

    @ApiServiceDecorator(Get('channel/list'), {
        operation: { summary: '查询路由下的通道' },
        request: { source: 'query', type: RouteDto.ListRouteChannelDto },
        response: { type: RouteDto.RouteChannelResponseDto, isArray: true, description: '路由通道列表' }
    })
    public async httpBaseSrmListRouteChannel(@Query() input: RouteDto.ListRouteChannelDto) {
        return this.routeService.httpBaseSrmListRouteChannel(input)
    }
}
