import { ApiProperty } from '@nestjs/swagger';

export class TilePosDto {
  @ApiProperty({ example: 0 }) team!: number;
  @ApiProperty({ example: 48 }) tileX!: number;
  @ApiProperty({ example: 96 }) tileZ!: number;
}

export class LaneDto {
  @ApiProperty({ example: 0 }) team!: number;
  @ApiProperty({ enum: ['left', 'mid', 'right'] }) lane!:
    'left' | 'mid' | 'right';
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
    example: [
      [48, 96],
      [51, 80],
      [48, 56],
    ],
    description: 'Control points in tiles, Core first',
  })
  points!: number[][];
  @ApiProperty({
    type: [Number],
    description: 'Tile indices (z * width + x), unique and ascending',
  })
  tiles!: number[];
}

/** The map `generateMap` builds for a seed (GDD section 10). */
export class MapLayoutDto {
  @ApiProperty({ example: 96 }) width!: number;
  @ApiProperty({ example: 112 }) height!: number;
  @ApiProperty({
    example: 1234567,
    description:
      'The seed that passed the connectivity check; usually the requested one',
  })
  usedSeed!: number;
  @ApiProperty({ type: [TilePosDto] }) cores!: TilePosDto[];
  @ApiProperty({ type: [LaneDto] }) lanes!: LaneDto[];
  @ApiProperty({ type: [TilePosDto] }) vents!: TilePosDto[];
  @ApiProperty({ type: [TilePosDto] }) blockers!: TilePosDto[];
  @ApiProperty({ type: [TilePosDto] }) itemSpawns!: TilePosDto[];
}
