import type { Stage } from './compiler/passes/pass';
import type { LocationRange } from './parser';

// See: https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
// This is roughly what typescript generates, it's not called after super(), where it's needed.
// istanbul ignore next This is a special black magic that cannot be covered everywhere
const setProtoOf = Object.setPrototypeOf
  || ({ __proto__: [] } instanceof Array
      && function(d: any, b: any) {
        // eslint-disable-next-line no-proto
        d.__proto__ = b;
      })
  || function(d: any, b: any) {
    for (const p in b) {
      if (Object.prototype.hasOwnProperty.call(b, p)) {
        d[p] = b[p];
      }
    }
  };

export interface DiagnosticNote {
  message: string;
  location: LocationRange;
}

/** Severity level of problems that can be registered in compilation session. */
export type Severity = "error" | "warning" | "info";

export type Problem = [
  /** Problem severity. */
  Severity,
  /** Diagnostic message. */
  string,
  /** Location where message is generated, if applicable. */
  LocationRange?,
  /** List of additional messages with their locations, if applicable. */
  DiagnosticNote[]?,
];

/**
 * The entry that maps object in the `source` property of error locations
 * to the actual source text of a grammar. That entries is necessary for
 * formatting errors.
 */
export interface SourceText {
  /**
   * Identifier of a grammar that stored in the `location().source` property
   * of error and diagnostic messages.
   *
   * This one should be the same object that used in the `location().source`,
   * because their compared using `===`.
   */
  source: any;
  /** Source text of a grammar. */
  text: string;
}

// Thrown when the grammar contains an error.
export class GrammarError extends Error {
  public stage: Stage | null;
  public problems: Problem[];
  constructor(
    public message: string,
    public readonly location?: LocationRange,
    public readonly diagnostics: DiagnosticNote[] = []
  ) {
    super(message);
    setProtoOf(this, GrammarError.prototype);
    this.name = "GrammarError";
    // All problems if this error is thrown by the plugin and not at stage
    // checking phase
    this.stage = null;
    this.problems = [["error", message, location, diagnostics]];
  }

  toString() {
    let str = super.toString();
    if (this.location) {
      str += "\n at ";
      if ((this.location.source !== undefined)
          && (this.location.source !== null)) {
        str += `${this.location.source}:`;
      }
      str += `${this.location.start.line}:${this.location.start.column}`;
    }
    for (const diag of this.diagnostics) {
      str += "\n from ";
      if ((diag.location.source !== undefined)
          && (diag.location.source !== null)) {
        str += `${diag.location.source}:`;
      }
      str += `${diag.location.start.line}:${diag.location.start.column}: ${diag.message}`;
    }

    return str;
  }

  /**
   * Format the error with associated sources.  The `location.source` should have
   * a `toString()` representation in order the result to look nice. If source
   * is `null` or `undefined`, it is skipped from the output
   *
   * Sample output:
   * ```
   * Error: Label "head" is already defined
   *  --> examples/arithmetics.pegjs:15:17
   *    |
   * 15 |   = head:Factor head:(_ ("*" / "/") _ Factor)* {
   *    |                 ^^^^
   * note: Original label location
   *  --> examples/arithmetics.pegjs:15:5
   *    |
   * 15 |   = head:Factor head:(_ ("*" / "/") _ Factor)* {
   *    |     ^^^^
   * ```
   *
   * @param {import("./peg").SourceText[]} sources mapping from location source to source text
   *
   * @returns {string} the formatted error
   */
  format(sources: SourceText[]) {
    const srcLines = sources.map(({ source, text }) => ({
      source,
      text: text.split(/\r\n|\n|\r/g),
    }));

    /**
     * Returns a highlighted piece of source to which the `location` points
     *
     * @param {import("./peg").LocationRange} location
     * @param {number} indent How much width in symbols line number strip should have
     * @param {string} message Additional message that will be shown after location
     * @returns {string}
     */
    function entry(location: LocationRange, indent: number, message: string = "") {
      let str = "";
      const src = srcLines.find(({ source }) => source === location.source);
      const s = location.start;
      if (src) {
        const e = location.end;
        const line = src.text[s.line - 1];
        const last = s.line === e.line ? e.column : line.length + 1;
        const hatLen = (last - s.column) || 1;
        if (message) {
          str += `\nnote: ${message}`;
        }
        str += `
 --> ${location.source}:${s.line}:${s.column}
${"".padEnd(indent)} |
${s.line.toString().padStart(indent)} | ${line}
${"".padEnd(indent)} | ${"".padEnd(s.column - 1)}${"".padEnd(hatLen, "^")}`;
      } else {
        str += `\n at ${location.source}:${s.line}:${s.column}`;
        if (message) {
          str += `: ${message}`;
        }
      }

      return str;
    }

    /**
     * Returns a formatted representation of the one problem in the error.
     */
    function formatProblem(
      severity: Severity,
      message: string,
      location?: LocationRange,
      diagnostics: DiagnosticNote[] = []
    ) {
      // Calculate maximum width of all lines
      let maxLine;
      if (location) {
        maxLine = diagnostics.reduce(
          (t, { location }) => Math.max(t, location.start.line),
          location.start.line
        );
      } else {
        maxLine = Math.max.apply(
          null,
          diagnostics.map(d => d.location.start.line)
        );
      }
      maxLine = maxLine.toString().length;

      let str = `${severity}: ${message}`;
      if (location) {
        str += entry(location, maxLine);
      }
      for (const diag of diagnostics) {
        str += entry(diag.location, maxLine, diag.message);
      }

      return str;
    }

    // "info" problems are only appropriate if in verbose mode.
    // Handle them separately.
    return this.problems
      .filter(p => p[0] !== "info")
      .map(p => formatProblem(...p)).join("\n\n");
  }
}
