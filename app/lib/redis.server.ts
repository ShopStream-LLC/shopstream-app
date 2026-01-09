import Redis from "ioredis";

declare global {
  // Prevent multiple instances in dev
  // eslint-disable-next-line no-var
  var __redis__: Redis | undefined;
}

const redis =
  global.__redis__ ??
  new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== "production") {
  global.__redis__ = redis;
}

export { redis };
