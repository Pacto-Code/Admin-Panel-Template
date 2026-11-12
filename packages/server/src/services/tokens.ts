/** Shared services that later modules implement and provide under these tokens. */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
  enqueue(msg: MailMessage): Promise<void>;
}

export const MAILER = Symbol("MAILER");

export interface Notifier {
  notify(input: { userIds: string[]; title: string; body: string; link?: string; sourceEventId?: string }): Promise<void>;
}

export const NOTIFIER = Symbol("NOTIFIER");

export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  url(key: string): string;
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol("STORAGE");
