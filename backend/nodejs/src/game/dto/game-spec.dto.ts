import { ApiProperty } from '@nestjs/swagger';

export class SocketEventDocDto {
  @ApiProperty({ example: 'match:command' }) name!: string;
  @ApiProperty({ enum: ['client-to-server', 'server-to-client'] }) direction!:
    'client-to-server' | 'server-to-client';
  @ApiProperty({ example: 'GameCommandDto' }) payload!: string;
  @ApiProperty({
    example:
      'Queue a sim command for the next tick. The ack is `{ accepted, tick?, reason? }`.',
  })
  description!: string;
}

export class SocketDocDto {
  @ApiProperty({ example: '/game' }) namespace!: string;
  @ApiProperty({
    example: 'Pass the JWT as `auth: { token }` in the Socket.IO handshake.',
  })
  auth!: string;
  @ApiProperty({ type: [SocketEventDocDto] }) events!: SocketEventDocDto[];
}

export class WebSocketDocDto {
  @ApiProperty({ example: '/ws' }) path!: string;
  @ApiProperty({
    example:
      'JSON frames { event, data, id? }. A frame with an id is answered by { event: "ack", id, data }.',
  })
  format!: string;
  @ApiProperty({
    example:
      'Authorization header, ?token= query parameter, or an auth frame { event: "auth", data: { token } } after connecting.',
  })
  auth!: string;
  @ApiProperty({
    description:
      'Same events as the Socket.IO namespace, listed in `socket.events`',
  })
  events!: string;
}

/** What a client needs to know before it joins a match. */
export class GameSpecDto {
  @ApiProperty({
    example: '0.10.0',
    description:
      'Sim spec version. A client on another version cannot play here.',
  })
  specVersion!: string;

  @ApiProperty({
    description: 'sha256 of the data files the server simulates with',
  })
  dataHash!: string;

  @ApiProperty({ example: 1 }) mapgenVersion!: number;
  @ApiProperty({ example: 20 }) tickHz!: number;
  @ApiProperty({ example: 2, description: 'Ticks between snapshots' })
  snapshotEveryTicks!: number;
  @ApiProperty({
    example: 10000,
    description:
      'An undecided match ends as a draw at this tick (data/balance.json match.stalemateTicks, or MATCH_MAX_TICKS)',
  })
  matchMaxTicks!: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { CORE: 1, SOLAR: 2, TOWER: 7 },
    description: 'Entity kind codes by name, as `entities[].kind` carries them',
  })
  kinds!: Record<string, number>;
  @ApiProperty({ type: SocketDocDto }) socket!: SocketDocDto;
  @ApiProperty({ type: WebSocketDocDto }) webSocket!: WebSocketDocDto;
}
