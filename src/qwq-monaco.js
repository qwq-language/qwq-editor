import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";

export const qwqLanguageId = "qwq";
export const qwqThemeName = "qwq-dark";
const hoverRangesByModel = new WeakMap();

if (!monaco.languages.getLanguages().some((language) => language.id === qwqLanguageId)) {
  monaco.languages.register({ id: qwqLanguageId });
}

monaco.languages.setLanguageConfiguration(qwqLanguageId, {
  comments: { lineComment: "//" },
  brackets: [["(", ")"], ["[", "]"], ["{", "}"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"' },
  ],
});

function flowHoverRangeAtPosition(model, position) {
  const offset = model.getOffsetAt(position);
  return (hoverRangesByModel.get(model) ?? []).find(
    (candidate) => offset >= candidate.start && offset < candidate.end,
  ) ?? null;
}

export function flowHoverAtPosition(model, position) {
  return flowHoverRangeAtPosition(model, position)?.message ?? null;
}

export function clearFlowHoverData(model) {
  hoverRangesByModel.delete(model);
}

export function flowNavigationAtPosition(model, position) {
  const candidate = flowHoverRangeAtPosition(model, position);
  const navigation = candidate?.navigation;
  const offset = navigation?.targets?.[0];
  return offset == null
    ? null
    : { offset, kind: navigation.kind, start: candidate.start, end: candidate.end };
}

monaco.languages.registerHoverProvider(qwqLanguageId, {
  provideHover(model, position) {
    const candidate = flowHoverRangeAtPosition(model, position);
    if (!candidate) return null;

    const start = model.getPositionAt(candidate.start);
    const end = model.getPositionAt(candidate.end);
    return {
      range: monaco.Range.fromPositions(start, end),
      contents: [candidate.message],
    };
  },
});

monaco.editor.defineTheme(qwqThemeName, {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editorCursor.foreground": "#aeafad",
    "editor.lineHighlightBackground": "#ffffff0a",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#3a3d41",
    "editorGutter.background": "#1e1e1e",
    "editorError.foreground": "#f14c4c",
    "editorError.border": "#e51400",
    "editorBracketMatch.background": "#0064001a",
    "editorBracketMatch.border": "#888888",
    "editorWidget.background": "#252526",
    "editorWidget.border": "#454545",
    "editorSuggestWidget.background": "#252526",
    "editorSuggestWidget.border": "#454545",
    "editorOverviewRuler.errorForeground": "#ff0000cc",
    "scrollbarSlider.background": "#79797966",
    "scrollbarSlider.hoverBackground": "#646464b3",
    "scrollbarSlider.activeBackground": "#bfbfbf66",
  },
});

export function byteOffsetsToUtf16(source) {
  const byteLength = new TextEncoder().encode(source).length;
  const offsets = new Array(byteLength + 1);
  let byteOffset = 0;

  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    const utf16Width = codePoint > 0xffff ? 2 : 1;
    const byteWidth =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    for (let byte = 0; byte < byteWidth; byte += 1) offsets[byteOffset + byte] = index;
    byteOffset += byteWidth;
    index += utf16Width;
    offsets[byteOffset] = index;
  }

  return offsets;
}

function styleForToken(kind) {
  switch (kind) {
    case "VoidPort":
    case "IntPort":
    case "StrPort":
    case "BoolPort":
      return "port";
    case "IntLiteral":
      return "number";
    case "StringLiteral":
      return "string";
    case "Comment":
      return "comment";
    case "Identifier":
      return "identifier";
    case "Operator":
      return "operator";
    case "Underscore":
    case "Compose":
    case "Tee":
    case "Coerce":
    case "Loop":
    case "Branch":
      return "connector";
    case "Arrow":
    case "FatArrow":
    case "Equals":
      return "keyword";
    case "LeftParen":
    case "RightParen":
    case "LeftBracket":
    case "RightBracket":
    case "LeftBrace":
    case "RightBrace":
      return "bracket";
    case "Comma":
      return "punctuation";
    default:
      return null;
  }
}

