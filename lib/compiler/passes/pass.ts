import type * as a from "../../parser";
import type { ParsedOptions } from "..";
import type { Session } from "../session";

/** Possible compilation stage name. */
export enum Stage {
  /**
   * Passes that should check correctness of the parser AST. Passes in that
   * stage shouldn't modify the ast, if modification is required, use the
   * `transform` stage. This is the first stage executed.
   */
  check = "check",
  /**
   * Passes that should transform initial AST. They could add or remove some
   * nodes from the AST, or calculate some properties on nodes. That stage is
   * executed after the `check` stage but before the `generate` stage.
   */
  transform = "transform",
  /**
   * Passes that should generate the final code. This is the last stage executed
   */
  generate = "generate",
}

export type Stages = Record<Stage, Pass[]>;

/**
 * Function that performs checking, transformation or analysis of the AST.
 *
 * @param ast Reference to the parsed grammar. Pass can change it
 * @param options Options that was supplied to the `PEG.generate()` call.
 *        All passes shared the same options object
 * @param session An object that stores information about current compilation
 *        session and allows passes to report errors, warnings, and information
 *        messages. All passes shares the same session object
 */
export type Pass =
  (ast: a.Grammar, options: ParsedOptions, session: Session) => void;
