import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "@platform/config";
import { CONFIG } from "../tokens";

@Injectable()
export class CsrfService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  tokenFor(sessionId: string): string {
    return createHmac("sha256", this.config.session.secret).update(sessionId).digest("hex");
  }

  verify(sessionId: string, token: string): boolean {
    const expected = Buffer.from(this.tokenFor(sessionId));
    const given = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
