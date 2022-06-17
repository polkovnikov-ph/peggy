import {
  generateBytecode,
  generateJS,
  inferenceMatchResult,
  removeProxyRules,
  reportDuplicateLabels,
  reportDuplicateRules,
  reportInfiniteRecursion,
  reportInfiniteRepetition,
  reportUndefinedRules,
  reportIncorrectPlucking,
} from "./passes";
import { Session } from "./session";
import type { Diagnostics } from "./session";
import { buildVisitor } from "./visitor";
import { base64, entries } from "./utils";
import * as a from '../parser';
import type { Stages } from "./passes/pass";
import type { SourceNode } from "source-map-generator";
import type { ParserModule } from "../generated";

/**
 * Parser dependencies, is an object which maps variables used to access the
 * dependencies in the parser to module IDs used to load them
 */
export interface Dependencies {
  [variable: string]: string;
}

/**
 * Object that will be passed to the each plugin during their setup.
 * Plugins can replace `parser` and add new pass(es) to the `passes` array.
 */
export interface Config {
  /**
   * Parser object that will be used to parse grammar source. Plugin can replace it.
   */
  parser: ParserModule;
  /**
   * List of stages with compilation passes that plugin usually should modify
   * to add their own pass.
   */
  passes: Stages;
  /**
   * List of words that won't be allowed as label names. Using such word will
   * produce a syntax error. This property can be replaced by the plugin if
   * it want to change list of reserved words. By default this list is equals
   * to `RESERVED_WORDS`.
   */
  reservedWords: string[];
}

/** Interface for the Peggy extenders. */
export interface Plugin {
  /**
   * This method is called at start of the `generate()` call, before even parser
   * of the supplied grammar will be invoked. All plugins invoked in the order in
   * which their registered in the `options.plugins` array.
   *
   * @param config Object that can be modified by plugin to enhance generated parser
   * @param options Options that was supplied to the `generate()` call. Plugin
   *        can find their own parameters there. It is recommended to store all
   *        options in the object with name of plugin to reduce possible clashes
   */
  use(config: Config, options: RawOptions): void;
}

export interface BuildOptionsBase extends Partial<Diagnostics> {
  /** Rules the parser will be allowed to start parsing from (default: the first rule in the grammar) */
  allowedStartRules?: string[];

  /** If `true`, makes the parser cache results, avoiding exponential parsing time in pathological cases but making the parser slower (default: `false`) */
  cache?: boolean;

  /**
   * Object that will be attached to the each `LocationRange` object created by
   * the parser. For example, this can be path to the parsed file or even the
   * File object.
   */
  grammarSource?: any;

  /**
   * Selects between optimizing the generated parser for parsing speed (`"speed"`)
   * or code size (`"size"`) (default: `"speed"`)
   *
   * @deprecated This feature was deleted in 1.2.0 release and has no effect anymore.
   *             It will be deleted in 2.0.
   *             Parser is always generated in the former `"speed"` mode
   */
  optimize?: "speed" | "size";

  /** Plugins to use */
  plugins?: Plugin[];

  /** Makes the parser trace its progress (default: `false`) */
  trace?: boolean;
}

export type AstOutput = {
  output: "ast";
}

export type ParserOutput = {
  /**
   * If set to `"parser"`, the method will return generated parser object;
   * if set to `"source"`, it will return parser source code as a string;
   * if set to `"source-and-map"`, it will return a `SourceNode` object
   *   which can give a parser source code as a string and a source map;
   * if set to `"source-with-inline-map"`, it will return the parser source
   *   along with an embedded source map as a `data:` URI;
   * (default: `"parser"`)
   */
  output?: "parser";
}

export type SourceOutput<Output> = {
  /**
   * If set to `"parser"`, the method will return generated parser object;
   * if set to `"source"`, it will return parser source code as a string;
   * if set to `"source-and-map"`, it will return a `SourceNode` object
   *   which can give a parser source code as a string and a source map;
   * if set to `"source-with-inline-map"`, it will return the parser source
   *   along with an embedded source map as a `data:` URI;
   * (default: `"parser"`)
   */
  output: Output;
}

export interface JsFormatBare {
  /** Format of the generated parser (`"amd"`, `"bare"`, `"commonjs"`, `"es"`, `"globals"`, or `"umd"`); valid only when `output` is set to `"source"` (default: `"bare"`) */
  format?: "bare";
}