function templateTokenStyles(tokens, source) {
  const angles = new Set();
  const parameters = new Set();
  const allowedKinds = new Set([
    "Identifier", "VoidPort", "IntPort", "StrPort", "BoolPort",
    "Comma", "Underscore", "LeftBracket", "RightBracket", "Operator",
  ]);
  const validAfter = new Set([
    "Equals", "LeftParen", "RightParen", "LeftBracket", "RightBracket",
    "LeftBrace", "RightBrace", "Identifier", "VoidPort", "IntPort", "StrPort",
    "BoolPort", "IntLiteral", "StringLiteral", "Arrow", "FatArrow", "Underscore",
    "Comma", "Compose", "Tee", "Coerce", "Loop", "Branch", "Operator",
  ]);

  for (let index = 1; index < tokens.length; index += 1) {
    const opener = tokens[index];
    const previous = tokens[index - 1];
    if (opener.kind !== "Operator" || source.slice(opener.start, opener.end) !== "<") continue;
    if (previous.kind !== "Identifier" || previous.end !== opener.start) continue;

    let depth = 1;
    let closing = -1;
    let valid = true;
    let hasType = false;
    for (let item = index + 1; item < tokens.length; item += 1) {
      const token = tokens[item];
      if (token.kind === "Comment") continue;
      const spelling = source.slice(token.start, token.end);
      if (!allowedKinds.has(token.kind)) {
        valid = false;
        break;
      }
      if (token.kind === "Operator" && spelling === "<") depth += 1;
      else if (token.kind === "Operator" && spelling === ">") {
        depth -= 1;
        if (depth === 0) {
          closing = item;
          break;
        }
      } else if (token.kind === "Identifier" || /Port$/.test(token.kind)) {
        hasType = true;
      }
    }
    if (!valid || closing < 0 || !hasType) continue;

    const following = tokens[closing + 1];
    if (following && !validAfter.has(following.kind)) continue;
    if (!following && closing + 1 < tokens.length) continue;

    let contentValid = true;
    for (let item = index + 1; item < closing; item += 1) {
      const token = tokens[item];
      if (token.kind === "Operator") {
        const spelling = source.slice(token.start, token.end);
        if (spelling !== "<" && spelling !== ">") contentValid = false;
      }
    }
    if (!contentValid) continue;

    angles.add(index);
    angles.add(closing);
    const declaration = following?.kind === "Equals" || following?.kind === "LeftParen";
    if (declaration) {
      for (let item = index + 1; item < closing; item += 1) {
        if (tokens[item].kind === "Identifier") parameters.add(item);
      }
    }
    index = closing;
  }
  return { angles, parameters };
}

