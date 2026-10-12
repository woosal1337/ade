import { socialImage } from "../social-image";

export const dynamic = "force-static";

export function GET() {
  return socialImage(1280, 640);
}
