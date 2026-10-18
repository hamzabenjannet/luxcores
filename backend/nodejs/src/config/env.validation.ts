import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  validateSync,
} from 'class-validator';

/** Passes zero too. A checkpoint tick must be a multiple of the hash interval, so the sim's derived caches agree. */
function IsMultipleOf(divisor: number): PropertyDecorator {
  return ValidateBy({
    name: 'isMultipleOf',
    validator: { validate: (value: unknown) => typeof value === 'number' && value % divisor === 0, defaultMessage: () => `$property must be a multiple of ${divisor}` },
  });
}

enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

enum DbDriver {
  Auto = 'auto',
  Json = 'json',
  Mongodb = 'mongodb',
  Postgres = 'postgres',
}

/** Environment variables the app understands. See `.env.example` for the meaning of each. */
class EnvironmentVariables {
  @IsOptional() @IsEnum(NodeEnv) NODE_ENV?: NodeEnv;
  @IsOptional() @IsInt() @Min(1) @Max(65535) PORT?: number;
  @IsOptional() @IsString() HOST?: string;
  @IsOptional() @IsString() CORS_ORIGIN?: string;

  @ValidateIf(
    (o: EnvironmentVariables) =>
      o.NODE_ENV === NodeEnv.Production || o.JWT_SECRET !== undefined,
  )
  @IsString()
  @MinLength(16)
  JWT_SECRET?: string;
  @IsOptional() @IsString() JWT_EXPIRES_IN?: string;

  @ValidateIf(
    (o: EnvironmentVariables) =>
      o.NODE_ENV === NodeEnv.Production || o.ADMIN_API_KEY !== undefined,
  )
  @IsString()
  @MinLength(16)
  ADMIN_API_KEY?: string;

  @IsOptional() @IsEnum(DbDriver) DATABASE_DRIVER?: DbDriver;
  @IsOptional() @IsString() JSON_DB_PATH?: string;
  @IsOptional() @IsInt() @Min(200) @Max(60000) DATABASE_TIMEOUT_MS?: number;
  @ValidateIf(
    (o: EnvironmentVariables) => o.DATABASE_DRIVER === DbDriver.Mongodb,
  )
  @IsString()
  @MinLength(1)
  MONGODB_URL?: string;
  @IsOptional() @IsString() MONGODB_DB?: string;
  @ValidateIf(
    (o: EnvironmentVariables) => o.DATABASE_DRIVER === DbDriver.Postgres,
  )
  @IsString()
  @MinLength(1)
  POSTGRES_URL?: string;

  @IsOptional() @IsString() REDIS_URL?: string;
  @IsOptional() @IsInt() @Min(200) @Max(60000) REDIS_TIMEOUT_MS?: number;
  @IsOptional() @IsString() RABBITMQ_URL?: string;
  @IsOptional() @IsString() RABBITMQ_QUEUE?: string;
  @IsOptional() @IsInt() @Min(1) RABBITMQ_PREFETCH?: number;

  @IsOptional() @IsString() LUXCORES_ROOT?: string;
  @IsOptional() @IsString() PUBLIC_DIR?: string;
  @IsOptional() @IsInt() @Min(20) MATCH_MAX_TICKS?: number;
  @IsOptional() @IsIn(['resume', 'end']) MATCH_ON_SHUTDOWN?: string;
  @IsOptional() @IsString() EVENT_LOG_DIR?: string;
  @IsOptional() @IsInt() @Min(10) @Max(5000) EVENT_LOG_FLUSH_MS?: number;
  @IsOptional() @IsIn(['true', 'false']) EVENT_LOG_KEEP_FINISHED?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3650) EVENT_LOG_RETENTION_DAYS?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) SNAPSHOT_EVERY_TICKS?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) @IsMultipleOf(20) CHECKPOINT_EVERY_TICKS?: number;
  @IsOptional() @IsInt() @Min(1) RATE_LIMIT_PER_MINUTE?: number;
  @IsOptional() @IsInt() @Min(1) RATE_LIMIT_AUTH_PER_MINUTE?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) TRUST_PROXY?: number;
  @IsOptional() @IsInt() @Min(100) WS_AUTH_TIMEOUT_MS?: number;
  @IsOptional() @IsInt() @Min(256) WS_MAX_PAYLOAD_BYTES?: number;
}

/** Passed to `ConfigModule.forRoot({ validate })`. Throws one error that lists every bad variable. */
export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const instance = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(instance, {
    skipMissingProperties: false,
    whitelist: false,
  });
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment:\n  ${lines.join('\n  ')}`);
  }
  return raw;
}
