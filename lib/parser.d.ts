import { ParserModule } from "./generated";
import type { SourceNode } from "source-map-generator";

declare const exports: ParserModule<Grammar>;

export = exports;

/** Options, accepted by the parser of PEG grammar. */
export interface ParserOptions {
  /**
   * Object that will be attached to the each `LocationRange` object created by
   * the parser. For example, this can be path to the parsed file or even the
   * File object.
   */
  grammarSource?: string;
  /**
   * List of words that won't be allowed as label names. Using such word will
   * produce a syntax error.
   */
  reservedWords: string[];
  /** The only acceptable rule is `"Grammar"`, all other values leads to the exception */
  startRule?: "Grammar";
}

type NodesTuple = [
  Grammar,
  TopLevelInitializer,
  Initializer,
  Rule,
  Named,
  Choice,
  Action,
  Sequence,
  Labeled,
  Prefixed,
  Suffixed,
  Group,
  SemanticPredicate,
  RuleReference,
  Literal,
  CharacterClass,
  Any,
];

export type AnyNode = NodesTuple[number];

export type NodeType = AnyNode["type"];

export type NodeTypeToNode = {
  [K in NodeType]:
    AnyNode extends infer N
      // eslint-disable-next-line @typescript-eslint/space-infix-ops
      ? N extends { type: unknown }
        ? K extends N["type"]
          ? N
          : never
        : never
      : never
};

export type Expressions =  {
  rule: Rule;
  named: Named;
  action: Action;
  labeled: Labeled;
  text: Prefixed;
  simple_and: Prefixed;
  simple_not: Prefixed;
  optional: Suffixed;
  zero_or_more: Suffixed;
  one_or_more: Suffixed;
  group: Group;
};

export type VisitorFunctions<T extends unknown[], U> = {
  [K in NodeType]: (node: NodeTypeToNode[K], ...args: T) => U
};

export type Visitor<T extends any[], U> =
  <K extends NodeType>(node: NodeTypeToNode[K], ...args: T) => U;

/** Provides information pointing to a location within a source. */
export interface Location {
  /** Line in the parsed source (1-based). */
  line: number;
  /** Column in the parsed source (1-based). */
  column: number;
  /** Offset in the parsed source (0-based). */
  offset: number;
}

/** The `start` and `end` position's of an object within the source. */
export interface LocationRange {
  /** Any object that was supplied to the `parse()` call as the `grammarSource` option. */
  source: string;
  /** Position at the beginning of the expression. */
  start: Location;
  /** Position after the end of the expression. */
  end: Location;
}

/**
 * Base type for all nodes that represent grammar AST.
 *
 * @template {T} Type of the node
 */
export interface Node<T> {
  /** Defines type of each node */
  type: T;
  /**
   * Location in the source grammar where node is located. Locations of all
   * child nodes always inside location of their parent node.
   */
  location: LocationRange;
}

export const enum MatchResult {
  ALWAYS = 1,
  SOMETIMES = 0,
  NEVER = -1,
}

/**
 * Base interface for all nodes that forming a rule expression.
 *
 * @template {T} Type of the node
 */
export interface Expr<T> extends Node<T> {
  /**
   * The estimated result of matching this node against any input:
   *
   * - `-1`: negative result, matching of that node always fails
   * -  `0`: neutral result, may be fail, may be match
   * -  `1`: positive result, always match
   *
   * This property is created by the `inferenceMatchResult` pass.
   */
  match?: MatchResult;
}

export namespace bytecodeDone {
  export interface CharClassDesc {
    value: (string | [string, string])[];
    inverted: boolean;
    ignoreCase: boolean;
  }

  export interface ExpectedConstRule {
    type: "rule";
    value: string;
  }
  export interface ExpectedConstLiteral {
    type: "literal";
    value: string;
    ignoreCase: boolean;
  }
  export interface ExpectedConstClass {
    type: "class";
    value: (string | [string, string])[];
    inverted: boolean;
    ignoreCase: boolean;
  }
  export interface ExpectedConstAny {
    type: "any";
  }
  export type ExpectedConst =
    | ExpectedConstRule
    | ExpectedConstLiteral
    | ExpectedConstClass
    | ExpectedConstAny;

  export interface FunctionDesc {
    predicate: boolean;
    params: string[];
    body: string;
    location: LocationRange;
  }
}

/** The main Peggy AST class returned by the parser. */
export interface Grammar extends Node<"grammar"> {
  /** Initializer that run once when importing generated parser module. */
  topLevelInitializer?: TopLevelInitializer;
  /** Initializer that run each time when `parser.parse()` method in invoked. */
  initializer?: Initializer;
  /** List of all rules in that grammar. */
  rules: Rule[];

  /**
   * Added by the `generateBytecode` pass
   */
  literals?: string[];
  /**
   * Added by the `generateBytecode` pass
   */
  classes?: bytecodeDone.CharClassDesc[];
  /**
   * Added by the `generateBytecode` pass
   */
  expectations?: bytecodeDone.ExpectedConst[];
  /**
   * Added by the `generateBytecode` pass
   */
  functions?: bytecodeDone.FunctionDesc[];

