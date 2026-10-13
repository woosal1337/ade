"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { AvatarHeading } from "../_components/AvatarHeading";
import { CopyCommand } from "../_components/CopyCommand";
import { ArrowUpRight } from "../_components/primitives";
import { SetupView } from "../_components/SetupView";
import { SiteLink } from "../_components/SiteLink";
import { useVisibility } from "../_components/useVisibility";
import {
  ApiError,
  deleteAccount,
  loginUrl,
  logout,
  type Me,
  pendingLogin,
  updateAccount,
  verifyLogin,
} from "../account";
import { forgetAccount, saveAccount, useAccount, withItems } from "../account-store";
import { INSTALL_COMMAND } from "../content";

const FRAME = "mx-auto max-w-[1100px] px-5";
const BUTTON =
  "inline-flex h-8 items-center gap-2 border px-2.5 font-mono text-[12px] transition-colors disabled:opacity-50";

function when(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LoggedOut({ failed }: { readonly failed: boolean }) {
  return (
    <div className="max-w-[640px] space-y-8 py-16">
      <div className="space-y-4">
        <p className="font-mono text-[12px] text-muted">Your ade page</p>
        <h1 className="text-[36px] leading-[1.1] tracking-[-0.02em] text-fg">
          Share your agent setup at ade.chele.bi/your-name
        </h1>
        <p className="text-[16px] leading-[1.6] text-muted">
          Log in with GitHub. Then upload your setup from the CLI, and choose each item that others
          see. Nothing shows on your page until you switch it on.
        </p>
      </div>
      {failed ? (
        <p className="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          The login did not finish. Try again.
        </p>
      ) : null}
      <SiteLink
        href={loginUrl("/dashboard")}
        className={`${BUTTON} border-fg bg-fg text-ink hover:bg-white`}
      >
        Log in with GitHub
      </SiteLink>
      <ol className="space-y-2 font-mono text-[12px] text-muted">
        <li>1. Log in here with GitHub.</li>
        <li>2. Run ade login, then ade push, on your machine.</li>
        <li>3. Switch on the items that others can see and apply.</li>
      </ol>
    </div>
  );
}

function VerifyEmail({ email }: { readonly email: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    verifyLogin(code)
      .then((result) => {
        window.location.href = result.redirect;
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof ApiError ? reason.message : "ade could not check the code. Try again.",
        );
        setBusy(false);
      });
  };

  return (
    <div className="max-w-[640px] space-y-8 py-16">
      <div className="space-y-4">
        <p className="font-mono text-[12px] text-muted">One more step</p>
        <h1 className="text-[36px] leading-[1.1] tracking-[-0.02em] text-fg">Check your email</h1>
        <p className="text-[16px] leading-[1.6] text-muted">
          WorkOS sent a 6-digit code to <span className="text-fg">{email}</span>, the email address
          of your GitHub account. Enter the code to finish the login. WorkOS asks for it at the
          first login only.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="login-code" className="block font-mono text-[11px] text-faint">
          Code from the email
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="login-code"
            ref={input}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={6}
            className="h-10 w-40 border border-line-strong bg-ink px-3 font-mono text-[18px] tracking-[0.3em] text-fg outline-none focus:border-muted"
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="inline-flex h-10 items-center border border-fg bg-fg px-4 font-mono text-[12px] text-ink transition-colors hover:bg-white disabled:opacity-50"
          >
            Verify
          </button>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="font-mono text-[12px] text-danger">
            {error}
          </p>
        )}
      </form>
      <p className="font-mono text-[12px] leading-[1.7] text-muted">
        No email? Look in the spam folder, or{" "}
        <SiteLink
          href={loginUrl("/dashboard")}
          className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-muted"
        >
          start the login again
        </SiteLink>{" "}
        to get a new code.
      </p>
    </div>
  );
}

function Rename({ me, onRenamed }: { readonly me: Me; readonly onRenamed: (me: Me) => void }) {
  const [value, setValue] = useState(me.account.handle);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    updateAccount({ handle: value })
      .then((result) => {
        setError(undefined);
        onRenamed({ ...me, account: result.account });
      })
      .catch((reason: unknown) =>
        setError(reason instanceof ApiError ? reason.message : "ade could not save the name."),
      )
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="handle" className="block font-mono text-[11px] text-faint">
        Page name
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-muted">ade.chele.bi/</span>
        <input
          id="handle"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={39}
          className="h-8 w-48 border border-line-strong bg-ink px-2 font-mono text-[13px] text-fg outline-none focus:border-muted"
        />
        <button
          type="submit"
          disabled={saving || value === me.account.handle}
          className={`${BUTTON} border-line-strong bg-raised text-fg hover:border-muted`}
        >
          Save
        </button>
      </div>
      {error === undefined ? null : <p className="font-mono text-[12px] text-danger">{error}</p>}
    </form>
  );
}

