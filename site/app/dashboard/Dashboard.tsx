"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { AvatarHeading } from "../_components/AvatarHeading";
import { CopyCommand } from "../_components/CopyCommand";
import { ArrowUpRight } from "../_components/primitives";
import { SetupView } from "../_components/SetupView";
import { SiteLink } from "../_components/SiteLink";
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
import { forgetAccount, saveAccount, useAccount } from "../account-store";
import { INSTALL_COMMAND } from "../content";
import { Preview } from "./Preview";
import { type DraftEditor, useDraft } from "./useDraft";

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
          Share your agent setup
        </h1>
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
        <li>1. Log in with GitHub.</li>
        <li>2. Run ade login and ade push.</li>
        <li>3. Choose what others see.</li>
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

function SaveBar({
  draft,
  onPreview,
}: {
  readonly draft: DraftEditor;
  readonly onPreview: () => void;
}) {
  return (
    <section
      aria-label="Unsaved changes"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-panel/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="font-mono text-[12px] text-fg">
          {draft.count} unsaved {draft.count === 1 ? "change" : "changes"}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={draft.discard}
            disabled={draft.saving}
            className={`${BUTTON} border-transparent text-muted hover:text-fg`}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onPreview}
            className={`${BUTTON} border-line-strong bg-raised text-fg hover:border-muted`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => {
              draft.save().catch(() => undefined);
            }}
            disabled={draft.saving}
            className={`${BUTTON} border-fg bg-fg text-ink hover:bg-white`}
          >
            {draft.saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Setup({ me }: { readonly me: Me }) {
  const draft = useDraft(me);
  const [previewing, setPreviewing] = useState(false);
  const counts = { public: 0, changed: 0, hidden: 0 };
  for (const item of draft.items) {
    counts[item.state ?? "hidden"] += 1;
  }
  return (
    <section
      aria-labelledby="setup-title"
      className={`space-y-4 ${draft.count > 0 ? "pb-20" : ""}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="setup-title" className="text-[20px] text-fg">
            Your setup
            <span className="ml-3 font-mono text-[13px] text-faint">
              {counts.public} of {draft.items.length} shown
            </span>
          </h2>
          <p
            className="font-mono text-[12px] text-faint"
            title="Run ade push on your machine to upload a new version."
          >
            Updated {me.snapshot === null ? "" : when(me.snapshot.createdAt)}
            {counts.changed > 0 ? (
              <span className="text-warn"> · {counts.changed} changed</span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPreviewing(true)}
          className={`${BUTTON} border-line-strong bg-raised text-fg hover:border-muted`}
        >
          Preview
        </button>
      </div>
      {draft.error === undefined ? null : (
        <p className="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {draft.error}
        </p>
      )}
      <SetupView items={draft.items} editor={draft} />
      {draft.count > 0 ? <SaveBar draft={draft} onPreview={() => setPreviewing(true)} /> : null}
      <Preview
        open={previewing}
        me={me}
        items={draft.items}
        unsaved={draft.count}
        saving={draft.saving}
        onSave={() => {
          draft.save().catch(() => undefined);
        }}
        onClose={() => setPreviewing(false)}
      />
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
        Run these on your machine. ade uploads secret names, never secret values.
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
        <AvatarHeading src={account.avatarUrl} size={account.github === null ? 50 : 66} eager>
          <h1 className="truncate text-[24px] leading-[28px] text-fg">
            {account.displayName || `@${account.handle}`}
          </h1>
          <SiteLink
            href={`/${account.handle}`}
            className="mt-1 block truncate font-mono text-[12px] leading-[18px] text-muted hover:text-fg"
          >
            ade.chele.bi/{account.handle} <ArrowUpRight />
          </SiteLink>
          {account.github === null ? null : (
            <p className="truncate font-mono text-[11px] leading-[16px] text-faint">
              GitHub {account.github}
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
          <p className="font-mono text-[11px] text-faint">Apply command</p>
          <CopyCommand command={`ade apply @${account.handle}`} size="sm" />
        </div>
      </div>
      {me.snapshot === null ? <FirstUpload /> : <Setup key={me.snapshot.digest} me={me} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
        <p className="font-mono text-[12px] text-faint">
          Deletes the account, its uploads, and its page.
        </p>
        <button
          type="button"
          onClick={remove}
          disabled={leaving}
          className={`${BUTTON} border-danger/50 text-danger hover:border-danger`}
        >
          Delete account
        </button>
      </div>
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
