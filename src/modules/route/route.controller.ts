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

    /* ------------------------------ 路由 ------------------------------ */

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

    @ApiServiceDecorator(Get('select'), {
        operation: { summary: '获取路由下拉选项' },
        response: { type: RouteDto.RouteSelectResponseDto, isArray: true, description: '路由下拉选项' }
    })
    public async httpBaseSrmSelectRoute() {
        return this.routeService.httpBaseSrmSelectRoute()
    }

    /* ------------------------------ 路由规则 ------------------------------ */

    @ApiServiceDecorator(Post('rule/create'), {
        operation: { summary: '新增路由规则' },
        request: { source: 'body', type: RouteDto.CreateRouteRuleDto },
        response: { type: Schema.TbSrmRouteRuleDto, description: '新增后的路由规则' }
    })
    public async httpBaseSrmCreateRouteRule(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.CreateRouteRuleDto) {
        return this.routeService.httpBaseSrmCreateRouteRule(principal, input)
    }

    @ApiServiceDecorator(Post('rule/update'), {
        operation: { summary: '编辑路由规则状态和备注' },
        request: { source: 'body', type: RouteDto.UpdateRouteRuleDto },
        response: { type: Schema.TbSrmRouteRuleDto, description: '编辑后的路由规则' }
    })
    public async httpBaseSrmUpdateRouteRule(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.UpdateRouteRuleDto) {
        return this.routeService.httpBaseSrmUpdateRouteRule(principal, input)
    }

    @ApiServiceDecorator(Post('rule/delete'), {
        operation: { summary: '删除路由规则' },
        request: { source: 'body', type: RouteDto.RouteRuleKeyDto },
        response: { type: SuccessResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmDeleteRouteRule(@Body() input: RouteDto.RouteRuleKeyDto) {
        return this.routeService.httpBaseSrmDeleteRouteRule(input)
    }

    @ApiServiceDecorator(Post('rule/column'), {
        operation: { summary: '分页查询路由规则' },
        request: { source: 'body', type: RouteDto.ListRouteRuleDto },
        response: { type: RouteDto.RouteRulePageResponseDto, description: '路由规则分页数据' }
    })
    public async httpBaseSrmColumnRouteRule(@Body() input: RouteDto.ListRouteRuleDto) {
        return this.routeService.httpBaseSrmColumnRouteRule(input)
    }

    /* ------------------------------ 规则通道 ------------------------------ */

    @ApiServiceDecorator(Post('rule/channel/create'), {
        operation: { summary: '路由规则加入通道' },
        request: { source: 'body', type: RouteDto.CreateRouteChannelDto },
        response: { type: Schema.TbSrmRouteChannelDto, description: '新增后的规则通道' }
    })
    public async httpBaseSrmCreateRouteChannel(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: RouteDto.CreateRouteChannelDto
    ) {
        return this.routeService.httpBaseSrmCreateRouteChannel(principal, input)
    }

    @ApiServiceDecorator(Post('rule/channel/update'), {
        operation: { summary: '编辑规则通道优先级、权重和状态' },
        request: { source: 'body', type: RouteDto.UpdateRouteChannelDto },
        response: { type: Schema.TbSrmRouteChannelDto, description: '编辑后的规则通道' }
    })
    public async httpBaseSrmUpdateRouteChannel(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: RouteDto.UpdateRouteChannelDto
    ) {
        return this.routeService.httpBaseSrmUpdateRouteChannel(principal, input)
    }

    @ApiServiceDecorator(Post('rule/channel/delete'), {
        operation: { summary: '从路由规则移除通道' },
        request: { source: 'body', type: RouteDto.RouteChannelKeyDto },
        response: { type: SuccessResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmDeleteRouteChannel(@Body() input: RouteDto.RouteChannelKeyDto) {
        return this.routeService.httpBaseSrmDeleteRouteChannel(input)
    }

    @ApiServiceDecorator(Get('rule/channel/list'), {
        operation: { summary: '查询路由规则下的通道' },
        request: { source: 'query', type: RouteDto.ListRouteChannelDto },
        response: { type: RouteDto.RouteChannelResponseDto, isArray: true, description: '规则通道列表' }
    })
    public async httpBaseSrmListRouteChannel(@Query() input: RouteDto.ListRouteChannelDto) {
        return this.routeService.httpBaseSrmListRouteChannel(input)
    }

    /* ------------------------------ 短信应用绑定 ------------------------------ */

    @ApiServiceDecorator(Post('app/bind'), {
        operation: { summary: '短信应用绑定路由' },
        request: { source: 'body', type: RouteDto.BindRouteAppDto },
        response: { type: RouteDto.RouteCountResponseDto, description: '绑定数量' }
    })
    public async httpBaseSrmBindRouteApp(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.BindRouteAppDto) {
        return this.routeService.httpBaseSrmBindRouteApp(principal, input)
    }

    @ApiServiceDecorator(Post('app/unbind'), {
        operation: { summary: '短信应用解绑路由' },
        request: { source: 'body', type: RouteDto.UnbindRouteAppDto },
        response: { type: RouteDto.RouteCountResponseDto, description: '解绑数量' }
    })
    public async httpBaseSrmUnbindRouteApp(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RouteDto.UnbindRouteAppDto) {
        return this.routeService.httpBaseSrmUnbindRouteApp(principal, input)
    }

    @ApiServiceDecorator(Post('app/column'), {
        operation: { summary: '分页查询短信应用路由绑定' },
        request: { source: 'body', type: RouteDto.ListRouteAppDto },
        response: { type: RouteDto.RouteAppPageResponseDto, description: '短信应用绑定分页数据' }
    })
    public async httpBaseSrmColumnRouteApp(@Body() input: RouteDto.ListRouteAppDto) {
        return this.routeService.httpBaseSrmColumnRouteApp(input)
    }

    /* ------------------------------ 选路预览 ------------------------------ */

    @ApiServiceDecorator(Post('preview'), {
        operation: { summary: '选路预览：按短信应用和收件号码模拟选择通道' },
        request: { source: 'body', type: RouteDto.RoutePreviewDto },
        response: { type: RouteDto.RoutePreviewResponseDto, description: '选路结果' }
    })
    public async httpBaseSrmRoutePreview(@Body() input: RouteDto.RoutePreviewDto) {
        return this.routeService.httpBaseSrmRoutePreview(input)
    }
}
