import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

/** The sim reduces seeds to a uint32 (`rng.js`), so larger seeds would alias smaller ones. */
export const MAX_SEED = 0xffffffff;

/** Turns a path or query string into a seed: a whole number from 0 to 2^32 - 1. */
@Injectable()
export class ParseSeedPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d{1,10}$/.test(value))
      throw new BadRequestException(
        'seed must be a whole number from 0 to 4294967295',
      );
    const seed = Number(value);
    if (seed > MAX_SEED)
      throw new BadRequestException(
        'seed must be a whole number from 0 to 4294967295',
      );
    return seed;
  }
}
