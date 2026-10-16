import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export const PLAYER_NAME_MESSAGE =
  '2 to 24 letters, digits, spaces, dots, dashes or underscores';

/** Validates a display name: trimmed, 2 to 24 letters, digits, spaces, dots, dashes or underscores. */
export const PlayerName = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    Matches(/^[\p{L}\p{N} _.-]{2,24}$/u, {
      message: `name must be ${PLAYER_NAME_MESSAGE}`,
    }),
  );
