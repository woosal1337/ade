import { brandById } from "../brands";
import type { DraftPerson } from "../draft";
import { dotSvg, matrixRuns } from "../glyphs";
import { fitTags } from "../user-card";
import { COLORS, dataUri, harnessStrip } from "./SocialCard";

const LOGO = { sub: 2, pitch: 2.8, size: 2 };
const AVATAR = 176;
const ROOM = 1032;
const TAG = { fontSize: 22, padding: 12, gap: 10 };
const STRIP_ROOM = 560;

export interface UserSocialCardProps {
  readonly width: number;
  readonly height: number;
  readonly handle: string;
  readonly displayName: string;
  readonly github: string | null;
  readonly avatar: string | undefined;
  readonly person: DraftPerson | undefined;
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

export function UserSocialCard({
  width,
  height,
  handle,
  displayName,
  github,
  avatar,
  person,
}: UserSocialCardProps) {
  const logo = matrixRuns("ade.", LOGO.sub, LOGO.pitch, 0, 0);
  const logoSvg = dotSvg("ade.", { ...LOGO, label: "ade", on: COLORS.fg, off: COLORS.off });
  const name = displayName.trim() || `@${handle}`;
  const brands = (person?.harnesses ?? []).flatMap((id) => {
    const brand = brandById(id);
    return brand === undefined ? [] : [brand];
  });
  const strip = brands.length === 0 ? undefined : harnessStrip(brands);
  const stripScale = strip === undefined ? 1 : Math.min(1, STRIP_ROOM / strip.width);
  const counts =
    person === undefined
      ? []
      : [
          person.skillCount > 0 ? plural(person.skillCount, "skill") : undefined,
          person.mcpCount > 0 ? plural(person.mcpCount, "MCP server") : undefined,
          person.pluginCount > 0 ? plural(person.pluginCount, "plugin") : undefined,
          person.settingCount > 0 ? plural(person.settingCount, "setting") : undefined,
        ].filter((value): value is string => value !== undefined);
  const tags =
    person === undefined
      ? { shown: [], hidden: 0 }
      : fitTags(person.skills, person.skillCount, ROOM, TAG.fontSize, TAG.padding, TAG.gap);
  const mono = { fontFamily: "IBM Plex Mono" };
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: COLORS.ink,
        fontFamily: "Instrument Sans",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          display: "flex",
          border: `1px solid ${COLORS.line}`,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "64px 84px 62px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img alt="ade" src={dataUri(logoSvg)} width={logo.width} height={logo.height} />
          <div style={{ display: "flex", ...mono, fontSize: 24, color: COLORS.accent }}>
            {`ade.chele.bi/${handle}`}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <div
              style={{
                display: "flex",
                width: AVATAR,
                height: AVATAR,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${COLORS.line}`,
                background: "#161616",
                color: COLORS.muted,
                fontSize: 84,
              }}
            >
              {avatar === undefined ? (
                name.replace(/^@/, "").slice(0, 1).toUpperCase()
              ) : (
                <img
                  alt=""
                  src={avatar}
                  width={AVATAR - 2}
                  height={AVATAR - 2}
                  style={{ objectFit: "cover" }}
                />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 820 }}>
              <div
                style={{
                  display: "block",
                  fontSize: 72,
                  lineHeight: 1.3,
                  letterSpacing: -1.4,
                  color: COLORS.fg,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 820,
                }}
              >
                {name}
              </div>
              <div style={{ display: "flex", ...mono, fontSize: 24, color: COLORS.muted }}>
                {github === null ? `@${handle}` : `@${handle} · GitHub ${github}`}
              </div>
              <div style={{ display: "flex", ...mono, fontSize: 24, color: COLORS.fg }}>
                {counts.length === 0 ? "Shares no items yet" : counts.join(" · ")}
              </div>
            </div>
          </div>
          {tags.shown.length === 0 ? (
            <div style={{ display: "flex", height: 42 }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: TAG.gap, height: 42 }}>
              {tags.shown.map((tag) => (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    ...mono,
                    fontSize: TAG.fontSize,
                    color: COLORS.fg,
                    background: "#232323",
                    padding: `6px ${TAG.padding}px`,
                  }}
                >
                  {tag}
                </div>
              ))}
              {tags.hidden > 0 ? (
                <div
                  style={{ display: "flex", ...mono, fontSize: TAG.fontSize, color: COLORS.muted }}
                >
                  {`+${tags.hidden} more`}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {strip === undefined ? (
            <div style={{ display: "flex" }} />
          ) : (
            <img
              alt="Harnesses"
              src={dataUri(strip.svg)}
              width={strip.width * stripScale}
              height={strip.height * stripScale}
            />
          )}
          <div style={{ display: "flex", ...mono, fontSize: 26, color: COLORS.fg }}>
            <span style={{ color: COLORS.accent, marginRight: 14 }}>$</span>
            {`ade apply @${handle}`}
          </div>
        </div>
      </div>
    </div>
  );
}
