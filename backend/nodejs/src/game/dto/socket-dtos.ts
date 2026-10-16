import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { COMMAND_TYPES } from '../command-types.js';

const MAX_COMMAND_BYTES = 4096;

@ValidatorConstraint({ name: 'simCommand', async: false })
class SimCommandConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return false;
    const { t } = value as { t?: unknown };
    return (
      typeof t === 'string' &&
      (COMMAND_TYPES as readonly string[]).includes(t) &&
      JSON.stringify(value).length <= MAX_COMMAND_BYTES
    );
  }

  defaultMessage(): string {
    return `cmd must be an object under ${MAX_COMMAND_BYTES} bytes whose "t" is one of: ${COMMAND_TYPES.join(', ')}`;
  }
}

/** Payload of the `match:join` and `match:leave` socket events. */
export class MatchRefDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matchId!: string;
}

/** Payload of the `match:command` socket event. */
export class GameCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matchId!: string;

  @ApiProperty({
    example: 0,
    description:
      'Per-player counter. It must rise with every command; the server drops a repeat.',
  })
  @IsInt()
  @Min(0)
  seq!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { t: 'heroMove', x: 48000, z: 80000 },
    description:
      'A sim command (`src/sim/commands.js`). Coordinates are in units, 1 tile = 1000.',
  })
  @IsObject()
  @Validate(SimCommandConstraint)
  cmd!: { t: string; [field: string]: unknown };
}

/** Payload of the `chat:message` socket event. */
export class ChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matchId!: string;

  @ApiProperty({ example: 'good luck', minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  text!: string;
}
