import { Body, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { AppError } from "./app-error";

/** Validates a value against a Zod schema; failures become per-field messages keyed by dotted path. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new AppError("request.validation_failed", 400, "Validation failed", fields);
  }
}

/** `@ZodBody(schema)` parameter decorator: the request body, validated and typed. */
export const ZodBody = <T>(schema: ZodType<T>) => Body(new ZodValidationPipe(schema));
