export { default as VERSION } from "./version";
import { AstOutput, BuildOptionsBase, compiler, ModuleFormats, ParserOutput, RawOptions, SourceOutput } from "./compiler";
import { Stage } from "./compiler/passes/pass";
import parser from"./parser";
export { GrammarError } from "./grammar-error";
export { compiler, parser };
import type * as a from './parser';
import { ParserModule } from "./generated";
import { SourceNode } from "source-map-generator";

const keys = Object.keys as <T,>(t: T) => (keyof T)[];

const copyPasses = <T,>(passes: Record<Stage, T[]>) => {
  const copy = {...passes};
  for (const stage of keys(copy)) {
    copy[stage] = [...copy[stage]];
  }
  return copy;
}

/**
 * Returns a generated parser object.
 *
 * @param grammar String in the format described by the meta-grammar in the
 *        `parser.pegjs` file
 * @param options Options that allow you to customize returned parser object
 *
 * @throws {SyntaxError}  If the grammar contains a syntax error, for example,
 *         an unclosed brace
 * @throws {GrammarError} If the grammar contains a semantic error, for example,
 *         duplicated labels
 */
export function generate(grammar: string, options?: BuildOptionsBase & ParserOutput): ParserModule;

/**
 * Returns the generated source code as a `string` in the specified module format,
 * with appended source map as a `data:` URI, if requested.
 *
 * @param grammar String in the format described by the meta-grammar in the
 *        `parser.pegjs` file
 * @param options Options that allow you to customize returned parser object
 *
 * @throws {SyntaxError}  If the grammar contains a syntax error, for example,
 *         an unclosed brace
 * @throws {GrammarError} If the grammar contains a semantic error, for example,
 *         duplicated labels
 */
export function generate(grammar: string, options: BuildOptionsBase & ModuleFormats & SourceOutput<"source" | "source-with-inline-map">): string;

/**
 * Returns the generated source code and its source map as a `SourceNode`
 * object. You can get the generated code and the source map by using a
 * `SourceNode` API. Generated code will be in the specified module format.
 *
 * Note, that `SourceNode.source`s of the generated source map will depend
 * on the `options.grammarSource` value. Therefore, value `options.grammarSource`
 * will propagate to the `sources` array of the source map. That array MUST
 * contains absolute paths or paths, relative to the source map location.
 *
 * Because at that level we don't known location of the source map, you probably
 * will need to fix locations:
 *
 * ```ts
 * const mapDir = path.dirname(generatedParserJsMap);
 * const source = peggy.generate(...).toStringWithSourceMap({
 *   file: path.relative(mapDir, generatedParserJs),
 * });
 * const json = source.map.toJSON();
 * json.sources = json.sources.map(src => {
 *   return src === null ? null : path.relative(mapDir, src);
 * });
 * ```
 *
 * @param grammar String in the format described by the meta-grammar in the
 *        `parser.pegjs` file
 * @param options Options that allow you to customize returned parser object
 *
 * @throws {SyntaxError}  If the grammar contains a syntax error, for example,
 *         an unclosed brace
 * @throws {GrammarError} If the grammar contains a semantic error, for example,
 *         duplicated labels
 */
export function generate(grammar: string, options: BuildOptionsBase & ModuleFormats & SourceOutput<"source-and-map">): SourceNode;

/**
 * Returns the generated AST for the grammar. Unlike result of the
 * `peggy.compiler.compile(...)` an AST returned by this method is augmented
 * with data from passes. In other words, the compiler gives you the raw AST,
 * and this method provides the final AST after all optimizations and
 * transformations.
 *
 * @param grammar String in the format described by the meta-grammar in the
 *        `parser.pegjs` file
 * @param options Options that allow you to customize returned AST
 *
 * @throws {SyntaxError}  If the grammar contains a syntax error, for example,
 *         an unclosed brace
 * @throws {GrammarError} If the grammar contains a semantic error, for example,
 *         duplicated labels
 */
export function generate(grammar: string, options: BuildOptionsBase & AstOutput): a.Grammar;
export function generate(grammar: string, options: RawOptions = {}): a.Grammar | ParserModule | string | SourceNode {
  const config = {
    parser: parser,
    passes: copyPasses(compiler.passes),
    reservedWords: RESERVED_WORDS.slice(),
  };

  for (const plugin of (options.plugins ?? [])) {
    plugin.use(config, options);
  }

  return compiler.compile(
    config.parser.parse(grammar, {
      grammarSource: options.grammarSource,
      reservedWords: config.reservedWords,
    }),
    config.passes,
    // error ignored, so that we can avoid exposing ugly overloaded type to end users
    options as any,
  );
};

/**
 * Default list of reserved words. Contains list of currently and future
 * JavaScript (ECMAScript 2015) reserved words.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#reserved_keywords_as_of_ecmascript_2015
 */
export const RESERVED_WORDS = [
  // Reserved keywords as of ECMAScript 2015
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  // "yield", // encountered twice on the web page

  // Special constants
  "null",
  "true",
  "false",

  // These are always reserved:
  "enum",

  // The following are only reserved when they are found in strict mode code
  // Peggy generates code in strictly mode, so it applicable to it
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",

  // The following are only reserved when they are found in module code:
  "await",
];