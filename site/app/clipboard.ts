async function writeWithApi(text: string): Promise<boolean> {
  if (!window.isSecureContext || navigator.clipboard === undefined) {
    return false;
  }
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

function writeWithSelection(text: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  Object.assign(area.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    fontSize: "16px",
  });
  document.body.append(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let done: boolean;
  try {
    done = document.execCommand("copy");
  } catch {
    done = false;
  }
  area.remove();
  active?.focus({ preventScroll: true });
  return done;
}

export async function copyText(text: string): Promise<boolean> {
  return (await writeWithApi(text)) || writeWithSelection(text);
}
