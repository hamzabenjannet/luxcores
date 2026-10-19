import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OriginDto {
  @ApiProperty({ example: 'LAN 192.168.1.20' }) label!: string;
  @ApiProperty({ example: 'http://192.168.1.20:3000' }) url!: string;
}

export class ParamDocDto {
  @ApiProperty({ example: 'vsBot' }) name!: string;
  @ApiProperty({ example: 'Play against a bot' }) label!: string;
  @ApiProperty({ enum: ['text', 'number', 'flag'], description: 'A flag is sent as `name=1` when set and left out otherwise' })
  kind!: 'text' | 'number' | 'flag';
  @ApiProperty({ example: 'With match=new: fill the second slot with a bot' }) help!: string;
  @ApiPropertyOptional({ example: 'new', description: 'What the page uses when the parameter is absent, or a value to start from' })
  default?: string;
}

export class PageDocDto {
  @ApiProperty({ example: 'game' }) id!: string;
  @ApiProperty({ example: 'The game' }) title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: '/', description: 'Path of the page, without the query' }) path!: string;
  @ApiProperty({ type: [ParamDocDto] }) params!: ParamDocDto[];
}

export class PresetDocDto {
  @ApiProperty({ example: 'play-bot' }) id!: string;
  @ApiProperty({ example: 'Play' }) group!: string;
  @ApiProperty({ example: 'Play against the bot' }) title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 'game', description: 'The id of the page this link opens, in `pages`' }) page!: string;
  @ApiProperty({ example: '/?name=Tester&match=new&vsBot=1&autostart=1', description: 'Path and query; put an origin in front' }) path!: string;
}

export class LinkDocDto {
  @ApiProperty({ example: 'API' }) group!: string;
  @ApiProperty({ example: 'Health' }) title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: '/api/health' }) path!: string;
}

export class TestLinksDto {
  @ApiProperty({ type: [OriginDto], description: 'Addresses of this server, the one the request came to first. A phone on the same network uses a LAN address.' })
  origins!: OriginDto[];
  @ApiProperty({ type: [PageDocDto], description: 'Pages that take URL parameters, with each parameter described' })
  pages!: PageDocDto[];
  @ApiProperty({ type: [PresetDocDto], description: 'Ready-made links for the usual checks' })
  presets!: PresetDocDto[];
  @ApiProperty({ type: [LinkDocDto], description: 'The API, and the golden replays the determinism suite plays' })
  links!: LinkDocDto[];
}
