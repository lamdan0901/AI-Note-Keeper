import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const platformValue = v.union(v.literal("android"));

export const getDevicePushToken = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    return ctx.db
      .query("devicePushTokens")
      .filter((q) => q.eq(q.field("deviceId"), deviceId))
      .first();
  },
});

export const getTokensByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("devicePushTokens")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
  },
});

export const upsertDevicePushToken = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    deviceId: v.string(),
    fcmToken: v.string(),
    platform: platformValue,
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log(`[DeviceTokens] Upsert called for user=${args.userId}, device=${args.deviceId}, fcmToken=${args.fcmToken.slice(0, 20)}...`);
    const existing = await ctx.db
      .query("devicePushTokens")
      .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
      .first();
    const updatedAt = args.updatedAt ?? Date.now();
    const payload = { ...args, updatedAt };
    if (!existing) {
      await ctx.db.insert("devicePushTokens", payload);
      console.log(`[DeviceTokens] Inserted new token for device=${args.deviceId}`);
      return payload;
    }
    await ctx.db.patch(existing._id, payload);
    console.log(`[DeviceTokens] Updated existing token for device=${args.deviceId}`);
    return { ...existing, ...payload };
  },
});

export const listAllTokens = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("devicePushTokens").collect();
    console.log(`[DeviceTokens] Total tokens in DB: ${all.length}`);
    for (const t of all) {
      console.log(`[DeviceTokens]   user=${t.userId} device=${t.deviceId} fcm=${t.fcmToken.slice(0, 20)}... updated=${new Date(t.updatedAt).toISOString()}`);
    }
    return all;
  },
});

export const deleteDevicePushToken = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const existing = await ctx.db
      .query("devicePushTokens")
      .filter((q) => q.eq(q.field("deviceId"), deviceId))
      .first();
    if (!existing) {
      return null;
    }
    await ctx.db.delete(existing._id);
    return { deviceId };
  },
});
