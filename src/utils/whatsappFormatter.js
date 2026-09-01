/**
 * WhatsApp Markdown Formatter Utility
 * Converts standard Markdown (from ChatGPT/OpenAI) to native WhatsApp formatting.
 */

class WhatsAppFormatter {
  /**
   * Convert standard markdown text into WhatsApp compatible markdown.
   * @param {string} text - Raw markdown text from ChatGPT
   * @returns {string} - WhatsApp formatted text
   */
  format(text) {
    if (!text || typeof text !== 'string') return '';

    let formatted = text;

    // 1. Preserve code blocks (temporarily mask them)
    const codeBlocks = [];
    formatted = formatted.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const index = codeBlocks.length;
      const langHeader = lang ? `*💻 ${lang.toUpperCase()}*\n` : '';
      codeBlocks.push(`${langHeader}\`\`\`\n${code.trim()}\n\`\`\``);
      return `__CODE_BLOCK_${index}__`;
    });

    // 2. Preserve inline code
    const inlineCodes = [];
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
      const index = inlineCodes.length;
      inlineCodes.push(`\`${code}\``);
      return `__INLINE_CODE_${index}__`;
    });

    // 3. Headers: Convert # Header -> *HEADER*
    formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, (match, title) => {
      return `\n*${title.trim().toUpperCase()}*\n`;
    });

    // 4. Bold: Convert **bold** or __bold__ to *bold*
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
    formatted = formatted.replace(/__(.*?)__/g, '*$1*');

    // 5. Italic: Convert *italic* (single asterisk not bold) or _italic_ -> _italic_
    // Note: In WhatsApp, _italic_ is standard.

    // 6. Strikethrough: Convert ~~strikethrough~~ -> ~strikethrough~
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');

    // 7. Bullet lists: Convert markdown bullets (*, -, +) -> •
    formatted = formatted.replace(/^[\*\-\+]\s+(.+)$/gm, '• $1');

    // 8. Blockquotes: Convert > quote -> > quote (WhatsApp natively supports > blockquotes)
    formatted = formatted.replace(/^>\s+(.+)$/gm, '> $1');

    // 9. Links: Convert [Title](url) -> *Title*: url
    formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '*$1* ($2)');

    // 10. Restore inline code
    inlineCodes.forEach((code, i) => {
      formatted = formatted.replace(`__INLINE_CODE_${i}__`, code);
    });

    // 11. Restore code blocks
    codeBlocks.forEach((block, i) => {
      formatted = formatted.replace(`__CODE_BLOCK_${i}__`, block);
    });

    // 12. Clean up excessive consecutive newlines (max 2)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    return formatted.trim();
  }

  /**
   * Split a long message into sequential chunks within the WhatsApp 4096 char limit.
   * Ensures code blocks and paragraphs are not broken awkwardly.
   * @param {string} text - The formatted text
   * @param {number} maxChunkLength - Max character limit (default 3800 for safety)
   * @returns {string[]} - Array of message chunks
   */
  splitIntoChunks(text, maxChunkLength = 3800) {
    if (!text || text.length <= maxChunkLength) {
      return [text || ''];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxChunkLength) {
        chunks.push(remaining.trim());
        break;
      }

      // Find best splitting point before maxChunkLength
      let splitIndex = -1;

      // 1. Try splitting at a double newline (paragraph boundary)
      const doubleNewline = remaining.lastIndexOf('\n\n', maxChunkLength);
      if (doubleNewline > maxChunkLength * 0.4) {
        splitIndex = doubleNewline;
      }

      // 2. Try splitting at a single newline
      if (splitIndex === -1) {
        const singleNewline = remaining.lastIndexOf('\n', maxChunkLength);
        if (singleNewline > maxChunkLength * 0.4) {
          splitIndex = singleNewline;
        }
      }

      // 3. Try splitting at a sentence end (. or ? or !)
      if (splitIndex === -1) {
        const sentenceEnd = remaining.slice(0, maxChunkLength).search(/[\.\?!]\s+(?=[A-Z0-9])/);
        if (sentenceEnd > maxChunkLength * 0.4) {
          splitIndex = sentenceEnd + 1;
        }
      }

      // 4. Fallback to space
      if (splitIndex === -1) {
        const space = remaining.lastIndexOf(' ', maxChunkLength);
        if (space > 0) {
          splitIndex = space;
        } else {
          splitIndex = maxChunkLength;
        }
      }

      const chunk = remaining.substring(0, splitIndex).trim();
      if (chunk) chunks.push(chunk);
      remaining = remaining.substring(splitIndex).trim();
    }

    return chunks;
  }
}

module.exports = new WhatsAppFormatter();