function Setup({ me }: { readonly me: Me }) {
  const visibility = useVisibility(me.items, (items) => saveAccount(withItems(me, items)));
  const counts = { public: 0, changed: 0, hidden: 0 };
  for (const item of visibility.items) {
    counts[item.state ?? "hidden"] += 1;
  }
  return (
    <section aria-labelledby="setup-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="setup-title" className="text-[20px] text-fg">
            Your setup
          </h2>
          <p className="font-mono text-[12px] text-faint">
            Last upload {me.snapshot === null ? "" : when(me.snapshot.createdAt)}.{" "}
            {visibility.items.length} items: {counts.public} shown, {counts.changed} changed,{" "}
            {counts.hidden} hidden.
          </p>
        </div>
        <p className="font-mono text-[12px] text-muted">
          Run ade push again after a change on your machine.
        </p>
      </div>
      {visibility.error === undefined ? null : (
        <p className="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {visibility.error}
        </p>
      )}
      <SetupView items={visibility.items} editor={visibility} />
    </section>
  );
}

function FirstUpload() {
  return (
    <section aria-labelledby="upload-title" className="space-y-4 border border-line bg-panel p-5">
      <h2 id="upload-title" className="text-[20px] text-fg">
        Upload your setup
      </h2>
      <p className="text-[14px] leading-[1.6] text-muted">
        Run these commands on the machine with your setup. The upload holds secret names only, never
        secret values. Nothing shows on your page until you switch it on here.
      </p>
      <div className="space-y-2">
        <CopyCommand command={INSTALL_COMMAND} size="sm" />
        <CopyCommand command="ade login" size="sm" />
        <CopyCommand command="ade push" size="sm" />
      </div>
    </section>
  );
}

function LoggedIn({ me }: { readonly me: Me }) {
  const [leaving, setLeaving] = useState(false);
  const { account } = me;

  const signOut = () => {
    setLeaving(true);
    forgetAccount();
    logout()
      .then((result) => {
        window.location.href = result.redirect;
      })
      .catch(() => {
        window.location.href = "/";
      });
  };

  const remove = () => {
    if (
      !window.confirm(
        `Delete the ade account @${account.handle} and its page? ade cannot undo this.`,
      )
    ) {
      return;
    }
    setLeaving(true);
    deleteAccount()
      .then(() => {
        forgetAccount();
        window.location.href = "/";
      })
      .catch(() => setLeaving(false));
  };

  return (
    <div className="space-y-10 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <AvatarHeading src={account.avatarUrl}>
          <h1 className="text-[24px] leading-[1.2] text-fg">
            {account.displayName || `@${account.handle}`}
          </h1>
          <SiteLink
            href={`/${account.handle}`}
            className="mt-1 block font-mono text-[12px] leading-[1.5] text-muted hover:text-fg"
          >
            ade.chele.bi/{account.handle} <ArrowUpRight />
          </SiteLink>
          {account.github === null ? null : (
            <p className="font-mono text-[11px] leading-[1.5] text-faint">
              Your page shows your GitHub account: {account.github}
            </p>
          )}
        </AvatarHeading>
        <button
          type="button"
          onClick={signOut}
          disabled={leaving}
          className={`${BUTTON} border-line-strong bg-raised text-fg hover:border-muted`}
        >
          Log out
        </button>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4 border border-line bg-panel p-5">
          <Rename me={me} onRenamed={saveAccount} />
        </div>
        <div className="space-y-3 border border-line bg-panel p-5">
          <p className="font-mono text-[11px] text-faint">Others apply your shared items with</p>
          <CopyCommand command={`ade apply @${account.handle}`} size="sm" />
        </div>
      </div>
      {me.snapshot === null ? <FirstUpload /> : <Setup key={me.snapshot.digest} me={me} />}
      <section aria-labelledby="danger-title" className="space-y-3 border border-danger/30 p-5">
        <h2 id="danger-title" className="font-mono text-[13px] text-danger">
          Delete the account
        </h2>
        <p className="text-[14px] text-muted">
          ade deletes the account, every upload, and the page. Your machine keeps its setup.
        </p>
        <button
          type="button"
          onClick={remove}
          disabled={leaving}
          className={`${BUTTON} border-danger/50 text-danger hover:border-danger`}
        >
          Delete the account
        </button>
      </section>
    </div>
  );
}

const PENDING_DELAY_MS = 400;

function Pending({ text }: { readonly text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), PENDING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <p aria-live="polite" className="py-24 font-mono text-[12px] text-faint">
      {shown ? text : null}
    </p>
  );
}

export function Dashboard() {
  const account = useAccount();
  const [login, setLogin] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ readonly email: string } | "checking">();

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("login");
    setLogin(param);
    if (param !== "verify") {
      return;
    }
    setVerify("checking");
    pendingLogin()
      .then((pending) => setVerify(pending))
      .catch(() => setVerify(undefined));
  }, []);

  const failed = login === "failed" || login === "verify";
  let body: ReactNode;
  if (verify === "checking") {
    body = <Pending text="Loading your login..." />;
  } else if (verify !== undefined) {
    body = <VerifyEmail email={verify.email} />;
  } else if (account.status === "in") {
    body = <LoggedIn me={account.me} />;
  } else if (account.status === "out") {
    body = <LoggedOut failed={failed} />;
  } else if (account.status === "error") {
    body = <p className="py-24 font-mono text-[12px] text-danger">{account.message}</p>;
  } else {
    body = <Pending text="Loading your account..." />;
  }
  return <div className={`${FRAME} min-h-[100svh]`}>{body}</div>;
}
