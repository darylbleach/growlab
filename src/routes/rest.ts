import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth";
import { encryptText, id } from "../lib/crypto";
import { getMainAccount } from "../services/posts";
import { chat, aiConfigured, logUsage } from "../lib/ai";

async function accountIdOrMain(c: any, userId: string) {
  return c.req.query("account_id") || (await getMainAccount(c.env.DB, userId))?.id || null;
}

export const audienceRoutes = new Hono<{ Bindings: Env }>();
