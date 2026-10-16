import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AuthService } from './auth.service.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { GuestLoginDto } from './dto/guest-login.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('guest')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Sign in as a guest',
    description:
      'Creates a player profile with the given name and returns a JWT. Accounts with passwords come later.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  guest(@Body() dto: GuestLoginDto): Promise<AuthResponseDto> {
    return this.auth.guestLogin(dto.name);
  }
}