  /**
   * Added by the `generateJs` pass and contains the JS code and the source
   * map for it.
   */
  code?: SourceNode;
}

/**
 * Base interface for all initializer nodes with the code.
 *
 * @template {T} Type of the node
 */
export interface CodeBlock<T> extends Node<T> {
  /** The code from the grammar. */
  code: string;
  /** Span that covers all code between `{` and `}`. */
  codeLocation: LocationRange;
}

/**
 * Base interface for all expression nodes with the code.
 *
 * @template {T} Type of the node
 */
export interface CodeBlockExpr<T> extends Expr<T> {
  /** The code from the grammar. */
  code: string;
  /** Span that covers all code between `{` and `}`. */
  codeLocation: LocationRange;
}

/**
 * Code that runs one-time on import generated parser or right after
 * `generate(..., { output: "parser" })` returns.
 */
export interface TopLevelInitializer extends CodeBlock<"top_level_initializer"> {}

/** Code that runs on each `parse()` call of the generated parser. */
export interface Initializer extends CodeBlock<"initializer"> {}

export interface Rule extends Expr<"rule"> {
  /** Identifier of the rule. Should be unique in the grammar. */
  name: string;
  /**
   * Span of the identifier of the rule. Used for pointing to the rule
   * in error messages.
   */
  nameLocation: LocationRange;
  /** Parsing expression of this rule. */
  expression: Named | Expression;

  /** Added by the `generateBytecode` pass. */
  bytecode?: number[];
}

/** Represents rule body if it has a name. */
export interface Named extends Expr<"named"> {
  /** Name of the rule that will appear in the error messages. */
  name: string;
  expression: Expression;
}

/** Arbitrary expression of the grammar. */
export type Expression
  = Choice
  | Action
  | Sequence
  | Labeled
  | Prefixed
  | Suffixed
  | Primary;

/** One element of the choice node. */
export type Alternative
  = Action
  | Sequence
  | Labeled
  | Prefixed
  | Suffixed
  | Primary;

export interface Choice extends Expr<"choice"> {
  /**
   * List of expressions to match. Only one of them could match the input,
   * the first one that matched is used as a result of the `choice` node.
   */
  alternatives: Alternative[];
}

export interface Action extends CodeBlockExpr<"action"> {
  expression: (
      Sequence
    | Labeled
    | Prefixed
    | Suffixed
    | Primary
  );
}

/** One element of the sequence node. */
export type Element
  = Labeled
  | Prefixed
  | Suffixed
  | Primary;

export interface Sequence extends Expr<"sequence"> {
  /** List of expressions each of them should match in order to match the sequence. */
  elements: Element[];
}

export interface Labeled extends Expr<"labeled"> {
  /** If `true`, labeled expression is one of automatically returned. */
  pick?: true;
  /**
   * Name of the variable under that result of `expression` will be available
   * in the user code.
   */
  label: string | null;
  /**
   * Span of the identifier of the label. Used for pointing to the label
   * in error messages. If `label` is `null` then this location pointed
   * to the `@` symbol (pick symbol).
   */
  labelLocation: LocationRange;
  /** Expression which result will be available in the user code under name `label`. */
  expression: Prefixed | Suffixed | Primary;
}

/** Expression with a preceding operator. */
export interface Prefixed extends Expr<"text" | "simple_and" | "simple_not"> {
  expression: Suffixed | Primary;
}

/** Expression with a following operator. */
export interface Suffixed extends Expr<"optional" | "zero_or_more" | "one_or_more"> {
  expression: Primary;
}

export type Primary
  = RuleReference
  | SemanticPredicate
  | Group
  | Literal
  | CharacterClass
  | Any;

export interface RuleReference extends Expr<"rule_ref"> {
  /** Name of the rule to refer. */
  name: string;
}

export interface SemanticPredicate extends CodeBlockExpr<"semantic_and" | "semantic_not"> {}

/** Group node introduces new scope for labels. */
export interface Group extends Expr<"group"> {
  expression: Labeled | Sequence;
}

/** Matches continuous sequence of symbols. */
export interface Literal extends Expr<"literal"> {
  /** Sequence of symbols to match. */
  value: string;
  /** If `true`, symbols matches even if they case do not match case in the `value`. */
  ignoreCase: boolean;
}

/** Matches single UTF-16 character. */
export interface CharacterClass extends Expr<"class"> {
  /**
   * Each part represents either symbol range or single symbol.
   * If empty, such character class never matches anything, even end-of-stream marker.
   */
  parts: ([string, string] | string)[];
  /**
   * If `true`, matcher will match, if symbol from input doesn't contains
   * in the `parts`.
   */
  inverted: boolean;
  /**
   * If `true`, symbol matches even if it case do not match case of `string` parts,
   * or it case-paired symbol in the one of ranges of `string[]` parts.
   */
  ignoreCase: boolean;
}

/** Matches any UTF-16 code unit in the input, but doesn't match the empty string. */
export interface Any extends Expr<"any"> {}
