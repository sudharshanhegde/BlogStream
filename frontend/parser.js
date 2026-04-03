/**
 * cleanTextForTTS
 *
 * Keeps all content (including code) but strips characters that sound
 * terrible when read aloud by a TTS engine.
 *
 * What gets removed / replaced:
 *   - Fenced code block markers  (triple-backtick and ~~~)
 *   - Inline code backticks      (backtick code backtick) - just the backticks, text kept
 *   - HTML tags                  (<div>) - removed entirely
 *   - Symbols: # < > { } [ ] ( ) ; = + * @ ^ ~ | \ / _ $ % &
 *   - Markdown heading markers   (### ) - just the hashes
 *   - Markdown bold/italic markers (** or __) - just the markers
 *   - Markdown link syntax       ([text](url)) - keeps text, drops URL
 *   - Markdown image syntax      (![alt](url)) - removed
 *   - Blockquote markers         (> ) - removed
 *   - HTML entities              (&lt; &gt;) - removed or replaced
 *
 * What is KEPT:
 *   - All words (including code keywords like include, int, printf, etc.)
 *   - Numbers
 *   - Commas, periods, !, ?, ', ", -, newlines
 */
function cleanTextForTTS(raw) {
  let text = raw;

  // 1. Remove fenced code block openers/closers (``` lang or ~~~)
  //    but KEEP the code inside
  text = text.replace(/^```[^\n]*$/gm, "");
  text = text.replace(/^~~~[^\n]*$/gm, "");

  // 2. Strip inline code backticks, keep the content
  text = text.replace(/`([^`]*)`/g, "$1");

  // 3. Strip HTML tags entirely (e.g. <div>, <br/>, <stdio.h> treated as tag)
  text = text.replace(/<[^>]+>/g, " ");

  // 4. Decode useful HTML entities, remove noise ones
  const entities = {
    "&amp;":   "and",
    "&lt;":    "",
    "&gt;":    "",
    "&nbsp;":  " ",
    "&quot;":  '"',
    "&#39;":   "'",
    "&apos;":  "'",
    "&ndash;": "-",
    "&mdash;": "-",
    "&hellip;":"",
  };
  for (const [entity, replacement] of Object.entries(entities)) {
    text = text.replaceAll(entity, replacement);
  }
  text = text.replace(/&#\d+;/g, "");
  text = text.replace(/&[a-z]+;/gi, "");

  // 5. Strip markdown heading markers (keep heading text)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 6. Strip markdown bold/italic markers, keep text
  text = text.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1");

  // 7. Strip markdown links [text](url) → keep text only
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // 8. Remove markdown images
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // 9. Remove blockquote markers
  text = text.replace(/^>\s*/gm, "");

  // 10. Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // 11. Remove markdown table pipes and separator rows
  text = text.replace(/^\|.*\|$/gm, "");
  text = text.replace(/^[\s|:-]+$/gm, "");

  // 12. Remove special characters that sound bad when read aloud.
  //     These are the ones a TTS engine will either skip or read as
  //     "hash", "left bracket", "semicolon", etc.
  //     Removed: # < > { } [ ] ( ) ; = + * @ ^ ~ | \ / _ ` $ % & ! when standalone
  //
  //     Strategy: replace each with a space so words don't merge.
  //     Preserve: letters, digits, space, comma, period, !, ?, ', ", -, newline
  text = text.replace(/[#<>{}\[\]();=+*@^~|\\\/`$%&_]/g, " ");

  // 13. Collapse runs of spaces, preserve newlines
  text = text.replace(/[ \t]+/g, " ");

  // 14. Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // 15. Trim each line
  text = text.split("\n").map(l => l.trim()).join("\n");

  return text.trim();
}
