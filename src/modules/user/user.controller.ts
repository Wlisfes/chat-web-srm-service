import { Body, Get, Post, Query } from '@nestjs/common'
import { CurrentPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { UserService } from '@/modules/user/user.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as UserDto from '@/modules/user/dto/user.dto'

@ApifoxController('供应商关系管理-供应商', 'user', { bearerAuth: true })
export class UserController {
    constructor(private readonly userService: UserService) {}

    @ApiServiceDecorator(Get('enums'), {
        operation: { summary: '获取供应商静态枚举' },
        response: { type: UserDto.UserEnumsResponseDto, description: '供应商静态枚举' }
    })
    public async httpBaseSrmUserEnums() {
        return this.userService.httpBaseSrmUserEnums()
    }

    @ApiServiceDecorator(Get('faker'), {
        operation: { summary: '随机生成新增供应商表单数据' },
        response: { type: UserDto.UserFakerResponseDto, description: '新增供应商表单初始化数据' }
    })
    public async httpBaseSrmUserFaker() {
        return this.userService.httpBaseSrmUserFaker()
    }

    @ApiServiceDecorator(Post('create'), {
        operation: { summary: '新增供应商' },
        request: { source: 'body', type: UserDto.CreateUserDto },
        response: { type: Schema.TbSrmUserDto, description: '新增后的供应商信息' }
    })
    public async httpBaseSrmCreateUser(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: UserDto.CreateUserDto) {
        return this.userService.httpBaseSrmCreateUser(principal, input)
    }

    @ApiServiceDecorator(Post('update'), {
        operation: { summary: '更新供应商' },
        request: { source: 'body', type: UserDto.UpdateUserDto },
        response: { type: Schema.TbSrmUserDto, description: '更新后的供应商信息' }
    })
    public async httpBaseSrmUpdateUser(@Body() input: UserDto.UpdateUserDto) {
        return this.userService.httpBaseSrmUpdateUser(input)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询供应商' },
        request: { source: 'body', type: UserDto.ListUserDto },
        response: { type: UserDto.UserPageResponseDto, description: '供应商分页数据' }
    })
    public async httpBaseSrmColumnUser(@Body() input: UserDto.ListUserDto) {
        return this.userService.httpBaseSrmColumnUser(input)
    }

    @ApiServiceDecorator(Post('status/update'), {
        operation: { summary: '更新供应商状态' },
        request: { source: 'body', type: UserDto.UpdateUserStatusDto },
        response: { type: Schema.TbSrmUserDto, description: '更新后的供应商信息' }
    })
    public async httpBaseSrmUserStatusUpdate(@Body() input: UserDto.UpdateUserStatusDto) {
        return this.userService.httpBaseSrmUserStatusUpdate(input)
    }

    @ApiServiceDecorator(Get('resolve'), {
        operation: { summary: '获取供应商详情' },
        request: { source: 'query', type: UserDto.ResolveUserDto },
        response: { type: UserDto.UserResolveResponseDto, description: '供应商详情（含归属人、供应商配置）' }
    })
    public async httpBaseSrmUserResolver(@Query() query: UserDto.ResolveUserDto) {
        return this.userService.httpBaseSrmUserResolver(query)
    }

    @ApiServiceDecorator(Get('select'), {
        operation: { summary: '获取供应商下拉选项' },
        request: { source: 'query', type: UserDto.SelectUserDto },
        response: { type: UserDto.UserSelectResponseDto, isArray: true, description: '供应商下拉选项' }
    })
    public async httpBaseSrmSelectUser(@Query() query: UserDto.SelectUserDto) {
        return this.userService.httpBaseSrmSelectUser(query)
    }

    @ApiServiceDecorator(Get('config/resolve'), {
        operation: { summary: '获取供应商配置' },
        request: { source: 'query', type: UserDto.ResolveUserConfigDto },
        response: { type: UserDto.UserConfigResponseDto, description: '供应商配置' }
    })
    public async httpBaseSrmUserConfigResolver(@Query() query: UserDto.ResolveUserConfigDto) {
        return this.userService.httpBaseSrmUserConfigResolver(query)
    }

    @ApiServiceDecorator(Post('contact/create'), {
        operation: { summary: '新增供应商联系人' },
        request: { source: 'body', type: UserDto.CreateUserContactDto },
        response: { type: Schema.TbSrmUserContactDto, description: '新增后的联系人信息' }
    })
    public async httpBaseSrmCreateUserContact(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: UserDto.CreateUserContactDto) {
        return this.userService.httpBaseSrmCreateUserContact(principal, input)
    }

    @ApiServiceDecorator(Post('contact/update'), {
        operation: { summary: '编辑供应商联系人' },
        request: { source: 'body', type: UserDto.UpdateUserContactDto },
        response: { type: Schema.TbSrmUserContactDto, description: '编辑后的联系人信息' }
    })
    public async httpBaseSrmUpdateUserContact(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: UserDto.UpdateUserContactDto) {
        return this.userService.httpBaseSrmUpdateUserContact(principal, input)
    }

    @ApiServiceDecorator(Post('contact/status/update'), {
        operation: { summary: '修改供应商联系人状态' },
        request: { source: 'body', type: UserDto.UpdateUserContactStatusDto },
        response: { type: Schema.TbSrmUserContactDto, description: '修改后的联系人信息' }
    })
    public async httpBaseSrmUserContactStatusUpdate(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: UserDto.UpdateUserContactStatusDto
    ) {
        return this.userService.httpBaseSrmUserContactStatusUpdate(principal, input)
    }

    @ApiServiceDecorator(Post('contact/column'), {
        operation: { summary: '分页查询供应商联系人' },
        request: { source: 'body', type: UserDto.ListUserContactDto },
        response: { type: UserDto.UserContactPageResponseDto, description: '供应商联系人分页数据（含创建人、更新人信息）' }
    })
    public async httpBaseSrmColumnUserContact(@Body() input: UserDto.ListUserContactDto) {
        return this.userService.httpBaseSrmColumnUserContact(input)
    }
}