function hslHex(hue, saturation = 0.72, lightness = 0.72) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) [red, green, blue] = [chroma, secondary, 0];
  else if (segment < 2) [red, green, blue] = [secondary, chroma, 0];
  else if (segment < 3) [red, green, blue] = [0, chroma, secondary];
  else if (segment < 4) [red, green, blue] = [0, secondary, chroma];
  else if (segment < 5) [red, green, blue] = [secondary, 0, chroma];
  else [red, green, blue] = [chroma, 0, secondary];

  const offset = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((component) => Math.round((component + offset) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function averageColor(colors) {
  const channels = colors.map(rgb);
  const mixed = [0, 1, 2].map((channel) =>
    Math.round(channels.reduce((sum, color) => sum + color[channel], 0) / channels.length),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

let flowPaletteStyle;

function updateFlowPalette(provenance) {
  if (!flowPaletteStyle) {
    flowPaletteStyle = document.createElement("style");
    flowPaletteStyle.dataset.qwqFlowPalette = "";
    document.head.append(flowPaletteStyle);
  }

  const origins = provenance?.origins ?? [];
  const originIndex = new Map();
  const colors = origins.map((origin, index) => {
    originIndex.set(origin.id, index);
    return hslHex((index * 137.508) % 360);
  });

  const mixes = new Map();
  for (const mark of provenance?.flow ?? []) {
    if (mark.color === false) continue;
    const indices = [...new Set((mark.sources ?? [])
      .map((source) => originIndex.get(source))
      .filter((index) => index != null))].sort((first, second) => first - second);
    if (indices.length < 2) continue;
    const className = `qwq-flow-mix-${indices.join("-")}`;
    if (!mixes.has(className)) mixes.set(className, averageColor(indices.map((index) => colors[index])));
  }

  const rules = colors.map((color, index) =>
    `.monaco-editor .view-lines .qwq-token.qwq-flow-source-${index}{color:${color}!important;}`,
  );
  for (const [className, color] of mixes) {
    rules.push(
      `.monaco-editor .view-lines .qwq-token.${className}{color:${color}!important;}`,
    );
  }
  flowPaletteStyle.textContent = rules.join("\n");
  return originIndex;
}

function flowClassesFor(sources, originIndex) {
  const indices = [...new Set((sources ?? [])
    .map((source) => originIndex.get(source))
    .filter((index) => index != null))].sort((first, second) => first - second);
  if (indices.length === 0) return "";
  if (indices.length === 1) return `qwq-flow-source-${indices[0]}`;
  return `qwq-flow-mix-${indices.join("-")}`;
}

function originDescriptions(provenance, tokens, source, toUtf16, model) {
  const tokenByStart = new Map(tokens.map((token) => [token.start, token]));
  const tokenIndexByStart = new Map(tokens.map((token, index) => [token.start, index]));
  return new Map((provenance.origins ?? []).map((origin, index) => {
    const token = tokenByStart.get(origin.anchor);
    const start = token ? toUtf16(token.start) : toUtf16(origin.anchor);
    let tokenEnd = token?.end;
    if (token?.kind === "LeftBracket") {
      let depth = 0;
      const tokenIndex = tokenIndexByStart.get(token.start);
      for (let item = tokenIndex; item != null && item < tokens.length; item += 1) {
        if (tokens[item].kind === "LeftBracket") depth += 1;
        else if (tokens[item].kind === "RightBracket" && --depth === 0) {
          tokenEnd = tokens[item].end;
          break;
        }
      }
    }
    const end = tokenEnd == null ? start : toUtf16(tokenEnd);
    const spelling = start == null || end == null ? "" : source.slice(start, end);
    const id = String(origin.id ?? "");
    let kind = "Initial value";

    if (id.startsWith("param:") || id.startsWith("main-input:")) {
      const slotPart = id.slice(id.lastIndexOf(":") + 1);
      const slot = Number.isInteger(Number(slotPart)) ? Number(slotPart) + 1 : index + 1;
      kind = `Input slot ${slot}`;
    } else if (token?.kind === "IntLiteral" || token?.kind === "StringLiteral") {
      kind = "Literal";
    } else if (token?.kind === "Operator" && spelling === "#") {
      kind = "External read";
    } else if (token?.kind === "LeftBrace") {
      kind = "Array construction";
    } else if (token?.kind === "Identifier") {
      kind = "Function result";
    } else if (token?.kind === "Operator") {
      kind = `Computed by ${spelling}`;
    } else if (token?.kind === "LeftBracket") {
      kind = "Array operation";
    } else if (token?.kind === "Loop") {
      kind = "Loop result";
    } else if (token?.kind === "Branch") {
      kind = "Branch result";
    } else if (token?.kind === "Coerce") {
      kind = "Converted result";
    }

    const location = model.getPositionAt(start ?? 0);
    return [origin.id, {
      index,
      kind,
      spelling,
      lineNumber: location.lineNumber,
      column: location.column,
    }];
  }));
}

function markdownCode(value) {
  const longestBacktickRun = Math.max(
    0,
    ...(value.match(/`+/g) ?? []).map((run) => run.length),
  );
  const delimiter = "`".repeat(longestBacktickRun + 1);
  const padded = /^\s|\s$/.test(value) ? ` ${value} ` : value;
  return `${delimiter}${padded}${delimiter}`;
}

function originsMessage(sources, descriptions) {
  const entries = [...new Set(sources ?? [])]
    .map((id) => descriptions.get(id))
    .filter(Boolean)
    .sort((first, second) => first.index - second.index);
  return entries.map((entry) => {
    const spelling = entry.spelling ? ` · ${markdownCode(entry.spelling)}` : "";
    return `${entry.kind}${spelling}\n\nLine ${entry.lineNumber} · column ${entry.column}`;
  }).join("\n\n");
}

// `getLeft([q]_q_(q_q) -> [q]_q)` and `~([q]_q_(q_q) -> [q]_q_(q_q))` both
// reduce to the signature itself, without the name or the wrapping parens.
function signatureText(text) {
  const value = String(text ?? "").trim();
  const match = value.match(/^[^\s()]+\(([\s\S]*)\)$/);
  if (!match) return value;
  let depth = 0;
  for (const character of match[1]) {
    if (character === "(") depth += 1;
    else if (character === ")" && --depth < 0) return value;
  }
  return depth === 0 ? match[1].trim() : value;
}

function hoverMessageForSources(sources, descriptions, signatures = []) {
  if (signatures.length > 0) {
    const lines = [...new Set(signatures.map((signature) => signatureText(signature.text)))].filter(Boolean);
    if (lines.length > 0) {
      return { value: lines.map((line) => markdownCode(line)).join("\n"), isTrusted: false, supportHtml: false };
    }
  }

  const message = originsMessage(sources, descriptions);
  if (!message) return undefined;
  return { value: message, isTrusted: false, supportHtml: false };
}

export function decorationsForAnalysis(result, source, model) {
  const byteOffsets = byteOffsetsToUtf16(source);
  const decorations = [];
  const toUtf16 = (offset) => {
    if (offset == null) return null;
    const clamped = Math.max(0, Math.min(offset, byteOffsets.length - 1));
    return byteOffsets[clamped] ?? source.length;
  };
  const provenance = result.provenance ?? { origins: [], flow: [] };
  const originIndex = updateFlowPalette(provenance);
  const flowByRange = new Map();
  for (const mark of provenance.flow ?? []) {
    const key = `${mark.start}:${mark.end}`;
    const data = flowByRange.get(key) ?? {
      sources: new Set(),
      colorSources: new Set(),
      signatures: [],
    };
    for (const id of mark.sources ?? []) {
      data.sources.add(id);
      if (mark.color !== false) data.colorSources.add(id);
    }
    for (const signature of mark.signatures ?? []) {
      if (!data.signatures.some((existing) =>
        existing.text === signature.text && existing.declaration === signature.declaration)) {
        data.signatures.push(signature);
      }
    }
    flowByRange.set(key, data);
  }

  const tokens = result.tokens ?? [];
  const templateStyles = templateTokenStyles(tokens, source);
  const descriptions = originDescriptions(provenance, tokens, source, toUtf16, model);
  const originOffsets = new Map((provenance.origins ?? []).map((origin) => [
    origin.id,
    toUtf16(origin.anchor),
  ]));
  const hoverRanges = [];
  const bracketGroups = [];
  const groupedTokens = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].kind !== "LeftBracket") continue;
    let depth = 1;
    let closingIndex = index + 1;
    for (; closingIndex < tokens.length; closingIndex += 1) {
      if (tokens[closingIndex].kind === "LeftBracket") depth += 1;
      if (tokens[closingIndex].kind === "RightBracket" && --depth === 0) break;
    }
    if (closingIndex >= tokens.length) continue;

    const groupSources = new Set();
    const groupColorSources = new Set();
    for (let item = index; item <= closingIndex; item += 1) {
      if (tokens[item].kind === "Comment") continue;
      const data = flowByRange.get(`${tokens[item].start}:${tokens[item].end}`);
      for (const id of data?.sources ?? []) groupSources.add(id);
      for (const id of data?.colorSources ?? []) groupColorSources.add(id);
    }
    if (groupSources.size > 0) {
      for (let item = index; item <= closingIndex; item += 1) groupedTokens.add(item);
      for (let item = index; item <= closingIndex; item += 1) {
        if (tokens[item].kind === "Comment") continue;
        const key = `${tokens[item].start}:${tokens[item].end}`;
        const data = flowByRange.get(key) ?? {
          sources: new Set(),
          colorSources: new Set(),
          signatures: [],
        };
        for (const id of groupSources) data.sources.add(id);
        for (const id of groupColorSources) data.colorSources.add(id);
        flowByRange.set(key, data);
      }
      const groupSignatures = [];
      for (let item = index; item <= closingIndex; item += 1) {
        const data = flowByRange.get(`${tokens[item].start}:${tokens[item].end}`);
        for (const signature of data?.signatures ?? []) {
          if (!groupSignatures.some((existing) => existing.text === signature.text)) groupSignatures.push(signature);
        }
      }
      bracketGroups.push({
        from: tokens[index].start,
        to: tokens[closingIndex].end,
        sources: [...groupSources],
        signatures: groupSignatures,
      });
    }
    index = closingIndex;
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const from = toUtf16(token.start);
    const to = toUtf16(token.end);
    if (from == null || to == null || to <= from) continue;
    const style = styleForToken(token.kind);
    if (!style) continue;
    const flow = flowByRange.get(`${token.start}:${token.end}`);
    const sources = [...(flow?.sources ?? [])];
    const colorSources = [...(flow?.colorSources ?? [])];
    const sourceClass = flowClassesFor(colorSources, originIndex);
    const signatures = [...(flow?.signatures ?? [])];
    const hoverMessage = groupedTokens.has(tokenIndex)
      ? undefined
      : hoverMessageForSources(sources, descriptions, signatures);
    const templateClasses = [];
    if (templateStyles.angles.has(tokenIndex)) templateClasses.push("qwq-template-angle");
    if (templateStyles.parameters.has(tokenIndex)) templateClasses.push("qwq-template-parameter");
    const classes = ["qwq-token", `qwq-${style}`, sourceClass, ...templateClasses].filter(Boolean).join(" ");
    const range = monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to));
    if (hoverMessage) {
      const declarationTargets = [...new Set(signatures
        .filter((signature) => Number.isInteger(signature.declaration))
        .map((signature) => toUtf16(signature.declaration))
        .filter((offset) => offset != null))];
      const sourceTargets = sources
        .map((id) => ({
          index: descriptions.get(id)?.index ?? Number.MAX_SAFE_INTEGER,
          offset: originOffsets.get(id),
        }))
        .filter((target) => target.offset != null)
        .sort((first, second) => first.index - second.index)
        .map((target) => target.offset);
      const targets = declarationTargets.length > 0
        ? declarationTargets
        : [...new Set(sourceTargets)];
      const navigation = targets.length > 0
        ? { kind: declarationTargets.length > 0 ? "definition" : "source", targets }
        : null;
      hoverRanges.push({ start: from, end: to, message: hoverMessage, navigation });
    }
    if (!classes) continue;
    decorations.push({
      range,
      options: { inlineClassName: classes },
    });
  }

  // `[q]` reads as one unit: a single hover over the whole group instead of one per character.
  for (const group of bracketGroups) {
    const message = hoverMessageForSources(group.sources, descriptions, group.signatures);
    if (!message) continue;
    const from = toUtf16(group.from);
    const to = toUtf16(group.to);
    if (from == null || to == null || to <= from) continue;
    const targets = [...new Set(group.sources.map((id) => originOffsets.get(id)).filter((offset) => offset != null))];
    hoverRanges.push({
      start: from,
      end: to,
      message,
      navigation: targets.length > 0 ? { kind: "source", targets } : null,
    });
  }

  hoverRangesByModel.set(model, hoverRanges);
  return decorations;
}

export function markersForAnalysis(result, source, model) {
  const byteOffsets = byteOffsetsToUtf16(source);
  const toUtf16 = (offset) => {
    if (offset == null) return null;
    const clamped = Math.max(0, Math.min(offset, byteOffsets.length - 1));
    return byteOffsets[clamped] ?? source.length;
  };

  return (result.diagnostics ?? []).flatMap((diagnostic) => {
    let start = toUtf16(diagnostic.start);
    let end = toUtf16(diagnostic.end);
    if (start == null) return [];
    if (end == null) end = start;
    if (end <= start) {
      if (start < source.length) end = start + 1;
      else if (start > 0) start -= 1;
    }

    const startPosition = model.getPositionAt(start);
    const endPosition = model.getPositionAt(end);
    return [{
      severity: monaco.MarkerSeverity.Error,
      message: diagnostic.message,
      source: "qwq",
      code: diagnostic.phase,
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    }];
  });
}

export { monaco };
