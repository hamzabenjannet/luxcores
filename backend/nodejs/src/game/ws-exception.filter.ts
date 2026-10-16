import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/**
 * Reports a failed socket event to the client. A client that passed an ack
 * callback gets `{ ok: false, error }` through it, so its promise settles.
 * Without a callback, the client gets an `exception` event with the same body.
 */
@Catch()
export class WsErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const args = host.getArgs() as unknown[];
    const ack = args.find(
      (a): a is (body: unknown) => void => typeof a === 'function',
    );
    const body = { ok: false as const, error: messageOf(exception) };
    if (ack) ack(body);
    else host.switchToWs().getClient<Socket>().emit('exception', body);
  }
}

function messageOf(exception: unknown): string {
  if (exception instanceof WsException) {
    const error = exception.getError();
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
  if (exception instanceof HttpException) {
    // A validation pipe puts the field messages in the response body, not in `message`.
    const body = exception.getResponse();
    const detail =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: string | string[] }).message
        : undefined;
    return Array.isArray(detail)
      ? detail.join('; ')
      : (detail ?? exception.message);
  }
  return 'Internal server error';
}
