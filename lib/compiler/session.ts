import { GrammarError } from "../grammar-error";
import type { DiagnosticNote, Problem } from "../grammar-error";
import type { LocationRange } from "../parser";
import type { Stage } from "./passes/pass";

/**
 * Called when compiler reports an error, warning, or info.
 *
 * @param stage Stage in which this diagnostic was originated
 * @param message Main message, which should describe error objectives
 * @param location If defined, this is location described in the `message`
 * @param notes Additional messages with context information
 */
export type DiagnosticCallback = (
  stage: Stage,
  message: string,
  location?: LocationRange,
  notes?: DiagnosticNote[]
) => void;

export type Diagnostics = {
  /** Called when a semantic error during build was detected. */
  error: DiagnosticCallback;
  /** Called when a warning during build was registered. */
  warning: DiagnosticCallback;
  /** Called when an informational message during build was registered. */
  info: DiagnosticCallback;
}

/**
 * Compiler session, that allow a pass to register an error, warning or
 * an informational message.
 *
 * A new session is created for the each `PEG.generate()` call.
 * All passes, involved in the compilation, shares the one session object.
 *
 * Passes should use that object to reporting errors instead of throwing
 * exceptions, because reporting via this object allows report multiply
 * errors from different passes. Throwing `GrammarError` are also allowed
 * for backward compatibility.
 *
 * Errors will be reported after completion of each compilation stage where
 * each of them can have multiply passes. Plugins can register as many
 * stages as they want, but it is recommended to register pass in the
 * one of default stages, if possible:
 * - `check`
 * - `transform`
 * - `generate`
 */
export class Session {
  /**
   * The issues that have been registered during the compilation.
   */
  public problems: Problem[] = [];
  public stage: Stage | null = null;
  private _callbacks: Diagnostics;
  private _firstError: GrammarError | null = null;
  public errors = 0;

  constructor(options: Partial<Diagnostics> = {}) {
    const ignored = () => {};
    this._callbacks = {
      error: ignored,
      info: ignored,
      warning: ignored,
      ...options,
    };
  }

  /**
   * Reports an error. Pass shouldn't assume that after reporting error it
   * will be interrupted by throwing exception or in the other way. Therefore,
   * if after reporting error further execution of the pass is impossible, it
   * should use control flow statements, such as `break`, `continue`, `return`
   * to stop their execution.
   *
   * @param message Main message, which should describe error objectives
   * @param location If defined, this is location described in the `message`
   * @param notes Additional messages with context information
   */
  error(
    message: string,
    location?: LocationRange,
    notes?: DiagnosticNote[]
  ): void {
    const args = [message, location, notes] as const;
    ++this.errors;
    // In order to preserve backward compatibility we cannot change `GrammarError`
    // constructor, nor throw another class of error:
    // - if we change `GrammarError` constructor, this will break plugins that
    //   throws `GrammarError`
    // - if we throw another Error class, this will break parser clients that
    //   catches GrammarError
    //
    // So we use a compromise: we throw an `GrammarError` with all found problems
    // in the `problems` property, but the thrown error itself is the first
    // registered error.
    //
    // Thus when the old client catches the error it can find all properties on
    // the Grammar error that it want. On the other hand the new client can
    // inspect the `problems` property to get all problems.
    if (this._firstError === null) {
      this._firstError = new GrammarError(...args);
      this._firstError.stage = this.stage;
      this._firstError.problems = this.problems;
    }

    if (!this.stage) {
      throw new Error("Impossible");
    }

    this.problems.push(["error", ...args]);
    this._callbacks.error(this.stage, ...args);
  }

  /**
   * Reports a warning. Warning is a diagnostic, that doesn't prevent further
   * execution of a pass, but possible points to the some mistake, that should
   * be fixed.
   *
   * @param message Main message, which should describe warning objectives
   * @param location If defined, this is location described in the `message`
   * @param notes Additional messages with context information
   */
  warning(
    message: string,
    location?: LocationRange,
    notes?: DiagnosticNote[]
  ): void {
    const args = [message, location, notes] as const;
    this.problems.push(["warning", ...args]);

    if (!this.stage) {
      throw new Error("Impossible");
    }
    this._callbacks.warning(this.stage, ...args);
  }

  /**
   * Reports an informational message. such messages can report some important
   * details of pass execution that could be useful for the user, for example,
   * performed transformations over the AST.
   *
   * @param message Main message, which gives information about an event
   * @param location If defined, this is location described in the `message`
   * @param notes Additional messages with context information
   */
   info(
    message: string,
    location?: LocationRange,
    notes?: DiagnosticNote[]
  ): void {
    const args = [message, location, notes] as const;
    this.problems.push(["info", ...args]);

    if (!this.stage) {
      throw new Error("Impossible");
    }
    this._callbacks.info(this.stage, ...args);
  }

  checkErrors() {
    if (this.errors !== 0) {
      throw this._firstError;
    }
  }
}
