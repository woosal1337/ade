import { startFakeWorkos } from "./fake-workos.ts";

const env = process.env;
const firstName = env.FAKE_WORKOS_FIRST_NAME ?? "Demo";
const user = {
  id: "user_01LOCALDEMO",
  email: `${firstName.toLowerCase()}@example.com`,
  firstName,
  githubId: "local-demo",
};

const fake = await startFakeWorkos({
  clientId: env.FAKE_WORKOS_CLIENT_ID ?? "client_local",
  host: env.FAKE_WORKOS_HOST ?? "0.0.0.0",
  port: Number(env.FAKE_WORKOS_PORT ?? "4010"),
  publicUrl: env.FAKE_WORKOS_URL,
});
fake.users.set(user.id, user);
fake.autoUser = user.id;
process.stdout.write(`Local WorkOS stand-in at ${fake.url}. Each login is ${firstName}.\n`);
