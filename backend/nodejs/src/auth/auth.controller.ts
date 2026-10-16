import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlayer } from '../common/decorators/current-player.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { AuthRateLimit } from '../common/rate-limit.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import { AuthService } from './auth.service.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { DeviceLoginDto } from './dto/device-login.dto.js';
import { GuestLoginDto } from './dto/guest-login.dto.js';
import { RecoverDto, RecoveryCodeDto } from './dto/recover.dto.js';

@ApiTags('auth')
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description: 'Too many sign-in attempts from this address',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthRateLimit()
  @Post('guest')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Sign in as a new guest',
    description:
      'Creates a player profile and returns a JWT with a `deviceSecret`. Keep the secret on the device and use `POST /auth/device` to sign in again as the same player.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  guest(@Body() dto: GuestLoginDto): Promise<AuthResponseDto> {
    return this.auth.guestLogin(dto.name);
  }

  @Public()
  @AuthRateLimit()
  @Post('device')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in again from a device secret',
    description: 'Returns a fresh JWT for the guest that owns the secret.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'The secret is unknown, or a recovery replaced it',
  })
  device(@Body() dto: DeviceLoginDto): Promise<AuthResponseDto> {
    return this.auth.deviceLogin(dto.deviceSecret);
  }

  @ApiBearerAuth()
  @Post('recovery-code')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Make a recovery code',
    description:
      'Returns a code that moves this profile to another device. Only the newest code works, so asking again invalidates the old one.',
  })
  @ApiCreatedResponse({ type: RecoveryCodeDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async recoveryCode(
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<RecoveryCodeDto> {
    return { recoveryCode: await this.auth.issueRecoveryCode(player.id) };
  }

  @Public()
  @AuthRateLimit()
  @Post('recover')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move a profile to this device',
    description:
      'Exchanges a recovery code for a JWT, a new `deviceSecret` and a replacement `recoveryCode`. The code works once, and the previous device secret stops working.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'The code is unknown or already used',
  })
  recover(@Body() dto: RecoverDto): Promise<AuthResponseDto> {
    return this.auth.recover(dto.recoveryCode);
  }
}
