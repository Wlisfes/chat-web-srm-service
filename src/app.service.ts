import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import * as HealthDto from '@/health/dto/health.dto'
import { HealthService } from '@/health/health.service'

@Injectable()
export class AppService {
    constructor(private readonly healthService: HealthService) {}

    /**SRM 服务信息。*/
    public async httpBaseSrmResolverService(): Promise<string> {
        return 'Chat Web SRM Service'
    }

    /**SRM 服务存活状态。*/
    public async httpBaseSrmLiveHealth(): Promise<HealthDto.ServiceLivenessResponseDto> {
        return this.healthService.getLiveness()
    }

    /**SRM 服务就绪状态。*/
    public async httpBaseSrmReadyHealth(): Promise<HealthDto.ServiceReadinessResponseDto> {
        const result = await this.healthService.getReadiness()
        if (result.status !== 'UP') {
            throw new ServiceUnavailableException({ message: 'SRM 服务尚未就绪', data: result })
        }
        return result
    }
}