export interface JsFormatUmd {
  /** Format of the generated parser (`"amd"`, `"bare"`, `"commonjs"`, `"es"`, `"globals"`, or `"umd"`); valid only when `output` is set to `"source"` (default: `"bare"`) */
  format: "umd";
  /**
   * Parser dependencies, the value is an object which maps variables used to
   * access the dependencies in the parser to module IDs used to load them;
   * valid only when `format` is set to `"amd"`, `"commonjs"`, `"es"`, or `"umd"`
   * (default: `{}`)
   */
  dependencies?: Dependencies;
  /**
   * Name of a global variable into which the parser object is assigned to when
   * no module loader is detected; valid only when `format` is set to `"globals"`
   * (and in that case it should be defined) or `"umd"` (default: `null`)
   */
  exportVar?: string;
};

export interface JsFormatGlobals {
  /** Format of the generated parser (`"amd"`, `"bare"`, `"commonjs"`, `"es"`, `"globals"`, or `"umd"`); valid only when `output` is set to `"source"` (default: `"bare"`) */
  format: "globals";
  /**
   * Name of a global variable into which the parser object is assigned to when
   * no module loader is detected; valid only when `format` is set to `"globals"`
   * (and in that case it should be defined) or `"umd"` (default: `null`)
   */
  exportVar: string;
}

export interface JsFormatCommon {
  /** Format of the generated parser (`"amd"`, `"bare"`, `"commonjs"`, `"es"`, `"globals"`, or `"umd"`); valid only when `output` is set to `"source"` (default: `"bare"`) */
  format: "amd" | "commonjs" | "es";
  /**
   * Parser dependencies, the value is an object which maps variables used to
   * access the dependencies in the parser to module IDs used to load them;
   * valid only when `format` is set to `"amd"`, `"commonjs"`, `"es"`, or `"umd"`
   * (default: `{}`)
   */
  dependencies?: Dependencies;
}

export type ModuleFormats =
  | JsFormatUmd
  | JsFormatBare
  | JsFormatGlobals
  | JsFormatCommon;

export type RawOptions = BuildOptionsBase & (AstOutput | ParserOutput | ModuleFormats & (SourceOutput<"source" | "source-with-inline-map" | "source-and-map">))

const parseModuleFormats = (data: ModuleFormats) => {
  switch (data.format) {
    case "amd":
    case "commonjs":
    case "es":
      return {
        format: data.format,
        dependencies: data.dependencies || {},
      };
    
    case "bare": case undefined:
      return {
        format: data.format || "bare" as const,
      };

    case "umd":
      return {
        format: data.format,
        dependencies: data.dependencies || {},
        exportVar: data.exportVar || undefined,
      };

    case "globals":
      return {
        format: data.format,
        exportVar: data.exportVar || undefined,
      };
  }
};

const parseOptions = (getFirstRule: () => string, options: RawOptions) => {
  const {
    allowedStartRules = [getFirstRule()],
    cache = false,
    trace = false,
    grammarSource,
    optimize,
    plugins,
    error,
    warning,
    info,
  } = options;

  if (!options.output || options.output === "parser" || options.output === "ast") {
    return {
      output: options.output || "parser" as const,
      allowedStartRules,
      cache,
      trace,
      grammarSource,
      optimize,
      plugins,
      error,
      warning,
      info,
      format: "bare" as const,
    };
  } else if (options.output === "source" || options.output === "source-and-map" || options.output === "source-with-inline-map"){
    const format = parseModuleFormats(options);
    return {
      output: options.output,
      allowedStartRules,
      cache,
      trace,
      grammarSource,
      optimize,
      plugins,
      error,
      warning,
      info,
      ...format,
    };
  } else {
    throw new Error(`Unknown output value: ${options.output}`);
  }
};
export type ParsedOptions = ReturnType<typeof parseOptions>;

declare global {
  class TextEncoder {
    encode: (input: string) => Uint8Array;
  }
}

/**
 * Generates a parser from a specified grammar AST.
 *
 * Note that not all errors are detected during the generation and some may
 * protrude to the generated parser and cause its malfunction.
 *
 * @param ast Abstract syntax tree of the grammar from a parser
 * @param stages List of compilation stages
 * @param options Compilation options
 *
 * @return A parser object
 *
 * @throws {GrammarError} If the AST contains a semantic error, for example,
 *         duplicated labels
 */

