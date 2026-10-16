import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class DeviceLoginDto {
  @ApiProperty({
    description: 'The `deviceSecret` that `guest` or `recover` returned',
    minLength: 32,
    maxLength: 64,
  })
  @IsString()
  @Length(32, 64)
  deviceSecret!: string;
}
