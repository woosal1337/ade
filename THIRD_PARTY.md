# Third-party material

ade uses the material below. The ade license does not cover it.

## Trademarks

The names and logos of Claude Code, Codex, Cursor, Grok, Pi, Gemini CLI, OpenCode, Zed, Claude Desktop, Antigravity, and the model families on the site belong to their owners. ade has no link to these companies, and the companies do not endorse ade. The site and the README show the logos only to name the tools and models that ade works with.

The site and the README show each logo in one color, as a grid of dots or as a small icon. Some brand guidelines do not permit a changed logo. Read the guidelines of each brand before you use these logos in another project.

## Logo path data

`site/app/brands.ts` holds the logo path data. `tools/build-logo.mjs` writes the README logo images from it.

### Simple Icons 16.35.0

License: CC0 1.0 Universal. Source: https://github.com/simple-icons/simple-icons. Simple Icons asks each user to read its disclaimer: https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md

| Logo | Slug |
|---|---|
| Claude Code | `claudecode` |
| Cursor | `cursor` |
| Pi | `pi` |
| OpenCode | `opencode` |
| Zed | `zedindustries` |
| Claude Desktop | `claude` |
| Claude (Anthropic) | `anthropic` |
| Gemini (Google) | `googlegemini` |
| Mistral (Mistral AI) | `mistralai` |
| DeepSeek (DeepSeek) | `deepseek` |
| Qwen (Alibaba) | `qwen` |
| Kimi (Moonshot AI) | `kimi` |
| Llama (Meta) | `meta` |

### LobeHub Icons 1.95.1

License: MIT. Source: https://github.com/lobehub/lobe-icons

| Logo | Slug |
|---|---|
| Codex | `codex` |
| Grok | `grok` |
| Gemini CLI | `geminicli` |
| Antigravity | `antigravity` |
| GPT (OpenAI) | `openai` |
| Grok (xAI) | `xai` |
| GLM (Z.ai) | `zai` |

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

The site uses Instrument Sans and IBM Plex Mono under the SIL Open Font License 1.1. The WOFF2 files are in `site/app/fonts/`, and `next/font/local` serves them. The license texts are in `site/public/fonts/OFL-InstrumentSans.txt` and `site/public/fonts/OFL-IBMPlexMono.txt`.

`site/assets/fonts/` holds TTF copies of the same fonts for the social images. The image renderer cannot read WOFF2 or variable fonts. fonttools converted the WOFF2 files, and it made a static Regular instance of Instrument Sans. The same license applies.
