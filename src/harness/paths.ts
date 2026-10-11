import path from "node:path";
import type { Context } from "../core/context.ts";

export function xdgConfig(ctx: Context): string {
  return ctx.env.XDG_CONFIG_HOME
    ? path.resolve(ctx.env.XDG_CONFIG_HOME)
    : path.join(ctx.home, ".config");
}

export function xdgData(ctx: Context): string {
  return ctx.env.XDG_DATA_HOME
    ? path.resolve(ctx.env.XDG_DATA_HOME)
    : path.join(ctx.home, ".local", "share");
}

export function roamingAppData(ctx: Context): string {
  return ctx.env.APPDATA
    ? path.resolve(ctx.env.APPDATA)
    : path.join(ctx.home, "AppData", "Roaming");
}

export function localAppData(ctx: Context): string {
  return ctx.env.LOCALAPPDATA
    ? path.resolve(ctx.env.LOCALAPPDATA)
    : path.join(ctx.home, "AppData", "Local");
}

export function macAppSupport(ctx: Context): string {
  return path.join(ctx.home, "Library", "Application Support");
}

export function appConfigDir(ctx: Context, name: string): string {
  if (ctx.platform === "darwin") {
    return path.join(macAppSupport(ctx), name);
  }
  if (ctx.platform === "win32") {
    return path.join(roamingAppData(ctx), name);
  }
  return path.join(xdgConfig(ctx), name);
}

export function cursorUserDir(ctx: Context): string {
  return path.join(appConfigDir(ctx, "Cursor"), "User");
}

export function zedConfigDir(ctx: Context): string {
  return ctx.platform === "win32"
    ? path.join(roamingAppData(ctx), "Zed")
    : path.join(xdgConfig(ctx), "zed");
}

export function zedExtensionsDir(ctx: Context): string {
  if (ctx.platform === "darwin") {
    return path.join(macAppSupport(ctx), "Zed", "extensions", "installed");
  }
  if (ctx.platform === "win32") {
    return path.join(localAppData(ctx), "Zed", "extensions", "installed");
  }
  return path.join(xdgData(ctx), "zed", "extensions", "installed");
}
