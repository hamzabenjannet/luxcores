import { Module } from '@nestjs/common';
import { TestHubController } from './testhub.controller.js';

/** The list of test pages and links behind `/tests` and `GET /api/dev/links`. */
@Module({ controllers: [TestHubController] })
export class TestHubModule {}
