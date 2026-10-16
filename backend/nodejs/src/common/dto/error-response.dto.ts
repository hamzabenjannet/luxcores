import { ApiProperty } from '@nestjs/swagger';

/** Body of every error response. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code' })
  statusCode!: number;

  @ApiProperty({ example: 'BAD_REQUEST', description: 'Status name' })
  error!: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['name must be longer than or equal to 2 characters'],
    description: 'One message, or one message per invalid field',
  })
  message!: string | string[];

  @ApiProperty({ example: '/api/auth/guest' })
  path!: string;

  @ApiProperty({ example: '2026-10-16T21:00:00.000Z', format: 'date-time' })
  timestamp!: string;
}
