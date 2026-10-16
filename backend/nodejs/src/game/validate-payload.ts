import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Validates a payload that arrived outside Nest's pipes, such as a JSON frame on
 * the plain WebSocket. It applies the same rules as the global `ValidationPipe`:
 * unknown fields are an error. Throws an `Error` whose message lists every problem.
 */
export async function validatePayload<T extends object>(
  type: new () => T,
  data: unknown,
): Promise<T> {
  const instance = plainToInstance(type, data ?? {});
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new Error(
      errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') ||
        'Invalid payload',
    );
  }
  return instance;
}
