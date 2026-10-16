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
  @ApiProperty({ example: 12000 }) matchMaxTicks!: number;
  @ApiProperty({ type: SocketDocDto }) socket!: SocketDocDto;
}
