import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RecoverDto {
  @ApiProperty({
    example: 'K7QM-2XWD-9TFB-HN4C',
    description:
      '16 letters and digits. Case, dashes and spaces do not matter.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9 -]{16,24}$/, {
    message: 'recoveryCode must be 16 letters and digits, with optional dashes',
  })
  recoveryCode!: string;
}

export class RecoveryCodeDto {
  @ApiProperty({
    example: 'K7QM-2XWD-9TFB-HN4C',
    description:
      "Shown once. Writing it down is the player's job; a new code replaces the old one.",
  })
  recoveryCode!: string;
}