// Generates a parser from a specified grammar AST. Throws |peg.GrammarError|
// if the AST contains a semantic error. Note that not all errors are detected
// during the generation and some may protrude to the generated parser and
// cause its malfunction.
function compile(ast: a.Grammar, stages: Stages, options?: BuildOptionsBase & ParserOutput): ParserModule;
function compile(ast: a.Grammar, stages: Stages, options: BuildOptionsBase & AstOutput): a.Grammar;
function compile(ast: a.Grammar, stages: Stages, options: BuildOptionsBase & ModuleFormats & SourceOutput<"source" | "source-with-inline-map">): string;
function compile(ast: a.Grammar, stages: Stages, options: BuildOptionsBase & ModuleFormats & SourceOutput<"source-and-map">): SourceNode;
function compile(ast: a.Grammar, stages: Stages, rawOptions: RawOptions = {}): a.Grammar | ParserModule | string | SourceNode {
  const options = parseOptions(() => {
    if (ast.rules.length === 0) {
      throw new Error("Must have at least one start rule");
    }
    return ast.rules[0].name;
  }, rawOptions);

  const allRules = ast.rules.map(r => r.name);
  // "*" means all rules are start rules.  "*" is not a valid rule name.
  if (options.allowedStartRules.some(r => r === "*")) {
    options.allowedStartRules = allRules;
  } else {
    for (const rule of options.allowedStartRules) {
      if (allRules.indexOf(rule) === -1) {
        throw new Error(`Unknown start rule "${rule}"`);
      }
    }
  }
  // Due to https://github.com/mozilla/source-map/issues/444
  // grammarSource is required
  if (((options.output === "source-and-map")
       || (options.output === "source-with-inline-map"))
      && ((typeof options.grammarSource !== "string")
          || (options.grammarSource.length === 0))) {
    throw new Error("Must provide grammarSource (as a string) in order to generate source maps");
  }

  const session = new Session(options);
  for (const [stageName, passes] of entries(stages)) {
    session.stage = stageName;
    session.info(`Process stage ${stageName}`);

    for (const pass of passes) {
      session.info(`Process pass ${stageName}.${pass.name}`);

      pass(ast, options, session);
    }

    // Collect all errors by stage
    session.checkErrors();
  }

  const {code} = ast;
  if (!code) {
    throw new Error("Failed to generate code");
  }

  switch (options.output) {
    case "parser":
      return eval(code.toString());

    case "source":
      return code.toString();

    case "source-and-map":
      return code;

    case "source-with-inline-map": {
      if (typeof TextEncoder === "undefined") {
        throw new Error("TextEncoder is not supported by this platform");
      }
      const sourceMap = code.toStringWithSourceMap();
      const encoder = new TextEncoder();
      const b64 = base64(
        encoder.encode(JSON.stringify(sourceMap.map.toJSON()))
      );
      return sourceMap.code + `\
//\x23 sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}
`;
    }

    case "ast":
      return ast;
  }
};

export const compiler = {
  // AST node visitor builder. Useful mainly for plugins which manipulate the
  // AST.
  visitor: {
    build: buildVisitor,
  },

  // Compiler passes.
  //
  // Each pass is a function that is passed the AST. It can perform checks on it
  // or modify it as needed. If the pass encounters a semantic error, it throws
  // |peg.GrammarError|.
  /**
   * Mapping from the stage name to the default pass suite.
   * Plugins can extend or replace the list of passes during configuration.
   */
  /**
   * List of possible compilation stages. Each stage consist of the one or
   * several passes. Three default stage are defined, but plugins can insert
   * as many new stages as they want. But keep in mind, that order of stages
   * execution is defined by the insertion order (or declaration order in case
   * of the object literal) properties with stage names.
   */
  /** List of the compilation stages. */
  passes: {
    check: [
      reportUndefinedRules,
      reportDuplicateRules,
      reportDuplicateLabels,
      reportInfiniteRecursion,
      reportInfiniteRepetition,
      reportIncorrectPlucking,
    ],
    transform: [
      removeProxyRules,
      inferenceMatchResult,
    ],
    generate: [
      generateBytecode,
      generateJS,
    ],
  },

  compile,
};
