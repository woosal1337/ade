import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-api";
import { CST, Lexer } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipped = new Set(["package-lock.json"]);
const scriptExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const binaryExtensions = new Set([".woff2", ".png", ".ico", ".jpg", ".webp"]);
const thirdPartyTexts = /^site\/public\/fonts\/OFL-[A-Za-z]+\.txt$/;
const lineRuleNames = new Set([".gitignore", ".gitattributes", ".editorconfig"]);
const errors = [];

function authoredFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((file) => fs.existsSync(path.join(root, file)))
    .sort();
}

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function checkScript(file, text) {
  const extension = path.extname(file);
  const kind = extension === ".tsx" || extension === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  for (const diagnostic of source.parseDiagnostics) {
    errors.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  const seen = new Set();
  const report = (ranges) => {
    for (const range of ranges ?? []) {
      if (!seen.has(range.pos)) {
        seen.add(range.pos);
        errors.push(`${file}:${lineOf(text, range.pos)}: Remove the source comment.`);
      }
    }
  };
  const visit = (node) => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      report(ts.getLeadingCommentRanges(text, node.pos));
      report(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(source)) {
      visit(child);
    }
  };
  visit(source);
}

function checkJson(file, text) {
  try {
    JSON.parse(text);
  } catch {
    errors.push(`${file}: The file is not valid JSON, or it has a comment.`);
  }
}

function checkYaml(file, text) {
  let offset = 0;
  for (const token of new Lexer().lex(text)) {
    if (CST.tokenType(token) === "comment") {
      errors.push(`${file}:${lineOf(text, offset)}: Remove the source comment.`);
    }
    offset += token.length;
  }
}

function checkCss(file, text) {
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < text.length && text[end] !== char) {
        end += text[end] === "\\" ? 2 : 1;
      }
      index = end + 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      errors.push(`${file}:${lineOf(text, index)}: Remove the source comment.`);
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    index += 1;
  }
}

function checkMarkup(file, text) {
  for (const match of text.matchAll(/<!--/g)) {
    errors.push(`${file}:${lineOf(text, match.index)}: Remove the source comment.`);
  }
}

function checkShell(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trimStart();
    if (index === 0 && trimmed.startsWith("#!")) {
      return;
    }
    if (trimmed.startsWith("#") || (path.extname(file) === ".ps1" && trimmed.startsWith("<#"))) {
      errors.push(`${file}:${index + 1}: Remove the source comment.`);
    }
  });
}

function checkLineRule(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) {
      errors.push(`${file}:${index + 1}: Remove the source comment.`);
    }
  });
}

const pythonFiles = [];
for (const file of authoredFiles()) {
  const name = path.basename(file);
  const extension = path.extname(file);
  if (
    skipped.has(name) ||
    extension === ".md" ||
    binaryExtensions.has(extension) ||
    thirdPartyTexts.test(file)
  ) {
    continue;
  }
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (scriptExtensions.has(extension)) {
    checkScript(file, text);
  } else if (extension === ".json") {
    checkJson(file, text);
  } else if (extension === ".yml" || extension === ".yaml") {
    checkYaml(file, text);
  } else if (extension === ".css") {
    checkCss(file, text);
  } else if (extension === ".svg") {
    checkMarkup(file, text);
  } else if (extension === ".sh" || extension === ".ps1") {
    checkShell(file, text);
  } else if (lineRuleNames.has(name)) {
    checkLineRule(file, text);
  } else if (extension === ".py") {
    pythonFiles.push(file);
  } else {
    errors.push(`${file}: Add a source comment rule for this file type.`);
  }
}

if (pythonFiles.length > 0) {
  const result = spawnSync("python3", ["tools/check-python-comments.py", ...pythonFiles], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    errors.push(
      ...(result.stderr || result.stdout || "The Python check failed.").trim().split("\n"),
    );
  }
}

for (const error of errors) {
  console.error(error);
}
process.exit(errors.length > 0 ? 1 : 0);
